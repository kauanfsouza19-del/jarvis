import "@/lib/jobs/registro-handlers";
import { criarJob } from "@/lib/jobs/motor";

export const runtime = "nodejs";

/**
 * Dispara a coleta como um Job real (mesmo motor de sempre) — nunca roda
 * inline na requisição HTTP (poderia estourar timeout com muitas fontes).
 * Não existe agendamento automático real ainda (sem cron no Jarvis) — isto
 * é o gatilho manual/sob demanda, documentado como tal.
 */
export async function POST() {
  const { job, novo } = criarJob(null, "inteligencia_coletar", {});
  return Response.json({ execucaoId: job.id }, { status: novo ? 201 : 200 });
}
