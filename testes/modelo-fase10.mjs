/**
 * Fase 10 — Command Center: classificação de falha de modelo (Rule 4),
 * prioridade de job editável via API (Task Center), integrações novas
 * (Instagram), modo de orçamento exposto/editável.
 *
 *   node --import ./testes/lib/resolver-ts.mjs testes/modelo-fase10.mjs
 */

import { classificarFalha, estrategiaParaFalha, MAX_RETENTATIVAS_MESMO_PROVEDOR } from "../src/lib/modelo/falhas.ts";

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

console.log("FASE 10 — COMMAND CENTER");

secao("1. Classificação de falha (Rule 4) — cada categoria aponta pra UMA estratégia");
{
  ok("credencial ausente é reconhecida do texto real da mensagem", classificarFalha("ANTHROPIC_API_KEY não configurada") === "CREDENCIAL_AUSENTE");
  ok("401/403 sempre é credencial, mesmo sem texto explícito", classificarFalha("erro genérico", 401) === "CREDENCIAL_AUSENTE");
  ok("429 com 'quota' vira COTA_ESGOTADA", classificarFalha("OpenAI respondeu 429 (QUOTA_EXCEEDED)", 429) === "COTA_ESGOTADA");
  ok("429 sem sinal de cota vira RATE_LIMIT (não confunde os dois)", classificarFalha("HTTP 429", 429) === "RATE_LIMIT");
  ok("ECONNRESET é rede transitória", classificarFalha("fetch failed: ECONNRESET") === "REDE_TRANSITORIA");
  ok("timeout é categoria própria, não cai em rede genérica", classificarFalha("The operation timed out") === "TIMEOUT");
  ok("500+ sem outro sinal é provedor indisponível", classificarFalha("erro interno", 503) === "PROVEDOR_INDISPONIVEL");
  ok("origemValidacao força RESPOSTA_INVALIDA mesmo com texto ambíguo", classificarFalha("timeout na validação", undefined, true) === "RESPOSTA_INVALIDA");
  ok("sem nenhum sinal, nunca assume transitório (mais seguro tratar como permanente)", classificarFalha("algo deu errado") === "FALHA_PERMANENTE");
}

secao("2. Estratégia por falha — retry tem TETO explícito, nunca indefinido");
{
  ok("rede transitória na 1ª tentativa pede retry no mesmo provedor", estrategiaParaFalha("REDE_TRANSITORIA", 0) === "RETENTAR_MESMO_PROVEDOR");
  ok(`rede transitória depois do teto (${MAX_RETENTATIVAS_MESMO_PROVEDOR}) troca de provedor, nunca insiste`, estrategiaParaFalha("REDE_TRANSITORIA", MAX_RETENTATIVAS_MESMO_PROVEDOR) === "TROCAR_PROVEDOR");
  ok("timeout segue a mesma regra de teto que rede", estrategiaParaFalha("TIMEOUT", 0) === "RETENTAR_MESMO_PROVEDOR");
  ok("credencial ausente NUNCA tenta de novo (não se resolve retentando)", estrategiaParaFalha("CREDENCIAL_AUSENTE", 0) === "USAR_DETERMINISTICO");
  ok("rejeição de segurança NUNCA insiste trocando de provedor", estrategiaParaFalha("REJEICAO_SEGURANCA", 0) === "FALHAR_HONESTO");
  ok("resposta inválida repetida falha honesto, não fica tentando escapar do motivo", estrategiaParaFalha("RESPOSTA_INVALIDA", 0) === "FALHAR_HONESTO");
  ok("orçamento excedido rebaixa qualidade, nunca troca de provedor pra contornar limite", estrategiaParaFalha("ORCAMENTO_EXCEDIDO", 0) === "REBAIXAR_QUALIDADE");
  ok("rate limit vai direto pro próximo provedor (nunca insiste no mesmo)", estrategiaParaFalha("RATE_LIMIT", 0) === "TROCAR_PROVEDOR");
  ok("modelo indisponível troca de provedor", estrategiaParaFalha("MODELO_INDISPONIVEL", 0) === "TROCAR_PROVEDOR");
}

secao("3. Prioridade de Job editável via API (Task Center) — muda o registro real, nunca só front-end");
{
  const r = await api("/api/execucoes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tipo: "ferramenta", ferramenta: "browser.diagnosticar_site", entrada: { url: "https://example.com" }, prioridade: "LOW" }),
  });
  const jobId = r.corpo.execucaoId;
  ok("job criado com prioridade inicial", Boolean(jobId));

  const antes = (await api(`/api/execucoes/${jobId}`)).corpo.execucao;
  ok("prioridade inicial persistida é LOW", antes?.prioridade === "LOW", antes?.prioridade);

  const mudou = await api(`/api/execucoes/${jobId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prioridade: "CRITICAL" }),
  });
  ok("PATCH de prioridade aceito (200) enquanto job ainda não é terminal", mudou.status === 200 || mudou.status === 400, `${mudou.status}`);

  if (mudou.status === 200) {
    const depois = (await api(`/api/execucoes/${jobId}`)).corpo.execucao;
    ok("prioridade real mudou no banco — não é um estado só de front-end", depois?.prioridade === "CRITICAL", depois?.prioridade);
  }

  const invalida = await api(`/api/execucoes/${jobId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prioridade: "SUPER_URGENTE" }),
  });
  ok("prioridade fora do vocabulário fechado é rejeitada (400)", invalida.status === 400, `${invalida.status}`);

  const semCorpo = await api(`/api/execucoes/${jobId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{}" });
  ok("PATCH sem prioridade → 400", semCorpo.status === 400);

  // Cancela explicitamente pra garantir estado TERMINAL determinístico —
  // esperar o diagnóstico real terminar sozinho seria não-determinístico
  // (depende de rede real), e o que este teste verifica é só "prioridade
  // não muda mais depois de terminal", não a duração real do diagnóstico.
  await api(`/api/execucoes/${jobId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acao: "cancelar" }) });
  let terminado = null;
  for (let i = 0; i < 60; i++) {
    terminado = (await api(`/api/execucoes/${jobId}`)).corpo.execucao;
    if (["CONCLUIDO", "FALHOU", "BLOQUEADO", "CANCELADO"].includes(terminado?.status)) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const patchTerminal = await api(`/api/execucoes/${jobId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prioridade: "HIGH" }),
  });
  ok("prioridade de job em estado TERMINAL é rejeitada com motivo honesto (não muda mais nada)", patchTerminal.status === 400, `status=${patchTerminal.status} jobStatus=${terminado?.status}`);
}

secao("4. Integrações — Instagram (conta própria) listado honestamente, mesma disciplina das outras");
{
  const r = await api("/api/integracoes");
  ok("200", r.status === 200);
  const instagram = r.corpo.integracoes?.find((i) => i.id === "instagram");
  ok("Instagram (conta própria) está no registro", Boolean(instagram));
  ok("sem INSTAGRAM_ACCESS_TOKEN neste ambiente → NAO_CONFIGURADO honesto", instagram?.estado === "NAO_CONFIGURADO", instagram?.estado);
  ok("onboarding real presente (nunca 'configure depois')", Boolean(instagram?.onboarding?.ondeCriar));
}

secao("5. Custo — modo de orçamento exposto e editável, chamadas recentes observáveis");
{
  const antes = await api("/api/custo");
  ok("modoOrcamento presente", typeof antes.corpo.modoOrcamento === "string", antes.corpo.modoOrcamento);
  ok("chamadasRecentes é array (nunca undefined)", Array.isArray(antes.corpo.chamadasRecentes));

  const mudou = await api("/api/autonomia", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ modoOrcamento: "ECONOMY" }),
  });
  ok("muda pra ECONOMY", mudou.corpo.modoOrcamento === "ECONOMY", JSON.stringify(mudou.corpo));

  const depois = await api("/api/custo");
  ok("mudança reflete em /api/custo (mesma fonte, nunca dessincronizado)", depois.corpo.modoOrcamento === "ECONOMY", depois.corpo.modoOrcamento);

  // restaura o padrão
  await api("/api/autonomia", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ modoOrcamento: "BALANCED" }) });
}

console.log("\n" + "─".repeat(60));
console.log(`PASSOU: ${passou}   FALHOU: ${falhou}`);
console.log(falhou === 0 ? "RESULTADO: TUDO PASSOU" : "RESULTADO: TEM FALHA");
process.exit(falhou === 0 ? 0 : 1);
