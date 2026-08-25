import "server-only";
import { createHash } from "node:crypto";
import { mkdir, writeFile, stat, readdir, unlink } from "node:fs/promises";
import { join, resolve, sep, extname } from "node:path";

/**
 * Staging de criativo em disco (Fase 27b) — mesmo princípio de
 * dados/db.ts (CAMINHO): fica DENTRO de `dados/` (persistente, fora do
 * git, fora da imagem Docker mínima — mesmo volume já usado pelo SQLite e
 * pela chave SSH do Obsidian), nunca dentro do binário do banco. Arquivo
 * de mídia nunca vira BLOB no SQLite — só o caminho é gravado na tabela
 * `criativos` (ver criativos/biblioteca.ts).
 *
 * `JARVIS_CRIATIVOS_DIR` segue exatamente o mesmo padrão de override de
 * `JARVIS_DB` — sem a env var, cai em `dados/criativos-temp` relativo ao
 * cwd do processo (dev local = raiz do repo; produção = o mesmo volume
 * bind-mount usado por tudo em `dados/`).
 */

const DIR_STAGING = process.env.JARVIS_CRIATIVOS_DIR ?? join(process.cwd(), "dados", "criativos-temp");

const EXTENSOES_PERMITIDAS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".mp4", ".mov", ".m4v"]);
const TAMANHO_MAXIMO_BYTES = 500 * 1024 * 1024; // 500MB — teto generoso pra vídeo de anúncio, nunca ilimitado

async function garantirDiretorio(): Promise<void> {
  await mkdir(DIR_STAGING, { recursive: true });
}

/** Fronteira de path — mesmo princípio de ferramentas/codigo.ts (resolverDentroDoRepo), aplicado ao staging de criativo em vez do repositório de código. */
function resolverDentroDoStaging(nomeArquivo: string): string {
  const alvo = resolve(DIR_STAGING, nomeArquivo);
  if (alvo !== DIR_STAGING && !alvo.startsWith(DIR_STAGING + sep)) {
    throw new Error("caminho fora do diretório de staging de criativos");
  }
  return alvo;
}

export type ArquivoSalvo = { caminhoLocal: string; tamanhoBytes: number; checksumSha256: string };

/**
 * Salva bytes de criativo no staging local — nunca aceita nome de arquivo
 * com caminho embutido (../ etc, mesma proteção de codigo.ts), nunca
 * extensão fora da allowlist (nunca .exe/.sh/.php disfarçado de imagem),
 * nunca acima do teto de tamanho. Retorna o checksum real (SHA-256) —
 * usado pela Biblioteca de Criativos pra detectar duplicata mesmo quando
 * o nome do arquivo muda entre uploads (ver criativos/biblioteca.ts).
 */
export async function salvarCriativoStaging(nomeArquivoOriginal: string, bytes: Buffer): Promise<ArquivoSalvo> {
  if (bytes.length === 0) throw new Error("arquivo vazio");
  if (bytes.length > TAMANHO_MAXIMO_BYTES) throw new Error(`arquivo excede o teto de ${TAMANHO_MAXIMO_BYTES / 1024 / 1024}MB`);

  const ext = extname(nomeArquivoOriginal).toLowerCase();
  if (!EXTENSOES_PERMITIDAS.has(ext)) {
    throw new Error(`extensão "${ext}" fora da allowlist de criativo (permitidas: ${[...EXTENSOES_PERMITIDAS].join(", ")})`);
  }

  await garantirDiretorio();
  const checksum = createHash("sha256").update(bytes).digest("hex");
  // nome no disco é sempre checksum+extensão — nunca o nome original cru
  // (evita colisão, evita caractere estranho vindo do Drive/upload, e já
  // é a chave natural de dedup: mesmo conteúdo -> mesmo nome de arquivo).
  const nomeArquivoStaging = `${checksum}${ext}`;
  const caminho = resolverDentroDoStaging(nomeArquivoStaging);
  await writeFile(caminho, bytes);
  const info = await stat(caminho);

  return { caminhoLocal: caminho, tamanhoBytes: info.size, checksumSha256: checksum };
}

/** Remove um criativo do staging (chamado depois de confirmado no Meta, ou em limpeza de retenção — nunca automático sem uma dessas duas razões). */
export async function removerCriativoStaging(caminhoLocal: string): Promise<void> {
  const alvo = resolverDentroDoStaging(caminhoLocal.startsWith(DIR_STAGING) ? caminhoLocal.slice(DIR_STAGING.length + 1) : caminhoLocal);
  await unlink(alvo).catch(() => {}); // já removido não é erro
}

/** Retenção simples — apaga staging mais velho que N dias. Nunca roda sozinho num cron ainda (Fase 27b não inclui agendamento); é um gancho pra quem for operar o disco depois. */
export async function limparStagingAntigo(diasRetencao = 7): Promise<{ removidos: number }> {
  await garantirDiretorio();
  const limite = Date.now() - diasRetencao * 24 * 60 * 60 * 1000;
  const entradas = await readdir(DIR_STAGING, { withFileTypes: true });
  let removidos = 0;
  for (const e of entradas) {
    if (!e.isFile()) continue;
    const caminho = join(DIR_STAGING, e.name);
    const info = await stat(caminho);
    if (info.mtimeMs < limite) {
      await unlink(caminho);
      removidos++;
    }
  }
  return { removidos };
}
