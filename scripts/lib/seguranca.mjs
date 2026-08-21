/**
 * Travas de segurança compartilhadas pelos indexadores.
 *
 * Módulo único de propósito: duplicar denylist entre scripts é como as duas
 * cópias divergem e uma delas passa a deixar segredo entrar.
 */

import { basename, sep } from "node:path";

export const CAMINHOS_NEGADOS = [
  /(^|\/)\.env($|\.|[^/]*$)/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /(^|\/)id_rsa/i,
  /(^|\/)id_ed25519/i,
  /(^|\/)credentials?/i,
  /(^|\/)secrets?/i,
  /(^|\/)service-account/i,
  /(^|\/)\.git(\/|$)/i,
  /(^|\/)\.npmrc$/i,
  /(^|\/)\.netrc$/i,
  /(^|\/)\.ssh\//i,
  /(^|\/)\.aws\//i,
  /(^|\/)node_modules(\/|$)/i,
  /(^|\/)\.next(\/|$)/i,
  /(^|\/)\.vercel(\/|$)/i,
  /(^|\/)\.netlify(\/|$)/i,
  /(^|\/)dist(\/|$)/i,
  /(^|\/)build(\/|$)/i,
  /(^|\/)coverage(\/|$)/i,
  /(^|\/)site-build(\/|$)/i,
  /\.log$/i,
  /\.lock$/i,
  /package-lock\.json$/i,
  /tsconfig\.tsbuildinfo$/i,
];

/** Nome de arquivo que sugere credencial. Conservador de propósito. */
export const NOME_SUSPEITO =
  /(^|[-_.])(token|secret|senha|password|apikey|api-key)([-_.]|$)/i;

export function negado(rel) {
  const p = rel.split(sep).join("/");
  if (CAMINHOS_NEGADOS.some((r) => r.test(p))) return "denylist";
  if (NOME_SUSPEITO.test(basename(p))) return "nome_suspeito";
  return null;
}

/** Padrões de VALOR de segredo — comprimento é o discriminador, não o prefixo. */
export const PADROES = [
  [/sk-ant-[A-Za-z0-9_-]{20,}/g, "chave_anthropic"],
  [/\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, "token_github"],
  [/\bgithub_pat_[A-Za-z0-9_]{30,}/g, "token_github"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "chave_aws"],
  [/\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{20,}/g, "chave_stripe"],
  [/\bwhsec_[A-Za-z0-9]{20,}/g, "segredo_webhook"],
  [/\$aact_[A-Za-z0-9_=+/-]{40,}/g, "chave_asaas"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "jwt"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "chave_privada"],
  [/\b[a-z][a-z0-9+.-]*:\/\/[^\s/@]+:[^\s/@]{6,}@/gi, "senha_em_url"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, "token_slack"],
  [/\bBearer\s+[A-Za-z0-9._-]{24,}/g, "bearer"],
];

export function redigir(texto) {
  let saida = texto;
  const achados = [];
  for (const [re, nome] of PADROES) {
    re.lastIndex = 0;
    if (re.test(saida)) {
      achados.push(nome);
      re.lastIndex = 0;
      saida = saida.replace(re, "[REDACTED]");
    }
    re.lastIndex = 0;
  }
  return { texto: saida, achados };
}

/** Dado pessoal em material de marketing — CPF, telefone, e-mail em massa. */
export const PADROES_PESSOAIS = [
  [/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, "cpf"],
  [/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, "cnpj"],
];

export function redigirPessoais(texto) {
  let saida = texto;
  const achados = [];
  for (const [re, nome] of PADROES_PESSOAIS) {
    re.lastIndex = 0;
    if (re.test(saida)) {
      achados.push(nome);
      re.lastIndex = 0;
      saida = saida.replace(re, "[REDACTED]");
    }
    re.lastIndex = 0;
  }
  return { texto: saida, achados };
}
