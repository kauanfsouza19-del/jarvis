import "server-only";
import { listarProspects, type Prospect } from "../../prospeccao/repositorio";
import { obterFerramenta } from "../../ferramentas/registro";
import { fecharResultadoDeProspects } from "../resultados";
import {
  registrarHandler,
  registrarPasso,
  concluirPasso,
  falharPasso,
  passosConcluidos,
  atualizarJob,
  concluirJob,
  bloquearJob,
  cancelamentoPedido,
  confirmarCancelamento,
  pausaPedida,
  confirmarPausa,
} from "../motor";
import type { HandlerJob } from "../tipos";

/**
 * Handler de diagnóstico de prospect — o primeiro tipo de job real,
 * registrado no despachante do motor. `retomavel: true` porque cada
 * prospect diagnosticado vira um passo CONCLUÍDO independente: se o
 * servidor cair no meio, a retomada pula quem já foi visitado.
 */

export type ParametrosProspeccao = {
  vertical: string | null;
  localizacao: string | null;
  quantidade: number;
  prospectIds?: string[];
};

const LIMITE_POR_JOB = 25;

function nomePasso(prospectId: string) {
  return `diagnostico:${prospectId}`;
}

async function executar(jobId: string, parametrosBrutos: unknown): Promise<void> {
  const params = parametrosBrutos as ParametrosProspeccao;

  let alvo: Prospect[];
  if (params.prospectIds?.length) {
    alvo = params.prospectIds.map((id) => listarProspects().find((p) => p.id === id)).filter((p): p is Prospect => Boolean(p));
  } else {
    const existentes = listarProspects({ vertical: params.vertical ?? undefined, cidade: params.localizacao ?? undefined });
    if (!process.env.GOOGLE_PLACES_API_KEY && existentes.length === 0) {
      bloquearJob(
        jobId,
        "Descoberta de negócio novo por vertical/cidade precisa de GOOGLE_PLACES_API_KEY (ver SISTEMA → INTEGRAÇÕES). Nenhum prospect dessa vertical/cidade já cadastrado para eu trabalhar em cima.",
      );
      return;
    }
    alvo = existentes.slice(0, Math.min(params.quantidade || LIMITE_POR_JOB, LIMITE_POR_JOB));
  }

  const comSite = alvo.filter((p) => p.website);
  // Retomada: passo já CONCLUÍDO numa rodada anterior não é refeito.
  const jaFeitos = passosConcluidos(jobId);
  const pendentes = comSite.filter((p) => !jaFeitos.has(nomePasso(p.id)));

  atualizarJob(jobId, { progresso_total: comSite.length, progresso_atual: comSite.length - pendentes.length });

  let i = comSite.length - pendentes.length;
  for (const p of pendentes) {
    if (cancelamentoPedido(jobId)) {
      confirmarCancelamento(jobId, `${i}/${comSite.length} sites diagnosticados antes do cancelamento.`);
      return;
    }
    // Pausa (Fase 7) — mesmo ponto de checagem do cancelamento; retomarJobPausado
    // relança executar() do zero, e passosConcluidos()/pendentes acima já
    // pulam quem já foi diagnosticado (mesmo mecanismo de retomada após
    // restart, reaproveitado).
    if (pausaPedida(jobId)) {
      confirmarPausa(jobId, `${i}/${comSite.length} sites diagnosticados antes da pausa.`);
      return;
    }

    i++;
    atualizarJob(jobId, { progresso_atual: i, etapa: `Diagnosticando site ${i}/${comSite.length} — ${p.negocio}` });
    const passoId = registrarPasso(jobId, i, nomePasso(p.id));
    try {
      // Mesma Tool que o Orquestrador usa pela capacidade "diagnosticar_prospect"
      // — um caminho só de código para "visitar site + gravar score", nunca
      // duas implementações divergindo com o tempo.
      const ferramenta = obterFerramenta("prospeccao.diagnosticar_e_pontuar");
      const resultado = await ferramenta!.executar!({ prospectId: p.id });
      if (!resultado.ok) throw new Error(resultado.erro);
      concluirPasso(passoId, p.negocio);
    } catch (e) {
      // Um site falhar não derruba o job inteiro — segue para o próximo,
      // mas o passo fica FALHOU (não CONCLUIDO), então uma retomada tentaria
      // de novo em vez de considerar "já feito".
      falharPasso(passoId, e instanceof Error ? e.message.slice(0, 200) : "erro desconhecido");
    }
  }

  const atualizados = alvo.map((p) => listarProspects().find((x) => x.id === p.id) ?? p);
  const bloqueadaDescoberta = !params.prospectIds?.length && !process.env.GOOGLE_PLACES_API_KEY;

  const { resultadoId, resumo } = await fecharResultadoDeProspects(jobId, "lista_prospects", atualizados, {
    descobertaDeNovosBloqueada: bloqueadaDescoberta,
    motivoDescobertaBloqueada: bloqueadaDescoberta
      ? "GOOGLE_PLACES_API_KEY não configurada — resultado usa só prospects já cadastrados."
      : null,
  });

  concluirJob(jobId, resultadoId, `${resumo.total} prospect(s) — ${resumo.altaOportunidade} de alta oportunidade.`);
}

export const handlerProspeccao: HandlerJob = {
  tipo: "prospeccao_diagnostico",
  retomavel: true,
  executar,
};

registrarHandler(handlerProspeccao);
