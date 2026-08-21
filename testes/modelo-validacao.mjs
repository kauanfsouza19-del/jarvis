/**
 * Validação da saída do modelo — resposta malformada nunca vira Plano
 * quebrado. Função pura, sem servidor de pé e sem ANTHROPIC_API_KEY: o
 * `bruto` aqui é fabricado no teste, exatamente como chegaria depois de
 * `JSON.parse` numa resposta real (mal-intencionada, incompleta ou só
 * quebrada) do modelo.
 *
 *   node --import ./testes/lib/resolver-ts.mjs testes/modelo-validacao.mjs
 */

import { validarPlanoProposto, validarInterpretacao, validarDecisao } from "../src/lib/modelo/validacao.ts";

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
const lanca = (fn) => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};

console.log("VALIDAÇÃO DE SAÍDA DO MODELO (plano/interpretação/decisão malformados)");

secao("1. validarPlanoProposto — plano bem formado passa");
{
  const bom = {
    resumoRaciocinio: "Visitar site de cada prospect.",
    nivelRisco: "baixo",
    passos: [{ descricao: "Diagnosticar A", capacidade: "diagnosticar_prospect", entrada: { prospectId: "x" }, dependeDe: [] }],
  };
  const v = validarPlanoProposto(bom);
  ok("plano válido não lança", v.passos.length === 1 && v.nivelRisco === "baixo");
}

secao("2. validarPlanoProposto — rejeita formatos malformados (nunca vira Plano quebrado)");
{
  ok("null → rejeitado", lanca(() => validarPlanoProposto(null)));
  ok("string solta → rejeitada", lanca(() => validarPlanoProposto("isso não é um plano")));
  ok("array na raiz (sem resumoRaciocinio) → rejeitado", lanca(() => validarPlanoProposto([1, 2, 3])));
  ok("sem resumoRaciocinio → rejeitado", lanca(() => validarPlanoProposto({ passos: [] })));
  ok("resumoRaciocinio não-string → rejeitado", lanca(() => validarPlanoProposto({ resumoRaciocinio: 123, passos: [] })));
  ok("passos não é array → rejeitado", lanca(() => validarPlanoProposto({ resumoRaciocinio: "ok", passos: "não é lista" })));
  ok("passo sem descricao → rejeitado", lanca(() => validarPlanoProposto({ resumoRaciocinio: "ok", passos: [{ capacidade: "x" }] })));
  ok("passo sem capacidade → rejeitado (planejador nunca aceita 'capacidade' livre)", lanca(() => validarPlanoProposto({ resumoRaciocinio: "ok", passos: [{ descricao: "x" }] })));
  ok("passo que é string solta dentro do array → rejeitado", lanca(() => validarPlanoProposto({ resumoRaciocinio: "ok", passos: ["passo fantasma"] })));
}

secao("3. validarPlanoProposto — normaliza campos opcionais/ruidosos em vez de rejeitar à toa");
{
  const v = validarPlanoProposto({
    resumoRaciocinio: "ok",
    nivelRisco: "isso não é um nível válido",
    passos: [{ descricao: "x", capacidade: "y", dependeDe: ["não é número", 1, 2.5, null] }],
  });
  ok("nivelRisco inválido cai pro padrão seguro 'baixo', nunca quebra", v.nivelRisco === "baixo", v.nivelRisco);
  ok("entrada ausente vira objeto vazio, nunca undefined solto", JSON.stringify(v.passos[0].entrada) === "{}");
  ok("dependeDe filtra só números (protege passosProntos() de índice inválido)", JSON.stringify(v.passos[0].dependeDe) === "[1,2.5]");
}

secao("4. validarInterpretacao — rejeita classificação fora do vocabulário fechado");
{
  ok("classificação válida passa", validarInterpretacao({ classificacao: "RESULTADO_VAZIO_VALIDO", resumo: "nada encontrado" }).classificacao === "RESULTADO_VAZIO_VALIDO");
  ok("classificação inventada pelo modelo é rejeitada", lanca(() => validarInterpretacao({ classificacao: "TALVEZ_SUCESSO", resumo: "" })));
  ok("null → rejeitado", lanca(() => validarInterpretacao(null)));
  ok("sem campo classificacao → rejeitado", lanca(() => validarInterpretacao({ resumo: "sem classificação nenhuma" })));
}

secao("5. validarDecisao — rejeita ação fora do vocabulário fechado (nunca uma ação arbitrária do modelo)");
{
  ok("ação válida passa", validarDecisao({ acao: "RETENTAR", motivo: "timeout transitório" }).acao === "RETENTAR");
  ok("ação inventada é rejeitada (modelo nunca pode inventar um comando novo)", lanca(() => validarDecisao({ acao: "DELETAR_TUDO", motivo: "" })));
  ok("acao ausente → rejeitado", lanca(() => validarDecisao({ motivo: "sem ação" })));
}

console.log(`\n${"─".repeat(56)}`);
console.log(`PASSOU: ${passou}   FALHOU: ${falhou}`);
if (falhou > 0) {
  console.log("RESULTADO: FALHOU");
  process.exit(1);
}
console.log("RESULTADO: TUDO PASSOU");
