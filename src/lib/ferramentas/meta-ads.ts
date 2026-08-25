import "server-only";

/**
 * Cliente Meta Marketing API (Fase 27) — fetch cru contra graph.facebook.com,
 * mesmo padrão de modelo/gemini.ts e modelo/ollama.ts (sem SDK).
 *
 * Testado de ponta a ponta nesta fase, à mão, contra conta real (Dra Juliana
 * Klein 2, act_818013916024302) via Graph API Explorer — listagem de
 * contas, listagem de campanhas e insights (spend/cpc/ctr/cpm/CPA reais)
 * todos confirmados contra dado real antes deste módulo existir. As
 * mutações (status/orçamento) abaixo usam o MESMO endpoint documentado da
 * Marketing API, mas NUNCA foram exercitadas contra uma campanha real
 * ainda — primeira execução real deve ser feita numa campanha de baixo
 * risco (ex: pausar uma das campanhas TC1-TC5 já identificadas como
 * "Crítico" no painel), nunca assumida funcionando só por compilar.
 *
 * Duas credenciais, papéis diferentes (ver .env.local.exemplo):
 * - META_ADS_TOKEN: token de usuário de longa duração (~60 dias) — usado em
 *   TODA chamada abaixo (leitura e escrita).
 * - META_APP_ID / META_APP_SECRET: só para RENOVAR o token acima antes de
 *   expirar (endpoint oauth/access_token, grant_type=fb_exchange_token) —
 *   nenhuma função deste módulo os usa ainda (renovação automática é
 *   trabalho futuro, deliberadamente não feito agora — ver relatório da
 *   Fase 27).
 *
 * Fronteira de segurança: este módulo só faz a chamada HTTP. A decisão de
 * SE uma mutação pode rodar (aprovação explícita do Cacique) é inteiramente
 * de ferramentas/registro.ts (nivelPermissao "FINANCIAL" +
 * exigeAprovacaoExplicita: true) e do motor de job — nada aqui decide isso
 * sozinho, e nada aqui deveria ser chamado fora desse caminho.
 */

const GRAPH_BASE = "https://graph.facebook.com/v26.0";

function tokenObrigatorio(): string {
  const t = process.env.META_ADS_TOKEN;
  if (!t) throw new Error("META_ADS_TOKEN não configurado (.env.local) — ver .env.local.exemplo");
  return t;
}

type ErroGraph = { error?: { message: string; type?: string; code?: number; error_subcode?: number; error_user_msg?: string; error_user_title?: string } };

async function chamarGraph<T>(caminho: string, opcoes: { metodo?: "GET" | "POST"; corpo?: Record<string, string> } = {}): Promise<T> {
  const token = tokenObrigatorio();
  const metodo = opcoes.metodo ?? "GET";
  let url = `${GRAPH_BASE}${caminho}`;
  const init: RequestInit = { method: metodo, signal: AbortSignal.timeout(20_000) };

  if (metodo === "GET") {
    url += `${url.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`;
  } else {
    const corpo = new URLSearchParams({ ...(opcoes.corpo ?? {}), access_token: token });
    init.body = corpo;
    init.headers = { "Content-Type": "application/x-www-form-urlencoded" };
  }

  let resp: Response;
  try {
    resp = await fetch(url, init);
  } catch (e) {
    throw new Error(`falha de rede chamando Graph API: ${e instanceof Error ? e.message : "erro desconhecido"}`);
  }
  const dados = (await resp.json()) as T & ErroGraph;
  if (!resp.ok || dados.error) {
    // error_user_msg é a explicação REAL e específica (ex: "falta bid_amount
    // pra essa estratégia de lance") — sem isto, todo erro 100 vira o mesmo
    // "Invalid parameter" genérico e indistinguível de qualquer outro
    // (achado real, Fase 27: 3 causas raiz diferentes, mesma "message").
    const detalhe = dados.error?.error_user_msg ?? dados.error?.error_user_title;
    throw new Error(
      `Graph API erro: ${dados.error?.message ?? `HTTP ${resp.status}`}${dados.error?.code ? ` (code ${dados.error.code}${dados.error.error_subcode ? `/${dados.error.error_subcode}` : ""})` : ""}${detalhe ? ` — ${detalhe}` : ""}`,
    );
  }
  return dados;
}

export type ContaAnuncioMeta = {
  id: string;
  account_id: string;
  name: string;
  account_status: number;
  currency: string;
};

/** Espelha exatamente a chamada já validada à mão contra a conta real (me/adaccounts). */
export async function listarContasAnuncio(): Promise<ContaAnuncioMeta[]> {
  const r = await chamarGraph<{ data: ContaAnuncioMeta[] }>("/me/adaccounts?fields=name,account_id,account_status,currency");
  return r.data;
}

export type CampanhaMeta = {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  daily_budget?: string;
  lifetime_budget?: string;
};

/** contaId no formato "act_XXXXXXXXXXX" (com prefixo), igual ao devolvido por listarContasAnuncio. */
export async function listarCampanhas(contaId: string): Promise<CampanhaMeta[]> {
  validarContaId(contaId);
  const r = await chamarGraph<{ data: CampanhaMeta[] }>(`/${contaId}/campaigns?fields=id,name,status,effective_status,daily_budget,lifetime_budget&limit=200`);
  return r.data;
}

export type InsightCampanhaMeta = {
  campaign_id?: string;
  campaign_name?: string;
  spend?: string;
  cpc?: string;
  ctr?: string;
  cpm?: string;
  actions?: Array<{ action_type: string; value: string }>;
  cost_per_action_type?: Array<{ action_type: string; value: string }>;
  date_start?: string;
  date_stop?: string;
};

const DATE_PRESETS_VALIDOS = new Set(["today", "yesterday", "last_7d", "last_14d", "last_30d", "last_90d", "this_month", "last_month"]);

/** Mesma chamada já validada à mão (level=campaign, insights reais confirmados na conta Klein). */
export async function obterInsightsCampanhas(contaId: string, datePreset = "last_30d"): Promise<InsightCampanhaMeta[]> {
  validarContaId(contaId);
  if (!DATE_PRESETS_VALIDOS.has(datePreset)) throw new Error(`date_preset "${datePreset}" inválido — use um de: ${[...DATE_PRESETS_VALIDOS].join(", ")}`);
  const campos = "campaign_name,campaign_id,spend,cpc,ctr,cpm,cost_per_action_type,actions";
  const r = await chamarGraph<{ data: InsightCampanhaMeta[] }>(`/${contaId}/insights?level=campaign&fields=${campos}&date_preset=${datePreset}`);
  return r.data;
}

function validarContaId(contaId: string): void {
  if (!/^act_\d+$/.test(contaId)) throw new Error(`contaId inválido: "${contaId}" — esperado formato "act_XXXXXXXXXXX"`);
}

function validarCampanhaId(campanhaId: string): void {
  if (!/^\d+$/.test(campanhaId)) throw new Error(`campanhaId inválido: "${campanhaId}" — esperado só dígitos`);
}

// ── Discovery de conta (Fase 27b — Priority 3: Page/Instagram) ──
// Pesquisado contra developers.facebook.com/docs/graph-api/reference/user/accounts
// em 25/08/2026: GET /me/accounts é o endpoint documentado atual pra listar
// as Páginas que o usuário do token administra, cada uma já trazendo
// instagram_business_account quando vinculada — um único campo evita uma
// segunda chamada por Página só pra achar o Instagram correspondente.
export type PaginaMeta = {
  id: string;
  name: string;
  access_token?: string;
  instagram_business_account?: { id: string };
};

export async function listarPaginas(): Promise<PaginaMeta[]> {
  const r = await chamarGraph<{ data: PaginaMeta[] }>("/me/accounts?fields=name,instagram_business_account&limit=100");
  return r.data;
}

// ── Upload de criativo (Fase 27b — Priority 3: pipeline Drive → Meta) ──
// Pesquisado contra developers.facebook.com/docs/marketing-api/image-upload
// e /video-uploads em 25/08/2026: adimages aceita multipart `file`
// diretamente pra imagem (resposta: {images:{"<nome>":{hash,url,...}}});
// vídeo usa o MESMO padrão multipart em advideos pra arquivo < ~1GB
// (resumable upload via /uploads é só necessário acima disso — fora de
// escopo desta fase, arquivo de criativo real observado até agora nunca
// chegou perto). `fetch` com FormData é suportado nativamente pelo Node
// usado aqui (v24) — nenhuma dependência de multipart nova.

export type ImagemEnviadaMeta = { hash: string; url: string };

export async function enviarImagemCreativo(contaId: string, bytes: Buffer, nomeArquivo: string): Promise<ImagemEnviadaMeta> {
  validarContaId(contaId);
  const token = tokenObrigatorio();
  const form = new FormData();
  form.append("access_token", token);
  form.append("file", new Blob([new Uint8Array(bytes)]), nomeArquivo);

  let resp: Response;
  try {
    resp = await fetch(`${GRAPH_BASE}/${contaId}/adimages`, { method: "POST", body: form, signal: AbortSignal.timeout(60_000) });
  } catch (e) {
    throw new Error(`falha de rede enviando imagem pra Meta: ${e instanceof Error ? e.message : "erro desconhecido"}`);
  }
  const dados = (await resp.json()) as { images?: Record<string, { hash: string; url: string }> } & ErroGraph;
  if (!resp.ok || dados.error) {
    const detalhe = dados.error?.error_user_msg ?? dados.error?.error_user_title;
    throw new Error(`Graph API erro ao enviar imagem: ${dados.error?.message ?? `HTTP ${resp.status}`}${detalhe ? ` — ${detalhe}` : ""}`);
  }
  const chave = dados.images ? Object.keys(dados.images)[0] : undefined;
  if (!chave || !dados.images) throw new Error("resposta do upload de imagem sem campo 'images' — resposta inesperada da Meta");
  return { hash: dados.images[chave].hash, url: dados.images[chave].url };
}

export type VideoEnviadoMeta = { videoId: string };

export async function enviarVideoCreativo(contaId: string, bytes: Buffer, nomeArquivo: string): Promise<VideoEnviadoMeta> {
  validarContaId(contaId);
  const token = tokenObrigatorio();
  const form = new FormData();
  form.append("access_token", token);
  form.append("source", new Blob([new Uint8Array(bytes)]), nomeArquivo);

  let resp: Response;
  try {
    resp = await fetch(`${GRAPH_BASE}/${contaId}/advideos`, { method: "POST", body: form, signal: AbortSignal.timeout(120_000) });
  } catch (e) {
    throw new Error(`falha de rede enviando vídeo pra Meta: ${e instanceof Error ? e.message : "erro desconhecido"}`);
  }
  const dados = (await resp.json()) as { id?: string } & ErroGraph;
  if (!resp.ok || dados.error) {
    const detalhe = dados.error?.error_user_msg ?? dados.error?.error_user_title;
    throw new Error(`Graph API erro ao enviar vídeo: ${dados.error?.message ?? `HTTP ${resp.status}`}${detalhe ? ` — ${detalhe}` : ""}`);
  }
  if (!dados.id) throw new Error("resposta do upload de vídeo sem 'id' — resposta inesperada da Meta");
  return { videoId: dados.id };
}

export type StatusCampanha = "ACTIVE" | "PAUSED";

export type ResultadoMutacaoMeta = { id: string; sucesso: true };

/**
 * Pausa ou ativa uma campanha. SÓ deve ser alcançada depois de aprovação
 * explícita (ver ferramentas/registro.ts — nivelPermissao "FINANCIAL",
 * exigeAprovacaoExplicita: true). Efeito real e imediato na conta.
 */
export async function atualizarStatusCampanha(campanhaId: string, status: StatusCampanha): Promise<ResultadoMutacaoMeta> {
  validarCampanhaId(campanhaId);
  await chamarGraph(`/${campanhaId}`, { metodo: "POST", corpo: { status } });
  return { id: campanhaId, sucesso: true };
}

/**
 * Teto de segurança contra erro de dígito (ex: mandar reais em vez de
 * centavos por engano) — nunca aceita um orçamento diário acima disto por
 * uma única chamada, mesmo que aprovado. R$ 50.000/dia é generoso o
 * bastante pra qualquer conta real vista até agora (a maior campanha
 * observada gastou ~R$ 2.269 em 30 dias inteiros) e baixo o bastante pra
 * nunca deixar passar um erro de ordem de grandeza sem ninguém perceber.
 */
const TETO_ORCAMENTO_DIARIO_CENTAVOS = 5_000_000;

/**
 * Atualiza o orçamento DIÁRIO de uma campanha (formato ABO — orçamento no
 * nível da campanha, não do conjunto de anúncios; é o padrão observado nas
 * campanhas reais já analisadas). Valor em CENTAVOS da moeda da conta
 * (BRL): R$ 50,00/dia = 5000. Mesma régua de aprovação de
 * atualizarStatusCampanha.
 */
export async function atualizarOrcamentoDiarioCampanha(campanhaId: string, orcamentoDiarioCentavos: number): Promise<ResultadoMutacaoMeta> {
  validarCampanhaId(campanhaId);
  if (!Number.isInteger(orcamentoDiarioCentavos) || orcamentoDiarioCentavos <= 0) {
    throw new Error("orcamentoDiarioCentavos deve ser um inteiro positivo (centavos da moeda da conta)");
  }
  if (orcamentoDiarioCentavos > TETO_ORCAMENTO_DIARIO_CENTAVOS) {
    throw new Error(`orcamentoDiarioCentavos (${orcamentoDiarioCentavos}) excede o teto de segurança de ${TETO_ORCAMENTO_DIARIO_CENTAVOS} — confirme que o valor está em CENTAVOS, não em reais, antes de tentar de novo com um valor menor`);
  }
  await chamarGraph(`/${campanhaId}`, { metodo: "POST", corpo: { daily_budget: String(orcamentoDiarioCentavos) } });
  return { id: campanhaId, sucesso: true };
}

/**
 * Cria uma campanha nova completa (campanha → conjunto de anúncios →
 * anúncio) REAPROVEITANDO um criativo (image/video + copy + formulário de
 * lead) que já existe na conta — nunca inventa criativo novo, nunca faz
 * upload (upload de mídia nova é trabalho futuro, deliberadamente fora
 * desta fase). `targeting` e `pageId` idealmente vêm de uma campanha real
 * já validada da mesma conta (ver meta_ads.listar_campanhas +
 * consulta manual de /ads e /adsets), nunca inventados.
 *
 * SEMPRE cria os três níveis em PAUSED — nunca ativa sozinha, mesmo
 * depois de aprovada. Ativar é uma chamada separada
 * (atualizarStatusCampanha), com sua própria aprovação explícita — dois
 * passos de aprovação humana antes de qualquer centavo real ser gasto,
 * nunca um só.
 */
export type ParametrosCampanhaTeste = {
  contaId: string;
  nomeCampanha: string;
  orcamentoDiarioCentavos: number;
  creativeId: string;
  pageId: string;
  targeting: Record<string, unknown>;
  optimizationGoal?: string;
  billingEvent?: string;
  bidStrategy?: string;
  destinationType?: string;
};

export type ResultadoCriacaoCampanha = {
  campanhaId: string;
  conjuntoAnuncioId: string;
  anuncioId: string;
  status: "PAUSED";
};

export async function criarCampanhaTeste(p: ParametrosCampanhaTeste): Promise<ResultadoCriacaoCampanha> {
  validarContaId(p.contaId);
  if (!Number.isInteger(p.orcamentoDiarioCentavos) || p.orcamentoDiarioCentavos <= 0) {
    throw new Error("orcamentoDiarioCentavos deve ser um inteiro positivo (centavos da moeda da conta)");
  }
  if (p.orcamentoDiarioCentavos > TETO_ORCAMENTO_DIARIO_CENTAVOS) {
    throw new Error(`orcamentoDiarioCentavos (${p.orcamentoDiarioCentavos}) excede o teto de segurança de ${TETO_ORCAMENTO_DIARIO_CENTAVOS}`);
  }
  if (!p.nomeCampanha.trim()) throw new Error("nomeCampanha não pode ser vazio");

  const campanha = await chamarGraph<{ id: string }>(`/${p.contaId}/campaigns`, {
    metodo: "POST",
    corpo: {
      name: p.nomeCampanha,
      objective: "OUTCOME_LEADS",
      status: "PAUSED",
      special_ad_categories: JSON.stringify([]),
      daily_budget: String(p.orcamentoDiarioCentavos),
      // Achado real (Fase 27, testando contra a conta Klein): sem isto, a
      // Meta aplica o default LOWEST_COST_WITH_BID_CAP, que então EXIGE
      // bid_amount manual no conjunto de anúncios (erro 100/1815857) — a
      // campanha real que estamos replicando usa LOWEST_COST_WITHOUT_CAP
      // no nível da CAMPANHA (não do conjunto, confirmado consultando o
      // objeto real), deixando a Meta licitar automaticamente pelo menor
      // custo. Mesmo valor, sempre — nunca bid manual sem o Cacique pedir.
      bid_strategy: p.bidStrategy ?? "LOWEST_COST_WITHOUT_CAP",
    },
  });

  let conjunto: { id: string };
  try {
    conjunto = await chamarGraph<{ id: string }>(`/${p.contaId}/adsets`, {
      metodo: "POST",
      corpo: {
        name: `${p.nomeCampanha} — conjunto`,
        campaign_id: campanha.id,
        status: "PAUSED",
        billing_event: p.billingEvent ?? "IMPRESSIONS",
        optimization_goal: p.optimizationGoal ?? "LEAD_GENERATION",
        targeting: JSON.stringify(p.targeting),
        promoted_object: JSON.stringify({ page_id: p.pageId }),
        // Achado real (Fase 27): sem isto, o anúncio final falha com "O
        // criativo com formulário de lead só pode ser usado para... o
        // destino ON_AD" (erro 100/1892040) — obrigatório quando o
        // criativo reaproveitado usa Formulário Instantâneo (confirmado
        // no conjunto real: destination_type "ON_AD"). Sem impacto quando
        // não há formulário de lead no criativo.
        destination_type: p.destinationType ?? "ON_AD",
      },
    });
  } catch (e) {
    throw new Error(`campanha ${campanha.id} foi criada (PAUSADA) mas o conjunto de anúncios falhou: ${e instanceof Error ? e.message : "erro desconhecido"} — campanha órfã, apague manualmente no Ads Manager se não for reaproveitar`);
  }

  let anuncio: { id: string };
  try {
    anuncio = await chamarGraph<{ id: string }>(`/${p.contaId}/ads`, {
      metodo: "POST",
      corpo: {
        name: `${p.nomeCampanha} — anúncio`,
        adset_id: conjunto.id,
        creative: JSON.stringify({ creative_id: p.creativeId }),
        status: "PAUSED",
      },
    });
  } catch (e) {
    throw new Error(`campanha ${campanha.id} e conjunto ${conjunto.id} foram criados (PAUSADOS) mas o anúncio falhou: ${e instanceof Error ? e.message : "erro desconhecido"} — estrutura incompleta, revise manualmente no Ads Manager`);
  }

  return { campanhaId: campanha.id, conjuntoAnuncioId: conjunto.id, anuncioId: anuncio.id, status: "PAUSED" };
}
