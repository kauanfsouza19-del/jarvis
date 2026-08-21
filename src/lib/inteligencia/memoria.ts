import "server-only";
import { criarMemoria } from "../dados/repositorio";
import type { ItemInteligencia } from "./repositorio";

/**
 * Captura de conhecimento durável a partir de inteligência (Fase 13, Rule
 * 10) — nunca todo item vira memória (isso seria ruído, não conhecimento).
 * Só CRITICAL com análise de modelo real (nunca RSS cru, sem interpretação
 * nenhuma) — mesmo padrão de memoria/captura.ts (Fase 9) e social/
 * memoria.ts (Fase 11): reaproveita criarMemoria (dedup por título+
 * confiança+proveniência já prontos desde a Fase 9).
 */
export type AnaliseModeloItem = {
  fato?: string;
  observacao?: string;
  inferencia?: string;
  desconhecido?: string;
  porque_relevante?: string;
  possivel_acao?: string;
};

export function avaliarItemParaMemoria(item: ItemInteligencia, analise: AnaliseModeloItem | null): { capturado: boolean; motivo: string } {
  if (item.prioridade !== "CRITICAL") {
    return { capturado: false, motivo: "só itens CRITICAL viram memória automaticamente — o resto fica só na fila de inteligência" };
  }
  if (!analise) {
    return { capturado: false, motivo: "sem análise de modelo real — nunca vira memória a partir de RSS cru, sem interpretação" };
  }

  const corpo = [analise.observacao, analise.porque_relevante, analise.possivel_acao].filter(Boolean).join(" ") || item.resumo;

  criarMemoria({
    tipo: "FATO",
    titulo: `Inteligência: ${item.titulo}`.slice(0, 150),
    corpo: `${corpo}\nFonte: ${item.url}`,
    camada: "recuperavel",
    origem: `inteligencia:${item.id}`,
    confianca: 0.7,
    importancia: 4,
  });
  return { capturado: true, motivo: "item CRITICAL com análise real de modelo" };
}
