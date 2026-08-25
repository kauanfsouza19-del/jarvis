import "server-only";
import { db, id as gerarId, agora } from "../dados/db";

/**
 * Biblioteca de Criativos (Fase 27b) — repositório sobre a tabela
 * `criativos` (ver dados/db.ts). Metadado apenas; o binário vive no
 * staging local (ver criativos/armazenamento.ts).
 */

export type StatusCriativo = "NOVO" | "BAIXADO" | "ENVIADO_META" | "FALHOU" | "ARQUIVADO";
export type TipoCriativo = "imagem" | "video";

export type Criativo = {
  id: string;
  origem: string;
  drive_file_id: string | null;
  drive_folder_id: string | null;
  nome_arquivo: string;
  mime_type: string;
  tipo: TipoCriativo;
  largura: number | null;
  altura: number | null;
  duracao_segundos: number | null;
  tamanho_bytes: number | null;
  checksum_sha256: string | null;
  caminho_local: string | null;
  conta_meta_id: string | null;
  cliente: string | null;
  campanha_alvo: string | null;
  versao: number;
  status: StatusCriativo;
  meta_creative_hash: string | null;
  meta_video_id: string | null;
  meta_ad_id: string | null;
  erro: string | null;
  criado_em: string;
  atualizado_em: string;
};

export type NovoCriativo = {
  origem: string;
  driveFileId?: string | null;
  driveFolderId?: string | null;
  nomeArquivo: string;
  mimeType: string;
  tipo: TipoCriativo;
  largura?: number | null;
  altura?: number | null;
  duracaoSegundos?: number | null;
  tamanhoBytes?: number | null;
  checksumSha256?: string | null;
  caminhoLocal?: string | null;
  contaMetaId?: string | null;
  cliente?: string | null;
  campanhaAlvo?: string | null;
};

/** drive_file_id repetido nunca cria linha nova (UNIQUE INDEX em dados/db.ts) — devolve a existente, é assim que "detectar duplicata" (Fase 27b, seção 7) fica garantido no nível do banco, não só na lógica de quem chama. */
export function registrarCriativo(n: NovoCriativo): Criativo {
  if (n.driveFileId) {
    const existente = obterCriativoPorDriveFileId(n.driveFileId);
    if (existente) return existente;
  }
  const novoId = gerarId();
  db()
    .prepare(
      `INSERT INTO criativos (id, origem, drive_file_id, drive_folder_id, nome_arquivo, mime_type, tipo, largura, altura, duracao_segundos, tamanho_bytes, checksum_sha256, caminho_local, conta_meta_id, cliente, campanha_alvo, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'NOVO')`,
    )
    .run(
      novoId,
      n.origem,
      n.driveFileId ?? null,
      n.driveFolderId ?? null,
      n.nomeArquivo,
      n.mimeType,
      n.tipo,
      n.largura ?? null,
      n.altura ?? null,
      n.duracaoSegundos ?? null,
      n.tamanhoBytes ?? null,
      n.checksumSha256 ?? null,
      n.caminhoLocal ?? null,
      n.contaMetaId ?? null,
      n.cliente ?? null,
      n.campanhaAlvo ?? null,
    );
  return obterCriativo(novoId)!;
}

export function obterCriativo(id: string): Criativo | undefined {
  return db().prepare(`SELECT * FROM criativos WHERE id = ?`).get(id) as Criativo | undefined;
}

export function obterCriativoPorDriveFileId(driveFileId: string): Criativo | undefined {
  return db().prepare(`SELECT * FROM criativos WHERE drive_file_id = ?`).get(driveFileId) as Criativo | undefined;
}

export function listarCriativos(filtro: { status?: StatusCriativo; contaMetaId?: string; cliente?: string } = {}): Criativo[] {
  const condicoes: string[] = [];
  const params: string[] = [];
  if (filtro.status) {
    condicoes.push("status = ?");
    params.push(filtro.status);
  }
  if (filtro.contaMetaId) {
    condicoes.push("conta_meta_id = ?");
    params.push(filtro.contaMetaId);
  }
  if (filtro.cliente) {
    condicoes.push("cliente = ?");
    params.push(filtro.cliente);
  }
  const where = condicoes.length ? `WHERE ${condicoes.join(" AND ")}` : "";
  return db()
    .prepare(`SELECT * FROM criativos ${where} ORDER BY criado_em DESC LIMIT 200`)
    .all(...params) as Criativo[];
}

export function atualizarStatusCriativo(id: string, status: StatusCriativo, erro?: string | null): void {
  db().prepare(`UPDATE criativos SET status = ?, erro = ?, atualizado_em = ? WHERE id = ?`).run(status, erro ?? null, agora(), id);
}

export function registrarEnvioMeta(id: string, dados: { metaCreativeHash?: string | null; metaVideoId?: string | null; metaAdId?: string | null }): void {
  db()
    .prepare(`UPDATE criativos SET status = 'ENVIADO_META', meta_creative_hash = ?, meta_video_id = ?, meta_ad_id = ?, atualizado_em = ? WHERE id = ?`)
    .run(dados.metaCreativeHash ?? null, dados.metaVideoId ?? null, dados.metaAdId ?? null, agora(), id);
}

// ── Fontes de Criativo (Cliente ↔ pasta do Drive ↔ conta/campanha Meta) ──

export type FonteCriativo = {
  id: string;
  nome: string;
  drive_folder_id: string;
  cliente: string;
  conta_meta_id: string;
  campanha_alvo_padrao: string | null;
  ad_set_alvo_padrao: string | null;
  padrao_nomenclatura: string | null;
  habilitada: number;
  criado_em: string;
};

export type NovaFonteCriativo = {
  nome: string;
  driveFolderId: string;
  cliente: string;
  contaMetaId: string;
  campanhaAlvoPadrao?: string | null;
  adSetAlvoPadrao?: string | null;
  padraoNomenclatura?: string | null;
};

export function registrarFonteCriativo(f: NovaFonteCriativo): FonteCriativo {
  const novoId = gerarId();
  db()
    .prepare(
      `INSERT INTO fontes_criativo (id, nome, drive_folder_id, cliente, conta_meta_id, campanha_alvo_padrao, ad_set_alvo_padrao, padrao_nomenclatura, habilitada)
       VALUES (?,?,?,?,?,?,?,?,1)`,
    )
    .run(novoId, f.nome, f.driveFolderId, f.cliente, f.contaMetaId, f.campanhaAlvoPadrao ?? null, f.adSetAlvoPadrao ?? null, f.padraoNomenclatura ?? null);
  return db().prepare(`SELECT * FROM fontes_criativo WHERE id = ?`).get(novoId) as FonteCriativo;
}

export function listarFontesCriativo(soHabilitadas = true): FonteCriativo[] {
  const where = soHabilitadas ? "WHERE habilitada = 1" : "";
  return db().prepare(`SELECT * FROM fontes_criativo ${where} ORDER BY criado_em DESC`).all() as FonteCriativo[];
}
