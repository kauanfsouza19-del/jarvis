import "server-only";
import { montarContexto } from "../contexto";

/**
 * Context Builder reutilizável (Fase 9, seção 12) — ENVOLVE
 * `montarContexto()` (contexto.ts, já existente desde fases anteriores),
 * nunca duplica a lógica de recuperação de memória/conhecimento que já
 * existe lá. O que este arquivo adiciona é o que faltava: contexto de
 * job/plano/resultado de Tool e preferência do usuário, montados num único
 * bloco pronto pra prompt, com corte explícito de tamanho — nunca despeja o
 * banco inteiro num prompt.
 */

export type ContextoModelo = {
  objetivo: string;
  jobId?: string | null;
  planoResumo?: string | null;
  resultadosFerramentas?: Array<{ ferramenta: string; resumo: string }>;
  projetoId?: string | null;
};

const LIMITE_CARACTERES_BLOCO = 6000;

export function construirContextoParaModelo(entrada: ContextoModelo): string {
  const base = montarContexto(entrada.objetivo, entrada.projetoId ?? null);
  const partes: string[] = [];

  if (entrada.planoResumo) {
    partes.push(`## PLANO EM EXECUÇÃO\n${entrada.planoResumo}`);
  }
  if (entrada.resultadosFerramentas?.length) {
    partes.push(
      `## RESULTADOS JÁ COLETADOS NESTE JOB (evite pedir de novo o que já está aqui)\n` +
        entrada.resultadosFerramentas.map((r) => `- [${r.ferramenta}] ${r.resumo}`).join("\n"),
    );
  }
  if (base.bloco) partes.push(base.bloco);

  let bloco = partes.join("\n\n");
  // Corte explícito — nunca deixa o prompt crescer sem limite; corta do fim
  // (memória/base primeiro no bloco), preservando o objetivo e o plano, que
  // vêm antes.
  if (bloco.length > LIMITE_CARACTERES_BLOCO) {
    bloco = bloco.slice(0, LIMITE_CARACTERES_BLOCO) + "\n\n[...contexto cortado para caber no limite de tokens...]";
  }
  return bloco;
}
