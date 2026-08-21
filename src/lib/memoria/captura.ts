import "server-only";
import { criarMemoria } from "../dados/repositorio";

/**
 * Captura automática de conhecimento (Fase 9, seção 15) — decisão
 * DETERMINÍSTICA de "isto merece virar memória", disparada só ao FIM de
 * uma operação significativa (nunca por evento qualquer, nunca por LLM
 * decidindo "isso parece importante"). Reaproveita `criarMemoria()`
 * (dados/repositorio.ts), que já faz deduplicação por título — é essa
 * dedup que evita a explosão de memórias: um novo lote de oportunidades
 * ATUALIZA a mesma memória "Oportunidades quentes de prospecção" em vez de
 * criar uma nova a cada job.
 */

export type SinalOportunidade = {
  jobId: string;
  hot: number;
  nomesHot: string[];
  origem: string; // ex: "job:<id>" — proveniência real, nunca "desconhecida"
};

/** true só quando existe pelo menos 1 prospect HOT — mesmo limiar já usado pra notificação (ver jobs/resultados.ts), nunca um segundo critério paralelo. */
export function deveCapturarOportunidade(sinal: SinalOportunidade): boolean {
  return sinal.hot > 0;
}

export function capturarOportunidade(sinal: SinalOportunidade): void {
  if (!deveCapturarOportunidade(sinal)) return;
  const lista = sinal.nomesHot.slice(0, 5).join(", ");
  criarMemoria({
    tipo: "OPORTUNIDADE",
    titulo: "Oportunidades quentes de prospecção",
    corpo: `Detecção mais recente (job ${sinal.jobId}): ${sinal.hot} prospect(s) classificados HOT — ${lista}${sinal.hot > 5 ? ` e mais ${sinal.hot - 5}` : ""}.`,
    camada: "recuperavel",
    origem: sinal.origem,
    confianca: 0.8,
    importancia: 3,
  });
}
