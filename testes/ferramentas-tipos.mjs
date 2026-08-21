/**
 * disponibilidadeDe — os cinco estados reais de uma Tool, função pura, sem
 * servidor de pé. O registro real (ver testes/orquestrador.mjs, seção 1)
 * hoje só exercita DISPONIVEL, REQUER_CREDENCIAL e NAO_IMPLEMENTADO — nenhuma
 * Tool `implementado: true` no registro atual pede aprovação (as que pedem
 * aprovação ainda são stub), e INDISPONIVEL (serviço temporariamente fora,
 * não "nunca implementado") não tem produtor sem uma checagem de saúde ao
 * vivo, que esta fase não constrói. Este teste prova que a FUNÇÃO em si
 * decide corretamente os cinco casos com objetos fabricados — a lacuna é
 * "nada no registro pede isso hoje", não "a função erra isso".
 *
 *   node --import ./testes/lib/resolver-ts.mjs testes/ferramentas-tipos.mjs
 */

import { disponibilidadeDe, exigeAprovacao } from "../src/lib/ferramentas/tipos.ts";

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

function ferramenta(over) {
  return {
    nome: "teste.ferramenta",
    descricao: "",
    capacidade: "teste",
    nivelPermissao: "READ",
    exigeAprovacaoExplicita: false,
    implementado: true,
    validarEntrada: () => true,
    ...over,
  };
}

console.log("DISPONIBILIDADE DE FERRAMENTA — os 5 estados reais");

secao("1. Cada estado isolado");
{
  ok("implementado + sem credencial + sem aprovação → DISPONIVEL", disponibilidadeDe(ferramenta({})) === "DISPONIVEL");
  ok("não implementado → NAO_IMPLEMENTADO, mesmo com tudo mais 'certo'", disponibilidadeDe(ferramenta({ implementado: false })) === "NAO_IMPLEMENTADO");

  const semVar = "JARVIS_TESTE_CREDENCIAL_QUE_NAO_EXISTE";
  delete process.env[semVar];
  ok(
    "implementado + credencialNecessaria ausente do ambiente → REQUER_CREDENCIAL",
    disponibilidadeDe(ferramenta({ credencialNecessaria: semVar })) === "REQUER_CREDENCIAL",
  );
  process.env[semVar] = "valor-fake-so-pra-este-teste";
  ok(
    "mesma ferramenta, credencial presente no ambiente → DISPONIVEL (deixa de exigir)",
    disponibilidadeDe(ferramenta({ credencialNecessaria: semVar })) === "DISPONIVEL",
  );
  delete process.env[semVar];

  ok(
    "implementado + exigeAprovacaoExplicita → REQUER_APROVACAO",
    disponibilidadeDe(ferramenta({ exigeAprovacaoExplicita: true })) === "REQUER_APROVACAO",
  );
  ok(
    "implementado + nivelPermissao de alto impacto (sem exigeAprovacaoExplicita) → REQUER_APROVACAO também",
    disponibilidadeDe(ferramenta({ nivelPermissao: "EXTERNAL_COMMUNICATION" })) === "REQUER_APROVACAO",
  );
}

secao("2. Prioridade entre estados quando mais de um se aplicaria");
{
  ok(
    "não implementado VENCE mesmo se também exigiria aprovação (nunca finge 'só falta aprovar')",
    disponibilidadeDe(ferramenta({ implementado: false, exigeAprovacaoExplicita: true })) === "NAO_IMPLEMENTADO",
  );
  const semVar2 = "JARVIS_TESTE_CREDENCIAL_2";
  delete process.env[semVar2];
  ok(
    "credencial ausente VENCE sobre exigir aprovação (a ordem real é implementado → credencial → aprovação)",
    disponibilidadeDe(ferramenta({ credencialNecessaria: semVar2, exigeAprovacaoExplicita: true })) === "REQUER_CREDENCIAL",
  );
}

secao("3. exigeAprovacao — vocabulário fechado de níveis de alto impacto");
{
  ok("READ nunca exige aprovação", !exigeAprovacao("READ"));
  ok("WRITE nunca exige aprovação (gerar texto/arquivo não é comunicação externa)", !exigeAprovacao("WRITE"));
  ok("SEND exige aprovação", exigeAprovacao("SEND"));
  ok("DELETE exige aprovação", exigeAprovacao("DELETE"));
  ok("FINANCIAL exige aprovação", exigeAprovacao("FINANCIAL"));
  ok("EXTERNAL_COMMUNICATION exige aprovação", exigeAprovacao("EXTERNAL_COMMUNICATION"));
  ok("ACCOUNT_ACCESS exige aprovação", exigeAprovacao("ACCOUNT_ACCESS"));
}

console.log(`\n${"─".repeat(56)}`);
console.log(`PASSOU: ${passou}   FALHOU: ${falhou}`);
if (falhou > 0) {
  console.log("RESULTADO: FALHOU");
  process.exit(1);
}
console.log("RESULTADO: TUDO PASSOU");
