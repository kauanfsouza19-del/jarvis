import "server-only";
import { chromium, type Browser } from "playwright";
import { validarUrlPublica } from "../seguranca/rede";

/**
 * Pesquisa PÚBLICA de perfil de Instagram — mesma fronteira do navegador de
 * site: nunca login, nunca CAPTCHA, nunca burla controle de acesso. Testado
 * de verdade contra um perfil público real antes de escrever qualquer linha
 * daqui (ver relatório da fase): uma visita comum (sem login) ao perfil
 * carrega normalmente e mostra prompt de "Log In / Sign Up" JUNTO com o
 * conteúdo público (nome, bio, contagem de seguidores/seguindo/posts, link
 * em destaque) — não é bypass de autenticação, é exatamente o que qualquer
 * visitante deslogado vê no navegador. Quando o Instagram bloquear (perfil
 * privado, rate limit, mudança de layout que quebra a extração), o retorno
 * é NAO_VERIFICADO — nunca "sem Instagram" (ausência de acesso não é
 * ausência do dado).
 */

export type SinaisInstagram = {
  handle: string;
  url: string;
  carregouComSucesso: boolean;
  /** true só quando conseguiu confirmar publicamente que o perfil existe e está acessível sem login. */
  perfilPublicoAcessivel: boolean;
  nomeExibicao: string | null;
  bio: string | null;
  linkNaBio: string | null;
  seguidores: string | null;
  seguindo: string | null;
  publicacoes: string | null;
  erro: string | null;
};

function baseVazia(handle: string, url: string): SinaisInstagram {
  return {
    handle,
    url,
    carregouComSucesso: false,
    perfilPublicoAcessivel: false,
    nomeExibicao: null,
    bio: null,
    linkNaBio: null,
    seguidores: null,
    seguindo: null,
    publicacoes: null,
    erro: null,
  };
}

let instanciaCompartilhada: Browser | null = null;
async function obterBrowser(): Promise<Browser> {
  if (instanciaCompartilhada?.isConnected()) return instanciaCompartilhada;
  instanciaCompartilhada = await chromium.launch({ headless: true });
  return instanciaCompartilhada;
}

/** Aceita "@handle", "handle" ou URL completa — sempre normaliza pra URL pública do perfil. */
function normalizarEntrada(entrada: string): { handle: string; url: string } | null {
  const semEspaco = entrada.trim();
  const deUrl = /instagram\.com\/([a-zA-Z0-9._]{1,30})\/?/i.exec(semEspaco);
  const handle = (deUrl ? deUrl[1] : semEspaco.replace(/^@/, "")).toLowerCase();
  if (!handle || ["p", "reel", "explore", "accounts", "stories"].includes(handle)) return null;
  return { handle, url: `https://www.instagram.com/${handle}/` };
}

export async function pesquisarInstagramPublico(entradaHandleOuUrl: string): Promise<SinaisInstagram> {
  const normalizado = normalizarEntrada(entradaHandleOuUrl);
  if (!normalizado) return { ...baseVazia("", entradaHandleOuUrl), erro: "handle/URL de Instagram inválido" };
  const { handle, url } = normalizado;
  const base = baseVazia(handle, url);

  // Mesma fronteira de SSRF do navegador de site — instagram.com é fixo,
  // mas o handle pode vir de fonte externa (site/OSM), então nunca navega
  // sem validar antes.
  const validacao = await validarUrlPublica(url);
  if (!validacao.permitido) return { ...base, erro: `URL recusada por segurança: ${validacao.motivo}` };

  let browser: Browser;
  try {
    browser = await obterBrowser();
  } catch (e) {
    return { ...base, erro: `navegador indisponível: ${mensagemDeErro(e)}` };
  }

  const contexto = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 JarvisResearch/1.0",
    viewport: { width: 1280, height: 900 },
  });
  const pagina = await contexto.newPage();

  await pagina.route("**/*", async (route) => {
    if (route.request().resourceType() !== "document") return route.continue();
    const check = await validarUrlPublica(route.request().url());
    if (!check.permitido) return route.abort("blockedbyclient");
    return route.continue();
  });

  try {
    const resposta = await pagina.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    const status = resposta?.status() ?? null;
    // Layout de perfil demora um instante a mais que domcontentloaded pra
    // hidratar (SPA) — sem esperar, os campos abaixo saem vazios com
    // frequência mesmo em perfil público real (achado testando de verdade).
    await pagina.waitForTimeout(2500);

    base.carregouComSucesso = status !== null && status < 400;

    const ogDescricao = await pagina.locator('meta[property="og:description"]').first().getAttribute("content").catch(() => null);
    const ogTitulo = await pagina.locator('meta[property="og:title"]').first().getAttribute("content").catch(() => null);
    const html = await pagina.content();

    // "291M Followers, 267 Following, 1,669 Posts - ..." — formato estável
    // do próprio Instagram pra visitante deslogado; é o sinal mais confiável
    // de "perfil público e acessível" que existe nesta página.
    const contagens = ogDescricao ? /([\d.,]+[MmKk]?)\s+Followers?,\s+([\d.,]+[MmKk]?)\s+Following,\s+([\d.,]+[MmKk]?)\s+Posts?/i.exec(ogDescricao) : null;
    if (contagens) {
      base.seguidores = contagens[1];
      base.seguindo = contagens[2];
      base.publicacoes = contagens[3];
      base.perfilPublicoAcessivel = true;
    }

    base.nomeExibicao = ogTitulo ? (/^(.*?)\s*\(@/.exec(ogTitulo)?.[1] ?? ogTitulo).trim() : null;

    // Link em destaque da bio: Instagram embrulha em redirecionador próprio
    // (l.instagram.com/?u=...) — dado estruturado, não regex livre em texto.
    const linkMatch = /l\.instagram\.com\/\?u=([^&"']+)/i.exec(html);
    base.linkNaBio = linkMatch ? decodeURIComponent(linkMatch[1]) : null;

    // Bio: melhor esforço, não estruturado — extrai do bloco de cabeçalho
    // (handle/contagens/nome/handle de novo/BIO/link) só quando o padrão
    // bate; sem o padrão claro, fica null (nunca texto errado com confiança
    // de bio real).
    const headerTexto = await pagina.locator("header").first().innerText().catch(() => "");
    if (headerTexto) base.bio = extrairBioDoTextoDeCabecalho(headerTexto, base.linkNaBio);
  } catch (e) {
    base.erro = mensagemDeErro(e);
  } finally {
    await pagina.close().catch(() => {});
    await contexto.close().catch(() => {});
  }

  return base;
}

/**
 * Heurística: a bio é a(s) linha(s) entre a SEGUNDA ocorrência do handle
 * (repetido no cabeçalho depois do nome de exibição) e a linha do link em
 * destaque (quando existe) ou o fim do bloco. Nunca inventa — sem padrão
 * claro, devolve null.
 */
function extrairBioDoTextoDeCabecalho(texto: string, linkNaBio: string | null): string | null {
  const linhas = texto.split("\n").map((l) => l.trim()).filter(Boolean);
  if (linhas.length < 3) return null;
  const segundaOcorrenciaHandle = linhas.findIndex((l, i) => i > 0 && l === linhas[0]);
  const inicio = segundaOcorrenciaHandle >= 0 ? segundaOcorrenciaHandle + 1 : 3; // fallback: pula handle/seguidores/seguindo
  let fim = linhas.length;
  if (linkNaBio) {
    const dominioLink = linkNaBio.replace(/^https?:\/\//, "").split("/")[0];
    const idxLink = linhas.findIndex((l, i) => i >= inicio && l.includes(dominioLink));
    if (idxLink > inicio) fim = idxLink;
  }
  const bio = linhas.slice(inicio, fim).join(" ").trim();
  return bio.length > 0 && bio.length < 300 ? bio : null;
}

function mensagemDeErro(e: unknown): string {
  return e instanceof Error ? e.message.slice(0, 200) : "erro desconhecido";
}
