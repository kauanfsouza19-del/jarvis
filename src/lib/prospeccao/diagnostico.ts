import "server-only";
import { diagnosticarSite, type SinaisSite } from "../pesquisa/navegador";
import { registrarVisitaSite } from "./repositorio";

/**
 * Resolve os sinais de site pra um estágio do pipeline — visita de verdade,
 * A MENOS que o próprio Orquestrador já tenha passado adiante o resultado de
 * uma visita anterior no MESMO plano (ver jobs/handlers/plano-orquestrado.ts,
 * EXPANSORES: quando um estágio encadeia o próximo pro MESMO prospect, o
 * `saida.sinais` do estágio anterior vira `entrada.sinaisPreCarregados` do
 * próximo).
 *
 * De propósito NÃO existe heurística de "diagnóstico recente o bastante" por
 * janela de tempo — isso reaproveitaria visita entre JOBS diferentes sem o
 * Orquestrador ter decidido isso (achado rodando de verdade: uma janela por
 * relógio reaproveitava diagnóstico entre um teste de idempotência e um
 * teste de cancelamento não relacionados, só porque os dois usam o mesmo
 * domínio de teste — silenciosamente mudava comportamento fora do pipeline
 * que motivou isto). Reaproveitamento só acontece quando EXPLICITAMENTE
 * encadeado pelo Orquestrador, nunca por adivinhação de tempo.
 */
export async function garantirSinais(prospectId: string, website: string, sinaisPreCarregados?: SinaisSite | null): Promise<{ sinais: SinaisSite; reaproveitado: boolean }> {
  if (sinaisPreCarregados) return { sinais: sinaisPreCarregados, reaproveitado: true };

  const sinais = await diagnosticarSite(website);
  registrarVisitaSite(prospectId, sinais);
  return { sinais, reaproveitado: false };
}
