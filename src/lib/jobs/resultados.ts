import "server-only";
import { db, id as gerarId } from "../dados/db";
import type { Prospect } from "../prospeccao/repositorio";
import { gerarCsv, gerarXlsx } from "../arquivos/exportar";
import { LIMIARES_OPORTUNIDADE } from "../prospeccao/pontuacao";
import { criarNotificacao } from "./motor";
import { capturarOportunidade } from "../memoria/captura";

/**
 * Result como objeto de primeira classe — nunca linha despejada no chat.
 * Separado do motor de job de propósito: um Orchestrator futuro pode
 * produzir Result de tipos que não são prospecção sem tocar em motor.ts.
 *
 * Linhagem (parentResultId/operacao/metadadosTransformacao) é o que faz
 * "30 pizzarias" -> "+ Instagram" -> "10 de maior prioridade" continuar
 * rastreável até a descoberta original — nunca reescreve o resultado pai,
 * cada transformação grava uma linha NOVA apontando pra de onde veio (ver
 * esquema.ts, seção resultados).
 */

export type OpcoesFechamentoResultado = {
  parentResultId?: string | null;
  operacao?: string | null;
  metadadosTransformacao?: Record<string, unknown> | null;
};

/** Grava resumo + snapshot de prospects + CSV/XLSX reais. Usado por qualquer handler que produza lista de prospect. */
export async function fecharResultadoDeProspects(
  jobId: string,
  tipo: string,
  prospects: Prospect[],
  extra: Record<string, unknown> = {},
  opcoes: OpcoesFechamentoResultado = {},
) {
  const resultadoId = gerarId();
  const ordenados = [...prospects].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  const hot = ordenados.filter((p) => (p.score ?? -1) >= LIMIARES_OPORTUNIDADE.HOT).length;
  const alta = ordenados.filter((p) => (p.score ?? -1) >= LIMIARES_OPORTUNIDADE.HIGH && (p.score ?? -1) < LIMIARES_OPORTUNIDADE.HOT).length;
  const media = ordenados.filter((p) => (p.score ?? -1) >= LIMIARES_OPORTUNIDADE.MEDIUM && (p.score ?? -1) < LIMIARES_OPORTUNIDADE.HIGH).length;
  const baixa = ordenados.filter((p) => (p.score ?? -1) >= LIMIARES_OPORTUNIDADE.LOW && (p.score ?? -1) < LIMIARES_OPORTUNIDADE.MEDIUM).length;
  const semDiagnostico = ordenados.filter((p) => p.score === null).length;

  const resumo = { total: ordenados.length, hotOportunidade: hot, altaOportunidade: alta, mediaOportunidade: media, baixaOportunidade: baixa, semDiagnostico, ...extra };

  db()
    .prepare(`INSERT INTO resultados (id, execucao_id, tipo, resumo, parent_result_id, operacao, metadados_transformacao) VALUES (?,?,?,?,?,?,?)`)
    .run(
      resultadoId,
      jobId,
      tipo,
      JSON.stringify(resumo),
      opcoes.parentResultId ?? null,
      opcoes.operacao ?? null,
      opcoes.metadadosTransformacao ? JSON.stringify(opcoes.metadadosTransformacao) : null,
    );

  const inserirLink = db().prepare(`INSERT INTO resultado_prospects (resultado_id, prospect_id, ordem) VALUES (?,?,?)`);
  ordenados.forEach((p, i) => inserirLink.run(resultadoId, p.id, i));

  const csv = gerarCsv(resultadoId, ordenados);
  const xlsx = await gerarXlsx(resultadoId, ordenados);

  // Fase 7 — notificação de oportunidade real (nunca por evento interno
  // qualquer): só dispara quando a síntese realmente encontrou HOT, com o
  // nome de quem puxou a média pra cima, não um aviso genérico "tem
  // oportunidade" sem dizer qual.
  if (hot > 0) {
    const nomesHot = ordenados
      .filter((p) => (p.score ?? -1) >= LIMIARES_OPORTUNIDADE.HOT)
      .slice(0, 3)
      .map((p) => p.negocio)
      .join(", ");
    criarNotificacao(
      "OPORTUNIDADE_ENCONTRADA",
      jobId,
      hot === 1 ? "1 oportunidade quente encontrada" : `${hot} oportunidades quentes encontradas`,
      `${nomesHot}${hot > 3 ? ` e mais ${hot - 3}` : ""} — classificação HOT no resultado.`,
    );
    // Fase 9 — mesmo sinal (hot > 0) também decide captura de conhecimento,
    // nunca um segundo critério paralelo (ver memoria/captura.ts).
    capturarOportunidade({
      jobId,
      hot,
      nomesHot: ordenados.filter((p) => (p.score ?? -1) >= LIMIARES_OPORTUNIDADE.HOT).map((p) => p.negocio),
      origem: `job:${jobId}`,
    });
  }

  return { resultadoId, resumo, arquivos: [csv, xlsx] };
}

/**
 * Fechamento genérico (Fase 20 — missão de agente) — exatamente o que o
 * comentário acima já previa: um Result de tipo que não é lista de
 * prospect, sem tocar em motor.ts nem em fecharResultadoDeProspects. Usado
 * por qualquer Plano cujos passos não terminam num
 * `gerar_arquivo_resultado` de prospecção (ex: capacidades de código —
 * listar/ler/testar/typecheck/build/git — ou conteúdo social encadeado
 * sem descoberta). Nunca gera CSV/XLSX (não há prospect nenhum); o
 * `resumo` já É o dado, gravado como está.
 */
export function fecharResultadoGenerico(jobId: string, tipo: string, resumo: Record<string, unknown>, opcoes: OpcoesFechamentoResultado = {}) {
  const resultadoId = gerarId();
  db()
    .prepare(`INSERT INTO resultados (id, execucao_id, tipo, resumo, parent_result_id, operacao, metadados_transformacao) VALUES (?,?,?,?,?,?,?)`)
    .run(
      resultadoId,
      jobId,
      tipo,
      JSON.stringify(resumo),
      opcoes.parentResultId ?? null,
      opcoes.operacao ?? null,
      opcoes.metadadosTransformacao ? JSON.stringify(opcoes.metadadosTransformacao) : null,
    );
  return { resultadoId, resumo };
}

type LinhaResultado = {
  id: string;
  execucao_id: string;
  tipo: string;
  resumo: string;
  parent_result_id: string | null;
  operacao: string | null;
  metadados_transformacao: string | null;
  criado_em: string;
};

export function obterResultado(id: string) {
  const resultado = db().prepare(`SELECT * FROM resultados WHERE id = ?`).get(id) as LinhaResultado | undefined;
  if (!resultado) return null;

  const prospects = db()
    .prepare(`SELECT p.* FROM resultado_prospects rp JOIN prospects p ON p.id = rp.prospect_id WHERE rp.resultado_id = ? ORDER BY rp.ordem`)
    .all(id) as Prospect[];

  const arquivos = db()
    .prepare(`SELECT id, tipo, nome, mime_type, tamanho_bytes FROM arquivos_gerados WHERE resultado_id = ?`)
    .all(id);

  return { resultado, prospects, arquivos };
}

/** Cadeia de resultados-pai até a descoberta raiz — mais recente primeiro (o próprio resultado não entra). */
export function obterLinhagem(resultadoId: string): LinhaResultado[] {
  const cadeia: LinhaResultado[] = [];
  let atualId: string | null = resultadoId;
  const vistos = new Set<string>();
  for (let i = 0; i < 50 && atualId && !vistos.has(atualId); i++) {
    vistos.add(atualId);
    const linha = db().prepare(`SELECT * FROM resultados WHERE id = ?`).get(atualId) as LinhaResultado | undefined;
    if (!linha) break;
    if (linha.id !== resultadoId) cadeia.push(linha);
    atualId = linha.parent_result_id;
  }
  return cadeia;
}

export function ultimoResultadoDaConversa(conversaId: string) {
  const r = db()
    .prepare(`SELECT r.id FROM resultados r JOIN jobs j ON j.id = r.execucao_id WHERE j.conversa_id = ? ORDER BY r.criado_em DESC LIMIT 1`)
    .get(conversaId) as { id: string } | undefined;
  return r ? obterResultado(r.id) : null;
}

export async function filtrarResultado(
  resultadoIdOrigem: string,
  filtro: { comWhatsapp?: boolean; comTelefone?: boolean; cidade?: string; scoreMin?: number; limite?: number },
) {
  const origem = db().prepare(`SELECT * FROM resultados WHERE id = ?`).get(resultadoIdOrigem) as
    | { id: string; execucao_id: string; tipo: string }
    | undefined;
  if (!origem) throw new Error("resultado_nao_encontrado");

  const linhas = db()
    .prepare(`SELECT p.* FROM resultado_prospects rp JOIN prospects p ON p.id = rp.prospect_id WHERE rp.resultado_id = ? ORDER BY rp.ordem`)
    .all(resultadoIdOrigem) as Prospect[];

  let filtrados = linhas;
  if (filtro.comWhatsapp) filtrados = filtrados.filter((p) => p.whatsapp_publico);
  if (filtro.comTelefone) filtrados = filtrados.filter((p) => p.telefone_publico);
  if (filtro.cidade) {
    const alvo = filtro.cidade.trim().toLowerCase();
    filtrados = filtrados.filter((p) => p.cidade?.trim().toLowerCase() === alvo);
  }
  if (filtro.scoreMin !== undefined) filtrados = filtrados.filter((p) => (p.score ?? -1) >= filtro.scoreMin!);
  if (filtro.limite) filtrados = filtrados.slice(0, filtro.limite);

  return fecharResultadoDeProspects(
    origem.execucao_id,
    origem.tipo,
    filtrados,
    { filtroAplicado: filtro },
    { parentResultId: origem.id, operacao: filtro.limite ? "selecao" : "filtro", metadadosTransformacao: { filtro } },
  );
}
