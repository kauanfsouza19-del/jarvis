/**
 * Frescor de cache por tarefa (Fase 9, seção 11) — função pura, sem
 * "server-only", sem I/O, separada de cache.ts (que precisa de server-only
 * pra tocar SQLite) só pra continuar testável direto. Decide, ANTES de
 * olhar o cache, se esta classe de tarefa sequer PODE usar cache. Nunca
 * vira "cache pra tudo": tarefa que depende de dado que muda (preço,
 * evidência coletada agora, pesquisa web) nunca é servida de um resultado
 * velho, mesmo dentro do TTL. Exemplo da própria fase: "capital da França"
 * é cacheável; "cotação do dólar agora" e "analise este prospect com dado
 * atual" não são.
 */
const CLASSES_NUNCA_CACHEAVEIS: ReadonlySet<string> = new Set(["WEB_RESEARCH", "REASONING", "FINAL_SYNTHESIS"]);

export function tarefaPodeUsarCache(classeTarefa: string): boolean {
  return !CLASSES_NUNCA_CACHEAVEIS.has(classeTarefa);
}
