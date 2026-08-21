import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Contexto assíncrono do job em execução (Fase 7) — permite que código
 * profundo na pilha (ex: uma chamada de modelo dentro de uma Tool) saiba
 * "qual job estou servindo agora" SEM que nenhuma assinatura de função
 * precise de um parâmetro `jobId` novo. Múltiplos jobs rodam concorrentes
 * de verdade (Fase 5+), então uma variável de módulo simples vazaria entre
 * jobs — `AsyncLocalStorage` (nativo do Node) é isolado por cadeia de
 * `await`, seguro sob concorrência real.
 *
 * Fase 8 — o mesmo armazenamento também carrega, quando aplicável, "esta
 * chamada é uma tentativa de FALLBACK, o modelo original foi X, o motivo
 * foi Y" (ver modelo/roteador.ts, chamarComFallback). `modelo/uso.ts` lê
 * isso pra gravar o rastro original->fallback sem que `ModelProvider`
 * precise de nenhum parâmetro novo.
 */

type ContextoJob = {
  jobId: string | null;
  modeloOriginal?: string;
  motivoFallback?: string;
  motivoRoteamento?: string;
  /** Fase 10 — model_id que rotear() efetivamente escolheu PARA ESTA TENTATIVA (nunca o modelo original quando é fallback). Ver seção abaixo. */
  modeloSelecionado?: string;
  /** Fase 10 — score de roteamento (0-1) do model_id acima nesta tentativa. */
  scoreRoteamento?: number;
};

const armazenamento = new AsyncLocalStorage<ContextoJob>();

export function rodarComContextoDeJob<T>(jobId: string, fn: () => T): T {
  return armazenamento.run({ jobId }, fn);
}

export function jobIdAtual(): string | null {
  return armazenamento.getStore()?.jobId ?? null;
}

/** Envolve UMA tentativa de fallback — preserva o jobId do contexto externo, se houver. `modeloSelecionado` é o modelo desta tentativa (do fallback), nunca o original que falhou. Fallback não recalcula score (o score original não se aplica a um modelo diferente) — vai como undefined, honesto. */
export function rodarComContextoDeFallback<T>(modeloOriginal: string, motivoFallback: string, modeloSelecionado: string, fn: () => T): T {
  const atual = armazenamento.getStore();
  return armazenamento.run({ jobId: atual?.jobId ?? null, modeloOriginal, motivoFallback, motivoRoteamento: atual?.motivoRoteamento, modeloSelecionado }, fn);
}

export function contextoFallbackAtual(): { modeloOriginal?: string; motivoFallback?: string } {
  const s = armazenamento.getStore();
  return { modeloOriginal: s?.modeloOriginal, motivoFallback: s?.motivoFallback };
}

/**
 * Fase 9 — carrega o MOTIVO DE ROTEAMENTO decidido por rotear() (ver
 * modelo/roteador.ts) até o ponto onde a chamada é de fato registrada
 * (modelo/uso.ts registrarChamadaModelo), sem precisar de parâmetro novo em
 * `ModelProvider`. Mesmo padrão já usado acima para modelo_original/
 * motivo_fallback.
 *
 * Fase 10 — passou a carregar também `modeloSelecionado`: o model_id EXATO
 * que rotear() escolheu (ex: "claude-haiku-4-5"), não só o provedor. Fecha
 * a pendência documentada no relatório da Fase 8 ("o provedor ainda
 * escolhe seu próprio modelo via mapeamento de complexidade interno") —
 * `anthropic.ts`/`openai.ts` agora leem isto ANTES de cair no mapeamento
 * interno, então o modelo que de fato chega no SDK é o que o Router
 * decidiu, nunca um substituto silencioso.
 */
export function rodarComContextoDeRoteamento<T>(motivoRoteamento: string, modeloSelecionado: string, scoreRoteamento: number, fn: () => T): T {
  const atual = armazenamento.getStore();
  return armazenamento.run({ jobId: atual?.jobId ?? null, motivoRoteamento, modeloSelecionado, scoreRoteamento }, fn);
}

export function motivoRoteamentoAtual(): string | undefined {
  return armazenamento.getStore()?.motivoRoteamento;
}

/** Model_id que o Router escolheu PARA ESTA CHAMADA — undefined quando a chamada não passou por chamarComFallback (ex: uso direto de um ModelProvider fora do Router), caso em que o provedor cai no seu mapeamento interno de complexidade como antes. */
export function modeloSelecionadoAtual(): string | undefined {
  return armazenamento.getStore()?.modeloSelecionado;
}

export function scoreRoteamentoAtual(): number | undefined {
  return armazenamento.getStore()?.scoreRoteamento;
}
