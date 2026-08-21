import type { ModeloRegistro, TierModelo } from "./registro";
import type { ModoOrcamento } from "../autonomia";

/**
 * Lógica determinística de tier/score do Router — extraída de roteador.ts
 * (que precisa de "server-only" pra chamar provedor de verdade) pra
 * continuar testável direto, mesmo padrão já usado em escalonamento.ts e
 * cache-frescor.ts nesta fase. Nenhuma destas funções toca rede/banco.
 */

export type PedidoRoteamentoTier = {
  tipoTarefa: string;
  complexidade: "baixa" | "media" | "alta";
  qualidadeNecessaria?: "baixa" | "media" | "alta";
};

/** Tarefa -> tier ideal, antes de qualquer ajuste de orçamento. Nunca hardcoded no meio de uma função de negócio — centralizado aqui, único lugar que decide "isto é caro ou barato por natureza". */
export function tierIdeal(pedido: PedidoRoteamentoTier): TierModelo {
  if (pedido.complexidade === "alta" || pedido.qualidadeNecessaria === "alta" || pedido.tipoTarefa === "raciocinio_estrategico") return "PREMIUM";
  if (pedido.complexidade === "baixa" && pedido.tipoTarefa !== "codigo") return "CHEAP";
  return "BALANCED";
}

export const ORDEM_TIER: TierModelo[] = ["CHEAP", "BALANCED", "PREMIUM"];

/** Tiers aceitáveis pra este pedido, do ideal pro mais fraco — nunca sobe de tier sozinho, só desce quando o ideal falta. */
export function tiersAceitaveis(ideal: TierModelo): TierModelo[] {
  const i = ORDEM_TIER.indexOf(ideal);
  return ORDEM_TIER.slice(0, i + 1).reverse(); // do ideal pro mais barato
}

/**
 * Budget Mode (Fase 9, seção 10) ajusta o tier IDEAL antes do orçamento
 * numérico entrar em jogo — nunca contorna credencial/disponibilidade, só
 * desloca a preferência dentro do que já é elegível.
 */
export function ajustarTierPorModo(ideal: TierModelo, modo: ModoOrcamento): TierModelo {
  if (modo === "ECONOMY") return "CHEAP";
  if (modo === "MAX_QUALITY") return "PREMIUM";
  if (modo === "QUALITY") return ORDEM_TIER[Math.max(ORDEM_TIER.indexOf(ideal), ORDEM_TIER.indexOf("BALANCED"))];
  return ideal; // BALANCED — respeita o ideal calculado pela tarefa, sem viés
}

/**
 * Score de roteamento determinístico e explicável (Fase 9, seção 9) —
 * pesos ilustrativos da própria especificação: CAPABILITY 40% / RELIABILITY
 * 30% / COST 20% / LATENCY 10%. Nunca aprendizado de máquina — cada termo
 * vem de um dado real (registro declarativo ou agregação SQL simples em
 * chamadas_modelo), nunca um peso ajustado sozinho ao longo do tempo.
 */
export function calcularScoreRoteamento(
  modelo: ModeloRegistro,
  idealTier: TierModelo,
  custoMaximoDoLote: number,
  desempenho: { taxaSucesso: number; latenciaMediaMs: number | null } | undefined,
): number {
  const distanciaTier = Math.abs(ORDEM_TIER.indexOf(modelo.tier) - ORDEM_TIER.indexOf(idealTier));
  const scoreCapacidade = distanciaTier === 0 ? 1 : distanciaTier === 1 ? 0.65 : 0.35;

  // Sem histórico ainda: nem otimista nem pessimista — 0.75 neutro, nunca
  // decide sozinho contra um modelo só por falta de dado.
  const scoreConfiabilidade = desempenho ? desempenho.taxaSucesso : 0.75;

  const custoModelo = modelo.custoPor1M.entrada + modelo.custoPor1M.saida;
  const scoreCusto = custoMaximoDoLote > 0 ? 1 - custoModelo / custoMaximoDoLote : 1;

  // Empírico (chamadas_modelo real) vence quando existe; sem histórico
  // ainda, cai pra classe DECLARADA no registro (ver registro.ts) em vez de
  // um 0.75 fixo pra todo mundo — mais honesto que fingir neutralidade
  // quando o próprio registro já declara a expectativa.
  const LATENCIA_REFERENCIA_MS = 4000;
  const SCORE_POR_CLASSE_DECLARADA: Record<string, number> = { baixa: 0.9, media: 0.7, alta: 0.5 };
  const scoreLatencia =
    desempenho?.latenciaMediaMs != null
      ? Math.max(0, 1 - desempenho.latenciaMediaMs / LATENCIA_REFERENCIA_MS)
      : (SCORE_POR_CLASSE_DECLARADA[modelo.latenciaClasse] ?? 0.75);

  return scoreCapacidade * 0.4 + scoreConfiabilidade * 0.3 + scoreCusto * 0.2 + scoreLatencia * 0.1;
}
