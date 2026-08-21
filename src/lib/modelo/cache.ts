import "server-only";
import { createHash } from "node:crypto";
import { db } from "../dados/db";
import { tarefaPodeUsarCache } from "./cache-frescor";

export { tarefaPodeUsarCache };

/**
 * Cache de chamada de modelo (Fase 8) — liga `cache_resultados`, tabela que
 * já existia no schema desde fases anteriores mas nunca era lida/escrita
 * por código nenhum (achado revisando o schema, mesma situação de
 * `orcamentos` antes desta fase). Só usado onde reaproveitar é seguro: uma
 * pergunta IDÊNTICA num período curto (a mesma pergunta de novo, minutos
 * depois, ainda vale a mesma resposta) — nunca em tarefa que precisa de
 * dado fresco (diagnóstico de site, pesquisa web, preço).
 */

const TTL_PADRAO_MS = 10 * 60 * 1000;

export function chaveCache(fonte: string, ...partes: string[]): string {
  return createHash("sha256").update(fonte + "::" + partes.join("::")).digest("hex").slice(0, 32);
}

export function obterCache<T>(chave: string): T | null {
  const linha = db().prepare(`SELECT valor, expira_em FROM cache_resultados WHERE chave = ?`).get(chave) as { valor: string; expira_em: string | null } | undefined;
  if (!linha) return null;
  if (linha.expira_em && new Date(linha.expira_em.replace(" ", "T") + "Z").getTime() < Date.now()) return null;
  try {
    return JSON.parse(linha.valor) as T;
  } catch {
    return null;
  }
}

/** Mesmo que `obterCache`, mas recusa servir cache pra classe de tarefa time-sensitive (ver cache-frescor.ts) — nunca é preciso lembrar de checar isso em cada chamador. */
export function obterCacheSeFresco<T>(chave: string, classeTarefa: string): T | null {
  if (!tarefaPodeUsarCache(classeTarefa)) return null;
  return obterCache<T>(chave);
}

export function gravarCache(chave: string, fonte: string, valor: unknown, ttlMs = TTL_PADRAO_MS, confianca?: number): void {
  const expiraEm = new Date(Date.now() + ttlMs).toISOString().replace("T", " ").slice(0, 19);
  db()
    .prepare(
      `INSERT INTO cache_resultados (chave, fonte, valor, confianca, expira_em)
       VALUES (?,?,?,?,?)
       ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor, confianca=excluded.confianca, expira_em=excluded.expira_em, versao=versao+1`,
    )
    .run(chave, fonte, JSON.stringify(valor), confianca ?? null, expiraEm);
}
