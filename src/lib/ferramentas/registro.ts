import "server-only";
import { diagnosticarSite, type SinaisSite } from "../pesquisa/navegador";
import { descobrirNegociosGooglePlaces } from "../pesquisa/places";
import { descobrirNegociosOSM } from "../pesquisa/osm";
import { pesquisarWeb } from "../pesquisa/busca-web";
import { pesquisarInstagramPublico, type SinaisInstagram } from "../pesquisa/instagram";
import {
  salvarDiagnostico,
  obterProspect,
  criarOuAtualizarProspect,
  registrarEvidenciasDeSite,
  registrarEvidencia,
  repontuarProspect,
  salvarAbordagem,
} from "../prospeccao/repositorio";
import { garantirSinais } from "../prospeccao/diagnostico";
import { analisarSinaisMarketing, type RelatorioMarketing } from "../prospeccao/marketing";
import { rotuloDeVertical } from "../tarefas/roteador";
import { rotear, chamarComFallback } from "../modelo/roteador";
import { higienizarTextoExterno } from "../seguranca/prompt";
import { criarConteudo, type PlataformaConteudo, type TipoConteudo } from "../social/repositorio";
import { buscarEmails, lerEmail, type EmailResumo, type EmailCompleto } from "../google/gmail";
import { listarEventos, criarEvento, type EventoResumo } from "../google/calendar";
import {
  listarArquivosProjeto,
  lerArquivoProjeto,
  escreverArquivoProjeto,
  rodarTestesJarvis,
  rodarTypecheckJarvis,
  rodarBuildJarvis,
  gitStatusJarvis,
  gitDiffJarvis,
  type ArquivoListado,
  type ResultadoComando,
  type ResultadoEscrita,
} from "./codigo";
import type { Ferramenta, ResultadoFerramenta } from "./tipos";

/**
 * Registro de Tools — o que existe de verdade e o que é fronteira definida
 * para o futuro. `implementado: true` só em cima de código que já roda.
 *
 * Cada Tool declara uma `capacidade` — é isso que o Planejador procura
 * ("preciso de diagnosticar_prospect"), nunca o nome da Tool direto. Duas
 * Tools podem oferecer a mesma capacidade no futuro (ex: mais de um
 * provedor de e-mail); o Orquestrador escolhe entre as DISPONÍVEIS, nunca
 * fixa uma na hora de planejar.
 *
 * As Tools com `implementado: false` abaixo são exatamente as que a
 * inspeção de estado já apontou como não conectadas — isto só formaliza
 * essa verdade num lugar único, para nenhuma UI futura poder "esquecer" e
 * reportar conectado por engano. As com `implementado: true` e
 * `credencialNecessaria` definida (Places, busca web) têm código real —
 * sem a chave configurada, `disponibilidadeDe` reporta REQUER_CREDENCIAL
 * automaticamente, nunca finge sucesso nem inventa resultado.
 */

const browserDiagnosticarSite: Ferramenta<{ url: string }, SinaisSite> = {
  nome: "browser.diagnosticar_site",
  descricao: "Visita uma URL pública e extrai sinais técnicos observáveis (pixel, GTM, GA4, WhatsApp, Instagram, plataforma).",
  capacidade: "visitar_site",
  nivelPermissao: "READ",
  exigeAprovacaoExplicita: false,
  implementado: true,
  validarEntrada: (e): e is { url: string } =>
    typeof e === "object" && e !== null && typeof (e as { url?: unknown }).url === "string" && (e as { url: string }).url.length > 0,
  executar: async (entrada): Promise<ResultadoFerramenta<SinaisSite>> => {
    const sinais = await diagnosticarSite(entrada.url);
    return sinais.erro ? { ok: false, erro: sinais.erro } : { ok: true, saida: sinais };
  },
};

/**
 * Composta de propósito: visita o site E grava o diagnóstico/score — é
 * exatamente o que o handler de prospecção já fazia direto, agora exposto
 * como capacidade descobrível em vez de chamada fixa no código do handler.
 */
export type EntradaComSinaisPreCarregados = { prospectId: string; sinaisPreCarregados?: SinaisSite | null };

const prospeccaoDiagnosticarEPontuar: Ferramenta<EntradaComSinaisPreCarregados, { score: number | null; sinaisSite?: SinaisSite }> = {
  nome: "prospeccao.diagnosticar_e_pontuar",
  descricao: "Diagnostica o site de um prospect já cadastrado e grava o score real.",
  capacidade: "diagnosticar_prospect",
  nivelPermissao: "READ",
  exigeAprovacaoExplicita: false,
  implementado: true,
  validarEntrada: (e): e is EntradaComSinaisPreCarregados =>
    typeof e === "object" && e !== null && typeof (e as { prospectId?: unknown }).prospectId === "string",
  executar: async (entrada) => {
    const p = obterProspect(entrada.prospectId);
    if (!p) return { ok: false, erro: "prospect_nao_encontrado" };
    // Sem site NÃO é falha — é um sinal real (a própria ausência já entra
    // no score, ver pontuacao.ts). Achado rodando de verdade: descoberta
    // via OSM traz negócio sem site com frequência, e antes disso virava
    // FALHOU em vez de pontuado — excluía do resultado final exatamente o
    // tipo de prospect que a agência mais quer achar.
    if (!p.website) {
      const resultado = repontuarProspect(entrada.prospectId);
      return { ok: true, saida: { score: resultado?.score ?? null } };
    }
    // sinaisPreCarregados: o Orquestrador encadeou este passo depois de
    // outro estágio (enriquecimento/análise) que JÁ visitou este mesmo site
    // no MESMO plano — reaproveita em vez de visitar de novo (ver
    // prospeccao/diagnostico.ts). Sem isso, visita de verdade — nunca por
    // adivinhação de tempo, só quando o Orquestrador explicitamente manda.
    const { sinais } = await garantirSinais(entrada.prospectId, p.website, entrada.sinaisPreCarregados);
    if (sinais.erro) return { ok: false, erro: sinais.erro };
    const resultado = salvarDiagnostico(entrada.prospectId, sinais, { jaVisitado: true });
    // sinaisSite SEMPRE repassado (reaproveitado ou visita fresca) — é o
    // que permite um estágio SEGUINTE no MESMO pipeline (ex: análise de
    // marketing depois do diagnóstico) reaproveitar de novo, mesmo que
    // ESTE passo já tenha reaproveitado de um estágio anterior. Omitir
    // quando reaproveitado quebraria o encadeamento em cadeias com 3+
    // estágios (a visita real só aconteceu no PRIMEIRO, mas o sinal
    // precisa atravessar todos os estágios seguintes).
    return { ok: true, saida: { score: resultado?.score ?? null, sinaisSite: sinais } };
  },
};

export type SaidaEnriquecimento = {
  camposEncontrados: string[];
  camposNaoEncontrados: string[];
  sinaisSite?: SinaisSite;
};

/**
 * Enriquecimento — visita o site público (mesma fronteira do
 * diagnóstico: nunca login, nunca CAPTCHA, nunca paywall) e extrai contato
 * público, gravando CADA campo com fonte e confiança (ver
 * prospeccao/repositorio.ts registrarEvidenciasDeSite). Nunca sobrescreve
 * campo que o prospect já tinha.
 */
const prospeccaoEnriquecer: Ferramenta<{ prospectId: string; campos?: string[]; sinaisPreCarregados?: SinaisSite | null }, SaidaEnriquecimento> = {
  nome: "prospeccao.enriquecer",
  descricao: "Coleta telefone, WhatsApp, e-mail, Instagram e Facebook públicos do site de um prospect, com fonte e confiança por campo.",
  capacidade: "enriquecer_prospect",
  nivelPermissao: "READ",
  exigeAprovacaoExplicita: false,
  implementado: true,
  validarEntrada: (e): e is { prospectId: string; campos?: string[]; sinaisPreCarregados?: SinaisSite | null } =>
    typeof e === "object" && e !== null && typeof (e as { prospectId?: unknown }).prospectId === "string",
  executar: async (entrada) => {
    const p = obterProspect(entrada.prospectId);
    if (!p) return { ok: false, erro: "prospect_nao_encontrado" };
    // Sem site não é falha de execução — não tem de onde extrair contato,
    // então o passo termina OK com "nada encontrado" (nunca tenta inventar
    // Instagram/telefone que não existe em lugar nenhum acessível).
    const camposPedidos = entrada.campos && entrada.campos.length > 0 ? entrada.campos : ["instagram", "whatsapp", "email", "telefone", "facebook"];
    if (!p.website) {
      return { ok: true, saida: { camposEncontrados: [], camposNaoEncontrados: camposPedidos } };
    }
    const { sinais } = await garantirSinais(entrada.prospectId, p.website, entrada.sinaisPreCarregados);
    if (sinais.erro) return { ok: false, erro: sinais.erro };

    const campos = {
      instagram: sinais.instagramHandle,
      whatsapp: sinais.whatsappNumero,
      email: sinais.emailEncontrado,
      telefone: sinais.telefoneEncontrado,
      facebook: sinais.facebookLink,
    };
    registrarEvidenciasDeSite(entrada.prospectId, p.website, campos);

    const solicitados = entrada.campos && entrada.campos.length > 0 ? entrada.campos : Object.keys(campos);
    const encontrados = solicitados.filter((c) => campos[c as keyof typeof campos]);
    const naoEncontrados = solicitados.filter((c) => !campos[c as keyof typeof campos]);
    // sinaisSite sempre repassado — ver comentário equivalente no diagnóstico.
    return { ok: true, saida: { camposEncontrados: encontrados, camposNaoEncontrados: naoEncontrados, sinaisSite: sinais } };
  },
};

/**
 * Análise de sinal de marketing — mesma visita real, leitura em
 * detectado/não detectado/inconclusivo (ver prospeccao/marketing.ts).
 * Nunca afirma "não anuncia" com certeza que a evidência não sustenta.
 */
const prospeccaoAnalisarMarketing: Ferramenta<EntradaComSinaisPreCarregados, RelatorioMarketing & { sinaisSite?: SinaisSite }> = {
  nome: "prospeccao.analisar_marketing",
  descricao: "Avalia sinais reais de marketing digital (Meta Pixel, GTM, GA4, e-commerce) no site de um prospect, com confiança por sinal.",
  capacidade: "analisar_marketing_digital",
  nivelPermissao: "READ",
  exigeAprovacaoExplicita: false,
  implementado: true,
  validarEntrada: (e): e is EntradaComSinaisPreCarregados =>
    typeof e === "object" && e !== null && typeof (e as { prospectId?: unknown }).prospectId === "string",
  executar: async (entrada) => {
    const p = obterProspect(entrada.prospectId);
    if (!p) return { ok: false, erro: "prospect_nao_encontrado" };
    // Sem site: reusa o MESMO caminho de "página não carregou" —
    // analisarSinaisMarketing já sabe virar tudo inconclusivo nesse caso,
    // nunca "não detectado" (que implicaria ter checado e não achado).
    const sinais = p.website
      ? (await garantirSinais(entrada.prospectId, p.website, entrada.sinaisPreCarregados)).sinais
      : {
          url: "",
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
          erro: "prospect sem site público cadastrado",
          instagramHandle: null,
          whatsappNumero: null,
          emailEncontrado: null,
          telefoneEncontrado: null,
          facebookLink: null,
          enderecoEstruturado: null,
          nomeContatoEstruturado: null,
          cargoContatoEstruturado: null,
        };
    const relatorio = analisarSinaisMarketing(sinais);
    // sinaisSite sempre repassado (mesmo raciocínio do diagnóstico/
    // enriquecimento) — hoje é o último estágio de qualquer cadeia
    // configurada, mas não trava se um estágio futuro vier depois dele.
    return { ok: true, saida: { ...relatorio, sinaisSite: sinais.erro ? undefined : sinais } };
  },
};

/**
 * Pontuação — SEM visita nova ao site (usa o diagnóstico mais recente já
 * gravado). Existe pra "pontue de novo" depois de um enriquecimento não ter
 * custo de rede nenhum — puramente determinístico, nunca chama modelo.
 */
const prospeccaoPontuar: Ferramenta<{ prospectId: string }, { score: number; classificacao: string }> = {
  nome: "prospeccao.pontuar",
  descricao: "Recalcula o score de um prospect a partir do que já foi observado, sem visitar o site de novo.",
  capacidade: "pontuar_prospect",
  nivelPermissao: "READ",
  exigeAprovacaoExplicita: false,
  implementado: true,
  validarEntrada: (e): e is { prospectId: string } =>
    typeof e === "object" && e !== null && typeof (e as { prospectId?: unknown }).prospectId === "string",
  executar: async (entrada) => {
    const resultado = repontuarProspect(entrada.prospectId);
    if (!resultado) return { ok: false, erro: "prospect_nao_encontrado" };
    return { ok: true, saida: { score: resultado.score, classificacao: resultado.classificacao } };
  },
};

/**
 * Descoberta de negócio novo — Google Places Text Search, texto livre (sem
 * enum fechado de tipo de negócio, ver pesquisa/places.ts). `implementado:
 * true` porque o código é real; sem GOOGLE_PLACES_API_KEY, disponibilidadeDe
 * reporta REQUER_CREDENCIAL e o Planejador nunca chega a chamar isto —
 * cai no caminho honesto já existente (trabalha só com prospects
 * cadastrados e diz isso).
 */
export type EntradaDescobertaNegocios = { vertical: string; rotuloVertical: string | null; localizacao: string; quantidade: number };
export type SaidaDescobertaNegocios = { criados: number; atualizados: number; prospectIds: string[] };

const validarEntradaDescoberta = (e: unknown): e is EntradaDescobertaNegocios =>
  typeof e === "object" &&
  e !== null &&
  typeof (e as EntradaDescobertaNegocios).vertical === "string" &&
  typeof (e as EntradaDescobertaNegocios).localizacao === "string" &&
  typeof (e as EntradaDescobertaNegocios).quantidade === "number";

/** Mesmo caminho de cadastro pra qualquer provedor de descoberta — dedup real, nunca dois códigos diferentes pra "criar prospect a partir de negócio achado". */
async function executarDescoberta(
  entrada: EntradaDescobertaNegocios,
  fonte: string,
  buscar: (rotulo: string, localizacao: string, quantidade: number) => ReturnType<typeof descobrirNegociosGooglePlaces>,
): Promise<ResultadoFerramenta<SaidaDescobertaNegocios>> {
  const rotulo = rotuloDeVertical(entrada.vertical, entrada.rotuloVertical);
  const resultado = await buscar(rotulo, entrada.localizacao, entrada.quantidade);
  if (!resultado.ok) return { ok: false, erro: resultado.erro };

  let criados = 0;
  let atualizados = 0;
  const prospectIds: string[] = [];
  for (const n of resultado.negocios) {
    const { prospect, novo } = criarOuAtualizarProspect({
      negocio: n.nome,
      vertical: entrada.vertical,
      cidade: n.cidade ?? entrada.localizacao,
      placeId: n.placeId,
      fonte,
    });
    prospectIds.push(prospect.id);
    if (novo) criados++;
    else atualizados++;
  }
  return { ok: true, saida: { criados, atualizados, prospectIds } };
}

const placesDescobrirNegocios: Ferramenta<EntradaDescobertaNegocios, SaidaDescobertaNegocios> = {
  nome: "places.descobrir_negocios",
  descricao: "Descobre negócios novos por vertical (texto livre) e cidade via Google Places.",
  capacidade: "descobrir_negocios",
  nivelPermissao: "READ",
  exigeAprovacaoExplicita: false,
  implementado: true,
  credencialNecessaria: "GOOGLE_PLACES_API_KEY",
  validarEntrada: validarEntradaDescoberta,
  executar: (entrada) => executarDescoberta(entrada, "google_places", descobrirNegociosGooglePlaces),
};

/**
 * Segundo provedor da MESMA capacidade — gratuito, sem credencial, via
 * Nominatim/OpenStreetMap (ver pesquisa/osm.ts). Como não exige credencial,
 * `disponibilidadeDe` reporta DISPONIVEL sempre, e é o que
 * `ferramentaDisponivelPara("descobrir_negocios")` escolhe quando o Places
 * não está configurado — descoberta de negócio novo passa a funcionar de
 * verdade sem nenhuma chave paga.
 */
const osmDescobrirNegocios: Ferramenta<EntradaDescobertaNegocios, SaidaDescobertaNegocios> = {
  nome: "osm.descobrir_negocios",
  descricao: "Descobre negócios novos por vertical (texto livre) e cidade via OpenStreetMap (geocodificação + Overpass) — gratuito, sem credencial. Cobertura real por categoria (tag OSM conhecida) e por nome; nem toda categoria tem tag mapeada.",
  capacidade: "descobrir_negocios",
  nivelPermissao: "READ",
  exigeAprovacaoExplicita: false,
  implementado: true,
  validarEntrada: validarEntradaDescoberta,
  executar: async (entrada) => {
    const rotulo = rotuloDeVertical(entrada.vertical, entrada.rotuloVertical);
    const resultado = await descobrirNegociosOSM(rotulo, entrada.localizacao, entrada.quantidade);
    if (!resultado.ok) return { ok: false, erro: resultado.erro };

    let criados = 0;
    let atualizados = 0;
    const prospectIds: string[] = [];
    for (const n of resultado.negocios) {
      const { prospect, novo } = criarOuAtualizarProspect({
        negocio: n.nome,
        vertical: entrada.vertical,
        cidade: n.cidade ?? entrada.localizacao,
        bairro: n.bairro ?? undefined,
        endereco: n.enderecoFormatado ?? undefined,
        placeId: n.placeId,
        website: n.website ?? undefined,
        telefonePublico: n.telefone ?? undefined,
        instagram: n.instagram ?? undefined,
        facebook: n.facebook ?? undefined,
        emailPublico: n.email ?? undefined,
        fonte: "openstreetmap",
      });
      prospectIds.push(prospect.id);
      if (novo) criados++;
      else atualizados++;
      // OSM às vezes já tem telefone/site/rede social tagueado — evidência
      // real, com fonte própria, nunca silenciosa (mesma disciplina do
      // enriquecimento). Confiança "media": é dado declarado por quem
      // editou o mapa, não extraído/verificado pelo Jarvis agora.
      if (n.telefone) registrarEvidencia(prospect.id, "telefone", n.telefone, "openstreetmap", "media");
      if (n.website) registrarEvidencia(prospect.id, "website", n.website, "openstreetmap", "media");
      if (n.instagram) registrarEvidencia(prospect.id, "instagram", n.instagram, "openstreetmap", "media");
      if (n.facebook) registrarEvidencia(prospect.id, "facebook", n.facebook, "openstreetmap", "media");
      if (n.email) registrarEvidencia(prospect.id, "email", n.email, "openstreetmap", "media");
    }
    return { ok: true, saida: { criados, atualizados, prospectIds } };
  },
};

/**
 * Pesquisa web genérica — provedor-agnóstica (ver pesquisa/busca-web.ts).
 * Sem SERPAPI_KEY (ou outro provedor futuro) configurada, REQUER_CREDENCIAL
 * honesto — nunca abre a página de resultado de busca via Playwright pra
 * contornar isso (seria evasão de anti-bot, fora da fronteira permitida).
 */
const buscaWeb: Ferramenta<{ consulta: string; limite?: number }, { resultados: unknown[] }> = {
  nome: "browser.pesquisar",
  descricao: "Busca pública na web via provedor de busca oficial (não abre SERP diretamente).",
  capacidade: "pesquisar_web",
  nivelPermissao: "READ",
  exigeAprovacaoExplicita: false,
  implementado: true,
  credencialNecessaria: "SERPAPI_KEY",
  validarEntrada: (e): e is { consulta: string; limite?: number } =>
    typeof e === "object" && e !== null && typeof (e as { consulta?: unknown }).consulta === "string" && (e as { consulta: string }).consulta.length > 0,
  executar: async (entrada) => {
    const resultado = await pesquisarWeb(entrada.consulta, entrada.limite ?? 10);
    if (!resultado.ok) return { ok: false, erro: resultado.erro };
    return { ok: true, saida: { resultados: resultado.resultados } };
  },
};

/**
 * Prova real de "job derivado de resultado anterior": gera texto de
 * abordagem de venda pros prospects de um resultado já existente. Usa o
 * modelo quando disponível — sem ANTHROPIC_API_KEY, falha honesto (nunca
 * texto fabricado por template disfarçado de "abordagem personalizada").
 *
 * Entrada é só `prospectId` de propósito — a evidência (motivo_score,
 * oportunidades, classificação) é lida do prospect NO MOMENTO da execução,
 * nunca congelada na hora de montar o Plano. Isso é o que permite um
 * pipeline "descobrir -> enriquecer -> pontuar -> abordar" encadeado: a
 * abordagem usa o estado mais recente, depois dos passos anteriores.
 */
export type EntradaAbordagem = { prospectId: string };
const gerarAbordagem: Ferramenta<EntradaAbordagem, { texto: string }> = {
  nome: "modelo.gerar_abordagem",
  descricao: "Gera uma mensagem de abordagem comercial personalizada para um prospect, a partir do diagnóstico real dele.",
  capacidade: "gerar_abordagem",
  nivelPermissao: "WRITE",
  exigeAprovacaoExplicita: false,
  implementado: true,
  credencialNecessaria: "ANTHROPIC_API_KEY",
  validarEntrada: (e): e is EntradaAbordagem =>
    typeof e === "object" && e !== null && typeof (e as { prospectId?: unknown }).prospectId === "string",
  executar: async (entrada) => {
    // Fase 8: abordagem é copy que representa o Cacique pro prospect — nem
    // tarefa mecânica (CHEAP) nem raciocínio estratégico (PREMIUM), BALANCED
    // é o tier certo. rotear() já cobre orçamento/disponibilidade real.
    const decisao = rotear({ tipoTarefa: "copy", complexidade: "media", tamanhoContextoTokens: 400 });
    if (!decisao.provedor) return { ok: false, erro: decisao.motivo || "nenhum provedor de modelo disponível" };
    const p = obterProspect(entrada.prospectId);
    if (!p) return { ok: false, erro: "prospect_nao_encontrado" };

    const oportunidades: string[] = p.oportunidades ? JSON.parse(p.oportunidades) : [];
    const contexto = [
      p.motivo_score ?? "Sem diagnóstico detalhado.",
      oportunidades.length > 0 ? `Oportunidades observadas: ${oportunidades.join(", ")}.` : "",
      p.classificacao_oportunidade ? `Classificação de oportunidade: ${p.classificacao_oportunidade}.` : "",
    ]
      .filter(Boolean)
      .join(" ");
    // Nome do negócio vem de descoberta pública (OSM/Places) — origem
    // externa, fora do controle do Cacique. Higieniza antes de entrar no
    // prompt (defesa em profundidade; a defesa principal é a instrução
    // explícita de fronteira em comporResposta).
    const nomeSeguro = higienizarTextoExterno(p.negocio, 120);
    const texto = await chamarComFallback(decisao, (provedor) => provedor.comporResposta(`Escrever abertura de abordagem comercial para ${nomeSeguro}`, contexto));
    salvarAbordagem(entrada.prospectId, texto);
    return { ok: true, saida: { texto } };
  },
};

/**
 * Pesquisa pública de Instagram — capacidade nova da Fase 6, testada de
 * verdade contra perfil público real antes de virar Tool (ver pesquisa/
 * instagram.ts). Gratuita, sem credencial: visita a MESMA página que
 * qualquer visitante deslogado vê, nunca contorna login.
 *
 * Só roda quando o prospect JÁ tem um handle/URL de Instagram conhecido
 * (de OSM, do site, ou cadastro manual) — esta Tool NUNCA adivinha handle a
 * partir do nome do negócio (chutar "@nomedonegocio" seria dado fabricado
 * com aparência de real, exatamente o que a Fase 6 proíbe).
 */
export type SaidaPesquisaInstagram = { pesquisado: boolean; perfilAcessivel: boolean };
const prospeccaoPesquisarInstagram: Ferramenta<{ prospectId: string }, SaidaPesquisaInstagram> = {
  nome: "instagram.pesquisar",
  descricao: "Coleta sinal público de um perfil de Instagram já conhecido do prospect (bio, link em destaque, seguidores/seguindo/posts) — nunca contorna login, nunca adivinha handle.",
  capacidade: "pesquisar_instagram",
  nivelPermissao: "READ",
  exigeAprovacaoExplicita: false,
  implementado: true,
  validarEntrada: (e): e is { prospectId: string } =>
    typeof e === "object" && e !== null && typeof (e as { prospectId?: unknown }).prospectId === "string",
  executar: async (entrada) => {
    const p = obterProspect(entrada.prospectId);
    if (!p) return { ok: false, erro: "prospect_nao_encontrado" };
    if (!p.instagram) {
      return { ok: true, saida: { pesquisado: false, perfilAcessivel: false } };
    }

    const sinais: SinaisInstagram = await pesquisarInstagramPublico(p.instagram);
    const fonte = `instagram_publico:${sinais.handle}`;

    // Bloqueio/erro de acesso vira nao_verificado — NUNCA "sem Instagram".
    // Ausência de acesso não é ausência do dado (instrução explícita da fase).
    const statusBase = sinais.erro || !sinais.carregouComSucesso ? "nao_verificado" : undefined;

    registrarEvidencia(entrada.prospectId, "instagram_bio", sinais.bio, fonte, "media", statusBase ?? (sinais.bio ? "encontrado" : "nao_encontrado"));
    registrarEvidencia(entrada.prospectId, "instagram_link_bio", sinais.linkNaBio, fonte, "alta", statusBase ?? (sinais.linkNaBio ? "encontrado" : "nao_encontrado"));
    registrarEvidencia(
      entrada.prospectId,
      "instagram_seguidores",
      sinais.seguidores,
      fonte,
      "alta",
      statusBase ?? (sinais.seguidores ? "encontrado" : "nao_encontrado"),
    );
    registrarEvidencia(entrada.prospectId, "instagram_publicacoes", sinais.publicacoes, fonte, "alta", statusBase ?? (sinais.publicacoes ? "encontrado" : "nao_encontrado"));

    return { ok: true, saida: { pesquisado: true, perfilAcessivel: sinais.perfilPublicoAcessivel } };
  },
};

/**
 * Geração de conteúdo social (Fase 11) — mesmo padrão de gerarAbordagem:
 * rotear() decide o modelo, chamarComFallback() executa com fallback real,
 * comporResposta() gera o texto (reaproveita a MESMA operação de copy já
 * usada pra abordagem comercial, nunca um segundo método de ModelProvider
 * só pra isto). Sempre grava como RASCUNHO — nunca pula pra
 * AGUARDANDO_APROVACAO sozinho; a fila de aprovação (Rule 21) é uma
 * decisão explícita de quem revisa o rascunho, nunca automática.
 */
export type EntradaGerarConteudo = { tema: string; plataforma?: PlataformaConteudo; tipoConteudo?: TipoConteudo; agenteId?: string | null; jobId?: string | null; planoId?: string | null };
export type SaidaGerarConteudo = { conteudoId: string; titulo: string };

function extrairHashtags(texto: string): string[] {
  const achados = texto.match(/#[a-zA-Z0-9_À-ÿ]+/g) ?? [];
  return [...new Set(achados)].slice(0, 15);
}

const gerarConteudoSocial: Ferramenta<EntradaGerarConteudo, SaidaGerarConteudo> = {
  nome: "modelo.gerar_conteudo_social",
  descricao: "Gera um rascunho de conteúdo (legenda/hashtags) para uma plataforma social, a partir de um tema — sempre entra na fila como RASCUNHO, nunca pula revisão/aprovação.",
  capacidade: "gerar_conteudo_social",
  nivelPermissao: "WRITE",
  exigeAprovacaoExplicita: false, // gerar rascunho não é ação externa — publicar (fora de escopo desta fase) é que exigiria
  implementado: true,
  credencialNecessaria: "ANTHROPIC_API_KEY",
  validarEntrada: (e): e is EntradaGerarConteudo =>
    typeof e === "object" && e !== null && typeof (e as { tema?: unknown }).tema === "string",
  executar: async (entrada) => {
    const decisao = rotear({ tipoTarefa: "copy", complexidade: "media", tamanhoContextoTokens: 400 });
    if (!decisao.provedor) return { ok: false, erro: decisao.motivo || "nenhum provedor de modelo disponível" };

    const temaSeguro = higienizarTextoExterno(entrada.tema, 200);
    const plataforma = entrada.plataforma ?? "instagram";
    const objetivo = `Escrever legenda de post de ${plataforma} sobre: ${temaSeguro}`;
    const contexto = "Inclua uma chamada pra ação curta no fim e 3 a 8 hashtags relevantes em português.";
    const texto = await chamarComFallback(decisao, (provedor) => provedor.comporResposta(objetivo, contexto));

    const conteudo = criarConteudo({
      titulo: temaSeguro.slice(0, 80),
      conceito: entrada.tema,
      tipoConteudo: entrada.tipoConteudo ?? "post",
      plataforma,
      legenda: texto,
      hashtags: extrairHashtags(texto),
      promptReferencia: objetivo,
      status: "RASCUNHO",
      criadoPor: "jarvis",
      agenteId: entrada.agenteId ?? null,
      jobId: entrada.jobId ?? null,
      planoId: entrada.planoId ?? null,
    });

    return { ok: true, saida: { conteudoId: conteudo.id, titulo: conteudo.titulo } };
  },
};

/**
 * Gmail/Calendar (Fase 14/2) — antes eram stub(); agora chamam a API real
 * do Google via lib/google/*. `credencialNecessaria: GOOGLE_CLIENT_ID`
 * continua reportando REQUER_CREDENCIAL quando a variável não existe; se
 * existir mas o OAuth nunca foi concluído, `executar` devolve um erro
 * honesto ("gmail_nao_conectado"/"calendar_nao_conectado") em vez de
 * fingir sucesso — a mesma distinção que `disponibilidadeDe` não cobre
 * sozinha (ela só enxerga variável de ambiente, não estado de conexão).
 */
const gmailBuscar: Ferramenta<{ query?: string; max?: number }, EmailResumo[]> = {
  nome: "gmail.buscar",
  descricao: "Busca mensagens numa conta Gmail autorizada.",
  capacidade: "buscar_email",
  nivelPermissao: "READ",
  exigeAprovacaoExplicita: false,
  implementado: true,
  credencialNecessaria: "GOOGLE_CLIENT_ID",
  validarEntrada: (e): e is { query?: string; max?: number } => typeof e === "object" && e !== null,
  executar: async (entrada) => {
    const r = await buscarEmails(entrada.query ?? "", entrada.max ?? 10);
    return r.ok ? { ok: true, saida: r.dados } : { ok: false, erro: r.erro };
  },
};

const gmailLer: Ferramenta<{ id: string }, EmailCompleto> = {
  nome: "gmail.ler",
  descricao: "Lê o conteúdo de uma mensagem específica.",
  capacidade: "ler_email",
  nivelPermissao: "READ",
  exigeAprovacaoExplicita: false,
  implementado: true,
  credencialNecessaria: "GOOGLE_CLIENT_ID",
  validarEntrada: (e): e is { id: string } => typeof e === "object" && e !== null && typeof (e as { id?: unknown }).id === "string",
  executar: async (entrada) => {
    const r = await lerEmail(entrada.id);
    return r.ok ? { ok: true, saida: r.dados } : { ok: false, erro: r.erro };
  },
};

const calendarListar: Ferramenta<{ desde?: string; ate?: string }, EventoResumo[]> = {
  nome: "calendar.listar",
  descricao: "Lista eventos do calendário principal da conta autorizada.",
  capacidade: "listar_agenda",
  nivelPermissao: "READ",
  exigeAprovacaoExplicita: false,
  implementado: true,
  credencialNecessaria: "GOOGLE_CLIENT_ID",
  validarEntrada: (e): e is { desde?: string; ate?: string } => typeof e === "object" && e !== null,
  executar: async (entrada) => {
    const r = await listarEventos(entrada.desde, entrada.ate);
    return r.ok ? { ok: true, saida: r.dados } : { ok: false, erro: r.erro };
  },
};

const calendarCriar: Ferramenta<{ titulo: string; inicioIso: string; fimIso: string; local?: string; participantes?: string[] }, EventoResumo> = {
  nome: "calendar.criar",
  descricao: "Cria um evento novo no calendário principal.",
  capacidade: "criar_evento_agenda",
  nivelPermissao: "WRITE",
  exigeAprovacaoExplicita: true, // cria evento de verdade na agenda real — mesma régua de qualquer WRITE externo
  implementado: true,
  credencialNecessaria: "GOOGLE_CLIENT_ID",
  validarEntrada: (e): e is { titulo: string; inicioIso: string; fimIso: string; local?: string; participantes?: string[] } =>
    typeof e === "object" && e !== null && typeof (e as { titulo?: unknown }).titulo === "string" && typeof (e as { inicioIso?: unknown }).inicioIso === "string" && typeof (e as { fimIso?: unknown }).fimIso === "string",
  executar: async (entrada) => {
    const r = await criarEvento(entrada);
    return r.ok ? { ok: true, saida: r.dados } : { ok: false, erro: r.erro };
  },
};

/* ── código do próprio Jarvis (Fase 20 — missão de agente) ──
 * Só-leitura/só-verificação: listar, ler, typecheck, build, testes
 * (allowlist), git status/diff. Nenhuma delas escreve em disco — editar
 * arquivo do próprio Jarvis fica fora desta fase (ver relatório final).
 */

const codigoListarArquivos: Ferramenta<{ pasta?: string }, ArquivoListado[]> = {
  nome: "codigo.listar_arquivos",
  descricao: "Lista arquivos e pastas de um diretório do repositório Jarvis (não recursivo).",
  capacidade: "listar_arquivos_jarvis",
  nivelPermissao: "READ",
  exigeAprovacaoExplicita: false,
  implementado: true,
  validarEntrada: (e): e is { pasta?: string } => typeof e === "object" && e !== null,
  executar: async (entrada) => {
    try {
      return { ok: true, saida: await listarArquivosProjeto(entrada.pasta ?? ".") };
    } catch (e) {
      return { ok: false, erro: e instanceof Error ? e.message : "erro ao listar" };
    }
  },
};

const codigoLerArquivo: Ferramenta<{ caminho: string }, { conteudo: string; truncado: boolean; tamanhoBytes: number }> = {
  nome: "codigo.ler_arquivo",
  descricao: "Lê o conteúdo de um arquivo de texto do repositório Jarvis (nunca segredo/credencial/banco).",
  capacidade: "ler_arquivo_jarvis",
  nivelPermissao: "READ",
  exigeAprovacaoExplicita: false,
  implementado: true,
  validarEntrada: (e): e is { caminho: string } => typeof e === "object" && e !== null && typeof (e as { caminho?: unknown }).caminho === "string",
  executar: async (entrada) => {
    try {
      return { ok: true, saida: await lerArquivoProjeto(entrada.caminho) };
    } catch (e) {
      return { ok: false, erro: e instanceof Error ? e.message : "erro ao ler" };
    }
  },
};

const codigoRodarTestes: Ferramenta<{ arquivo: string }, ResultadoComando> = {
  nome: "codigo.rodar_testes",
  descricao: "Roda um arquivo de teste puro do Jarvis (allowlist: contexto.mjs, ferramentas-tipos.mjs, modelo-validacao.mjs, modelo-registro.mjs, roteador.mjs) e reporta a saída real.",
  capacidade: "rodar_testes_jarvis",
  nivelPermissao: "WRITE",
  exigeAprovacaoExplicita: false, // executa código de teste, nunca muda produção — reversível por natureza
  implementado: true,
  validarEntrada: (e): e is { arquivo: string } => typeof e === "object" && e !== null && typeof (e as { arquivo?: unknown }).arquivo === "string",
  executar: async (entrada) => {
    try {
      return { ok: true, saida: await rodarTestesJarvis(entrada.arquivo) };
    } catch (e) {
      return { ok: false, erro: e instanceof Error ? e.message : "erro ao rodar teste" };
    }
  },
};

const codigoRodarTypecheck: Ferramenta<Record<string, never>, ResultadoComando> = {
  nome: "codigo.rodar_typecheck",
  descricao: "Roda 'tsc --noEmit' no repositório Jarvis e reporta a saída real.",
  capacidade: "rodar_typecheck_jarvis",
  nivelPermissao: "WRITE",
  exigeAprovacaoExplicita: false,
  implementado: true,
  validarEntrada: (e): e is Record<string, never> => typeof e === "object" && e !== null,
  executar: async () => ({ ok: true, saida: await rodarTypecheckJarvis() }),
};

const codigoRodarBuild: Ferramenta<Record<string, never>, ResultadoComando> = {
  nome: "codigo.rodar_build",
  descricao: "Roda 'npm run build' (build de produção) no repositório Jarvis e reporta a saída real.",
  capacidade: "rodar_build_jarvis",
  nivelPermissao: "WRITE",
  exigeAprovacaoExplicita: false,
  implementado: true,
  validarEntrada: (e): e is Record<string, never> => typeof e === "object" && e !== null,
  executar: async () => ({ ok: true, saida: await rodarBuildJarvis() }),
};

const codigoGitStatus: Ferramenta<Record<string, never>, ResultadoComando> = {
  nome: "codigo.git_status",
  descricao: "Roda 'git status --short' no repositório Jarvis.",
  capacidade: "inspecionar_git_jarvis",
  nivelPermissao: "READ",
  exigeAprovacaoExplicita: false,
  implementado: true,
  validarEntrada: (e): e is Record<string, never> => typeof e === "object" && e !== null,
  executar: async () => ({ ok: true, saida: await gitStatusJarvis() }),
};

// Fase 22 — única Tool de ESCRITA de código desta esteira. WRITE +
// exigeAprovacaoExplicita:true = disponibilidadeDe() nunca reporta
// DISPONIVEL (ver ferramentas/tipos.ts) — o executor de Plano SEMPRE
// para em AGUARDANDO_APROVACAO antes de rodar (ver plano-orquestrado.ts,
// jaAprovado checado por plano_passo_id específico). Nunca executa sem
// aprovação explícita do Cacique, mesmo que o modelo peça.
const codigoEscreverArquivo: Ferramenta<{ caminho: string; conteudo: string }, ResultadoEscrita> = {
  nome: "codigo.escrever_arquivo",
  descricao: "Escreve o conteúdo completo de um arquivo de texto do repositório Jarvis (substituição total, não patch). SEMPRE exige aprovação explícita antes de rodar.",
  capacidade: "escrever_arquivo_jarvis",
  nivelPermissao: "WRITE",
  exigeAprovacaoExplicita: true,
  implementado: true,
  validarEntrada: (e): e is { caminho: string; conteudo: string } =>
    typeof e === "object" && e !== null && typeof (e as { caminho?: unknown }).caminho === "string" && typeof (e as { conteudo?: unknown }).conteudo === "string",
  executar: async (entrada) => {
    try {
      return { ok: true, saida: await escreverArquivoProjeto(entrada.caminho, entrada.conteudo) };
    } catch (e) {
      return { ok: false, erro: e instanceof Error ? e.message : "erro ao escrever" };
    }
  },
};

const codigoGitDiff: Ferramenta<{ caminho?: string }, ResultadoComando> = {
  nome: "codigo.git_diff",
  descricao: "Roda 'git diff --stat' (opcionalmente restrito a um caminho) no repositório Jarvis.",
  capacidade: "inspecionar_git_jarvis",
  nivelPermissao: "READ",
  exigeAprovacaoExplicita: false,
  implementado: true,
  validarEntrada: (e): e is { caminho?: string } => typeof e === "object" && e !== null,
  executar: async (entrada) => {
    try {
      return { ok: true, saida: await gitDiffJarvis(entrada.caminho) };
    } catch (e) {
      return { ok: false, erro: e instanceof Error ? e.message : "erro ao rodar git diff" };
    }
  },
};

function stub(
  nome: string,
  descricao: string,
  capacidade: string,
  nivelPermissao: Ferramenta["nivelPermissao"],
  exigeAprovacaoExplicita: boolean,
  credencialNecessaria?: string,
): Ferramenta {
  return {
    nome,
    descricao,
    capacidade,
    nivelPermissao,
    exigeAprovacaoExplicita,
    implementado: false,
    credencialNecessaria,
    validarEntrada: (e): e is unknown => e !== undefined,
    // sem `executar` — chamar isto é erro de programação, não de runtime silencioso
  };
}

// O registro é heterogêneo de propósito — cada Tool tem seu próprio par
// entrada/saída, e quem consome sempre passa por `validarEntrada` (guarda de
// runtime) antes de chamar `executar`. O cast é o preço de expor um registro
// único e, ainda assim, cada Tool tipada no próprio arquivo onde é definida.
export const REGISTRO_FERRAMENTAS: Ferramenta[] = [
  browserDiagnosticarSite as unknown as Ferramenta,
  prospeccaoDiagnosticarEPontuar as unknown as Ferramenta,
  prospeccaoEnriquecer as unknown as Ferramenta,
  prospeccaoAnalisarMarketing as unknown as Ferramenta,
  prospeccaoPontuar as unknown as Ferramenta,
  placesDescobrirNegocios as unknown as Ferramenta,
  osmDescobrirNegocios as unknown as Ferramenta,
  buscaWeb as unknown as Ferramenta,
  gerarAbordagem as unknown as Ferramenta,
  prospeccaoPesquisarInstagram as unknown as Ferramenta,
  gerarConteudoSocial as unknown as Ferramenta,
  gmailBuscar as unknown as Ferramenta,
  gmailLer as unknown as Ferramenta,
  calendarListar as unknown as Ferramenta,
  calendarCriar as unknown as Ferramenta,
  codigoListarArquivos as unknown as Ferramenta,
  codigoLerArquivo as unknown as Ferramenta,
  codigoEscreverArquivo as unknown as Ferramenta,
  codigoRodarTestes as unknown as Ferramenta,
  codigoRodarTypecheck as unknown as Ferramenta,
  codigoRodarBuild as unknown as Ferramenta,
  codigoGitStatus as unknown as Ferramenta,
  codigoGitDiff as unknown as Ferramenta,
  stub("whatsapp.enviar", "Envia mensagem de WhatsApp em nome do Cacique.", "enviar_mensagem_whatsapp", "EXTERNAL_COMMUNICATION", true, "EVOLUTION_API_URL"),
  stub("meta_ads.analisar", "Lê campanhas de uma conta Meta Ads autorizada.", "analisar_meta_ads", "READ", false),
  stub("google_ads.analisar", "Lê campanhas de uma conta Google Ads autorizada.", "analisar_google_ads", "READ", false),
  stub("google_ads.negativar", "Adiciona palavra negativa a uma campanha.", "negativar_google_ads", "WRITE", true),
  stub("imagem.gerar", "Gera imagem via provedor externo.", "gerar_imagem", "WRITE", false),
  stub("video.gerar", "Gera vídeo via provedor externo.", "gerar_video", "WRITE", false),
];

export function obterFerramenta(nome: string): Ferramenta | undefined {
  return REGISTRO_FERRAMENTAS.find((f) => f.nome === nome);
}

export function listarFerramentasImplementadas(): Ferramenta[] {
  return REGISTRO_FERRAMENTAS.filter((f) => f.implementado);
}

/** O Planejador procura por CAPACIDADE — nunca por nome de Tool fixo. */
export function ferramentasParaCapacidade(capacidade: string): Ferramenta[] {
  return REGISTRO_FERRAMENTAS.filter((f) => f.capacidade === capacidade);
}
