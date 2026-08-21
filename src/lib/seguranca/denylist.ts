/**
 * Duas travas independentes:
 *
 * 1. `arquivoBloqueado` — o indexador nunca lê, indexa, resume ou envia ao
 *    modelo um arquivo que casa aqui. O Jarvis pode SABER que uma integração
 *    existe (lendo o código que referencia `process.env.X`) sem nunca ver o valor.
 *
 * 2. `contemSegredo` — filtro de escrita na memória. Roda antes de qualquer
 *    INSERT em `memorias`, `projeto_conhecimento` e `trechos_conhecimento`.
 */

const ARQUIVOS_BLOQUEADOS: RegExp[] = [
  /(^|[\\/])\.env($|\.|[^\\/]*$)/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /(^|[\\/])id_rsa/i,
  /(^|[\\/])id_ed25519/i,
  /(^|[\\/])credentials?/i,
  /(^|[\\/])secrets?/i,
  /(^|[\\/])\.git[\\/]config$/i,
  /(^|[\\/])\.npmrc$/i,
  /(^|[\\/])\.netrc$/i,
  /(^|[\\/])\.aws[\\/]/i,
  /(^|[\\/])\.ssh[\\/]/i,
  /(^|[\\/])node_modules[\\/]/i,
];

export function arquivoBloqueado(caminho: string): boolean {
  const c = caminho.replace(/\\/g, "/");
  return ARQUIVOS_BLOQUEADOS.some((r) => r.test(c));
}

/** Padrões de VALOR de segredo — não de nome de variável. */
const PADROES_SEGREDO: Array<{ nome: string; regex: RegExp }> = [
  { nome: "chave_anthropic", regex: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { nome: "chave_openai", regex: /\bsk-[A-Za-z0-9]{32,}/ },
  { nome: "token_github", regex: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/ },
  { nome: "token_github_fino", regex: /\bgithub_pat_[A-Za-z0-9_]{30,}/ },
  { nome: "chave_aws", regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { nome: "chave_stripe", regex: /\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{20,}/ },
  { nome: "segredo_webhook_stripe", regex: /\bwhsec_[A-Za-z0-9]{20,}/ },
  { nome: "chave_asaas", regex: /\$aact_[A-Za-z0-9_=+/-]{40,}/ },
  { nome: "jwt", regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { nome: "chave_privada", regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { nome: "bearer", regex: /\bBearer\s+[A-Za-z0-9._-]{24,}/ },
  { nome: "senha_em_url", regex: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@]+:[^\s/@]+@/i },
  { nome: "slack", regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { nome: "cartao", regex: /\b(?:\d[ -]?){13,16}\b(?=.*(?:cart|card|cvv|validade))/i },
  { nome: "codigo_verificacao", regex: /\b(c[oó]digo|code)\D{0,20}\b\d{6}\b/i },
];

export type ResultadoSegredo =
  | { bloqueado: false }
  | { bloqueado: true; padroes: string[] };

export function contemSegredo(texto: string): ResultadoSegredo {
  const achados = PADROES_SEGREDO.filter((p) => p.regex.test(texto)).map((p) => p.nome);
  return achados.length > 0 ? { bloqueado: true, padroes: achados } : { bloqueado: false };
}

/** Lança se o texto carregar segredo. Use antes de qualquer persistência. */
export function exigirSemSegredo(texto: string, onde: string): void {
  const r = contemSegredo(texto);
  if (r.bloqueado) {
    throw new Error(
      `Persistência recusada em ${onde}: padrão de segredo detectado (${r.padroes.join(", ")}). ` +
        `Segredo não entra na memória do Jarvis.`,
    );
  }
}
