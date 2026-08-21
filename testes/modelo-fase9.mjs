/**
 * Fase 9 — Multi-Model Intelligence Engine: classificação de tarefa,
 * validação semântica de plano, motor de síntese, níveis de escalonamento.
 * Tudo função pura, testada direto (sem servidor de pé).
 *
 *   node --import ./testes/lib/resolver-ts.mjs testes/modelo-fase9.mjs
 */

import { classificarTarefa } from "../src/lib/modelo/classificacao.ts";
import { validarSemanticaPlano } from "../src/lib/modelo/validacao.ts";
import { sintetizar } from "../src/lib/modelo/sintese.ts";
import { decidirNivelEscalonamento } from "../src/lib/modelo/escalonamento.ts";
import { tarefaPodeUsarCache } from "../src/lib/modelo/cache-frescor.ts";
import { tierIdeal, tiersAceitaveis, ajustarTierPorModo, calcularScoreRoteamento } from "../src/lib/modelo/roteador-score.ts";
import { obterModelo } from "../src/lib/modelo/registro.ts";

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

console.log("FASE 9 — MULTI-MODEL INTELLIGENCE ENGINE (testes diretos)");

secao("1. Classificação determinística de tarefa — nunca chama modelo pra classificar");
{
  ok("plano detectado", classificarTarefa("Gere um plano completo passo a passo").classe === "COMPLEX_PLANNING");
  ok("estratégia detectada", classificarTarefa("Qual estratégia vale a pena aqui?").classe === "STRATEGY");
  ok("copy detectada", classificarTarefa("Escreva a abordagem comercial para este prospect").classe === "COPYWRITING");
  ok("pesquisa web detectada", classificarTarefa("Faça uma pesquisa na web sobre o Instagram deles").classe === "WEB_RESEARCH");
  ok("extração detectada", classificarTarefa("Extraia o telefone do site").classe === "EXTRACTION");
  ok("todas determinísticas (nunca gasta modelo pra classificar)", classificarTarefa("qualquer coisa").deterministico === true);
  ok("operação conhecida decide quando texto não bate padrão nenhum", classificarTarefa("blablabla sem padrão", "gerar_plano").classe === "COMPLEX_PLANNING");
  ok("padrão seguro conversacional quando nada bate", classificarTarefa("oi, tudo bem?").classe === "CONVERSATIONAL");
}

secao("2. Validação SEMÂNTICA de plano — esquema OK não basta, capacidade tem que existir de verdade");
{
  const capacidadesReais = ["prospeccao_descoberta", "pesquisa_diagnostico", "gerar_abordagem"];
  const planoValido = {
    resumoRaciocinio: "ok",
    nivelRisco: "baixo",
    passos: [{ descricao: "buscar", capacidade: "prospeccao_descoberta", entrada: {}, dependeDe: [] }],
  };
  const r1 = validarSemanticaPlano(planoValido, capacidadesReais);
  ok("plano com capacidade real passa", r1.valido === true);

  const planoAlucinado = {
    resumoRaciocinio: "ok",
    nivelRisco: "baixo",
    passos: [{ descricao: "fazer mágica", capacidade: "capacidade_que_nao_existe", entrada: {}, dependeDe: [] }],
  };
  const r2 = validarSemanticaPlano(planoAlucinado, capacidadesReais);
  ok("plano com capacidade inventada é reprovado", r2.valido === false);
  ok("problema aponta a capacidade alucinada", r2.problemas[0].includes("capacidade_que_nao_existe"));

  const planoVazio = { resumoRaciocinio: "ok", nivelRisco: "baixo", passos: [] };
  ok("plano sem nenhum passo é reprovado", validarSemanticaPlano(planoVazio, capacidadesReais).valido === false);

  const planoDepInvalida = {
    resumoRaciocinio: "ok",
    nivelRisco: "baixo",
    passos: [{ descricao: "x", capacidade: "prospeccao_descoberta", entrada: {}, dependeDe: [5] }],
  };
  ok("dependeDe apontando pra índice inexistente é reprovado", validarSemanticaPlano(planoDepInvalida, capacidadesReais).valido === false);
}

secao("3. Motor de síntese — nunca promove inferência a fato, nunca esconde divergência");
{
  const concordam = sintetizar([
    { origem: "modelo:a", afirmacao: "O negócio fica em Osasco.", nivel: "OBSERVACAO" },
    { origem: "evidencia:site", afirmacao: "o negócio fica em osasco", nivel: "FATO" },
  ]);
  ok("duas fontes com o mesmo texto (normalizado) concordam", concordam.concordancias.length === 1);
  ok("nível final é o MAIS FRACO entre as que concordam (nunca promove pra FATO só porque uma delas é FATO)", concordam.nivelFinal === "OBSERVACAO");

  const divergem = sintetizar([
    { origem: "modelo:a", afirmacao: "Melhor ângulo é conversão.", nivel: "INFERENCIA", chaveTema: "angulo_venda" },
    { origem: "determinístico:pontuacao", afirmacao: "Melhor ângulo é mensuração.", nivel: "INFERENCIA", chaveTema: "angulo_venda" },
  ]);
  ok("divergência real (mesmo tema, resposta diferente) é detectada, nunca escondida", divergem.divergencias.length === 1);
  ok("divergência nunca vira FATO sozinha", divergem.nivelFinal !== "FATO");

  const isolada = sintetizar([{ origem: "modelo:a", afirmacao: "Provavelmente investe em mídia paga.", nivel: "INFERENCIA" }]);
  ok("alegação de fonte única em nível baixo é reportada como sem suporte", isolada.alegacoesSemSuporte.length === 1);

  ok("sem fontes nenhuma, síntese honesta (DESCONHECIDO, nunca inventa)", sintetizar([]).nivelFinal === "DESCONHECIDO");
}

secao("4. Escalonamento de validação cruzada — nível 1 é o padrão, subir sempre exige sinal concreto");
{
  ok("sem nenhum sinal de risco, fica em nível 1 (nunca gasta em segunda opinião à toa)", decidirNivelEscalonamento({}).nivel === 1);
  ok("confiança baixa sozinha já justifica nível 2", decidirNivelEscalonamento({ confiancaBaixa: true }).nivel === 2);
  ok("alto impacto justifica nível 2", decidirNivelEscalonamento({ altoImpacto: true }).nivel === 2);
  ok("decisão complexa/alto valor é a ÚNICA que justifica nível 3", decidirNivelEscalonamento({ decisaoComplexaOuAltoValor: true }).nivel === 3);
  ok("nível 3 vence mesmo com outros sinais de nível 2 presentes também", decidirNivelEscalonamento({ decisaoComplexaOuAltoValor: true, altoImpacto: true }).nivel === 3);
  const motivo = decidirNivelEscalonamento({ altoImpacto: true, confiancaBaixa: true }).motivo;
  ok("motivo lista os gatilhos reais, nunca um texto genérico", motivo.includes("alto impacto") && motivo.includes("confiança baixa"));
}

secao("5. Frescor de cache — tarefa time-sensitive nunca é servida de cache, mesmo dentro do TTL");
{
  ok("pesquisa web nunca usa cache (dado muda)", tarefaPodeUsarCache("WEB_RESEARCH") === false);
  ok("raciocínio/análise nunca usa cache (depende de evidência corrente)", tarefaPodeUsarCache("REASONING") === false);
  ok("síntese final nunca usa cache", tarefaPodeUsarCache("FINAL_SYNTHESIS") === false);
  ok("classificação simples pode usar cache (não muda com o tempo)", tarefaPodeUsarCache("SIMPLE_CLASSIFICATION") === true);
  ok("extração pode usar cache", tarefaPodeUsarCache("EXTRACTION") === true);
}

secao("6. Tier ideal e Budget Modes — nunca contorna credencial, só desloca preferência");
{
  ok("tarefa complexa pede PREMIUM", tierIdeal({ tipoTarefa: "raciocinio_estrategico", complexidade: "alta" }) === "PREMIUM");
  ok("tarefa simples pede CHEAP", tierIdeal({ tipoTarefa: "classificacao", complexidade: "baixa" }) === "CHEAP");
  ok("tarefa média fica em BALANCED", tierIdeal({ tipoTarefa: "copy", complexidade: "media" }) === "BALANCED");
  ok("tiersAceitaveis(PREMIUM) inclui os 3, do ideal pro mais barato", JSON.stringify(tiersAceitaveis("PREMIUM")) === JSON.stringify(["PREMIUM", "BALANCED", "CHEAP"]));

  ok("ECONOMY sempre força CHEAP, mesmo se o ideal fosse PREMIUM", ajustarTierPorModo("PREMIUM", "ECONOMY") === "CHEAP");
  ok("MAX_QUALITY sempre força PREMIUM, mesmo se o ideal fosse CHEAP", ajustarTierPorModo("CHEAP", "MAX_QUALITY") === "PREMIUM");
  ok("QUALITY nunca desce de BALANCED", ajustarTierPorModo("CHEAP", "QUALITY") === "BALANCED");
  ok("QUALITY não rebaixa PREMIUM", ajustarTierPorModo("PREMIUM", "QUALITY") === "PREMIUM");
  ok("BALANCED respeita o ideal calculado, sem viés", ajustarTierPorModo("CHEAP", "BALANCED") === "CHEAP");
}

secao("7. Score de roteamento — determinístico, explicável, pesos CAPABILITY 40/RELIABILITY 30/COST 20/LATENCY 10");
{
  const haiku = obterModelo("claude-haiku-4-5"); // CHEAP
  const opus = obterModelo("claude-opus-5"); // PREMIUM
  const custoMax = Math.max(haiku.custoPor1M.entrada + haiku.custoPor1M.saida, opus.custoPor1M.entrada + opus.custoPor1M.saida);

  const scoreHaikuParaTarefaCheap = calcularScoreRoteamento(haiku, "CHEAP", custoMax, undefined);
  const scoreOpusParaTarefaCheap = calcularScoreRoteamento(opus, "CHEAP", custoMax, undefined);
  ok("modelo no tier ideal pontua mais que um modelo mais caro fora do tier, pra tarefa barata", scoreHaikuParaTarefaCheap > scoreOpusParaTarefaCheap, `${scoreHaikuParaTarefaCheap.toFixed(3)} > ${scoreOpusParaTarefaCheap.toFixed(3)}`);

  const scoreOpusParaTarefaPremium = calcularScoreRoteamento(opus, "PREMIUM", custoMax, undefined);
  ok("mesmo modelo pontua mais quando ESTÁ no tier ideal da tarefa", scoreOpusParaTarefaPremium > scoreOpusParaTarefaCheap, `${scoreOpusParaTarefaPremium.toFixed(3)} > ${scoreOpusParaTarefaCheap.toFixed(3)}`);

  const semHistorico = calcularScoreRoteamento(haiku, "CHEAP", custoMax, undefined);
  const comHistoricoRuim = calcularScoreRoteamento(haiku, "CHEAP", custoMax, { taxaSucesso: 0.2, latenciaMediaMs: 3000 });
  ok("histórico real de baixo sucesso reduz o score (nunca ignorado)", comHistoricoRuim < semHistorico, `${comHistoricoRuim.toFixed(3)} < ${semHistorico.toFixed(3)}`);

  const score = calcularScoreRoteamento(haiku, "CHEAP", custoMax, undefined);
  ok("score sempre entre 0 e 1 (nunca estoura a escala)", score >= 0 && score <= 1, score.toFixed(3));
}

console.log("\n" + "─".repeat(60));
console.log(`PASSOU: ${passou}   FALHOU: ${falhou}`);
console.log(falhou === 0 ? "RESULTADO: TUDO PASSOU" : "RESULTADO: TEM FALHA");
process.exit(falhou === 0 ? 0 : 1);
