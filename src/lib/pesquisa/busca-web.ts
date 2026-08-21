import "server-only";
import { normalizarRespostaSerpApi, type ResultadoBusca } from "./normalizacao";

/**
 * Pesquisa web genérica ("research.web_search") — capacidade
 * agnóstica de provedor. A alternativa a isto seria abrir a página de
 * resultado do Google direto no Playwright, mas isso é exatamente o tipo de
 * coisa que a regra de fronteira do navegador proíbe: SERP de busca é
 * fortemente protegida contra automação, e raspar ali é o tipo de evasão
 * de anti-bot que este sistema nunca faz. Por isso a única fonte real de
 * busca web aqui é uma API de busca oficial — sem uma configurada, a
 * capacidade fica REQUER_CREDENCIAL, honesto, nunca faz raspagem disfarçada
 * pra fingir que tem resultado.
 *
 * SerpApi é o primeiro provedor real (chave paga, uso permitido pelos
 * termos — não é scraping direto de SERP). Trocar de provedor no futuro é
 * escrever outra função com a mesma assinatura, nunca reescrever quem
 * chama. Normalização é função pura em normalizacao.ts, testável sem chave
 * real — ver testes/pesquisa-e-pontuacao.mjs.
 */

export type { ResultadoBusca };
export type ResultadoPesquisaWeb =
  | { ok: true; resultados: ResultadoBusca[]; fonte: string; coletadoEm: string }
  | { ok: false; erro: string };

const ENDPOINT_SERPAPI = "https://serpapi.com/search.json";

export async function pesquisarWeb(consulta: string, limite = 10): Promise<ResultadoPesquisaWeb> {
  const chave = process.env.SERPAPI_KEY;
  if (!chave) return { ok: false, erro: "SERPAPI_KEY não configurada — nenhum provedor de busca web disponível" };

  const url = `${ENDPOINT_SERPAPI}?engine=google&q=${encodeURIComponent(consulta)}&api_key=${chave}&num=${Math.min(20, limite)}`;
  let resp: Response;
  try {
    resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
  } catch (e) {
    return { ok: false, erro: `falha de rede consultando provedor de busca: ${e instanceof Error ? e.message : "erro desconhecido"}` };
  }
  if (!resp.ok) return { ok: false, erro: `provedor de busca respondeu HTTP ${resp.status}` };

  const bruto = await resp.json().catch(() => null);
  const resultados = normalizarRespostaSerpApi(bruto).slice(0, limite);
  return { ok: true, resultados, fonte: "serpapi:google", coletadoEm: new Date().toISOString().replace("T", " ").slice(0, 19) };
}
