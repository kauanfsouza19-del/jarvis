import "server-only";
import { normalizarRespostaPlaces, type ResultadoDescobertaPlaces, type NegocioDescoberto } from "./normalizacao";

/**
 * Descoberta de negócio via Google Places API (Text Search, legado) — a
 * ÚNICA fonte real de descoberta nova nesta fase. Sem GOOGLE_PLACES_API_KEY
 * configurada, `descobrirNegociosGooglePlaces` nunca é chamada (ver
 * ferramentas/registro.ts — `disponibilidadeDe` reporta REQUER_CREDENCIAL
 * antes disso, pela mesma checagem usada em toda Tool credenciada).
 *
 * Texto livre na consulta ("pizzarias em Osasco", "clínicas odontológicas
 * em Osasco") é o que permite QUALQUER vertical sem mapear um enum pra tipo
 * do Places — a Text Search da Places API já aceita linguagem natural.
 *
 * Fronteira: só a Text Search (nome, endereço, place_id). Telefone/site NÃO
 * vêm daqui de propósito — pedir isso exigiria uma chamada de Place Details
 * por resultado (custo por request), e o Jarvis já tem um jeito mais barato
 * de conseguir isso: visitar o site depois, via prospeccao.enrich, que é a
 * MESMA infraestrutura usada pra todo prospect, veio de onde vier.
 *
 * A normalização da resposta (normalizarRespostaPlaces) é função pura em
 * normalizacao.ts, testável sem chave real nem rede — ver testes/
 * pesquisa-e-pontuacao.mjs.
 */

const ENDPOINT = "https://maps.googleapis.com/maps/api/place/textsearch/json";

export type { NegocioDescoberto, ResultadoDescobertaPlaces };

export async function descobrirNegociosGooglePlaces(
  vertical: string,
  localizacao: string,
  quantidade: number,
): Promise<ResultadoDescobertaPlaces> {
  const chave = process.env.GOOGLE_PLACES_API_KEY;
  if (!chave) return { ok: false, erro: "GOOGLE_PLACES_API_KEY não configurada" };

  const consulta = `${vertical} em ${localizacao}`;
  const url = `${ENDPOINT}?query=${encodeURIComponent(consulta)}&key=${chave}`;

  let resp: Response;
  try {
    resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
  } catch (e) {
    return { ok: false, erro: `falha de rede consultando Places API: ${e instanceof Error ? e.message : "erro desconhecido"}` };
  }
  if (!resp.ok) return { ok: false, erro: `Places API respondeu HTTP ${resp.status}` };

  const bruto = await resp.json().catch(() => null);
  const resultado = normalizarRespostaPlaces(bruto, localizacao);
  if (!resultado.ok) return resultado;

  // Text Search já devolve por relevância — só corta na quantidade pedida
  // aqui, nunca pagina além do necessário (controle de custo).
  return { ok: true, negocios: resultado.negocios.slice(0, quantidade) };
}
