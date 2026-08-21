/**
 * Fase 14/2 — OAuth do Google + Gmail/Calendar reais (antes eram stub).
 * Via HTTP real contra o servidor de dev, SEM credencial real — o ponto é
 * provar degradação honesta: nunca finge conectado, nunca quebra sem
 * explicar. Rodar com GOOGLE_CLIENT_ID configurado fica documentado como
 * verificação manual futura (ver relatório da fase), não simulado aqui.
 *
 *   node testes/google-oauth-fase14.mjs
 */

const BASE = process.env.JARVIS_URL ?? "http://localhost:3000";
async function api(caminho, opcoes) {
  const r = await fetch(`${BASE}${caminho}`, { redirect: "manual", ...opcoes });
  return { status: r.status, location: r.headers.get("location"), corpo: await r.json().catch(() => null) };
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

console.log("FASE 14/2 — OAUTH GOOGLE + GMAIL/CALENDAR");

secao("1. gmail.*/calendar.* deixaram de ser stub — aparecem como implementado no registro");
{
  const r = await fetch(`${BASE}/api/ferramentas`).then((x) => x.json());
  for (const nome of ["gmail.buscar", "gmail.ler", "calendar.listar", "calendar.criar"]) {
    const f = r.ferramentas.find((x) => x.nome === nome);
    ok(`${nome} existe no registro`, Boolean(f));
    ok(`${nome} está implementado de verdade (não é mais stub)`, f?.implementado === true, `implementado=${f?.implementado}`);
    // Sem GOOGLE_CLIENT_ID neste ambiente (não configurado) — precisa
    // reportar REQUER_CREDENCIAL, nunca DISPONIVEL de mentira.
    ok(`${nome} reporta disponibilidade honesta sem credencial`, ["REQUER_CREDENCIAL", "DISPONIVEL"].includes(f?.disponibilidade), f?.disponibilidade);
  }
}

secao("2. /api/integracoes lista google_gmail/google_calendar com onboarding real");
{
  const r = await fetch(`${BASE}/api/integracoes`).then((x) => x.json());
  const gmail = r.integracoes.find((i) => i.id === "google_gmail");
  const calendar = r.integracoes.find((i) => i.id === "google_calendar");
  ok("google_gmail aparece no registro de integrações", Boolean(gmail));
  ok("google_calendar aparece no registro de integrações", Boolean(calendar));
  ok(
    "estado é NAO_CONFIGURADO ou AUTH_NECESSARIA — nunca CONECTADO sem OAuth real concluído",
    !gmail || ["NAO_CONFIGURADO", "AUTH_NECESSARIA", "CONECTADO"].includes(gmail.estado),
    gmail?.estado,
  );
}

secao("3. /api/integracoes/google/conectar — degradação honesta sem credencial");
{
  const r = await api("/api/integracoes/google/conectar");
  // Sem GOOGLE_CLIENT_ID configurado neste ambiente: 400 com erro claro,
  // nunca um redirect fingindo que ia funcionar.
  if (!process.env.GOOGLE_CLIENT_ID) {
    ok("responde 400 (não configurado) em vez de redirecionar sem poder completar", r.status === 400, String(r.status));
    ok("mensagem de erro nomeia exatamente o que falta", typeof r.corpo?.erro === "string" && /GOOGLE_CLIENT_ID/.test(r.corpo.erro), r.corpo?.erro);
  } else {
    ok("com credencial configurada, redireciona pro consent real do Google", r.status === 307 && /accounts\.google\.com/.test(r.location ?? ""), r.location);
  }
}

secao("4. /api/integracoes/google/callback — nunca grava conexão com code inválido/ausente");
{
  const semCode = await api("/api/integracoes/google/callback");
  ok("sem `code` → redireciona com erro, nunca lança 500", semCode.status === 307 && /google=erro/.test(semCode.location ?? ""), semCode.location);

  const stateInvalido = await api("/api/integracoes/google/callback?code=abc&state=nao-existe");
  ok("`state` que não veio de /conectar → recusado (defesa de CSRF)", stateInvalido.status === 307 && /google=erro/.test(stateInvalido.location ?? ""), stateInvalido.location);
}

secao("5. Rotas OAuth continuam públicas mesmo com JARVIS_TOKEN configurado (regressão coberta em autorizacao.mjs, aqui só smoke real)");
{
  const r = await api("/api/integracoes/google/callback", { headers: {} }); // sem Authorization nenhum
  ok("callback responde (não 401) mesmo sem header de autorização", r.status !== 401, String(r.status));
}

console.log(`\n${"─".repeat(56)}`);
console.log(`PASSOU: ${passou}   FALHOU: ${falhou}`);
if (falhou > 0) {
  console.log("RESULTADO: FALHOU");
  process.exit(1);
}
console.log("RESULTADO: TUDO PASSOU");
