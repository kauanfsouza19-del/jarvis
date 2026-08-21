/**
 * Fronteira de autorização — decisão testada como função pura
 * (src/lib/seguranca/autorizacao.ts), sem depender de servidor nem de
 * `next/server` (que não resolve fora do processo gerenciado pelo Next —
 * tentei subir um segundo `next dev` isolado numa porta separada primeiro;
 * o Next trava UM servidor de dev por DIRETÓRIO de projeto, independente da
 * porta, então essa abordagem não funciona neste repo com o principal de pé).
 *
 *   node testes/autorizacao.mjs
 */

import { decidirAutorizacao } from "../src/lib/seguranca/autorizacao.ts";

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

console.log("FRONTEIRA DE AUTORIZAÇÃO");

const TOKEN = "teste-token-autorizacao-jarvis";

secao("1. Sem JARVIS_TOKEN configurado — modo local (comportamento atual preservado)");
ok(
  "rota protegida passa quando não há token configurado",
  decidirAutorizacao("/api/memorias", null, undefined).permitido === true,
);
ok(
  "mesmo com header presente, sem token configurado o sistema não exige nada",
  decidirAutorizacao("/api/memorias", "Bearer qualquer-coisa", undefined).permitido === true,
);

secao("2. Com token configurado — rotas protegidas exigem o valor certo");
ok("/api/saude continua público mesmo com token configurado", decidirAutorizacao("/api/saude", null, TOKEN).permitido === true);

const semAuth = decidirAutorizacao("/api/memorias", null, TOKEN);
ok("rota protegida sem Authorization → recusado", semAuth.permitido === false);
ok("motivo é identificável", !semAuth.permitido && semAuth.motivo === "nao_autorizado");

ok(
  "token incorreto → recusado",
  decidirAutorizacao("/api/memorias", "Bearer token-errado-de-proposito", TOKEN).permitido === false,
);
ok(
  "token correto → permitido",
  decidirAutorizacao("/api/memorias", `Bearer ${TOKEN}`, TOKEN).permitido === true,
);
ok(
  "aceita o header mesmo sem o prefixo 'Bearer '",
  decidirAutorizacao("/api/memorias", TOKEN, TOKEN).permitido === true,
);

secao("3. Cobertura — rotas de job/aprovação/ferramenta também protegidas");
for (const caminho of ["/api/execucoes", "/api/aprovacoes", "/api/ferramentas", "/api/custo", "/api/whatsapp", "/api/conversar"]) {
  ok(`${caminho} sem token → recusado`, decidirAutorizacao(caminho, null, TOKEN).permitido === false);
}

secao("4. /api/saude público não vaza por coincidência de prefixo");
ok(
  "rota com nome parecido (/api/saudeoutracoisa) continua protegida",
  decidirAutorizacao("/api/saudeoutracoisa", null, TOKEN).permitido === false,
);
ok(
  "subrota real de /api/saude/algo continua liberada",
  decidirAutorizacao("/api/saude/algo", null, TOKEN).permitido === true,
);

secao("5. OAuth do Google — /callback público (vem do domínio do Google), /conectar protegido (Fase 16 — achado real)");
ok(
  "/api/integracoes/google/callback liberado mesmo com token configurado",
  decidirAutorizacao("/api/integracoes/google/callback", null, TOKEN).permitido === true,
);
ok(
  "/api/integracoes/google/conectar EXIGE sessão/Bearer — evita hijack por visitante não autenticado (Fase 16)",
  decidirAutorizacao("/api/integracoes/google/conectar", null, TOKEN).permitido === false,
);
ok(
  "/api/integracoes/google/conectar com Bearer certo → permitido",
  decidirAutorizacao("/api/integracoes/google/conectar", `Bearer ${TOKEN}`, TOKEN).permitido === true,
);
ok(
  "rota com nome parecido não vaza por coincidência de prefixo",
  decidirAutorizacao("/api/integracoes/google/callback-outracoisa", null, TOKEN).permitido === false,
);

secao("6. Login de produção (Fase 15) — /api/auth/* precisa ser público (são elas que autenticam)");
for (const caminho of ["/api/auth/login", "/api/auth/logout", "/api/auth/status"]) {
  ok(`${caminho} liberado mesmo com token configurado`, decidirAutorizacao(caminho, null, TOKEN).permitido === true);
}
ok(
  "rota com nome parecido não vaza por coincidência de prefixo",
  decidirAutorizacao("/api/auth/login-outracoisa", null, TOKEN).permitido === false,
);

secao("7. Webhook do WhatsApp (Fase 16) — público no middleware, segredo próprio checado dentro da rota");
ok(
  "/api/whatsapp/webhook liberado mesmo com token configurado (Evolution não manda Bearer/cookie)",
  decidirAutorizacao("/api/whatsapp/webhook", null, TOKEN).permitido === true,
);
ok(
  "/api/whatsapp (status/QR, rota diferente) continua exigindo autenticação normal",
  decidirAutorizacao("/api/whatsapp", null, TOKEN).permitido === false,
);

console.log(`\n${"─".repeat(56)}`);
console.log(`PASSOU: ${passou}   FALHOU: ${falhou}`);
if (falhou > 0) {
  console.log("RESULTADO: FALHOU");
  process.exit(1);
}
console.log("RESULTADO: TUDO PASSOU");
