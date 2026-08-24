import "server-only";
import { db } from "../dados/db";
import { criarJob } from "./motor";
import { sincronizarVaultGit, obsidianGitConfigurado } from "../obsidian/sync-git";

/**
 * Scheduler mínimo, em processo (Fase 14) — não é cron distribuído nem
 * serviço externo: é um `setInterval` do MESMO processo Node que já roda
 * o Jarvis, iniciado uma vez no boot (ver instrumentation.ts, hook oficial
 * do Next.js). Gratuito, sem dependência nova, seguro (só dispara Jobs que
 * já existem e já são testados — nenhuma superfície de ataque nova).
 *
 * Honesto sobre o limite real: só roda enquanto o processo do servidor
 * está de pé. Fechar o terminal/desligar a máquina para a coleta — pra
 * isso sobreviver a reinícios/desligamentos, a alternativa é um agendador
 * do sistema operacional (Task Scheduler no Windows) chamando
 * POST /api/inteligencia/coletar por fora, documentado no relatório da
 * fase, nunca fingido como resolvido só por este arquivo existir.
 *
 * "Vencida" é decidido por dado real já existente
 * (fontes_inteligencia.frequencia_minutos, Fase 13) — nenhuma configuração
 * nova, nenhuma tabela nova.
 */

const INTERVALO_VERIFICACAO_MS = 5 * 60 * 1000;
// Sincronização do vault Obsidian (Fase 17) — bem menos frequente que a
// checagem de inteligência: notas mudam devagar, não precisa checar a
// cada 5min. 30min é o suficiente pra chegar rápido no Obsidian local
// sem gerar commit/push a cada mudancinha isolada.
const INTERVALO_SYNC_OBSIDIAN_MS = 30 * 60 * 1000;
let iniciado = false;

/** Exportado para teste direto (sem esperar o intervalo real de 5min). */
export function existeFonteVencida(): boolean {
  const linha = db()
    .prepare(
      `SELECT COUNT(*) AS n FROM fontes_inteligencia
        WHERE ativa = 1
          AND (ultima_verificacao IS NULL OR (julianday('now') - julianday(ultima_verificacao)) * 1440 >= frequencia_minutos)`,
    )
    .get() as { n: number };
  return linha.n > 0;
}

async function tickInteligencia(): Promise<void> {
  try {
    if (!existeFonteVencida()) return;
    // criarJob já deduplica contra FILA/EXECUTANDO (ver motor.ts) — nunca
    // empilha coleta em cima de coleta ainda rodando.
    criarJob(null, "inteligencia_coletar", {});
  } catch (e) {
    console.error("[jarvis] agendador: falha ao verificar/disparar coleta de inteligência:", e);
  }
}

async function tickSyncObsidian(): Promise<void> {
  if (!obsidianGitConfigurado()) return; // opcional — silencioso quando não configurado, sem log repetitivo a cada 30min
  try {
    const r = await sincronizarVaultGit();
    if (r.ok && r.commitado) console.log("[jarvis] vault Obsidian sincronizado (git push).");
    if (!r.ok) console.error(`[jarvis] sincronização do vault Obsidian falhou: ${r.motivo}`);
  } catch (e) {
    console.error("[jarvis] agendador: falha inesperada sincronizando vault Obsidian:", e);
  }
}

/**
 * Chamada uma vez no boot do servidor. Idempotente — se o hook de
 * instrumentação rodar mais de uma vez no mesmo processo (observado em
 * alguns ciclos de recompilação do dev server), nunca registra um segundo
 * intervalo.
 */
export function iniciarAgendador(): void {
  if (iniciado) return;
  iniciado = true;
  setInterval(() => void tickInteligencia(), INTERVALO_VERIFICACAO_MS);
  setInterval(() => void tickSyncObsidian(), INTERVALO_SYNC_OBSIDIAN_MS);
  console.log(
    `[jarvis] agendador iniciado — verifica fonte de inteligência vencida a cada ${INTERVALO_VERIFICACAO_MS / 60000}min` +
      `${obsidianGitConfigurado() ? `, sincroniza vault Obsidian a cada ${INTERVALO_SYNC_OBSIDIAN_MS / 60000}min` : " (sync do vault Obsidian desativado — OBSIDIAN_GIT_REMOTO não configurado)"}. ` +
      `Só funciona enquanto este processo está de pé — para sobreviver a reinício/desligamento, use o agendador do sistema operacional.`,
  );
}

/** Só para teste — permite resetar o guard sem reiniciar o processo Node. */
export function _resetarParaTeste(): void {
  iniciado = false;
}
