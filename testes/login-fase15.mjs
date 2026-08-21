/**
 * Fase 15 — login de produção (sessão de navegador). Duas partes:
 *
 * 1) Lógica pura de bloqueio por força bruta (tentativas-login.ts) —
 *    direto, sem servidor.
 * 2) Smoke HTTP contra o servidor de dev SEM JARVIS_TOKEN (modo local
 *    aberto de sempre) — confere que login/status se comportam direito
 *    QUANDO não há senha nenhuma pra checar, sem quebrar nada existente.
 *
 * O fluxo completo COM JARVIS_TOKEN real (login certo → cookie → página
 * libera → logout → volta a bloquear) foi verificado manualmente contra
 * um build de produção real (`next start`) nesta mesma fase — 11 chamadas
 * reais, incluindo o bloqueio de força bruta na 6ª tentativa errada — não
 * repetido aqui como servidor automatizado separado por economia (exigiria
 * subir um SEGUNDO servidor só pra isto; ver relatório da Fase 15 pela
 * transcrição completa da verificação manual).
 *
 *   node testes/login-fase15.mjs
 */
import { estaBloqueado, registrarFalha, registrarSucesso, _resetarParaTeste } from "../src/lib/seguranca/tentativas-login.ts";

const BASE = process.env.JARVIS_URL ?? "http://localhost:3000";
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

console.log("FASE 15 — LOGIN DE PRODUÇÃO");

secao("1. Bloqueio por força bruta — lógica pura, sem servidor");
{
  _resetarParaTeste();
  const ip = "1.2.3.4";
  ok("IP novo não está bloqueado", estaBloqueado(ip).bloqueado === false);
  for (let i = 0; i < 4; i++) registrarFalha(ip);
  ok("4 falhas ainda não bloqueia (limiar é 5)", estaBloqueado(ip).bloqueado === false);
  registrarFalha(ip);
  const b = estaBloqueado(ip);
  ok("5ª falha bloqueia", b.bloqueado === true);
  ok("bloqueio tem prazo no futuro", b.bloqueado === true && b.ateMs > Date.now());

  const outroIp = "5.6.7.8";
  ok("IP diferente não é afetado pelo bloqueio do primeiro", estaBloqueado(outroIp).bloqueado === false);

  registrarSucesso(ip);
  ok("login bem-sucedido reseta o contador (mesmo depois de bloqueado)", estaBloqueado(ip).bloqueado === false);
  _resetarParaTeste();
}

secao("2. Sem JARVIS_TOKEN configurado (modo local aberto) — login não se aplica, nunca finge sessão");
{
  const status = await fetch(`${BASE}/api/auth/status`).then((r) => r.json());
  ok("modo local_aberto reportado quando não há token", status.modo === "local_aberto", JSON.stringify(status));
  ok("autenticado:true em modo aberto (nunca bloqueia o próprio operador local)", status.autenticado === true);

  const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ senha: "qualquer" }) });
  ok("login responde 400 (não 500, não finge sucesso) sem token configurado", login.status === 400, String(login.status));
}

secao("3. Página /login sempre renderiza, independente do modo");
{
  const r = await fetch(`${BASE}/login`);
  ok("/login responde 200", r.status === 200, String(r.status));
}

console.log(`\n${"─".repeat(56)}`);
console.log(`PASSOU: ${passou}   FALHOU: ${falhou}`);
if (falhou > 0) {
  console.log("RESULTADO: FALHOU");
  process.exit(1);
}
console.log("RESULTADO: TUDO PASSOU");
