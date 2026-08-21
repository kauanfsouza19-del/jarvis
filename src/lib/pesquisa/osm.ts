import "server-only";
import { normalizarRespostaGeocodificacao, normalizarRespostaOverpass } from "./normalizacao";

/**
 * Descoberta de negócio via OpenStreetMap — provedor GRATUITO, sem
 * credencial, sem CAPTCHA, dados sob licença aberta (ODbL). Existe porque a
 * ordem de prioridade da fase é "API pública oficial antes de paga":
 * Google Places exige chave paga; Nominatim/Overpass são APIs públicas
 * PROJETADAS pra este uso, com política de uso que PERMITE tráfego
 * automatizado moderado — ao contrário de raspar Google Maps/Search
 * diretamente, que violaria os termos de uso da própria Google (fronteira
 * de "burlar restrição de acesso de plataforma", uma questão de
 * ToS/legal, não uma questão técnica de CAPTCHA — por isso este sistema
 * nunca faz isso; SerpApi, já integrado em busca-web.ts, é o caminho
 * oficial pra busca web).
 *
 * Dois passos, dois serviços do mesmo projeto:
 *  1. Nominatim `/search` — geocodifica a localização texto-livre num
 *     bounding box real (achado testando: Nominatim não serve pra achar
 *     NEGÓCIO por categoria — "pizzarias em Osasco" não bate nome nenhum;
 *     ele é geocodificador de ENDEREÇO/lugar nomeado, não busca de POI).
 *  2. Overpass API — consulta por TAG estruturada (amenity=restaurant,
 *     cuisine=pizza...) dentro do bounding box, que É o mecanismo certo
 *     pra "todo negócio da categoria X numa região" — achado testando: o
 *     Overpass devolveu pizzarias reais de Osasco, com telefone e site
 *     quando o mapeamento OSM já tinha.
 *
 * Vertical livre nunca vira obrigatório mapear pra uma tag: o filtro por
 * NOME (`name~"pizzaria",i`) roda em paralelo com o filtro por tag
 * conhecida (quando existe), então QUALQUER vertical funciona — a tag
 * mapeada só aumenta a cobertura pros casos comuns, nunca é pré-requisito.
 */

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const OVERPASS = "https://overpass-api.de/api/interpreter";
// Valor de header HTTP precisa ser ByteString (Latin-1) — achado rodando de
// verdade: um travessão (—, U+2014) aqui derrubava TODA chamada com
// "Cannot convert argument to a ByteString". Só ASCII puro em header.
const USER_AGENT = "JarvisResearch/1.0 (uso pessoal - prospeccao comercial; https://github.com)";

let ultimaRequisicaoEm = 0;
const INTERVALO_MINIMO_MS = 1100; // política do Nominatim: <= 1 req/s; margem de segurança

async function respeitarLimiteDeTaxa(): Promise<void> {
  const decorrido = Date.now() - ultimaRequisicaoEm;
  if (decorrido < INTERVALO_MINIMO_MS) await new Promise((r) => setTimeout(r, INTERVALO_MINIMO_MS - decorrido));
  ultimaRequisicaoEm = Date.now();
}

/**
 * Vocabulário -> tag OSM. Não é uma lista fechada de "workflow por
 * vertical" (o Orquestrador continua genérico) — é só um mapa de
 * sinônimo -> categoria padrão do OpenStreetMap, igual o próprio Google
 * Maps faz por baixo dos panos quando alguém busca "pizzaria" nele.
 * Vertical fora daqui não quebra nada — só usa unicamente o filtro por
 * nome (cobertura menor, nunca zero).
 */
const MAPA_TAGS: Array<[RegExp, string]> = [
  [/pizza/i, '"amenity"="restaurant"]["cuisine"~"pizza",i'],
  [/hambur/i, '"amenity"~"restaurant|fast_food"]["cuisine"~"burger",i'],
  [/lanchonete|fast.?food/i, '"amenity"="fast_food"'],
  [/a[çc]a[ií]/i, '"amenity"~"restaurant|fast_food|ice_cream"]["cuisine"~"acai|ice_cream",i'],
  [/restaurante/i, '"amenity"="restaurant"'],
  [/academia|gym|fitness|crossfit/i, '"leisure"="fitness_centre"'],
  [/personal trainer/i, '"leisure"="fitness_centre"'],
  [/dentist|odont/i, '"amenity"="dentist"'],
  [/cl[íi]nica m[ée]dica|consult[óo]rio/i, '"amenity"="clinic"'],
  [/est[ée]tica automotiv|funilaria|oficina|auto.?center/i, '"shop"="car_repair"'],
  [/est[ée]tica|sal[ãa]o de beleza|barbearia/i, '"shop"~"beauty|hairdresser"'],
  [/imobili[áa]ri|corretor de im[óo]ve/i, '"office"="estate_agent"'],
  [/advoga|advocacia/i, '"office"="lawyer"'],
  [/farm[áa]cia/i, '"amenity"="pharmacy"'],
  [/pet ?shop|pet ?store/i, '"shop"="pet"'],
  [/veterin[áa]ri/i, '"amenity"="veterinary"'],
  [/padaria/i, '"shop"="bakery"'],
  [/mercado|supermercado/i, '"shop"~"supermarket|convenience"'],
];

function tagOverpassPara(rotuloVertical: string): string | null {
  return MAPA_TAGS.find(([re]) => re.test(rotuloVertical))?.[1] ?? null;
}

async function geocodificarLocalizacao(localizacao: string): Promise<{ ok: true; bbox: [number, number, number, number] } | { ok: false; erro: string }> {
  await respeitarLimiteDeTaxa();
  // Achado rodando de verdade: "Osasco" sozinho, sem país, geocodificou pra
  // um lugar na fronteira Itália/França (nome parecido em outro idioma) em
  // vez de Osasco-SP — o Jarvis é pra prospecção no Brasil, então restringe
  // a busca ao Brasil sempre. Sem isso, QUALQUER cidade brasileira com nome
  // ambíguo internacionalmente vira descoberta silenciosamente errada.
  const params = new URLSearchParams({ q: localizacao, format: "jsonv2", limit: "1", countrycodes: "br" });
  let resp: Response;
  try {
    resp = await fetch(`${NOMINATIM}?${params}`, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
  } catch (e) {
    return { ok: false, erro: `falha de rede geocodificando localização: ${e instanceof Error ? e.message : "erro desconhecido"}` };
  }
  if (!resp.ok) return { ok: false, erro: `geocodificação respondeu HTTP ${resp.status}` };
  const bruto = await resp.json().catch(() => null);
  return normalizarRespostaGeocodificacao(bruto);
}

function construirConsultaOverpass(rotuloVertical: string, bbox: [number, number, number, number], quantidade: number): string {
  const [sul, oeste, norte, leste] = bbox;
  const areaOverpass = `${sul},${oeste},${norte},${leste}`;
  const tag = tagOverpassPara(rotuloVertical);
  // Escapa aspas na palavra livre — nunca interpola texto do Cacique sem
  // sanitizar dentro de uma query de outra API (mesma disciplina de nunca
  // concatenar SQL cru, aplicada aqui pro Overpass QL).
  const termoLivre = rotuloVertical.replace(/["\\]/g, "").split(/\s+/)[0]?.slice(0, 40) || rotuloVertical;
  const limite = Math.min(80, Math.max(quantidade * 2, 20)); // pede mais que o pedido — filtragem/dedup reduz depois

  const clausulas = [
    `node["name"~"${termoLivre}",i](${areaOverpass});`,
    `way["name"~"${termoLivre}",i](${areaOverpass});`,
  ];
  if (tag) {
    clausulas.push(`node[${tag}](${areaOverpass});`, `way[${tag}](${areaOverpass});`);
  }

  return `[out:json][timeout:25];(${clausulas.join("")});out center ${limite};`;
}

/**
 * Overpass é serviço público compartilhado — "servidor ocupado" (504) sob
 * carga é esperado, não uma falha permanente. Retry curto com backoff
 * antes de reportar indisponível; nunca finge sucesso, só dá mais de uma
 * chance real antes de desistir.
 */
async function consultarOverpassComRetry(query: string, tentativas = 3): Promise<{ ok: true; bruto: unknown } | { ok: false; erro: string }> {
  let ultimoErro = "erro desconhecido";
  for (let i = 0; i < tentativas; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1500 * i));
    let resp: Response;
    try {
      resp = await fetch(OVERPASS, {
        method: "POST",
        headers: { "Content-Type": "text/plain", "User-Agent": USER_AGENT },
        body: query,
        signal: AbortSignal.timeout(30000),
      });
    } catch (e) {
      ultimoErro = `falha de rede consultando Overpass: ${e instanceof Error ? e.message : "erro desconhecido"}`;
      continue;
    }
    if (resp.status === 504 || resp.status === 429) {
      ultimoErro = `Overpass respondeu HTTP ${resp.status} (servidor público ocupado)`;
      continue; // tentativa real de novo, não desiste na primeira
    }
    if (!resp.ok) return { ok: false, erro: `Overpass respondeu HTTP ${resp.status}` };
    return { ok: true, bruto: await resp.json().catch(() => null) };
  }
  return { ok: false, erro: `${ultimoErro} — desistiu após ${tentativas} tentativas` };
}

/**
 * Devolve telefone/site do OSM quando o mapeamento já tinha (o Tool usa
 * isso pra enriquecer de graça na própria descoberta — nunca inventa,
 * só repassa o que o OSM já tinha tagueado).
 */
export async function descobrirNegociosOSM(vertical: string, localizacao: string, quantidade: number) {
  const geo = await geocodificarLocalizacao(localizacao);
  if (!geo.ok) return { ok: false as const, erro: geo.erro };

  await respeitarLimiteDeTaxa();
  const query = construirConsultaOverpass(vertical, geo.bbox, quantidade);
  const resposta = await consultarOverpassComRetry(query);
  if (!resposta.ok) return { ok: false as const, erro: resposta.erro };

  const resultado = normalizarRespostaOverpass(resposta.bruto, localizacao);
  if (!resultado.ok) return resultado;
  return { ok: true as const, negocios: resultado.negocios.slice(0, quantidade) };
}
