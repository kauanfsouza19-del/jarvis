import "server-only";
import { chromium, type Browser } from "playwright";
import { validarUrlPublica } from "../seguranca/rede";

/**
 * Agente de navegador — capacidade central de pesquisa do Jarvis.
 *
 * Regra de fronteira, não negociável: só site público, sem burlar login,
 * sem CAPTCHA, sem paywall, sem se passar pelo Cacique. Quando o site pede
 * autenticação, a resposta é dizer isso — nunca contornar.
 *
 * Um browser Chromium por chamada, fechado sempre no `finally`. Nada de
 * pool/sessão persistente nesta fase — a prioridade é correção e não
 * vazar processo, não performance de alto volume.
 */

let instanciaCompartilhada: Browser | null = null;

async function obterBrowser(): Promise<Browser> {
  if (instanciaCompartilhada?.isConnected()) return instanciaCompartilhada;
  instanciaCompartilhada = await chromium.launch({ headless: true });
  return instanciaCompartilhada;
}

export async function encerrarBrowserCompartilhado() {
  if (instanciaCompartilhada) {
    await instanciaCompartilhada.close().catch(() => {});
    instanciaCompartilhada = null;
  }
}

export type SinaisSite = {
  url: string;
  httpStatus: number | null;
  tempoCarregamentoMs: number | null;
  temMetaPixel: boolean;
  temGtm: boolean;
  temGa4: boolean;
  temWhatsappLink: boolean;
  temInstagramLink: boolean;
  viewportMobile: boolean;
  tituloPagina: string | null;
  descricaoMeta: string | null;
  plataformaDetectada: string | null;
  erro: string | null;
  /**
   * Enriquecimento — extraído da MESMA página pública já carregada, nunca de
   * uma fonte autenticada. `null` é sempre "não encontrado nesta página",
   * nunca "não existe" — é por isso que cada um vira evidência com fonte
   * própria (ver prospeccao/repositorio.ts registrarEvidencia), não uma
   * afirmação definitiva.
   */
  instagramHandle: string | null;
  whatsappNumero: string | null;
  emailEncontrado: string | null;
  telefoneEncontrado: string | null;
  facebookLink: string | null;
  /**
   * Endereço/nome de contato — só de dado ESTRUTURADO (JSON-LD schema.org
   * PostalAddress/Person), nunca de regex livre em texto solto (endereço e
   * nome de pessoa são fáceis demais de "achar" errado num regex genérico —
   * mais vale null honesto do que um dado inventado com confiança falsa).
   * Ver extrairContatoSchemaOrg abaixo.
   */
  enderecoEstruturado: string | null;
  nomeContatoEstruturado: string | null;
  cargoContatoEstruturado: string | null;
};

/**
 * Visita um site público e devolve só o que foi OBSERVADO — nunca inferência
 * apresentada como fato. "temMetaPixel: false" significa "não encontrei o
 * script na página carregada agora", não "essa empresa não anuncia".
 */
export async function diagnosticarSite(urlBruta: string): Promise<SinaisSite> {
  const url = normalizarUrl(urlBruta);
  const t0 = Date.now();

  const base: SinaisSite = {
    url,
    httpStatus: null,
    tempoCarregamentoMs: null,
    temMetaPixel: false,
    temGtm: false,
    temGa4: false,
    temWhatsappLink: false,
    temInstagramLink: false,
    viewportMobile: false,
    tituloPagina: null,
    descricaoMeta: null,
    plataformaDetectada: null,
    erro: null,
    instagramHandle: null,
    whatsappNumero: null,
    emailEncontrado: null,
    telefoneEncontrado: null,
    facebookLink: null,
    enderecoEstruturado: null,
    nomeContatoEstruturado: null,
    cargoContatoEstruturado: null,
  };

  // SSRF: website de prospect pode vir de descoberta automática (fonte que
  // o Jarvis não controla) — nunca navega antes de confirmar que o
  // hostname resolve pra IP público. Falha aqui é reportada como erro
  // observado, igual a qualquer outra falha de carregamento — nunca lança.
  const validacao = await validarUrlPublica(url);
  if (!validacao.permitido) {
    return { ...base, erro: `URL recusada por segurança: ${validacao.motivo}` };
  }

  let browser: Browser;
  try {
    browser = await obterBrowser();
  } catch (e) {
    return { ...base, erro: `navegador indisponível: ${mensagemDeErro(e)}` };
  }

  const contexto = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 JarvisResearch/1.0",
  });
  const pagina = await contexto.newPage();

  // Redirect-based SSRF: a validação acima cobre a URL inicial, mas um site
  // malicioso pode redirecionar (3xx ou meta-refresh/JS) pra um alvo
  // interno DEPOIS de passar na checagem. Playwright segue redirect
  // sozinho, então cada navegação do documento principal é revalidada
  // aqui antes de seguir — sub-recurso (imagem/script) não é revalidado
  // por request (custo de DNS por request seria proibitivo), limitação
  // conhecida e documentada no relatório da fase.
  await pagina.route("**/*", async (route) => {
    if (route.request().resourceType() !== "document") return route.continue();
    const check = await validarUrlPublica(route.request().url());
    if (!check.permitido) return route.abort("blockedbyclient");
    return route.continue();
  });

  try {
    const resposta = await pagina.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    base.httpStatus = resposta?.status() ?? null;
    base.tempoCarregamentoMs = Date.now() - t0;

    const html = await pagina.content();
    base.tituloPagina = await pagina.title().catch(() => null);
    base.descricaoMeta = await pagina
      .locator('meta[name="description"]')
      .first()
      .getAttribute("content")
      .catch(() => null);

    base.temMetaPixel = /connect\.facebook\.net\/[^"']+\/fbevents\.js|fbq\(/i.test(html);
    base.temGtm = /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]+/i.test(html);
    base.temGa4 = /gtag\(['"]config['"]\s*,\s*['"]G-[A-Z0-9]+|googletagmanager\.com\/gtag\/js\?id=G-/i.test(
      html,
    );
    base.temWhatsappLink = /wa\.me\/|whatsapp\.com\/send|api\.whatsapp\.com/i.test(html);
    base.temInstagramLink = /instagram\.com\/[a-zA-Z0-9._]+/i.test(html);
    base.viewportMobile = /<meta[^>]+name=["']viewport["']/i.test(html);

    if (/cdn\.shopify\.com|Shopify\.theme/i.test(html)) base.plataformaDetectada = "shopify";
    else if (/wp-content|woocommerce/i.test(html)) base.plataformaDetectada = "woocommerce";
    else if (/nuvemshop|tiendanube/i.test(html)) base.plataformaDetectada = "nuvemshop";
    else if (/lojaintegrada/i.test(html)) base.plataformaDetectada = "loja_integrada";

    // Enriquecimento — mesma página, só que extraindo o VALOR em vez de só
    // detectar presença. Nunca abre outra página pra isso (ficaria fora do
    // limite "só site público já carregado").
    const instagram = /instagram\.com\/([a-zA-Z0-9._]{2,30})/i.exec(html);
    base.instagramHandle = instagram && !["p", "reel", "explore", "accounts"].includes(instagram[1].toLowerCase()) ? `@${instagram[1]}` : null;

    const whatsapp = /(?:wa\.me\/|api\.whatsapp\.com\/send\?phone=)(\d{8,15})/i.exec(html);
    base.whatsappNumero = whatsapp ? whatsapp[1] : null;

    const facebook = /facebook\.com\/(?!sharer|share\.php|plugins)([a-zA-Z0-9.]{2,50})/i.exec(html);
    base.facebookLink = facebook ? `https://facebook.com/${facebook[1]}` : null;

    // mailto: primeiro (intenção explícita de contato); texto solto só como
    // fallback, e nunca dentro de atributo/script pra não pegar rastreador.
    const emailMailto = /mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i.exec(html);
    const emailTexto = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/.exec(
      await pagina.locator("body").innerText().catch(() => ""),
    );
    base.emailEncontrado = (emailMailto?.[1] ?? emailTexto?.[0])?.toLowerCase() ?? null;

    const telTexto = /\btel:\+?(\d{10,13})\b/.exec(html) ?? /\(?\b\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}\b/.exec(html);
    base.telefoneEncontrado = telTexto ? telTexto[0].replace(/[^\d+]/g, "") : null;

    const estruturado = extrairContatoSchemaOrg(html);
    base.enderecoEstruturado = estruturado.endereco;
    base.nomeContatoEstruturado = estruturado.nomeContato;
    base.cargoContatoEstruturado = estruturado.cargoContato;
  } catch (e) {
    base.erro = mensagemDeErro(e);
  } finally {
    await pagina.close().catch(() => {});
    await contexto.close().catch(() => {});
  }

  return base;
}

/** Palavras que legitimam chamar alguém de contato de dono/direção — nunca infere de cargo genérico (ex: "atendente", "vendedor"). */
const RE_CARGO_DONO = /propriet[aá]ri[oa]|\bdon[oa]\b|s[oó]ci[oa][- ]?(fundador|propriet[aá]ri[oa])?|fundador|founder|\bceo\b|diretor(a)?[- ]?(geral|executiv[oa])?/i;

/**
 * Endereço/contato SÓ de JSON-LD (schema.org) — dado estruturado que o
 * próprio site declarou sobre si mesmo, nunca regex livre em texto solto.
 * `founder` é aceito sempre (papel explícito no vocabulário schema.org);
 * qualquer outro `Person` só entra se o `jobTitle` bater um cargo de
 * dono/direção real — nunca "primeiro nome de pessoa que a página cita".
 */
function extrairContatoSchemaOrg(html: string): { endereco: string | null; nomeContato: string | null; cargoContato: string | null } {
  const resultado: { endereco: string | null; nomeContato: string | null; cargoContato: string | null } = {
    endereco: null,
    nomeContato: null,
    cargoContato: null,
  };

  const blocos = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const bloco of blocos) {
    let dados: unknown;
    try {
      dados = JSON.parse(bloco[1]);
    } catch {
      continue;
    }
    const itens = Array.isArray(dados) ? dados : [dados];
    for (const item of itens) {
      if (!item || typeof item !== "object") continue;
      const obj = item as Record<string, unknown>;

      if (!resultado.endereco) {
        const end = obj.address as Record<string, unknown> | undefined;
        if (end && typeof end === "object") {
          const partes = [end.streetAddress, end.addressLocality, end.addressRegion, end.postalCode].filter(
            (p): p is string => typeof p === "string" && p.trim().length > 0,
          );
          if (partes.length > 0) resultado.endereco = partes.join(", ");
        }
      }

      if (!resultado.nomeContato) {
        const founder = obj.founder as Record<string, unknown> | undefined;
        if (founder && typeof founder === "object" && typeof founder.name === "string") {
          resultado.nomeContato = founder.name;
          resultado.cargoContato = "Fundador (declarado no site)";
        } else if (obj["@type"] === "Person" && typeof obj.name === "string" && typeof obj.jobTitle === "string" && RE_CARGO_DONO.test(obj.jobTitle)) {
          resultado.nomeContato = obj.name;
          resultado.cargoContato = obj.jobTitle;
        }
      }
    }
    if (resultado.endereco && resultado.nomeContato) break;
  }

  return resultado;
}

function normalizarUrl(u: string): string {
  const semEspaco = u.trim();
  if (/^https?:\/\//i.test(semEspaco)) return semEspaco;
  return `https://${semEspaco}`;
}

function mensagemDeErro(e: unknown): string {
  return e instanceof Error ? e.message.slice(0, 200) : "erro desconhecido";
}
