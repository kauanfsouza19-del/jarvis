/**
 * Fase 18 — sincronização do vault Obsidian via git. Via HTTP real contra
 * o servidor de dev (o módulo toca o banco, mesma convenção já
 * estabelecida desde a Fase 14 pra código que importa dados/db.ts). Não
 * testa push contra um remoto de verdade aqui — isso foi verificado
 * manualmente em produção (ver relatório da fase).
 *
 *   node testes/obsidian-sync-fase18.mjs
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

console.log("FASE 18 — SINCRONIZAÇÃO DO VAULT OBSIDIAN (GIT)");

secao("1. /api/obsidian/sincronizar — honestidade sem OBSIDIAN_GIT_REMOTO configurado");
{
  const r = await api("/api/obsidian/sincronizar", { method: "POST" });
  if (!process.env.OBSIDIAN_GIT_REMOTO) {
    ok("responde 400 (não configurado) — nunca finge sucesso", r.status === 400, String(r.status));
    ok("motivo nomeia exatamente a variável que falta", /OBSIDIAN_GIT_REMOTO/.test(r.corpo.motivo ?? ""), r.corpo.motivo);
  }
}

secao("2. /api/integracoes — entrada obsidian_sync existe e reflete estado real");
{
  const r = await api("/api/integracoes");
  const item = r.corpo.integracoes.find((i) => i.id === "obsidian_sync");
  ok("entrada obsidian_sync existe no painel", Boolean(item));
  if (!process.env.OBSIDIAN_GIT_REMOTO) {
    ok("estado NAO_CONFIGURADO quando a variável não existe (nunca CONECTADO de mentira)", item?.estado === "NAO_CONFIGURADO", item?.estado);
    ok("onboarding aponta pro repositório real (jarvis-obsidian, não um nome genérico inventado)", /jarvis-obsidian/.test(item?.onboarding?.servico ?? ""));
  }
}

console.log(`\n${"─".repeat(56)}`);
console.log(`PASSOU: ${passou}   FALHOU: ${falhou}`);
if (falhou > 0) {
  console.log("RESULTADO: FALHOU");
  process.exit(1);
}
console.log("RESULTADO: TUDO PASSOU");
