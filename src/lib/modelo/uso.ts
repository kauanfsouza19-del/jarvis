import "server-only";
import { db, id as gerarId } from "../dados/db";
import { jobIdAtual, contextoFallbackAtual, motivoRoteamentoAtual, scoreRoteamentoAtual } from "../jobs/contexto-execucao";
import { calcularCustoUsd } from "./registro";

/**
 * Log real de uso de modelo (Fase 7, estendido na Fase 8) — toda chamada
 * feita através de `ModelProvider` grava aqui, nunca só um contador
 * agregado em memória. `jobIdAtual()` (ver jobs/contexto-execucao.ts) soma
 * o custo direto em `jobs.custo_usd` sem precisar de parâmetro `jobId` novo
 * em `ModelProvider`.
 *
 * Preço por 1M tokens agora vem SÓ do registro central (modelo/registro.ts)
 * — antes desta fase existia duplicado aqui e em api/custo/route.ts (achado
 * real revisando o código), risco real de um lugar atualizar o preço e o
 * outro ficar desatualizado silenciosamente.
 */

export { calcularCustoUsd };

export function registrarChamadaModelo(entrada: {
  provedor: string;
  modelo: string;
  operacao: string;
  tokensEntrada?: number | null;
  tokensSaida?: number | null;
  sucesso: boolean;
  /** Preenchido só quando ESTA chamada é uma tentativa de fallback — "por que caiu pro próximo da cadeia". */
  motivoFallback?: string | null;
  /** Quando é fallback, o modelo que foi tentado ANTES desta chamada e falhou. */
  modeloOriginal?: string | null;
  erro?: string | null;
  latenciaMs?: number | null;
  /** Fase 9 — nível de escalonamento de validação cruzada aplicado a esta chamada (0-3), quando aplicável. */
  nivelEscalonamento?: number | null;
}): void {
  const custoUsd = calcularCustoUsd(entrada.modelo, entrada.tokensEntrada ?? 0, entrada.tokensSaida ?? 0);
  const jobId = jobIdAtual();
  // Contexto de fallback (ver jobs/contexto-execucao.ts) preenche
  // modelo_original/motivo_fallback automaticamente quando a chamada
  // acontece dentro de rodarComContextoDeFallback — o valor explícito
  // passado aqui (se houver) sempre vence.
  const contextoFallback = contextoFallbackAtual();
  // Fase 9 — motivo de roteamento (por que rotear() escolheu ESTE modelo)
  // gravado SEMPRE que a chamada acontece dentro de chamarComFallback, não
  // só nas tentativas de fallback (ver modelo/roteador.ts).
  const motivoRoteamento = motivoRoteamentoAtual();
  const scoreRoteamento = scoreRoteamentoAtual();

  db()
    .prepare(
      `INSERT INTO chamadas_modelo
        (id, job_id, provedor, modelo, operacao, tokens_entrada, tokens_saida, custo_usd, sucesso, motivo_fallback, modelo_original, erro, latencia_ms, motivo_roteamento, nivel_escalonamento, score_roteamento)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      gerarId(),
      jobId,
      entrada.provedor,
      entrada.modelo,
      entrada.operacao,
      entrada.tokensEntrada ?? null,
      entrada.tokensSaida ?? null,
      custoUsd,
      entrada.sucesso ? 1 : 0,
      entrada.motivoFallback ?? contextoFallback.motivoFallback ?? null,
      entrada.modeloOriginal ?? contextoFallback.modeloOriginal ?? null,
      entrada.erro ?? null,
      entrada.latenciaMs ?? null,
      motivoRoteamento ?? null,
      entrada.nivelEscalonamento ?? null,
      scoreRoteamento ?? null,
    );

  if (jobId && entrada.sucesso) {
    db().prepare(`UPDATE jobs SET custo_usd = custo_usd + ? WHERE id = ?`).run(custoUsd, jobId);
  }
}

export function usoDoJob(jobId: string) {
  return db().prepare(`SELECT * FROM chamadas_modelo WHERE job_id = ? ORDER BY criado_em`).all(jobId);
}

export type DesempenhoModelo = {
  modelo: string;
  operacao: string;
  chamadas: number;
  sucessos: number;
  taxaSucesso: number;
  custoMedioUsd: number;
  latenciaMediaMs: number | null;
  fallbacks: number;
};

/**
 * Memória de desempenho por operação (Fase 8, seção 8) — agregação REAL do
 * histórico em chamadas_modelo, nunca um número inventado. É o que
 * permitiria no futuro o Router aprender "pra esta operação, o modelo X é
 * mais barato e funciona igual" — hoje só EXPÕE o dado agregado de forma
 * auditável; a decisão de preferir X ainda é do Router (ver roteador.ts),
 * nunca um ajuste automático silencioso de peso.
 */
export function desempenhoPorOperacao(operacao?: string): DesempenhoModelo[] {
  const where = operacao ? "WHERE operacao = ?" : "";
  const linhas = db()
    .prepare(
      `SELECT modelo, operacao,
              COUNT(*) AS chamadas,
              SUM(sucesso) AS sucessos,
              AVG(custo_usd) AS custo_medio,
              AVG(latencia_ms) AS latencia_media,
              SUM(CASE WHEN modelo_original IS NOT NULL THEN 1 ELSE 0 END) AS fallbacks
         FROM chamadas_modelo
         ${where}
        GROUP BY modelo, operacao
        ORDER BY chamadas DESC`,
    )
    .all(...(operacao ? [operacao] : [])) as Array<{
    modelo: string;
    operacao: string;
    chamadas: number;
    sucessos: number;
    custo_medio: number;
    latencia_media: number | null;
    fallbacks: number;
  }>;

  return linhas.map((l) => ({
    modelo: l.modelo,
    operacao: l.operacao,
    chamadas: l.chamadas,
    sucessos: l.sucessos,
    taxaSucesso: l.chamadas > 0 ? l.sucessos / l.chamadas : 0,
    custoMedioUsd: l.custo_medio ?? 0,
    latenciaMediaMs: l.latencia_media,
    fallbacks: l.fallbacks,
  }));
}
