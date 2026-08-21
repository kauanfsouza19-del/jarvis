import "server-only";
import { obterFerramenta, listarFerramentasImplementadas } from "../../ferramentas/registro";
import { exigeAprovacao } from "../../ferramentas/tipos";
import { registrarHandler, pausarParaAprovacao, concluirJob, falharJob, bloquearJob, atualizarJob } from "../motor";
import { db, id as gerarId } from "../../dados/db";
import type { HandlerJob } from "../tipos";

/**
 * Job genérico que chama uma Tool do registro — a demonstração de ponta a
 * ponta da fronteira de permissão: Tool com nível SEND/DELETE/FINANCIAL/
 * EXTERNAL_COMMUNICATION/ACCOUNT_ACCESS nunca executa direto, sempre pausa
 * em AGUARDANDO_APROVACAO primeiro (ver `pausarParaAprovacao`). Tool não
 * implementada nunca finge sucesso — falha com o motivo, mesmo depois de
 * aprovada.
 */

export type ParametrosExecutarFerramenta = { ferramenta: string; entrada: unknown };

async function executar(jobId: string, parametrosBrutos: unknown): Promise<void> {
  const { ferramenta: nomeFerramenta, entrada } = parametrosBrutos as ParametrosExecutarFerramenta;
  const ferramenta = obterFerramenta(nomeFerramenta);

  if (!ferramenta) {
    falharJob(jobId, `Ferramenta "${nomeFerramenta}" não existe no registro.`);
    return;
  }

  if (!ferramenta.validarEntrada(entrada)) {
    falharJob(jobId, `Entrada inválida para "${nomeFerramenta}".`);
    return;
  }

  // Fase 7 — "qual Tool respondeu pelo job" (seção 1/15): aqui é
  // inequívoco (job genérico de UMA Tool só). Job de plano_orquestrado
  // encadeia várias Tools por capacidade — fica null de propósito ali, o
  // detalhe por estágio já é auditável via plano_passos.
  atualizarJob(jobId, { ferramenta_usada: nomeFerramenta });

  // Se exige aprovação e ainda não há uma APROVADA para este job, pausa.
  if (exigeAprovacao(ferramenta.nivelPermissao) || ferramenta.exigeAprovacaoExplicita) {
    const jaAprovado = db()
      .prepare(`SELECT 1 FROM aprovacoes WHERE job_id = ? AND ferramenta = ? AND estado = 'APROVADA'`)
      .get(jobId, nomeFerramenta);
    if (!jaAprovado) {
      pausarParaAprovacao(jobId, {
        ferramenta: nomeFerramenta,
        nivelPermissao: ferramenta.nivelPermissao,
        titulo: `Executar ${nomeFerramenta}`,
        descricao: ferramenta.descricao,
        risco: `Nível de permissão: ${ferramenta.nivelPermissao}.`,
      });
      return;
    }
  }

  if (!ferramenta.implementado || !ferramenta.executar) {
    bloquearJob(jobId, `Ferramenta "${nomeFerramenta}" ainda não está implementada — aprovado, mas não há integração real para executar.`);
    return;
  }

  const resultado = await ferramenta.executar(entrada);
  if (!resultado.ok) {
    falharJob(jobId, resultado.erro);
    return;
  }

  // Este handler não produz um Result de prospect — grava um resultado
  // genérico mínimo direto, sem passar pelo módulo de resultado de prospect.
  const resultadoId = gerarId();
  db()
    .prepare(`INSERT INTO resultados (id, execucao_id, tipo, resumo) VALUES (?,?,?,?)`)
    .run(resultadoId, jobId, "ferramenta", JSON.stringify({ ferramenta: nomeFerramenta, saida: resultado.saida }));

  concluirJob(jobId, resultadoId, `${nomeFerramenta} executada.`);
}

export const handlerExecutarFerramenta: HandlerJob = {
  tipo: "executar_ferramenta",
  retomavel: false,
  executar,
};

registrarHandler(handlerExecutarFerramenta);

export { listarFerramentasImplementadas };
