import { validarUrlPublica } from "../seguranca/rede.ts";

/**
 * Sem "server-only" de propósito — `parsearFeed` é pura (sem rede/banco) e
 * precisa continuar testável direto (node --import testes/lib/resolver-ts.mjs),
 * mesmo padrão já usado em social/deteccao.ts e modelo/registro.ts.
 * `buscarFeed` é a única função com I/O real, mas nada aqui é exclusivo de
 * servidor Next (fetch nativo + seguranca/rede.ts, que também não tem
 * "server-only").
 *
 * Motor genérico de ingestão RSS/Atom (Fase 13) — YouTube é só mais um
 * PROVEDOR que fala este formato (feed Atom público, sem API key — ver
 * canalYoutubeParaUrl abaixo), nunca um caminho hardcoded separado. Mesmo
 * parser serve blog, newsletter, notícia — qualquer RSS 2.0 ou Atom.
 *
 * Sem dependência nova: parser por regex é suficiente pra tag estruturada
 * de feed (mesma disciplina já usada em pesquisa/instagram.ts e
 * modelo/openai.ts — uma dependência a menos). Nunca fetch sem passar por
 * validarUrlPublica primeiro — feed é conteúdo de rede externa, mesma
 * fronteira SSRF do navegador real.
 */

export type ItemFeedBruto = {
  idExterno: string;
  titulo: string;
  resumo: string;
  url: string;
  publicadoEm: string | null;
};

export type ResultadoFeed = { ok: true; itens: ItemFeedBruto[] } | { ok: false; erro: string };

function decodificarEntidades(texto: string): string {
  return texto
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/<[^>]+>/g, " ") // remove marcação HTML solta dentro de description/summary
    .replace(/\s+/g, " ")
    .trim();
}

function extrairTag(bloco: string, tag: string): string | null {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i").exec(bloco);
  return m ? decodificarEntidades(m[1]) : null;
}

/** Atom usa <link href="URL" .../> (tag auto-fechada com atributo, não texto). RSS usa <link>URL</link> (texto). Tenta os dois. */
function extrairLink(bloco: string): string | null {
  const atom = /<link[^>]*\brel=["']alternate["'][^>]*\bhref=["']([^"']+)["']/i.exec(bloco) ?? /<link[^>]*\bhref=["']([^"']+)["']/i.exec(bloco);
  if (atom) return atom[1];
  const rss = extrairTag(bloco, "link");
  return rss;
}

function extrairBlocos(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tag}>`, "gi");
  return xml.match(re) ?? [];
}

/** Detecta Atom (<entry>) vs RSS 2.0 (<item>) — nunca assume um formato só. */
export function parsearFeed(xml: string): ItemFeedBruto[] {
  const entradasAtom = extrairBlocos(xml, "entry");
  const blocos = entradasAtom.length > 0 ? entradasAtom : extrairBlocos(xml, "item");

  return blocos
    .map((bloco): ItemFeedBruto | null => {
      const idExterno = extrairTag(bloco, "id") ?? extrairTag(bloco, "guid") ?? extrairLink(bloco);
      const titulo = extrairTag(bloco, "title");
      const url = extrairLink(bloco);
      if (!idExterno || !titulo || !url) return null; // sem identificador estável, nunca inventa um

      const resumo = extrairTag(bloco, "media:description") ?? extrairTag(bloco, "summary") ?? extrairTag(bloco, "description") ?? "";
      const publicadoEm = extrairTag(bloco, "published") ?? extrairTag(bloco, "pubDate") ?? extrairTag(bloco, "updated");

      return { idExterno, titulo, resumo: resumo.slice(0, 2000), url, publicadoEm };
    })
    .filter((x): x is ItemFeedBruto => x !== null);
}

export async function buscarFeed(url: string): Promise<ResultadoFeed> {
  const validacao = await validarUrlPublica(url);
  if (!validacao.permitido) return { ok: false, erro: validacao.motivo };

  let resp: Response;
  try {
    resp = await fetch(validacao.url, {
      signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": "JarvisIntelligence/1.0 (+local)" },
    });
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message.slice(0, 200) : "falha de rede desconhecida" };
  }
  if (!resp.ok) return { ok: false, erro: `HTTP ${resp.status}` };

  const xml = await resp.text();
  return { ok: true, itens: parsearFeed(xml) };
}

/** Feed público do YouTube por canal — NUNCA precisa de API key nem de cota (diferente de search.list). */
export function urlFeedYoutube(canalId: string): string {
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(canalId)}`;
}
