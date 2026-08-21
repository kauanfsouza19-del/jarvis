/**
 * Hook de inicialização do servidor (convenção do Next.js — roda uma vez
 * quando o processo sobe, antes de qualquer requisição).
 *
 * Único trabalho: encontrar job que ficou EXECUTANDO de um processo anterior
 * (o servidor caiu ou foi reiniciado no meio de um job) e resolver isso de
 * forma honesta — retomar se for seguro, marcar FALHOU com o motivo se não
 * for. Nunca deixa um job mentindo "executando" para sempre.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  await import("./lib/jobs/registro-handlers");
  const { recuperarJobsOrfaos } = await import("./lib/jobs/motor");

  try {
    const { retomados, falhados } = recuperarJobsOrfaos();
    if (retomados > 0 || falhados > 0) {
      console.log(`[jarvis] recuperação de jobs órfãos: ${retomados} retomado(s), ${falhados} marcado(s) como falho(s).`);
    }
  } catch (e) {
    console.error("[jarvis] recuperação de jobs órfãos falhou:", e);
  }

  // Scheduler mínimo em processo (Fase 14) — verifica fontes de
  // inteligência vencidas e dispara Job de coleta sozinho. Ver
  // lib/jobs/agendador.ts para o limite honesto (só roda com o processo
  // de pé).
  try {
    const { iniciarAgendador } = await import("./lib/jobs/agendador");
    iniciarAgendador();
  } catch (e) {
    console.error("[jarvis] falha ao iniciar agendador:", e);
  }

  // Sessões de login expiradas (Fase 15) — limpeza no boot, não em todo
  // request (mesmo padrão de custo baixo dos jobs órfãos acima).
  try {
    const { limparSessoesExpiradas } = await import("./lib/seguranca/sessoes");
    const removidas = limparSessoesExpiradas();
    if (removidas > 0) console.log(`[jarvis] ${removidas} sessão(ões) de login expirada(s) removida(s).`);
  } catch (e) {
    console.error("[jarvis] limpeza de sessões expiradas falhou:", e);
  }
}
