/**
 * Fase 8 — Registro de Provedor/Modelo: disponibilidade real (7 estados),
 * custo por 1M tokens (fonte única, nunca duplicada), estado transitório
 * forçado pra testar fallback/downgrade sem precisar de uma segunda
 * credencial real. Função pura, testada direto (sem servidor).
 *
 *   node --import ./testes/lib/resolver-ts.mjs testes/modelo-registro.mjs
 */

import {
  PROVEDORES,
  MODELOS_REGISTRO,
  disponibilidadeDoProvedor,
  registrarFalhaTransitoria,
  limparEstadoTransitorio,
  calcularCustoUsd,
  obterModelo,
  modelosDoProvedor,
  modelosPorTier,
  tierParaPapel,
} from "../src/lib/modelo/registro.ts";

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

console.log("FASE 8 — REGISTRO DE PROVEDOR/MODELO");

secao("1. Registro — provedores e modelos reais, nenhum decorativo");
{
  ok("Anthropic registrado", PROVEDORES.some((p) => p.id === "anthropic"));
  ok("OpenAI registrado (segundo provedor real, prova arquitetura multi-provedor)", PROVEDORES.some((p) => p.id === "openai"));
  ok("Gemini registrado (terceiro provedor, Fase 17 — tier gratuito)", PROVEDORES.some((p) => p.id === "gemini"));
  ok("modelo Gemini declara custo zero (tier gratuito real, não estimativa)", modelosDoProvedor("gemini").every((m) => m.custoPor1M.entrada === 0 && m.custoPor1M.saida === 0));
  ok("todo modelo aponta pra um provedor que existe no registro", MODELOS_REGISTRO.every((m) => PROVEDORES.some((p) => p.id === m.provedorId)));
  ok("existe pelo menos 1 modelo CHEAP, 1 BALANCED, 1 PREMIUM", ["CHEAP", "BALANCED", "PREMIUM"].every((t) => modelosPorTier(t).length > 0));
  ok("modelosDoProvedor('anthropic') retorna os 3 tiers", modelosDoProvedor("anthropic").length === 3, String(modelosDoProvedor("anthropic").length));
}

secao("2. Disponibilidade real — sem credencial neste ambiente, REQUIRES_CREDENTIAL honesto");
{
  const semChaveOpenAI = !process.env.OPENAI_API_KEY;
  if (semChaveOpenAI) {
    ok("openai sem OPENAI_API_KEY → REQUIRES_CREDENTIAL (nunca finge disponível)", disponibilidadeDoProvedor("openai") === "REQUIRES_CREDENTIAL", disponibilidadeDoProvedor("openai"));
  } else {
    ok("openai com credencial configurada → AVAILABLE", disponibilidadeDoProvedor("openai") === "AVAILABLE", disponibilidadeDoProvedor("openai"));
  }
  ok("provedor desconhecido → DISABLED (nunca lança)", disponibilidadeDoProvedor("provedor-que-nao-existe") === "DISABLED");

  const semChaveGemini = !process.env.GOOGLE_GEMINI_API_KEY;
  if (semChaveGemini) {
    ok("gemini sem GOOGLE_GEMINI_API_KEY → REQUIRES_CREDENTIAL (nunca finge disponível)", disponibilidadeDoProvedor("gemini") === "REQUIRES_CREDENTIAL", disponibilidadeDoProvedor("gemini"));
  } else {
    ok("gemini com credencial configurada → AVAILABLE", disponibilidadeDoProvedor("gemini") === "AVAILABLE", disponibilidadeDoProvedor("gemini"));
  }
}

secao("3. Estado transitório — fallback/downgrade testado de verdade com estado plantado (sem precisar de 2ª credencial real)");
{
  registrarFalhaTransitoria("anthropic", "RATE_LIMITED");
  ok("depois de registrar falha, disponibilidadeDoProvedor reporta RATE_LIMITED", disponibilidadeDoProvedor("anthropic") === "RATE_LIMITED", disponibilidadeDoProvedor("anthropic"));
  limparEstadoTransitorio("anthropic");
  ok(
    "limparEstadoTransitorio reverte pro status real de credencial (não fica preso em RATE_LIMITED pra sempre)",
    disponibilidadeDoProvedor("anthropic") !== "RATE_LIMITED",
    disponibilidadeDoProvedor("anthropic"),
  );

  registrarFalhaTransitoria("anthropic", "QUOTA_EXCEEDED");
  ok("QUOTA_EXCEEDED também é reportado corretamente", disponibilidadeDoProvedor("anthropic") === "QUOTA_EXCEEDED");
  limparEstadoTransitorio("anthropic");
}

secao("4. _estadoForcado — override determinístico só de teste, prova a lógica de downgrade de tier");
{
  const anthropic = PROVEDORES.find((p) => p.id === "anthropic");
  const antes = anthropic._estadoForcado;
  anthropic._estadoForcado = "DISABLED";
  ok("provedor forçado pra DISABLED é reportado assim", disponibilidadeDoProvedor("anthropic") === "DISABLED");
  const modelosDisponiveisAnthropic = modelosDoProvedor("anthropic").filter((m) => disponibilidadeDoProvedor(m.provedorId) === "AVAILABLE");
  ok("com o único provedor real desabilitado, nenhum modelo dele aparece como disponível (Router cairia pro próximo candidato)", modelosDisponiveisAnthropic.length === 0);
  anthropic._estadoForcado = antes;
  ok("estado restaurado depois do teste (nunca deixa efeito colateral)", disponibilidadeDoProvedor("anthropic") !== "DISABLED");
}

secao("5. Custo — fonte única, nunca hardcoded fora do registro");
{
  const custo = calcularCustoUsd("claude-haiku-4-5", 1_000_000, 1_000_000);
  ok("custo calculado bate com a tabela do registro (haiku: $1 entrada + $5 saída por 1M)", custo === 6, String(custo));
  ok("modelo desconhecido custa 0 (nunca inventa preço)", calcularCustoUsd("modelo-inexistente", 1000, 1000) === 0);
  ok("obterModelo devolve undefined honesto pra id desconhecido", obterModelo("nao-existe") === undefined);
}

secao("6. Papel de Agente -> tier (fundação de seleção de modelo por Agente)");
{
  ok("papel 'abordagem' sugere BALANCED", tierParaPapel("abordagem") === "BALANCED");
  ok("papel desconhecido cai num padrão seguro (nunca lança)", ["CHEAP", "BALANCED", "PREMIUM"].includes(tierParaPapel("papel-qualquer")));
}

console.log(`\n${"─".repeat(56)}`);
console.log(`PASSOU: ${passou}   FALHOU: ${falhou}`);
if (falhou > 0) {
  console.log("RESULTADO: FALHOU");
  process.exit(1);
}
console.log("RESULTADO: TUDO PASSOU");
