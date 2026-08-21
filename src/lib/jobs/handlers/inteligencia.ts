import "server-only";
import { registrarHandler, concluirJob, falharJob } from "../motor";
import { coletarInteligencia } from "../../inteligencia/processamento";
import { db, id as gerarId } from "../../dados/db";
import type { HandlerJob } from "../tipos";

/**
 * Job de coleta de inteligência (Fase 13) — mesmo motor de Job de sempre,
 * nenhum scheduler novo. Hoje disparado sob demanda (API/UI/chat) — não
 * existe cron real no Jarvis ainda (achado real revisando a arquitetura);
 * documentado como limitação honesta, não fingido como "roda sozinho a
 * cada X horas" sem isso ser verdade.
 */
async function executar(jobId: string): Promise<void> {
  try {
    const resultado = await coletarInteligencia();
    const resultadoId = gerarId();
    db()
      .prepare(`INSERT INTO resultados (id, execucao_id, tipo, resumo) VALUES (?,?,?,?)`)
      .run(resultadoId, jobId, "inteligencia_coleta", JSON.stringify(resultado));
    concluirJob(
      jobId,
      resultadoId,
      `${resultado.itensNovos} item(ns) novo(s) de ${resultado.fontesVerificadas} fonte(s) (${resultado.fontesComErro} com erro), ${resultado.itensDuplicados} duplicata(s) descartada(s).`,
    );
  } catch (e) {
    falharJob(jobId, e instanceof Error ? e.message.slice(0, 200) : "erro desconhecido na coleta de inteligência");
  }
}

export const handlerInteligencia: HandlerJob = {
  tipo: "inteligencia_coletar",
  retomavel: false,
  executar,
};

registrarHandler(handlerInteligencia);
