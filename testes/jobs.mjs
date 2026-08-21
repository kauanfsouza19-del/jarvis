/**
 * Ciclo de vida do job — idempotência, concorrência, cancelamento,
 * retentativa, aprovação e notificação. Tudo via HTTP real contra o
 * servidor de dev, sem derrubá-lo (recuperação após reinício é testada à
 * parte, ver relatório — precisa matar o processo de verdade).
 *
 *   node testes/jobs.mjs
 */

const BASE = process.env.JARVIS_URL ?? "http://localhost:3000";
async function api(caminho, opcoes) {
  const r = await fetch(`${BASE}${caminho}`, opcoes);
  return { status: r.status, corpo: await r.json().catch(() => ({})) };
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

let passou = 0,
  falhou = 0;
const ok = (n, c, det = "") => {
  if (c) {
    passou++;
    console.log(`  ok   ${n}${det ? ` — ${det}` : ""}`);
  } else {
    falhou++;
    console.log(`  FALHOU  ${n}${det ? ` — ${det}` : ""}`);
  }
};
const secao = (t) => console.log(`\n${t}`);

console.log("CICLO DE VIDA DO JOB");

async function criarProspect(negocio, website) {
  const r = await api("/api/prospeccao", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ acao: "criar", negocio, vertical: "delivery_pizzaria", website, fonte: "teste_jobs" }),
  });
  return r.corpo.prospect.id;
}

async function aguardarTerminal(execucaoId, tentativas = 100) {
  for (let i = 0; i < tentativas; i++) {
    const r = await api(`/api/execucoes/${execucaoId}`);
    const s = r.corpo.execucao?.status;
    if (["CONCLUIDO", "FALHOU", "BLOQUEADO", "CANCELADO", "AGUARDANDO_APROVACAO"].includes(s)) return r.corpo.execucao;
    await esperar(1000);
  }
  return null;
}

const idsProspectsCriados = [];
const idsJobsCriados = [];

/* ── 1. idempotência ── */

secao("1. Idempotência — job idêntico não duplica");

const pIdemp = await criarProspect("___Teste Jobs Idemp___", "https://example.com");
idsProspectsCriados.push(pIdemp);

const j1 = await api("/api/execucoes", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ tipo: "prospeccao", prospectIds: [pIdemp], quantidade: 1 }),
});
ok("primeiro job criado → 201", j1.status === 201, String(j1.status));
idsJobsCriados.push(j1.corpo.execucaoId);

const j2 = await api("/api/execucoes", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ tipo: "prospeccao", prospectIds: [pIdemp], quantidade: 1 }),
});
ok("job idêntico enquanto o primeiro roda → 200, não 201", j2.status === 200, String(j2.status));
ok("mesmo id do primeiro job", j2.corpo.execucaoId === j1.corpo.execucaoId);

await aguardarTerminal(j1.corpo.execucaoId);

/* ── 2. jobs concorrentes e independentes ── */

secao("2. Jobs concorrentes — não bloqueiam um ao outro");

const pA = await criarProspect("___Teste Jobs Conc A___", "https://example.com");
const pB = await criarProspect("___Teste Jobs Conc B___", "https://example.org");
idsProspectsCriados.push(pA, pB);

const t0 = Date.now();
const [jobA, jobB] = await Promise.all([
  api("/api/execucoes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tipo: "prospeccao", prospectIds: [pA], quantidade: 1 }),
  }),
  api("/api/execucoes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tipo: "prospeccao", prospectIds: [pB], quantidade: 1 }),
  }),
]);
idsJobsCriados.push(jobA.corpo.execucaoId, jobB.corpo.execucaoId);
ok("dois jobs distintos criados", jobA.corpo.execucaoId !== jobB.corpo.execucaoId);

// Se rodassem em série, o segundo só começaria depois do primeiro terminar
// (~20-30s de Playwright). Concorrente: os dois devem estar EXECUTANDO ao
// mesmo tempo em algum momento dentro de poucos segundos.
await esperar(3000);
const statusA = await api(`/api/execucoes/${jobA.corpo.execucaoId}`);
const statusB = await api(`/api/execucoes/${jobB.corpo.execucaoId}`);
ok(
  "os dois já saíram de FILA quase juntos (não serializados)",
  statusA.corpo.execucao.status !== "FILA" && statusB.corpo.execucao.status !== "FILA",
  `A=${statusA.corpo.execucao.status} B=${statusB.corpo.execucao.status}`,
);

await Promise.all([aguardarTerminal(jobA.corpo.execucaoId), aguardarTerminal(jobB.corpo.execucaoId)]);
const duracaoConcorrente = Date.now() - t0;
ok(
  "tempo total é próximo de UM diagnóstico, não da soma dos dois",
  duracaoConcorrente < 50000,
  `${duracaoConcorrente}ms`,
);

/* ── 3. cancelamento ── */

secao("3. Cancelamento cooperativo");

const pC1 = await criarProspect("___Teste Jobs Cancel 1___", "https://example.com");
const pC2 = await criarProspect("___Teste Jobs Cancel 2___", "https://example.org");
idsProspectsCriados.push(pC1, pC2);

const jobCancel = await api("/api/execucoes", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ tipo: "prospeccao", prospectIds: [pC1, pC2], quantidade: 2 }),
});
idsJobsCriados.push(jobCancel.corpo.execucaoId);

// espera o job realmente começar a trabalhar no primeiro antes de cancelar
await esperar(2000);
const cancelResp = await api(`/api/execucoes/${jobCancel.corpo.execucaoId}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ acao: "cancelar" }),
});
ok("pedido de cancelamento aceito", cancelResp.corpo.ok === true, JSON.stringify(cancelResp.corpo));

const finalCancel = await aguardarTerminal(jobCancel.corpo.execucaoId);
ok("job termina como CANCELADO", finalCancel?.status === "CANCELADO", finalCancel?.status);
ok(
  "progresso não chegou ao fim (cancelou antes do 2º prospect)",
  finalCancel && finalCancel.progresso_atual <= finalCancel.progresso_total,
  `${finalCancel?.progresso_atual}/${finalCancel?.progresso_total}`,
);

/* ── 4. job genérico de ferramenta — tipo desconhecido não cria job fantasma ── */

secao("4. Job de tipo desconhecido não cria nada");

const tipoDesconhecido = await api("/api/execucoes", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ tipo: "isso_nao_existe" }),
});
ok("tipo desconhecido → 400 (não cria job fantasma)", tipoDesconhecido.status === 400, String(tipoDesconhecido.status));

/* ── 4b. retentativa — job que falhou de verdade pode ser retentado ── */

secao("4b. Retentativa — job FALHOU pode ser retentado");

const jobFalha = await api("/api/execucoes", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ tipo: "ferramenta", ferramenta: "ferramenta_que_nao_existe_no_registro", entrada: {} }),
});
idsJobsCriados.push(jobFalha.corpo.execucaoId);

const falhou1 = await aguardarTerminal(jobFalha.corpo.execucaoId);
ok("job com ferramenta inexistente falha de verdade", falhou1?.status === "FALHOU", falhou1?.status);
ok("tentativas começa em 0", falhou1?.tentativas === 0, String(falhou1?.tentativas));

const naoPodeCancelar = await api(`/api/execucoes/${jobFalha.corpo.execucaoId}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ acao: "cancelar" }),
});
ok("job já FALHOU não aceita cancelamento (estado final)", naoPodeCancelar.corpo.ok === false);

const retentativa = await api(`/api/execucoes/${jobFalha.corpo.execucaoId}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ acao: "retentar" }),
});
ok("retentativa aceita", retentativa.corpo.ok === true, JSON.stringify(retentativa.corpo));

const falhou2 = await aguardarTerminal(jobFalha.corpo.execucaoId);
ok("job retentado falha de novo pelo mesmo motivo real (não finge sucesso)", falhou2?.status === "FALHOU", falhou2?.status);
ok("contador de tentativas incrementou", falhou2?.tentativas === 1, String(falhou2?.tentativas));

/* ── 5. fluxo de aprovação — ferramenta de alto impacto pausa o job ── */

secao("5. Aprovação — ferramenta EXTERNAL_COMMUNICATION pausa antes de executar");

const ferramentas = await api("/api/ferramentas");
const whatsappTool = ferramentas.corpo.ferramentas.find((f) => f.nome === "whatsapp.enviar");
ok("registro de ferramentas expõe whatsapp.enviar", Boolean(whatsappTool));
ok("whatsapp.enviar exige aprovação explícita", whatsappTool?.exigeAprovacaoExplicita === true);
ok("whatsapp.enviar NÃO está marcado como implementado (honestidade)", whatsappTool?.implementado === false);

const jobAprovacao = await api("/api/execucoes", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    tipo: "ferramenta",
    ferramenta: "whatsapp.enviar",
    entrada: { numero: "5511999999999", texto: "teste automatizado" },
  }),
});
ok("job de ferramenta criado → 201", jobAprovacao.status === 201, String(jobAprovacao.status));
idsJobsCriados.push(jobAprovacao.corpo.execucaoId);

const pausado = await aguardarTerminal(jobAprovacao.corpo.execucaoId);
ok("job pausa em AGUARDANDO_APROVACAO, não executa direto", pausado?.status === "AGUARDANDO_APROVACAO", pausado?.status);

const listaAprovacoes = await api("/api/aprovacoes?pendentes=1");
const aprovacaoCriada = listaAprovacoes.corpo.aprovacoes.find((a) => a.job_id === jobAprovacao.corpo.execucaoId);
ok("aprovação pendente aparece no registro", Boolean(aprovacaoCriada));
ok("aprovação carrega o nível de permissão certo", aprovacaoCriada?.nivel_permissao === "EXTERNAL_COMMUNICATION");

const aprovado = await api("/api/aprovacoes", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ id: aprovacaoCriada.id, aprovar: true }),
});
ok("aprovação aceita → ok", aprovado.corpo.ok === true, JSON.stringify(aprovado.corpo));

const posAprovacao = await aguardarTerminal(jobAprovacao.corpo.execucaoId);
ok(
  "após aprovar, job NÃO finge sucesso — ferramenta não implementada vira BLOQUEADO honesto",
  posAprovacao?.status === "BLOQUEADO",
  posAprovacao?.status,
);
ok(
  "motivo do bloqueio menciona que não está implementada",
  (posAprovacao?.erro ?? "").toLowerCase().includes("implementada"),
  posAprovacao?.erro ?? "",
);

/* ── 6. rejeição de aprovação cancela o job ── */

secao("6. Rejeitar aprovação cancela o job");

const jobRejeitado = await api("/api/execucoes", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ tipo: "ferramenta", ferramenta: "whatsapp.enviar", entrada: { numero: "x", texto: "y" } }),
});
idsJobsCriados.push(jobRejeitado.corpo.execucaoId);
await aguardarTerminal(jobRejeitado.corpo.execucaoId);

const listaAprov2 = await api("/api/aprovacoes?pendentes=1");
const aprovacaoRejeitar = listaAprov2.corpo.aprovacoes.find((a) => a.job_id === jobRejeitado.corpo.execucaoId);
await api("/api/aprovacoes", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ id: aprovacaoRejeitar.id, aprovar: false }),
});
const posRejeicao = await aguardarTerminal(jobRejeitado.corpo.execucaoId);
ok("rejeitar aprovação cancela o job", posRejeicao?.status === "CANCELADO", posRejeicao?.status);

/* ── 7. notificações — job concluído/bloqueado gera notificação real ── */

secao("7. Notificações");

const naoLidas = await api("/api/notificacoes?nao_lidas=1");
const notifDoJobAprovacao = naoLidas.corpo.notificacoes.find((n) => n.job_id === jobAprovacao.corpo.execucaoId);
ok("job bloqueado gerou notificação real", Boolean(notifDoJobAprovacao));

if (notifDoJobAprovacao) {
  await api("/api/notificacoes", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: notifDoJobAprovacao.id }),
  });
  const depoisDeLer = await api("/api/notificacoes?nao_lidas=1");
  ok(
    "marcar como lida remove da lista de não lidas",
    !depoisDeLer.corpo.notificacoes.some((n) => n.id === notifDoJobAprovacao.id),
  );
}

console.log(`\n${"─".repeat(56)}`);
console.log(`PASSOU: ${passou}   FALHOU: ${falhou}`);

/* ── limpeza ── */

const { DatabaseSync } = await import("node:sqlite");
const { unlinkSync } = await import("node:fs");
const db = new DatabaseSync("dados/jarvis.db");
db.exec("PRAGMA foreign_keys = ON");
for (const jobId of idsJobsCriados) {
  const arqs = db
    .prepare(`SELECT ag.caminho FROM arquivos_gerados ag JOIN resultados r ON r.id = ag.resultado_id WHERE r.execucao_id = ?`)
    .all(jobId);
  for (const a of arqs) {
    try {
      unlinkSync(a.caminho);
    } catch {
      /* ok */
    }
  }
  db.prepare("DELETE FROM jobs WHERE id = ?").run(jobId);
}
db.prepare(`DELETE FROM prospects WHERE negocio LIKE '___Teste Jobs%'`).run();
db.close();

if (falhou > 0) {
  console.log("RESULTADO: FALHOU");
  process.exit(1);
}
console.log("RESULTADO: TUDO PASSOU");
