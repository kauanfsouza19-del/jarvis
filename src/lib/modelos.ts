import "server-only";

/**
 * Roteador de modelo.
 *
 * Regra: o modelo mais barato que resolve. Modelo forte só quando o erro custa
 * mais que o token — auditoria de conta, planejamento pesado, decisão de alto
 * valor.
 */

export type Complexidade = "simples" | "padrao" | "complexa";

export const MODELOS = {
  simples: "claude-haiku-4-5",
  padrao: "claude-sonnet-5",
  complexa: "claude-opus-5",
} as const satisfies Record<Complexidade, string>;

/** Sinais de que a pergunta merece o modelo forte. */
const SINAIS_COMPLEXOS = [
  "audita",
  "auditoria",
  "estratégia",
  "estrategia",
  "planeja",
  "plano",
  "analisa",
  "análise",
  "analise",
  "diagnóstico",
  "diagnostico",
  "prioriza",
  "decidir",
  "decisão",
  "decisao",
  "compare",
  "compara",
  "arquitetura",
  "estrutura da campanha",
  "por que",
  "porque",
  "vale a pena",
];

/** Sinais de tarefa mecânica — classificar, extrair, formatar. */
const SINAIS_SIMPLES = [
  "classifica",
  "extrai",
  "lista",
  "resume em uma linha",
  "formata",
  "traduz",
  "conta quantos",
];

export function escolherComplexidade(texto: string): Complexidade {
  const t = texto.toLowerCase();

  if (SINAIS_SIMPLES.some((s) => t.includes(s)) && t.length < 200) {
    return "simples";
  }
  if (SINAIS_COMPLEXOS.some((s) => t.includes(s)) || t.length > 800) {
    return "complexa";
  }
  return "padrao";
}

/**
 * Esforço por complexidade. Vale mais que a escolha do modelo em muitos casos:
 * um Sonnet em esforço alto costuma bater um Opus em esforço baixo, e custa
 * menos.
 */
export function escolherEsforco(c: Complexidade): "low" | "medium" | "high" {
  if (c === "simples") return "low";
  if (c === "padrao") return "medium";
  return "high";
}
