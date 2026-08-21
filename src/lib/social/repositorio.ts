import "server-only";
import { db, id as gerarId, auditar } from "../dados/db";

/**
 * Social Media Operating System (Fase 11) — pipeline de conteúdo
 * determinístico. Mesmo espírito de prospeccao/repositorio.ts: CRUD real,
 * transições de estado explícitas, nunca lógica de execução aqui (isso é
 * Job/Tool, ver ferramentas/registro.ts e jobs/handlers/plano-orquestrado.ts).
 *
 * IDEIA -> BRIEFING -> RASCUNHO -> REVISAO -> AGUARDANDO_APROVACAO ->
 * APROVADO/REJEITADO -> AGENDADO -> PUBLICADO -> MONITORAMENTO -> ANALISADO
 * (FALHOU é terminal de exceção, alcançável de qualquer estado não-terminal).
 */

export type StatusConteudo =
  | "IDEIA"
  | "BRIEFING"
  | "RASCUNHO"
  | "REVISAO"
  | "AGUARDANDO_APROVACAO"
  | "APROVADO"
  | "REJEITADO"
  | "AGENDADO"
  | "PUBLICADO"
  | "FALHOU"
  | "MONITORAMENTO"
  | "ANALISADO";

export type PrioridadeConteudo = "URGENT" | "HIGH" | "MEDIUM" | "LOW";
export type TipoConteudo = "post" | "reels" | "story" | "carrossel" | "video" | "texto" | "outro";
export type PlataformaConteudo = "instagram" | "facebook" | "whatsapp_status" | "linkedin" | "tiktok" | "outro";

export type ConteudoSocial = {
  id: string;
  titulo: string;
  conceito: string;
  tipo_conteudo: TipoConteudo;
  plataforma: PlataformaConteudo;
  legenda: string;
  midia_referencias: string | null; // JSON
  prompt_referencia: string | null;
  cta: string | null;
  hashtags: string | null; // JSON
  status: StatusConteudo;
  prioridade: PrioridadeConteudo;
  agendado_para: string | null;
  publicado_em: string | null;
  criado_por: "cacique" | "jarvis";
  agente_id: string | null;
  job_id: string | null;
  plano_id: string | null;
  motivo_rejeicao: string | null;
  metadados_performance: string | null; // JSON
  criado_em: string;
  atualizado_em: string;
};

const STATUS_VALIDOS = new Set<StatusConteudo>([
  "IDEIA", "BRIEFING", "RASCUNHO", "REVISAO", "AGUARDANDO_APROVACAO",
  "APROVADO", "REJEITADO", "AGENDADO", "PUBLICADO", "FALHOU", "MONITORAMENTO", "ANALISADO",
]);
const PRIORIDADES_VALIDAS = new Set<PrioridadeConteudo>(["URGENT", "HIGH", "MEDIUM", "LOW"]);

/**
 * Transições permitidas — vocabulário fechado, nunca "qualquer estado pra
 * qualquer estado". FALHOU é alcançável de qualquer estado não-terminal
 * (exceção sempre pode acontecer); estados terminais (PUBLICADO/REJEITADO/
 * ANALISADO/FALHOU) não têm saída, exceto REJEITADO que pode voltar pra
 * RASCUNHO (retrabalho é o fluxo normal, não uma exceção).
 */
const TRANSICOES: Record<StatusConteudo, StatusConteudo[]> = {
  IDEIA: ["BRIEFING", "RASCUNHO", "FALHOU"],
  BRIEFING: ["RASCUNHO", "FALHOU"],
  RASCUNHO: ["REVISAO", "AGUARDANDO_APROVACAO", "FALHOU"],
  REVISAO: ["RASCUNHO", "AGUARDANDO_APROVACAO", "FALHOU"],
  AGUARDANDO_APROVACAO: ["APROVADO", "REJEITADO", "FALHOU"],
  APROVADO: ["AGENDADO", "PUBLICADO", "FALHOU"],
  REJEITADO: ["RASCUNHO"],
  AGENDADO: ["PUBLICADO", "FALHOU", "RASCUNHO"], // desagendar volta pra rascunho, nunca fica "AGENDADO" órfão
  PUBLICADO: ["MONITORAMENTO"],
  FALHOU: ["RASCUNHO"],
  MONITORAMENTO: ["ANALISADO"],
  ANALISADO: [],
};

export function transicoesPermitidas(de: StatusConteudo): StatusConteudo[] {
  return TRANSICOES[de] ?? [];
}

export type EntradaCriarConteudo = {
  titulo: string;
  conceito?: string;
  tipoConteudo?: TipoConteudo;
  plataforma?: PlataformaConteudo;
  legenda?: string;
  midiaReferencias?: string[];
  promptReferencia?: string | null;
  cta?: string | null;
  hashtags?: string[];
  status?: StatusConteudo;
  prioridade?: PrioridadeConteudo;
  agendadoPara?: string | null;
  criadoPor?: "cacique" | "jarvis";
  agenteId?: string | null;
  jobId?: string | null;
  planoId?: string | null;
};

export function criarConteudo(entrada: EntradaCriarConteudo): ConteudoSocial {
  const conteudoId = gerarId();
  const status = entrada.status && STATUS_VALIDOS.has(entrada.status) ? entrada.status : "IDEIA";
  const prioridade = entrada.prioridade && PRIORIDADES_VALIDAS.has(entrada.prioridade) ? entrada.prioridade : "MEDIUM";

  db()
    .prepare(
      `INSERT INTO conteudos_sociais
        (id, titulo, conceito, tipo_conteudo, plataforma, legenda, midia_referencias, prompt_referencia, cta, hashtags,
         status, prioridade, criado_por, agente_id, job_id, plano_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      conteudoId,
      entrada.titulo,
      entrada.conceito ?? "",
      entrada.tipoConteudo ?? "post",
      entrada.plataforma ?? "instagram",
      entrada.legenda ?? "",
      entrada.midiaReferencias ? JSON.stringify(entrada.midiaReferencias) : null,
      entrada.promptReferencia ?? null,
      entrada.cta ?? null,
      entrada.hashtags ? JSON.stringify(entrada.hashtags) : null,
      status,
      prioridade,
      entrada.criadoPor ?? "cacique",
      entrada.agenteId ?? null,
      entrada.jobId ?? null,
      entrada.planoId ?? null,
    );

  auditar({ acao: "conteudo.criar", resultado: conteudoId, impacto: `${entrada.plataforma ?? "instagram"}/${status}` });
  return obterConteudo(conteudoId)!;
}

export function obterConteudo(id: string): ConteudoSocial | null {
  return (db().prepare(`SELECT * FROM conteudos_sociais WHERE id = ?`).get(id) as ConteudoSocial | undefined) ?? null;
}

export type FiltroConteudo = {
  status?: StatusConteudo | StatusConteudo[];
  plataforma?: PlataformaConteudo;
  prioridade?: PrioridadeConteudo;
};

const ORDEM_PRIORIDADE_CONTEUDO: Record<PrioridadeConteudo, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

/** Fila real, ordenada por prioridade e depois por criação — nunca ordem aleatória, nunca decidida no front-end. */
export function listarConteudos(filtro: FiltroConteudo = {}): ConteudoSocial[] {
  const condicoes: string[] = [];
  const args: string[] = [];

  if (filtro.status) {
    const lista = Array.isArray(filtro.status) ? filtro.status : [filtro.status];
    condicoes.push(`status IN (${lista.map(() => "?").join(",")})`);
    args.push(...lista);
  }
  if (filtro.plataforma) {
    condicoes.push("plataforma = ?");
    args.push(filtro.plataforma);
  }
  if (filtro.prioridade) {
    condicoes.push("prioridade = ?");
    args.push(filtro.prioridade);
  }

  const where = condicoes.length ? `WHERE ${condicoes.join(" AND ")}` : "";
  const linhas = db().prepare(`SELECT * FROM conteudos_sociais ${where} ORDER BY criado_em DESC`).all(...args) as ConteudoSocial[];

  return linhas.sort((a, b) => ORDEM_PRIORIDADE_CONTEUDO[a.prioridade] - ORDEM_PRIORIDADE_CONTEUDO[b.prioridade]);
}

export type ResultadoTransicao = { ok: boolean; motivo?: string; conteudo?: ConteudoSocial };

/** Muda status respeitando o vocabulário de transição — nunca aceita "qualquer -> qualquer" vindo direto da requisição. */
export function mudarStatusConteudo(id: string, novoStatus: string, extra: { motivoRejeicao?: string } = {}): ResultadoTransicao {
  if (!STATUS_VALIDOS.has(novoStatus as StatusConteudo)) return { ok: false, motivo: "status_invalido" };
  const atual = obterConteudo(id);
  if (!atual) return { ok: false, motivo: "conteudo_nao_encontrado" };

  const permitido = TRANSICOES[atual.status]?.includes(novoStatus as StatusConteudo);
  if (!permitido) return { ok: false, motivo: `transição ${atual.status} → ${novoStatus} não é permitida` };

  const publicadoEm = novoStatus === "PUBLICADO" ? ", publicado_em = datetime('now')" : "";
  db()
    .prepare(`UPDATE conteudos_sociais SET status = ?, motivo_rejeicao = ?, atualizado_em = datetime('now') ${publicadoEm} WHERE id = ?`)
    .run(novoStatus, novoStatus === "REJEITADO" ? (extra.motivoRejeicao ?? null) : null, id);

  auditar({ acao: "conteudo.mudar_status", resultado: id, impacto: `${atual.status} -> ${novoStatus}` });
  return { ok: true, conteudo: obterConteudo(id)! };
}

export function definirPrioridadeConteudo(id: string, prioridade: string): ResultadoTransicao {
  if (!PRIORIDADES_VALIDAS.has(prioridade as PrioridadeConteudo)) return { ok: false, motivo: "prioridade_invalida" };
  const atual = obterConteudo(id);
  if (!atual) return { ok: false, motivo: "conteudo_nao_encontrado" };
  if (atual.status === "PUBLICADO" || atual.status === "ANALISADO") {
    return { ok: false, motivo: `conteúdo já está em estado terminal (${atual.status}) — prioridade não muda mais nada` };
  }
  db().prepare(`UPDATE conteudos_sociais SET prioridade = ?, atualizado_em = datetime('now') WHERE id = ?`).run(prioridade, id);
  auditar({ acao: "conteudo.redefinir_prioridade", resultado: id, impacto: prioridade });
  return { ok: true, conteudo: obterConteudo(id)! };
}

/** Agendar exige um conteúdo já APROVADO — nunca agenda rascunho sem aprovação (Rule 21: aprovação nunca é pulada). */
export function agendarConteudo(id: string, agendadoPara: string): ResultadoTransicao {
  const atual = obterConteudo(id);
  if (!atual) return { ok: false, motivo: "conteudo_nao_encontrado" };
  if (atual.status !== "APROVADO") return { ok: false, motivo: `só é possível agendar conteúdo APROVADO (está ${atual.status})` };
  if (!agendadoPara || Number.isNaN(Date.parse(agendadoPara))) return { ok: false, motivo: "data_invalida" };

  db().prepare(`UPDATE conteudos_sociais SET status = 'AGENDADO', agendado_para = ?, atualizado_em = datetime('now') WHERE id = ?`).run(agendadoPara, id);
  auditar({ acao: "conteudo.agendar", resultado: id, impacto: agendadoPara });
  return { ok: true, conteudo: obterConteudo(id)! };
}

export function editarConteudo(id: string, campos: { titulo?: string; conceito?: string; legenda?: string; cta?: string | null; hashtags?: string[] }): ResultadoTransicao {
  const atual = obterConteudo(id);
  if (!atual) return { ok: false, motivo: "conteudo_nao_encontrado" };
  if (["PUBLICADO", "AGENDADO", "MONITORAMENTO", "ANALISADO"].includes(atual.status)) {
    return { ok: false, motivo: `conteúdo em ${atual.status} não é mais editável — desagende primeiro` };
  }

  const sets: string[] = [];
  const args: unknown[] = [];
  if (campos.titulo !== undefined) { sets.push("titulo = ?"); args.push(campos.titulo); }
  if (campos.conceito !== undefined) { sets.push("conceito = ?"); args.push(campos.conceito); }
  if (campos.legenda !== undefined) { sets.push("legenda = ?"); args.push(campos.legenda); }
  if (campos.cta !== undefined) { sets.push("cta = ?"); args.push(campos.cta); }
  if (campos.hashtags !== undefined) { sets.push("hashtags = ?"); args.push(JSON.stringify(campos.hashtags)); }
  if (sets.length === 0) return { ok: false, motivo: "nada_para_editar" };

  sets.push("atualizado_em = datetime('now')");
  db().prepare(`UPDATE conteudos_sociais SET ${sets.join(", ")} WHERE id = ?`).run(...([...args, id] as never[]));
  auditar({ acao: "conteudo.editar", resultado: id });
  return { ok: true, conteudo: obterConteudo(id)! };
}

/** Contagem real por status — usada pra "3 conteúdos aguardando aprovação" (Rule 21), nunca um número inventado. */
export function contarPorStatus(): Record<string, number> {
  const linhas = db().prepare(`SELECT status, COUNT(*) AS n FROM conteudos_sociais GROUP BY status`).all() as Array<{ status: string; n: number }>;
  return Object.fromEntries(linhas.map((l) => [l.status, l.n]));
}

export function conteudosAguardandoAprovacao(): ConteudoSocial[] {
  return listarConteudos({ status: "AGUARDANDO_APROVACAO" });
}

/** Conteúdo agendado dentro da janela — usado pelo widget de agenda do Command Center (Rule 15). */
export function conteudosAgendadosProximos(diasAFrente = 7): ConteudoSocial[] {
  const limite = new Date(Date.now() + diasAFrente * 86400000).toISOString();
  return db()
    .prepare(`SELECT * FROM conteudos_sociais WHERE status = 'AGENDADO' AND agendado_para <= ? ORDER BY agendado_para ASC`)
    .all(limite) as ConteudoSocial[];
}
