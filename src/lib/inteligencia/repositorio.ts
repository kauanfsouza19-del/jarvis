import "server-only";
import { db, id as gerarId, auditar } from "../dados/db";
import { normalizarUrl, normalizarTitulo, encontrarDuplicata, type ItemExistenteParaDedup } from "./deduplicacao";
import { calcularRelevancia, type Interesse, type PrioridadeItem } from "./relevancia";

/**
 * Registro de fontes + itens de inteligência (Fase 13) — CRUD real, mesmo
 * padrão de social/repositorio.ts. Fonte é criada pelo Cacique (ou por um
 * provedor futuro), nunca hardcoded no código como as Tools são — por isso
 * mora em tabela, não em registro estático como ferramentas/registro.ts.
 */

export type TipoFonte = "YOUTUBE_RSS" | "RSS" | "WEB" | "NEWS_API" | "SOCIAL" | "OUTRO";
export type CustoFonte = "FREE" | "PAID" | "REQUIRES_CREDENTIAL";

export type FonteInteligencia = {
  id: string;
  nome: string;
  tipo: TipoFonte;
  url: string;
  categoria: string;
  ativa: number;
  custo: CustoFonte;
  confiabilidade: number;
  frequencia_minutos: number;
  config: string | null;
  ultima_verificacao: string | null;
  ultimo_sucesso: string | null;
  ultimo_erro: string | null;
  criado_em: string;
  atualizado_em: string;
};

export type ItemInteligencia = {
  id: string;
  fonte_id: string;
  id_externo: string;
  titulo: string;
  resumo: string;
  url: string;
  url_canonica: string;
  publicado_em: string | null;
  descoberto_em: string;
  categoria: string;
  relevancia: number;
  prioridade: PrioridadeItem;
  status: "NEW" | "REVIEWED" | "IMPORTANT" | "ARCHIVED" | "IGNORED";
  duplicado_de: string | null;
  analisado_por_modelo: number;
  analise: string | null;
  metadados: string | null;
  criado_em: string;
};

const TIPOS_VALIDOS = new Set<TipoFonte>(["YOUTUBE_RSS", "RSS", "WEB", "NEWS_API", "SOCIAL", "OUTRO"]);
const CUSTOS_VALIDOS = new Set<CustoFonte>(["FREE", "PAID", "REQUIRES_CREDENTIAL"]);

/* ══════════════════════════ fontes ══════════════════════════ */

export type EntradaCriarFonte = {
  nome: string;
  tipo: TipoFonte;
  url: string;
  categoria?: string;
  custo?: CustoFonte;
  confiabilidade?: number;
  frequenciaMinutos?: number;
  config?: Record<string, unknown>;
};

export function criarFonte(entrada: EntradaCriarFonte): { ok: true; fonte: FonteInteligencia } | { ok: false; motivo: string } {
  if (!TIPOS_VALIDOS.has(entrada.tipo)) return { ok: false, motivo: "tipo_invalido" };
  if (entrada.custo && !CUSTOS_VALIDOS.has(entrada.custo)) return { ok: false, motivo: "custo_invalido" };
  try {
    new URL(entrada.url);
  } catch {
    return { ok: false, motivo: "url_invalida" };
  }

  const fonteId = gerarId();
  db()
    .prepare(
      `INSERT INTO fontes_inteligencia (id, nome, tipo, url, categoria, custo, confiabilidade, frequencia_minutos, config)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      fonteId,
      entrada.nome,
      entrada.tipo,
      entrada.url,
      entrada.categoria ?? "geral",
      entrada.custo ?? "FREE",
      entrada.confiabilidade ?? 0.7,
      entrada.frequenciaMinutos ?? 360,
      entrada.config ? JSON.stringify(entrada.config) : null,
    );
  auditar({ acao: "inteligencia.criar_fonte", resultado: fonteId, impacto: entrada.tipo });
  return { ok: true, fonte: obterFonte(fonteId)! };
}

export function obterFonte(id: string): FonteInteligencia | null {
  return (db().prepare(`SELECT * FROM fontes_inteligencia WHERE id = ?`).get(id) as FonteInteligencia | undefined) ?? null;
}

export function listarFontes(filtro: { ativa?: boolean } = {}): FonteInteligencia[] {
  const where = filtro.ativa !== undefined ? `WHERE ativa = ${filtro.ativa ? 1 : 0}` : "";
  return db().prepare(`SELECT * FROM fontes_inteligencia ${where} ORDER BY criado_em DESC`).all() as FonteInteligencia[];
}

export function definirAtivaFonte(id: string, ativa: boolean): { ok: boolean; motivo?: string } {
  const f = obterFonte(id);
  if (!f) return { ok: false, motivo: "fonte_nao_encontrada" };
  db().prepare(`UPDATE fontes_inteligencia SET ativa = ?, atualizado_em = datetime('now') WHERE id = ?`).run(ativa ? 1 : 0, id);
  auditar({ acao: "inteligencia.ativar_fonte", resultado: id, impacto: String(ativa) });
  return { ok: true };
}

export function removerFonte(id: string): { ok: boolean; motivo?: string } {
  const f = obterFonte(id);
  if (!f) return { ok: false, motivo: "fonte_nao_encontrada" };
  db().prepare(`DELETE FROM fontes_inteligencia WHERE id = ?`).run(id);
  auditar({ acao: "inteligencia.remover_fonte", resultado: id });
  return { ok: true };
}

export function registrarVerificacaoFonte(id: string, resultado: { sucesso: boolean; erro?: string }): void {
  if (resultado.sucesso) {
    db()
      .prepare(`UPDATE fontes_inteligencia SET ultima_verificacao = datetime('now'), ultimo_sucesso = datetime('now'), ultimo_erro = NULL, atualizado_em = datetime('now') WHERE id = ?`)
      .run(id);
  } else {
    db()
      .prepare(`UPDATE fontes_inteligencia SET ultima_verificacao = datetime('now'), ultimo_erro = ?, atualizado_em = datetime('now') WHERE id = ?`)
      .run(resultado.erro?.slice(0, 300) ?? "erro desconhecido", id);
  }
}

/* ══════════════════════════ interesses ══════════════════════════ */

export function listarInteresses(soAtivos = true): Interesse[] {
  const where = soAtivos ? "WHERE ativo = 1" : "";
  return db().prepare(`SELECT termo, peso FROM interesses_inteligencia ${where}`).all() as Interesse[];
}

export function listarInteressesCompletos() {
  return db().prepare(`SELECT * FROM interesses_inteligencia ORDER BY categoria, termo`).all();
}

export function criarInteresse(termo: string, categoria = "geral", peso = 1): { ok: boolean; motivo?: string } {
  if (!termo.trim()) return { ok: false, motivo: "termo_obrigatorio" };
  if (peso < 1 || peso > 5) return { ok: false, motivo: "peso_invalido" };
  try {
    db().prepare(`INSERT INTO interesses_inteligencia (id, termo, categoria, peso) VALUES (?,?,?,?)`).run(gerarId(), termo.trim(), categoria, peso);
    return { ok: true };
  } catch {
    return { ok: false, motivo: "termo_ja_existe" };
  }
}

export function removerInteresse(id: string): void {
  db().prepare(`DELETE FROM interesses_inteligencia WHERE id = ?`).run(id);
}

/* ══════════════════════════ itens ══════════════════════════ */

/** Itens candidatos a colidir por dedup — só os últimos N dias, nunca a tabela inteira (custo de leitura previsível). */
export function itensRecentesParaDedup(diasJanela = 30): ItemExistenteParaDedup[] {
  const desde = new Date(Date.now() - diasJanela * 86_400_000).toISOString().replace("T", " ").slice(0, 19);
  const linhas = db()
    .prepare(`SELECT id, url_canonica, titulo, publicado_em FROM itens_inteligencia WHERE descoberto_em >= ?`)
    .all(desde) as Array<{ id: string; url_canonica: string; titulo: string; publicado_em: string | null }>;
  return linhas.map((l) => ({
    id: l.id,
    urlCanonica: l.url_canonica,
    tituloNormalizado: normalizarTitulo(l.titulo),
    publicadoEmDia: l.publicado_em ? l.publicado_em.slice(0, 10) : null,
  }));
}

export type ResultadoIngestaoItem = { criado: true; item: ItemInteligencia } | { criado: false; motivo: "duplicado" | "ja_existe_na_fonte"; deId?: string };

/**
 * Grava UM item bruto — normaliza, deduplica, pontua. Determinístico do
 * início ao fim (nenhuma chamada de modelo aqui — isso é decisão de quem
 * orquestra, ver inteligencia/processamento.ts).
 */
export function ingerirItem(
  fonte: FonteInteligencia,
  bruto: { idExterno: string; titulo: string; resumo: string; url: string; publicadoEm: string | null },
  itensExistentes: ItemExistenteParaDedup[],
  interesses: Interesse[],
): ResultadoIngestaoItem {
  // UNIQUE(fonte_id, id_externo) já impede duplicata exata na MESMA
  // fonte — checado aqui pra devolver um motivo explícito em vez de deixar
  // a constraint do banco lançar.
  const jaExiste = db().prepare(`SELECT 1 FROM itens_inteligencia WHERE fonte_id = ? AND id_externo = ?`).get(fonte.id, bruto.idExterno);
  if (jaExiste) return { criado: false, motivo: "ja_existe_na_fonte" };

  const urlCanonica = normalizarUrl(bruto.url);
  const dup = encontrarDuplicata({ urlCanonica: bruto.url, titulo: bruto.titulo, publicadoEm: bruto.publicadoEm }, itensExistentes);

  const rel = calcularRelevancia({ titulo: bruto.titulo, resumo: bruto.resumo, publicadoEm: bruto.publicadoEm }, interesses, fonte.confiabilidade);

  const itemId = gerarId();
  db()
    .prepare(
      `INSERT INTO itens_inteligencia
        (id, fonte_id, id_externo, titulo, resumo, url, url_canonica, publicado_em, categoria, relevancia, prioridade, status, duplicado_de)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      itemId,
      fonte.id,
      bruto.idExterno,
      bruto.titulo,
      bruto.resumo,
      bruto.url,
      urlCanonica,
      bruto.publicadoEm,
      fonte.categoria,
      rel.score,
      rel.prioridade,
      dup.duplicado ? "ARCHIVED" : "NEW", // duplicata nunca aparece na fila como NEW — mas fica no histórico, nunca apagada
      dup.duplicado ? dup.deId : null,
    );

  if (dup.duplicado) return { criado: false, motivo: "duplicado", deId: dup.deId };
  return { criado: true, item: obterItem(itemId)! };
}

export function obterItem(id: string): ItemInteligencia | null {
  return (db().prepare(`SELECT * FROM itens_inteligencia WHERE id = ?`).get(id) as ItemInteligencia | undefined) ?? null;
}

export type FiltroItens = { status?: string; prioridade?: string; categoria?: string; limite?: number };

export function listarItens(filtro: FiltroItens = {}): ItemInteligencia[] {
  const condicoes: string[] = [];
  const args: string[] = [];
  if (filtro.status) { condicoes.push("status = ?"); args.push(filtro.status); }
  if (filtro.prioridade) { condicoes.push("prioridade = ?"); args.push(filtro.prioridade); }
  if (filtro.categoria) { condicoes.push("categoria = ?"); args.push(filtro.categoria); }
  const where = condicoes.length ? `WHERE ${condicoes.join(" AND ")}` : "";
  const limite = Math.min(200, filtro.limite ?? 50);
  return db()
    .prepare(`SELECT * FROM itens_inteligencia ${where} ORDER BY CASE prioridade WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END, descoberto_em DESC LIMIT ?`)
    .all(...args, limite) as ItemInteligencia[];
}

export function mudarStatusItem(id: string, status: string): { ok: boolean; motivo?: string } {
  const validos = new Set(["NEW", "REVIEWED", "IMPORTANT", "ARCHIVED", "IGNORED"]);
  if (!validos.has(status)) return { ok: false, motivo: "status_invalido" };
  const item = obterItem(id);
  if (!item) return { ok: false, motivo: "item_nao_encontrado" };
  db().prepare(`UPDATE itens_inteligencia SET status = ? WHERE id = ?`).run(status, id);
  return { ok: true };
}

export function registrarAnaliseModelo(id: string, analise: Record<string, unknown>): void {
  db().prepare(`UPDATE itens_inteligencia SET analisado_por_modelo = 1, analise = ? WHERE id = ?`).run(JSON.stringify(analise), id);
}

export function contarPorPrioridade(): Record<string, number> {
  const linhas = db()
    .prepare(`SELECT prioridade, COUNT(*) AS n FROM itens_inteligencia WHERE status NOT IN ('ARCHIVED','IGNORED') GROUP BY prioridade`)
    .all() as Array<{ prioridade: string; n: number }>;
  return Object.fromEntries(linhas.map((l) => [l.prioridade, l.n]));
}
