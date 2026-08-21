/**
 * Roteador mensagem → tarefa/follow-up — função pura, sem servidor.
 *
 *   node testes/roteador.mjs
 */

import { resolverContexto } from "../src/lib/contexto/resolver.ts";
import { detectarComandoDeTarefa, detectarFollowUp } from "../src/lib/tarefas/roteador.ts";

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

const lexico = { entidades: [] };

console.log("ROTEADOR MENSAGEM → TAREFA");

secao("1. Detecção de comando de tarefa");

const c1 = detectarComandoDeTarefa(
  "Encontre 50 pizzarias em Osasco.",
  resolverContexto("Encontre 50 pizzarias em Osasco.", lexico),
);
ok("detecta tarefa de prospecção", c1?.tipo === "prospeccao");
ok("extrai quantidade = 50", c1?.quantidade === 50, `${c1?.quantidade}`);
ok("extrai vertical", c1?.vertical === "delivery_pizzaria", c1?.vertical ?? "null");
ok("extrai localização", c1?.localizacao === "Osasco", c1?.localizacao ?? "null");

const c2 = detectarComandoDeTarefa(
  "Sobre o Locatta, quero revisar o onboarding.",
  resolverContexto("Sobre o Locatta, quero revisar o onboarding.", lexico),
);
ok("mensagem sem PROSPECCAO não vira tarefa", c2 === null);

const c3 = detectarComandoDeTarefa(
  "Quero e-commerces com Shopify.",
  resolverContexto("Quero e-commerces com Shopify.", lexico),
);
ok("sem número explícito usa padrão de 25", c3?.quantidade === 25, `${c3?.quantidade}`);

secao("2. Detecção de follow-up");

const f1 = detectarFollowUp("Me mostra só os que têm whatsapp.");
ok("detecta filtro de whatsapp", f1?.comWhatsapp === true);

const f2 = detectarFollowUp("Agora separa os 10 melhores.");
ok("detecta limite de 'melhores'", f2?.limite === 10, `${f2?.limite}`);

const f3 = detectarFollowUp("Baixa essa lista.");
ok("'baixa' sem filtro específico vira apenasExibir", f3?.apenasExibir === true);

const f4 = detectarFollowUp("Sobre o Locatta, quero revisar o onboarding.");
ok("mensagem sem palavra de resultado não é follow-up", f4 === null);

const f5 = detectarFollowUp("Qual é a capital da França?");
ok("pergunta genérica não vira follow-up", f5 === null);

console.log(`\n${"─".repeat(56)}`);
console.log(`PASSOU: ${passou}   FALHOU: ${falhou}`);
if (falhou > 0) {
  console.log("RESULTADO: FALHOU");
  process.exit(1);
}
console.log("RESULTADO: TUDO PASSOU");
