import "server-only";
import { obterAccessTokenValido } from "./oauth";

/**
 * Google Drive API v3 real (Fase 27b — pipeline de criativo), fetch cru
 * (mesmo padrão de gmail.ts/calendar.ts — sem googleapis, REST direto).
 * Só LEITURA (escopo drive.readonly, ver oauth.ts) — nunca cria, move,
 * renomeia ou apaga nada no Drive do Cacique.
 *
 * `files.list` com `q` filtra por pasta pai + exclui lixeira; campos
 * pedidos explicitamente (nunca a resposta "default" da API, que omite
 * metadado de imagem/vídeo por padrão) — é isso que dá altura/largura/
 * duração pra classificação de criativo (Fase 27b, seção 6) sem precisar
 * baixar o arquivo primeiro só pra inspecionar.
 */

const BASE = "https://www.googleapis.com/drive/v3";
const CAMPOS_ARQUIVO = "id,name,mimeType,size,modifiedTime,md5Checksum,imageMediaMetadata(width,height),videoMediaMetadata(width,height,durationMillis)";

export type ArquivoDrive = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  md5Checksum?: string;
  imageMediaMetadata?: { width?: number; height?: number };
  videoMediaMetadata?: { width?: number; height?: number; durationMillis?: string };
};

export type ResultadoDrive<T> = { ok: true; dados: T } | { ok: false; erro: string };

const MIME_TIPOS_CRIATIVO = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/quicktime",
]);

async function chamar(caminho: string, token: string): Promise<Response> {
  return fetch(`${BASE}${caminho}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
}

/**
 * Lista arquivos de UMA pasta (nunca recursivo em subpastas nesta fase —
 * "retrieval direcionado", nunca varrer o Drive inteiro, conforme pedido
 * explícito da Fase 27b, seção 7). Filtra só mime types de criativo
 * conhecidos (imagem/vídeo) — nunca devolve PDF/planilha/doc que por
 * acaso esteja na mesma pasta.
 */
export async function listarArquivosPasta(folderId: string, apenasNaoBaixados = false): Promise<ResultadoDrive<ArquivoDrive[]>> {
  const token = await obterAccessTokenValido("google_drive");
  if (!token) return { ok: false, erro: "google_drive_nao_conectado" };

  const mimeFiltro = [...MIME_TIPOS_CRIATIVO].map((m) => `mimeType='${m}'`).join(" or ");
  const q = `'${folderId}' in parents and trashed=false and (${mimeFiltro})`;
  const params = new URLSearchParams({ q, fields: `files(${CAMPOS_ARQUIVO})`, pageSize: "100", orderBy: apenasNaoBaixados ? "modifiedTime desc" : "modifiedTime desc" });

  let r: Response;
  try {
    r = await chamar(`/files?${params.toString()}`, token);
  } catch (e) {
    return { ok: false, erro: `falha de rede: ${e instanceof Error ? e.message : "desconhecida"}` };
  }
  if (!r.ok) return { ok: false, erro: `Drive API HTTP ${r.status}: ${(await r.text()).slice(0, 300)}` };
  const j = (await r.json()) as { files?: ArquivoDrive[] };
  return { ok: true, dados: j.files ?? [] };
}

export async function obterMetadadosArquivo(fileId: string): Promise<ResultadoDrive<ArquivoDrive>> {
  const token = await obterAccessTokenValido("google_drive");
  if (!token) return { ok: false, erro: "google_drive_nao_conectado" };

  let r: Response;
  try {
    r = await chamar(`/files/${fileId}?fields=${CAMPOS_ARQUIVO}`, token);
  } catch (e) {
    return { ok: false, erro: `falha de rede: ${e instanceof Error ? e.message : "desconhecida"}` };
  }
  if (!r.ok) return { ok: false, erro: `Drive API HTTP ${r.status}` };
  return { ok: true, dados: (await r.json()) as ArquivoDrive };
}

const TAMANHO_MAXIMO_DOWNLOAD = 500 * 1024 * 1024; // mesmo teto de armazenamento.ts — nunca baixa além do que o staging aceitaria de qualquer forma

/** Baixa os bytes reais (`alt=media`) — nunca resumable upload/download parcial nesta fase (arquivo de criativo cabe inteiro em memória dentro do teto acima; resumable fica pra quando um vídeo real ultrapassar isso, ver relatório da fase). */
export async function baixarArquivo(fileId: string): Promise<ResultadoDrive<{ bytes: Buffer; mimeType: string; nome: string }>> {
  const token = await obterAccessTokenValido("google_drive");
  if (!token) return { ok: false, erro: "google_drive_nao_conectado" };

  const meta = await obterMetadadosArquivo(fileId);
  if (!meta.ok) return meta;
  const tamanho = meta.dados.size ? Number(meta.dados.size) : 0;
  if (tamanho > TAMANHO_MAXIMO_DOWNLOAD) {
    return { ok: false, erro: `arquivo (${(tamanho / 1024 / 1024).toFixed(0)}MB) excede o teto de ${TAMANHO_MAXIMO_DOWNLOAD / 1024 / 1024}MB pra download direto nesta fase` };
  }

  let r: Response;
  try {
    r = await chamar(`/files/${fileId}?alt=media`, token);
  } catch (e) {
    return { ok: false, erro: `falha de rede: ${e instanceof Error ? e.message : "desconhecida"}` };
  }
  if (!r.ok) return { ok: false, erro: `Drive API HTTP ${r.status} ao baixar` };
  const bytes = Buffer.from(await r.arrayBuffer());
  return { ok: true, dados: { bytes, mimeType: meta.dados.mimeType, nome: meta.dados.name } };
}
