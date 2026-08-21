/**
 * Fase 9 — Aceitação E2E real: "Encontre 5 pizzarias em Osasco, analise
 * quais parecem melhores oportunidades e me entregue uma recomendação."
 * Verifica a cadeia completa (descoberta -> diagnóstico -> síntese) e,
 * critério explícito da fase, que NENHUM estágio resolvível
 * deterministicamente chama modelo — custo real precisa ficar em 0 neste
 * ambiente (sem ANTHROPIC_API_KEY/OPENAI_API_KEY configuradas).
 *
 *   node testes/e2e-fase9.mjs
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

console.log("FASE 9 — ACEITAÇÃO E2E REAL (cadeia completa de prospecção)");

secao("Cenário: 'Encontre 5 pizzarias em Osasco, analise quais parecem melhores oportunidades e me entregue uma recomendação.'");
{
  const custoAntes = (await api("/api/custo")).corpo.custoTotalUsd;

  const conv = await api("/api/conversas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ titulo: "e2e fase 9 — pizzarias osasco" }),
  });
  ok("conversa criada", Boolean(conv.corpo.conversa?.id));

  const resp = await fetch(`${BASE}/api/conversar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      conversa_id: conv.corpo.conversa?.id,
      mensagem: "Encontre 5 pizzarias em Osasco, analise quais parecem melhores oportunidades e me entregue uma recomendação.",
    }),
  });
  const linhas = (await resp.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const inicio = linhas.find((l) => l.tipo === "inicio");
  ok("comando aceito e virou execução", Boolean(inicio?.execucaoId));

  let jobFinal = null;
  for (let i = 0; i < 90; i++) {
    jobFinal = (await api(`/api/execucoes/${inicio.execucaoId}`)).corpo.execucao;
    if (["CONCLUIDO", "FALHOU", "BLOQUEADO"].includes(jobFinal?.status)) break;
    await esperar(1000);
  }

  ok("job terminou em estado final (não travou)", ["CONCLUIDO", "FALHOU", "BLOQUEADO"].includes(jobFinal?.status), jobFinal?.status);
  ok(
    "cadeia completa concluiu (descoberta + diagnóstico + síntese) — CONCLUIDO, não FALHOU/BLOQUEADO",
    jobFinal?.status === "CONCLUIDO",
    jobFinal?.status,
  );
  ok("custo_usd do job é 0 — nenhum estágio resolvível deterministicamente chamou modelo", jobFinal?.custo_usd === 0, String(jobFinal?.custo_usd));

  const custoDepois = (await api("/api/custo")).corpo.custoTotalUsd;
  ok("custo total do sistema não mudou — zero chamada de IA na cadeia inteira", custoDepois === custoAntes, `antes=${custoAntes} depois=${custoDepois}`);

  const resultado = jobFinal?.resultado_id ? (await api(`/api/resultados/${jobFinal.resultado_id}`)).corpo : null;
  ok("resultado com prospects reais foi produzido", Boolean(resultado?.prospects?.length), `${resultado?.prospects?.length ?? 0} prospect(s)`);
  ok(
    "prospects têm score real (diagnóstico rodou de verdade, não é lista crua)",
    resultado?.prospects?.some((p) => p.score !== null && p.score !== undefined),
  );

  // Recomendação: se algum prospect for HOT, a captura de conhecimento
  // (memoria/captura.ts, Fase 9) deve ter gravado/atualizado a memória —
  // testado condicionalmente, nunca forçando um resultado específico de
  // rede (Osasco real, sinal pode variar a cada execução).
  const hot = resultado?.prospects?.filter((p) => (p.score ?? -1) >= 80) ?? [];
  if (hot.length > 0) {
    const mem = await api("/api/memorias?tipo=OPORTUNIDADE");
    const capturou = (mem.corpo.memorias ?? mem.corpo ?? []).some?.((m) => m.titulo === "Oportunidades quentes de prospecção");
    ok(`${hot.length} prospect(s) HOT encontrado(s) — captura automática de conhecimento disparou`, Boolean(capturou));
  } else {
    console.log("  (nenhum prospect HOT nesta execução — captura de conhecimento condicional não testada, comportamento normal e honesto)");
  }

  // limpeza — nunca deixa debris de teste na base real
  if (resultado?.prospects?.length) {
    const { DatabaseSync } = await import("node:sqlite");
    const d = new DatabaseSync("dados/jarvis.db");
    for (const p of resultado.prospects) d.prepare("DELETE FROM prospects WHERE id = ?").run(p.id);
    d.prepare("DELETE FROM conversas WHERE id = ?").run(conv.corpo.conversa?.id);
    d.close();
  }
}

console.log("\n" + "─".repeat(60));
console.log(`PASSOU: ${passou}   FALHOU: ${falhou}`);
console.log(falhou === 0 ? "RESULTADO: TUDO PASSOU" : "RESULTADO: TEM FALHA");
process.exit(falhou === 0 ? 0 : 1);
