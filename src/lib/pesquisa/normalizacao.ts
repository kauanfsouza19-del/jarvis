/**
 * Normalização de resposta de API de pesquisa (Places, busca web) — funções
 * puras, sem `server-only`, sem rede. Separado de propósito (mesmo padrão
 * de modelo/validacao.ts): testável direto com uma resposta FABRICADA, sem
 * precisar de chave real nem processo Next de pé.
 */

export type NegocioDescoberto = {
  placeId: string;
  nome: string;
  enderecoFormatado: string | null;
  cidade: string | null;
};

export type ResultadoDescobertaPlaces = { ok: true; negocios: NegocioDescoberto[] } | { ok: false; erro: string };

/** Extrai só a cidade do endereço formatado do Google — melhor esforço, nunca bloqueia o resultado se não achar. */
function extrairCidade(enderecoFormatado: string | undefined, cidadeSolicitada: string): string | null {
  if (!enderecoFormatado) return cidadeSolicitada || null;
  // "Rua X, 123 - Bairro, Osasco - SP, 12345-678, Brasil" — cidade costuma
  // vir logo antes do " - UF". Melhor esforço; nunca lançamos por não achar.
  const m = /,\s*([^,-]+?)\s*-\s*[A-Z]{2}\b/.exec(enderecoFormatado);
  return m?.[1]?.trim() || cidadeSolicitada || null;
}

export function normalizarRespostaPlaces(bruto: unknown, cidadeSolicitada: string): ResultadoDescobertaPlaces {
  if (typeof bruto !== "object" || bruto === null) return { ok: false, erro: "resposta da Places API não é um objeto" };
  const o = bruto as { status?: string; error_message?: string; results?: unknown[] };

  if (o.status === "ZERO_RESULTS") return { ok: true, negocios: [] };
  if (o.status !== "OK") {
    return { ok: false, erro: `Places API retornou status ${o.status ?? "desconhecido"}${o.error_message ? `: ${o.error_message}` : ""}` };
  }
  if (!Array.isArray(o.results)) return { ok: false, erro: "resposta OK sem results (formato inesperado)" };

  const negocios: NegocioDescoberto[] = o.results
    .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
    .map((r) => ({
      placeId: String(r.place_id ?? ""),
      nome: String(r.name ?? ""),
      enderecoFormatado: typeof r.formatted_address === "string" ? r.formatted_address : null,
      cidade: extrairCidade(typeof r.formatted_address === "string" ? r.formatted_address : undefined, cidadeSolicitada),
    }))
    .filter((n) => n.placeId && n.nome);

  return { ok: true, negocios };
}

/** Geocodificação de área (Nominatim) — usada só pra achar o bounding box da cidade antes de consultar o Overpass. */
export type ResultadoGeocodificacao = { ok: true; bbox: [number, number, number, number] } | { ok: false; erro: string };

export function normalizarRespostaGeocodificacao(bruto: unknown): ResultadoGeocodificacao {
  if (!Array.isArray(bruto) || bruto.length === 0) {
    const o = bruto as { error?: string } | null;
    return { ok: false, erro: `localização não encontrada no OpenStreetMap${o?.error ? `: ${o.error}` : ""}` };
  }
  const primeiro = bruto[0] as Record<string, unknown>;
  const bb = primeiro.boundingbox;
  if (!Array.isArray(bb) || bb.length !== 4) return { ok: false, erro: "geocodificação sem bounding box" };
  const [sul, norte, oeste, leste] = bb.map(Number);
  if ([sul, norte, oeste, leste].some(Number.isNaN)) return { ok: false, erro: "bounding box inválido" };
  return { ok: true, bbox: [sul, oeste, norte, leste] };
}

/**
 * Overpass (OpenStreetMap) — descoberta REAL por categoria dentro de uma
 * área, gratuita e sem credencial. Diferente do Nominatim `/search` (que é
 * geocodificador — só acha entidade cujo NOME bate com a consulta, por
 * isso "pizzarias em Osasco" não achava nada ali), o Overpass consulta por
 * TAG estruturada (amenity=restaurant, cuisine=pizza...) dentro de uma
 * área geográfica — é o mecanismo certo pra "todo negócio da categoria X
 * numa região", e devolve telefone/site quando o mapeamento já tem.
 *
 * `osm_id`+`osm_type` viram o identificador (`osm:{tipo}{id}`) — nunca
 * vazio, garantido pelo filtro final.
 */
export type NegocioDescobertoOSM = NegocioDescoberto & {
  telefone: string | null;
  website: string | null;
  /** Fase 6 — o OSM às vezes já tem estes campos tagueados; extrai quando presentes, nunca infere. */
  bairro: string | null;
  instagram: string | null;
  facebook: string | null;
  email: string | null;
};

/** OSM às vezes tagueia rede social como handle solto ("@nome"), às vezes como URL completa — normaliza pra URL sempre, sem inventar/adivinhar o que não veio. */
function normalizarUrlRedeSocial(bruto: string | undefined, dominio: string): string | null {
  if (!bruto) return null;
  const v = bruto.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  const handle = v.replace(/^@/, "");
  if (!handle) return null;
  return `https://${dominio}/${handle}`;
}

export function normalizarRespostaOverpass(bruto: unknown, cidadeSolicitada: string): { ok: true; negocios: NegocioDescobertoOSM[] } | { ok: false; erro: string } {
  if (typeof bruto !== "object" || bruto === null) return { ok: false, erro: "resposta do Overpass não é um objeto" };
  const o = bruto as { elements?: unknown[]; remark?: string };
  if (!Array.isArray(o.elements)) return { ok: false, erro: `Overpass sem elements${o.remark ? `: ${o.remark}` : ""}` };

  const vistos = new Set<string>();
  const negocios: NegocioDescobertoOSM[] = [];

  for (const el of o.elements) {
    if (typeof el !== "object" || el === null) continue;
    const e = el as Record<string, unknown>;
    const tags = (e.tags as Record<string, unknown>) ?? {};
    const nome = typeof tags.name === "string" ? tags.name.trim() : "";
    if (!nome) continue; // sem nome não é um prospect utilizável

    const tipo = typeof e.type === "string" ? e.type[0] : "?";
    const id = e.id ?? "";
    const chave = `osm:${tipo}${id}`;
    if (vistos.has(chave)) continue; // mesma entidade pode casar tag + nome no mesmo query
    vistos.add(chave);

    const rua = typeof tags["addr:street"] === "string" ? tags["addr:street"] : null;
    const numero = typeof tags["addr:housenumber"] === "string" ? tags["addr:housenumber"] : null;
    const cidade = (typeof tags["addr:city"] === "string" ? tags["addr:city"] : null) || cidadeSolicitada || null;
    const bairro = typeof tags["addr:suburb"] === "string" ? tags["addr:suburb"] : null;
    const endereco = rua ? `${rua}${numero ? `, ${numero}` : ""}${cidade ? ` - ${cidade}` : ""}` : null;

    const telefoneBruto = (tags.phone ?? tags["contact:phone"]) as string | undefined;
    const websiteBruto = (tags.website ?? tags["contact:website"]) as string | undefined;
    // instagram/facebook do OSM às vezes vêm como handle solto, às vezes
    // como URL completa — normaliza pra URL sempre, nunca inventa o handle.
    const instagramBruto = (tags["contact:instagram"] ?? tags.instagram) as string | undefined;
    const facebookBruto = (tags["contact:facebook"] ?? tags.facebook) as string | undefined;
    const emailBruto = (tags.email ?? tags["contact:email"]) as string | undefined;

    negocios.push({
      placeId: chave,
      nome,
      enderecoFormatado: endereco,
      cidade,
      bairro,
      telefone: telefoneBruto ? telefoneBruto.replace(/[^\d+]/g, "") || null : null,
      website: websiteBruto ?? null,
      instagram: normalizarUrlRedeSocial(instagramBruto, "instagram.com"),
      facebook: normalizarUrlRedeSocial(facebookBruto, "facebook.com"),
      email: emailBruto ? emailBruto.trim().toLowerCase() || null : null,
    });
  }

  return { ok: true, negocios };
}

export type ResultadoBusca = { titulo: string; url: string; trecho: string | null };

export function normalizarRespostaSerpApi(bruto: unknown): ResultadoBusca[] {
  if (typeof bruto !== "object" || bruto === null) return [];
  const o = bruto as { organic_results?: unknown[] };
  if (!Array.isArray(o.organic_results)) return [];
  return o.organic_results
    .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
    .map((r) => ({
      titulo: String(r.title ?? ""),
      url: String(r.link ?? ""),
      trecho: typeof r.snippet === "string" ? r.snippet : null,
    }))
    .filter((r) => r.titulo && r.url);
}
