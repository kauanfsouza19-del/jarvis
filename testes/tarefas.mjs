/**
 * Motor de Tarefa → Resultado → Arquivo, ponta a ponta, via HTTP real.
 *
 * Cenário: "Jarvis, encontre pizzarias em Osasco." → tarefa criada → executor
 * roda de verdade (Playwright real) → resultado com CSV/XLSX reais no disco →
 * follow-up conversacional filtra sem rodar de novo.
 *
 * Desde a fase de Execução Dinâmica, descoberta real (OpenStreetMap, sem
 * credencial) está sempre disponível — "Encontre pizzarias em Osasco."
 * agora acha pizzarias REAIS em vez de reaproveitar os 2 seeds fictícios
 * cadastrados abaixo (comportamento correto e intencional: descoberta ao
 * vivo tem prioridade sobre reaproveitar cadastro manual). Os seeds
 * continuam existindo só pra garantir que o teste tem prospect pra
 * trabalhar mesmo se a rede/OSM estiver fora nesse instante; as
 * verificações de conteúdo são sobre o resultado REAL (nomes/quantidade
 * não são mais previsíveis), não mais sobre os 2 seeds especificamente —
 * ver testes/execucao-dinamica.mjs pra cobertura dedicada da descoberta
 * dinâmica em si.
 *
 *   node testes/tarefas.mjs
 */

const BASE = process.env.JARVIS_URL ?? "http://localhost:3000";
async function api(caminho, opcoes) {
  const r = await fetch(`${BASE}${caminho}`, opcoes);
  return { status: r.status, corpo: await r.json().catch(() => ({})) };
}

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

console.log("MOTOR DE TAREFA → RESULTADO → ARQUIVO");

/* ── seed: prospects reais de pizzaria em Osasco, com site real ── */

secao("0. Seed — prospects reais para a tarefa ter o que diagnosticar");

// Domínios DIFERENTES de propósito — mesmo domínio nos dois seeds faria a
// deduplicação (correta) fundir os dois numa linha só, e o teste deixaria
// de provar "2 prospects num resultado".
const SEEDS = [
  { negocio: "___Teste Pizzaria A___", website: "https://example.com" },
  { negocio: "___Teste Pizzaria B___", website: "https://example.org" },
];
for (const s of SEEDS) {
  const r = await api("/api/prospeccao", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      acao: "criar",
      negocio: s.negocio,
      vertical: "delivery_pizzaria",
      cidade: "Osasco",
      website: s.website,
      fonte: "teste_automatizado",
    }),
  });
  ok(`seed "${s.negocio}" criado`, r.status === 201, String(r.status));
}
const NEGOCIOS_TESTE = SEEDS.map((s) => s.negocio);

/* ── 1. conversa + comando de tarefa ── */

secao("1. Comando de chat vira tarefa real (sem chamar modelo)");

const conv = await api("/api/conversas", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ titulo: "teste tarefa" }),
});
const conversaId = conv.corpo.conversa?.id;
ok("conversa criada", Boolean(conversaId));

let execucaoId;
{
  const r = await fetch(`${BASE}/api/conversar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversa_id: conversaId, mensagem: "Encontre pizzarias em Osasco." }),
  });
  ok("comando aceito → 200", r.status === 200, String(r.status));
  const texto = await r.text();
  const linhas = texto.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const inicio = linhas.find((l) => l.tipo === "inicio");
  execucaoId = inicio?.execucaoId;
  ok("evento 'inicio' carrega execucaoId", Boolean(execucaoId), execucaoId ?? "ausente");
  ok("nenhuma chamada de modelo — 'modelo' é null", inicio?.modelo === null, String(inicio?.modelo));
  const fim = linhas.find((l) => l.tipo === "fim");
  ok("uso de token é zero (resposta local)", fim?.uso?.entrada === 0 && fim?.uso?.saida === 0);
}

/* ── 2. execução real — polling até concluir ── */

secao("2. Execução real (Playwright de verdade, visível por polling)");

let execucao;
const t0 = Date.now();
for (let i = 0; i < 100; i++) {
  const r = await api(`/api/execucoes/${execucaoId}`);
  execucao = r.corpo.execucao;
  if (execucao.status === "CONCLUIDO" || execucao.status === "FALHOU" || execucao.status === "BLOQUEADO") break;
  await new Promise((res) => setTimeout(res, 1000));
}
const duracao = Date.now() - t0;

ok("execução saiu de FILA/EXECUTANDO", ["CONCLUIDO", "FALHOU", "BLOQUEADO"].includes(execucao?.status), execucao?.status);
ok("execução levou tempo real (não instantânea)", duracao > 500, `${duracao}ms`);
ok("progresso foi de verdade incrementado", execucao?.progresso_total > 0, `${execucao?.progresso_atual}/${execucao?.progresso_total}`);

if (execucao?.status === "CONCLUIDO") {
  ok("execução concluída tem resultado_id", Boolean(execucao.resultado_id));
}

/* ── 3. resultado + arquivos reais ── */

secao("3. Resultado é objeto real, arquivos existem de verdade");

let resultadoId = execucao?.resultado_id;
let resultado;
if (resultadoId) {
  const r = await api(`/api/resultados/${resultadoId}`);
  resultado = r.corpo;
  ok("GET resultado → 200 com prospects", Array.isArray(resultado.prospects), String(resultado.prospects?.length));
  ok(
    "resultado tem prospect(s) real(is) — descoberta ao vivo (OSM) tem prioridade sobre reaproveitar seed manual",
    resultado.prospects.length > 0 && resultado.prospects.every((p) => p.negocio?.length > 0),
    `${resultado.prospects.length} prospect(s): ${resultado.prospects.map((p) => p.negocio).join(", ")}`,
  );
  ok("prospects foram diagnosticados (score não nulo)", resultado.prospects.every((p) => p.score !== null));
  ok("2 arquivos gerados (csv + xlsx)", resultado.arquivos?.length === 2, `${resultado.arquivos?.length}`);

  const csv = resultado.arquivos.find((a) => a.tipo === "csv");
  const xlsx = resultado.arquivos.find((a) => a.tipo === "xlsx");

  const rc = await fetch(`${BASE}/api/arquivos/${csv.id}`);
  const bufCsv = await rc.arrayBuffer();
  ok("download do CSV é 200", rc.status === 200);
  ok("CSV baixado tem conteúdo real (bytes > 0)", bufCsv.byteLength > 50, `${bufCsv.byteLength} bytes`);
  ok(
    "CSV contém o nome de um prospect real do resultado",
    new TextDecoder().decode(bufCsv).includes(resultado.prospects[0]?.negocio ?? "\0impossivel"),
  );

  const rx = await fetch(`${BASE}/api/arquivos/${xlsx.id}`);
  const bufXlsx = await rx.arrayBuffer();
  ok("download do XLSX é 200", rx.status === 200);
  // XLSX é um ZIP — assinatura mágica PK\x03\x04
  const assinatura = new Uint8Array(bufXlsx.slice(0, 4));
  ok(
    "XLSX baixado é um arquivo ZIP real (assinatura PK)",
    assinatura[0] === 0x50 && assinatura[1] === 0x4b,
    Array.from(assinatura).map((b) => b.toString(16)).join(" "),
  );

  const semArquivo = await fetch(`${BASE}/api/arquivos/id-que-nao-existe`);
  ok("id de arquivo inexistente → 404, não 200 vazio", semArquivo.status === 404);
} else {
  ok("(pulado: execução não concluiu com resultado)", false, execucao?.erro ?? execucao?.status);
}

/* ── 4. follow-up conversacional — filtra sem buscar de novo ── */

secao("4. Follow-up — 'mostra os melhores' filtra o resultado existente");

if (resultadoId) {
  const r = await fetch(`${BASE}/api/conversar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversa_id: conversaId, mensagem: "Me mostra o resultado." }),
  });
  const texto = await r.text();
  const linhas = texto.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const inicio = linhas.find((l) => l.tipo === "inicio");
  ok("follow-up não cria execução nova", !inicio?.execucaoId);
  ok("follow-up reaproveita resultado (mesmo id ou derivado)", Boolean(inicio?.resultadoId));
  ok("follow-up também custa zero de modelo", linhas.find((l) => l.tipo === "fim")?.uso?.entrada === 0);
}

/* ── limpeza ── */

secao("5. Limpeza");

const { DatabaseSync } = await import("node:sqlite");
const { unlinkSync } = await import("node:fs");
const db = new DatabaseSync("dados/jarvis.db");
db.exec("PRAGMA foreign_keys = ON");

// Arquivo real gerado em disco — apaga antes de derrubar a linha, senão o
// caminho se perde e o arquivo fica órfão em dados/arquivos/.
const arquivos = db
  .prepare(
    `SELECT ag.caminho FROM arquivos_gerados ag
       JOIN resultados r ON r.id = ag.resultado_id
      WHERE r.execucao_id = ?`,
  )
  .all(execucaoId);
for (const a of arquivos) {
  try {
    unlinkSync(a.caminho);
  } catch {
    /* já não existe — segue */
  }
}

// Deletar o job cascadeia para resultados/resultado_prospects/arquivos_gerados/
// job_passos/job_eventos/notificacoes — é o mesmo teste provando, na prática,
// que o cascade da FK jobs(id) está correto de ponta a ponta.
db.prepare("DELETE FROM jobs WHERE id = ?").run(execucaoId);
db.prepare("DELETE FROM prospects WHERE negocio LIKE '___Teste Pizzaria%'").run();
// Descoberta ao vivo (OSM) pode ter achado pizzarias REAIS pra este
// resultado — nunca ficam presas no banco só porque não batem o padrão
// de nome fictício acima.
if (resultado?.prospects?.length) {
  for (const p of resultado.prospects) db.prepare("DELETE FROM prospects WHERE id = ?").run(p.id);
}
db.prepare("DELETE FROM conversas WHERE id = ?").run(conversaId);

const sobrouProspect = db.prepare("SELECT COUNT(*) n FROM prospects WHERE negocio LIKE '___Teste Pizzaria%'").get().n;
const sobrouConversa = db.prepare("SELECT COUNT(*) n FROM conversas WHERE id = ?").get(conversaId).n;
const sobrouJob = db.prepare("SELECT COUNT(*) n FROM jobs WHERE id = ?").get(execucaoId).n;
const sobrouResultado = db.prepare("SELECT COUNT(*) n FROM resultados WHERE execucao_id = ?").get(execucaoId).n;
const sobrouNotificacao = db.prepare("SELECT COUNT(*) n FROM notificacoes WHERE job_id = ?").get(execucaoId).n;
db.close();
ok("prospects de teste removidos", sobrouProspect === 0);
ok("conversa de teste removida", sobrouConversa === 0);
ok("job de teste removido", sobrouJob === 0);
ok("cascade removeu resultado junto com o job", sobrouResultado === 0);
ok("cascade removeu notificação junto com o job", sobrouNotificacao === 0);

console.log(`\n${"─".repeat(56)}`);
console.log(`PASSOU: ${passou}   FALHOU: ${falhou}`);
if (falhou > 0) {
  console.log("RESULTADO: FALHOU");
  process.exit(1);
}
console.log("RESULTADO: TUDO PASSOU");
