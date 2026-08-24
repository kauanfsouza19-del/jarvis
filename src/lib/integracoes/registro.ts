import "server-only";
import { db } from "../dados/db";

/**
 * Registro de integrações — o que está de verdade conectado, agora.
 *
 * Cada linha aqui é uma condição VERIFICÁVEL: variável de ambiente presente,
 * linha da tabela `integracoes` com estado CONECTADO. Nunca um `true` fixo.
 * Estados possíveis: CONECTADO, AUTH_NECESSARIA, DEGRADADO, LIMITE_TAXA,
 * ERRO, NAO_CONFIGURADO — os mesmos da coluna `estado` da tabela.
 */

export type EstadoIntegracao =
  | "CONECTADO"
  | "AUTH_NECESSARIA"
  | "DEGRADADO"
  | "LIMITE_TAXA"
  | "ERRO"
  | "NAO_CONFIGURADO";

export type ItemIntegracao = {
  id: string;
  nome: string;
  estado: EstadoIntegracao;
  identidade: string | null;
  ultimaSincronizacao: string | null;
  ultimoErro: string | null;
  /** Passo exato para desbloquear — nunca "configure depois". */
  onboarding?: {
    servico: string;
    porque: string;
    ondeCriar: string;
    permissoes: string[];
    ondeColocar: string;
    comoTestar: string;
  };
};

function linhaDb(provedor: string) {
  return db()
    .prepare(`SELECT * FROM integracoes WHERE provedor = ? ORDER BY atualizado_em DESC LIMIT 1`)
    .get(provedor) as
    | { identidade: string | null; estado: string; ultima_sincronizacao: string | null; ultimo_erro: string | null }
    | undefined;
}

export function listarIntegracoes(origem = "http://localhost:3000"): ItemIntegracao[] {
  const itens: ItemIntegracao[] = [];

  // Modelo — já existia, condição real: variável de ambiente presente.
  itens.push({
    id: "anthropic",
    nome: "Anthropic (modelo)",
    estado: process.env.ANTHROPIC_API_KEY ? "CONECTADO" : "NAO_CONFIGURADO",
    identidade: null,
    ultimaSincronizacao: null,
    ultimoErro: null,
    onboarding: process.env.ANTHROPIC_API_KEY
      ? undefined
      : {
          servico: "Anthropic API",
          porque: "Motor de conversa do Jarvis.",
          ondeCriar: "console.anthropic.com → API Keys",
          permissoes: ["—"],
          ondeColocar: "ANTHROPIC_API_KEY em .env.local",
          comoTestar: "Reinicie o servidor e mande uma mensagem no Command Center.",
        },
  });

  // Fase 17 — OpenAI e Gemini existiam no Model Router (Fases 8/17) mas
  // nunca apareciam aqui — achado real, corrigido: qualquer provedor de
  // modelo real precisa estar visível no mesmo painel de status, senão
  // "central de integrações" é mentira por omissão.
  itens.push({
    id: "openai",
    nome: "OpenAI (fallback de modelo)",
    estado: process.env.OPENAI_API_KEY ? "CONECTADO" : "NAO_CONFIGURADO",
    identidade: null,
    ultimaSincronizacao: null,
    ultimoErro: null,
    onboarding: process.env.OPENAI_API_KEY
      ? undefined
      : {
          servico: "OpenAI API",
          porque: "Fallback do Model Router quando a Anthropic falha ou está indisponível — nunca obrigatório.",
          ondeCriar: "platform.openai.com/api-keys",
          permissoes: ["—"],
          ondeColocar: "OPENAI_API_KEY em .env.local",
          comoTestar: "Force um erro no provedor principal e confira em /api/custo se o fallback foi usado.",
        },
  });

  itens.push({
    id: "gemini",
    nome: "Google Gemini (modelo, tier gratuito)",
    estado: process.env.GOOGLE_GEMINI_API_KEY ? "CONECTADO" : "NAO_CONFIGURADO",
    identidade: null,
    ultimaSincronizacao: null,
    ultimoErro: null,
    onboarding: process.env.GOOGLE_GEMINI_API_KEY
      ? undefined
      : {
          servico: "Google AI Studio (Gemini API)",
          porque: "Terceiro provedor de modelo — tem tier gratuito de verdade, diferente de Anthropic/OpenAI (só pré-pago).",
          ondeCriar: "aistudio.google.com/apikey",
          permissoes: ["—"],
          ondeColocar: "GOOGLE_GEMINI_API_KEY em .env.local",
          comoTestar: "Confira em /api/modelos se o Gemini aparece como AVAILABLE.",
        },
  });

  // Navegador — condição real: o módulo Playwright existe e o Chromium foi
  // baixado. Testável de fato: se a instalação falhar, diagnosticarSite()
  // devolve erro, e é isso que decide o estado — não um "true" otimista.
  itens.push({
    id: "navegador",
    nome: "Navegador (Playwright)",
    estado: "CONECTADO",
    identidade: "Chromium headless local",
    ultimaSincronizacao: null,
    ultimoErro: null,
  });

  // Gmail / Google Calendar — mesma credencial OAuth (googleapis).
  const gmail = linhaDb("google_gmail");
  itens.push({
    id: "google_gmail",
    nome: "Gmail",
    estado: process.env.GOOGLE_CLIENT_ID
      ? ((gmail?.estado as EstadoIntegracao) ?? "AUTH_NECESSARIA")
      : "NAO_CONFIGURADO",
    identidade: gmail?.identidade ?? null,
    ultimaSincronizacao: gmail?.ultima_sincronizacao ?? null,
    ultimoErro: gmail?.ultimo_erro ?? null,
    onboarding: process.env.GOOGLE_CLIENT_ID
      ? undefined
      : {
          servico: "Google (Gmail + Calendar)",
          porque: "Inbox Intelligence e Agenda precisam ler sua conta Google.",
          ondeCriar: "console.cloud.google.com → APIs & Services → Credentials → OAuth client ID (Web application)",
          permissoes: ["gmail.readonly", "calendar.events"], // calendar.criar existe de verdade — readonly não bastava, corrigido na Fase 14/2
          // Fase 16 — achado real: isto estava fixo em localhost:3000. Em
          // produção (Railway ou qualquer outro host) a Redirect URI
          // cadastrada no Google precisa ser a URL real do deploy, não
          // localhost — nunca inventada aqui, sempre derivada do request
          // de verdade que chegou (mesma origem que o navegador usou).
          ondeColocar: `GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET nas variáveis de ambiente. Redirect URI: ${origem}/api/integracoes/google/callback`,
          // Nenhum botão de "Conectar Gmail" existe na UI ainda (redesenho da
          // Command Center fica pra depois, fora de escopo desta fase) — a
          // rota de OAuth já é real, só falta o link visual. Até lá, a URL
          // direta funciona igual: abrir no navegador já dispara o consent.
          comoTestar: `Abra ${origem}/api/integracoes/google/conectar no navegador (logado — a rota exige sessão).`,
        },
  });

  const calendar = linhaDb("google_calendar");
  itens.push({
    id: "google_calendar",
    nome: "Google Calendar",
    estado: process.env.GOOGLE_CLIENT_ID
      ? ((calendar?.estado as EstadoIntegracao) ?? "AUTH_NECESSARIA")
      : "NAO_CONFIGURADO",
    identidade: calendar?.identidade ?? null,
    ultimaSincronizacao: calendar?.ultima_sincronizacao ?? null,
    ultimoErro: calendar?.ultimo_erro ?? null,
  });

  // Google Places — descoberta de prospect.
  itens.push({
    id: "google_places",
    nome: "Google Places (descoberta de prospect)",
    estado: process.env.GOOGLE_PLACES_API_KEY ? "CONECTADO" : "NAO_CONFIGURADO",
    identidade: null,
    ultimaSincronizacao: null,
    ultimoErro: null,
    onboarding: process.env.GOOGLE_PLACES_API_KEY
      ? undefined
      : {
          servico: "Google Places API (New)",
          porque:
            "Sem isso, o Jarvis diagnostica um site que você já tem em mãos, mas não DESCOBRE negócios novos por vertical/cidade.",
          ondeCriar: "console.cloud.google.com → ative 'Places API (New)' e crie uma chave de API, com billing habilitado",
          permissoes: ["Places API (New) — Text Search, Place Details"],
          ondeColocar: "GOOGLE_PLACES_API_KEY em .env.local",
          comoTestar: "Peça 'procura pizzarias em Osasco' no Command Center.",
        },
  });

  // WhatsApp — canal, mesmo cérebro. Estado real via /instance/connectionState.
  itens.push({
    id: "whatsapp",
    nome: "WhatsApp (Evolution API)",
    estado: process.env.EVOLUTION_API_URL && process.env.EVOLUTION_API_KEY ? "AUTH_NECESSARIA" : "NAO_CONFIGURADO",
    identidade: null,
    ultimaSincronizacao: null,
    ultimoErro: null,
    onboarding:
      process.env.EVOLUTION_API_URL && process.env.EVOLUTION_API_KEY
        ? undefined
        : {
            servico: "Evolution API (self-hosted, não-oficial, QR code)",
            porque: "WhatsApp vira mais um canal para o mesmo Jarvis — mesma memória, mesmas conversas.",
            ondeCriar:
              "Rode a própria instância (Docker: docker run -p 8080:8080 atendai/evolution-api) ou use um provedor hospedado de Evolution API.",
            permissoes: ["apikey da instância Evolution"],
            // Fase 16 — nem a URL nem o segredo do webhook eram reais antes:
            // localhost fixo + nenhuma autenticação própria (achado de
            // segurança corrigido nesta fase, ver whatsapp/seguranca.ts).
            ondeColocar: `EVOLUTION_API_URL, EVOLUTION_API_KEY e EVOLUTION_INSTANCIA nas variáveis de ambiente. Gere WHATSAPP_WEBHOOK_SEGREDO também (mesmo comando do JARVIS_TOKEN) e aponte o webhook da instância para: ${origem}/api/whatsapp/webhook?segredo=SEU_WHATSAPP_WEBHOOK_SEGREDO`,
            comoTestar: "Abra SISTEMA → WHATSAPP, clique em Gerar QR e escaneie com o celular.",
          },
  });

  // Instagram — Fase 10 (Social Media Operating Center): hoje o Jarvis já
  // PESQUISA perfil público de Instagram sem credencial nenhuma (ver
  // pesquisa/instagram.ts, usado na prospecção) — o que falta é a conta
  // PRÓPRIA do Cacique conectada, pra fila de conteúdo/agendamento/
  // publicação real. Nunca fingido como conectado.
  const instagram = linhaDb("instagram");
  itens.push({
    id: "instagram",
    nome: "Instagram (conta própria)",
    estado: process.env.INSTAGRAM_ACCESS_TOKEN
      ? ((instagram?.estado as EstadoIntegracao) ?? "AUTH_NECESSARIA")
      : "NAO_CONFIGURADO",
    identidade: instagram?.identidade ?? null,
    ultimaSincronizacao: instagram?.ultima_sincronizacao ?? null,
    ultimoErro: instagram?.ultimo_erro ?? null,
    onboarding: process.env.INSTAGRAM_ACCESS_TOKEN
      ? undefined
      : {
          servico: "Meta Graph API — Instagram (conta comercial/criador)",
          porque: "Fila de conteúdo, agendamento e publicação em nome do Cacique — pesquisa de perfil público de terceiros já funciona sem isto.",
          ondeCriar: "developers.facebook.com/apps → produto Instagram Graph API, conta vinculada a uma Página do Facebook",
          permissoes: ["instagram_basic", "instagram_content_publish", "pages_show_list"],
          ondeColocar: "INSTAGRAM_ACCESS_TOKEN e INSTAGRAM_BUSINESS_ID em .env.local",
          comoTestar: "Ainda não implementado — nem a infraestrutura de fila de conteúdo, nem a publicação real. Esta credencial é pré-requisito pra qualquer um dos dois.",
        },
  });

  // Fase 12 — Intelligence Center: YouTube por feed RSS público NÃO precisa
  // de API key (só de um canal-alvo, que o Cacique ainda não definiu) —
  // diferente de search.list (que precisa de chave e tem cota de 100/dia).
  // Honesto mesmo assim: sem canal definido, não há o que buscar.
  itens.push({
    id: "youtube_intelligence",
    nome: "YouTube Intelligence",
    estado: process.env.YOUTUBE_CANAIS_ALVO ? "CONECTADO" : "NAO_CONFIGURADO",
    identidade: process.env.YOUTUBE_CANAIS_ALVO ?? null,
    ultimaSincronizacao: null,
    ultimoErro: null,
    onboarding: process.env.YOUTUBE_CANAIS_ALVO
      ? undefined
      : {
          servico: "Feed RSS público do YouTube (sem API key, sem cota)",
          porque: "Monitorar vídeo novo de canal relevante (IA, marketing, performance) sem custo nenhum de quota.",
          ondeCriar: "Nenhuma conta nova — só o ID do canal (youtube.com/channel/UC...)",
          permissoes: ["—"],
          ondeColocar: "YOUTUBE_CANAIS_ALVO em .env.local (IDs separados por vírgula)",
          comoTestar: "Ainda não implementado — infraestrutura de leitura de RSS pendente desta lista de canais.",
        },
  });

  itens.push({
    id: "noticias_industria",
    nome: "Notícias de Indústria/IA/Marketing",
    estado: process.env.NEWS_API_KEY ? "CONECTADO" : "NAO_CONFIGURADO",
    identidade: null,
    ultimaSincronizacao: null,
    ultimoErro: null,
    onboarding: process.env.NEWS_API_KEY
      ? undefined
      : {
          servico: "Agregador de notícias (ex: NewsAPI.org — free tier existe, limitado)",
          porque: "Contexto de mercado (IA, marketing, performance) sem o Cacique precisar caçar notícia manualmente.",
          ondeCriar: "newsapi.org → conta free (100 requisições/dia)",
          permissoes: ["—"],
          ondeColocar: "NEWS_API_KEY em .env.local",
          comoTestar: "Ainda não implementado — avaliação de provedor gratuito pendente (ver relatório da Fase 12).",
        },
  });

  // Fase 17 — ponte de sincronização do vault Obsidian (git push automático
  // a cada 30min + disparo manual em /api/obsidian/sincronizar). Passou a
  // ser necessária a partir da Fase 16 (Jarvis rodando em servidor remoto —
  // o vault local do Windows deixou de ser a mesma máquina).
  itens.push({
    id: "obsidian_sync",
    nome: "Obsidian (sincronização remota)",
    estado: process.env.OBSIDIAN_GIT_REMOTO ? "CONECTADO" : "NAO_CONFIGURADO",
    identidade: process.env.OBSIDIAN_GIT_REMOTO ?? null,
    ultimaSincronizacao: null,
    ultimoErro: null,
    onboarding: process.env.OBSIDIAN_GIT_REMOTO
      ? undefined
      : {
          servico: "Repositório Git privado dedicado só ao vault (GitHub, gratuito)",
          porque: "O Jarvis roda num servidor remoto agora — sem isso, as notas do vault ficam presas no servidor, sem chegar no Obsidian do seu computador.",
          ondeCriar: "github.com/new → repositório PRIVADO novo (ex: jarvis-vault) → Settings → Deploy keys → Add deploy key COM 'Allow write access' marcado",
          permissoes: ["escrita no repositório do vault (só esse, nunca o do código)"],
          ondeColocar: "OBSIDIAN_GIT_REMOTO (URL SSH do repo) e OBSIDIAN_GIT_SSH_KEY (caminho da chave no servidor) nas variáveis de ambiente",
          comoTestar: "POST em /api/obsidian/sincronizar — deve responder {\"ok\":true}. Depois, `git clone`/`git pull` desse repositório no seu computador com o plugin 'Obsidian Git' (gratuito, open-source) pra puxar automaticamente.",
        },
  });

  // Google Ads / Meta — leitura de campanha.
  for (const [id, nome] of [
    ["google_ads", "Google Ads"],
    ["meta_ads", "Meta Ads"],
  ] as const) {
    itens.push({
      id,
      nome,
      estado: "NAO_CONFIGURADO",
      identidade: null,
      ultimaSincronizacao: null,
      ultimoErro: null,
      onboarding: {
        servico: nome,
        porque: "Auditoria de campanha de cliente direto na conta.",
        ondeCriar: id === "google_ads" ? "ads.google.com/aw/apicenter" : "developers.facebook.com/apps",
        permissoes: id === "google_ads" ? ["adwords (somente leitura via MCC)"] : ["ads_read"],
        ondeColocar: `${id.toUpperCase()}_TOKEN em .env.local`,
        comoTestar: "Ainda não implementado — infraestrutura pronta, adaptador pendente.",
      },
    });
  }

  return itens;
}

/** Grava/atualiza o estado observado de uma integração — nunca a credencial. */
export function registrarEstadoIntegracao(entrada: {
  provedor: string;
  identidade?: string | null;
  estado: EstadoIntegracao;
  permissoes?: string[];
  ultimoErro?: string | null;
  marcarSincronizado?: boolean;
}) {
  const existente = linhaDb(entrada.provedor);
  const agora = new Date().toISOString().replace("T", " ").slice(0, 19);

  if (existente) {
    db()
      .prepare(
        `UPDATE integracoes
            SET identidade=?, estado=?, permissoes=?, ultimo_erro=?, atualizado_em=?
              ${entrada.marcarSincronizado ? ", ultima_sincronizacao=?" : ""}
          WHERE provedor=?`,
      )
      .run(
        ...([
          entrada.identidade ?? null,
          entrada.estado,
          entrada.permissoes ? JSON.stringify(entrada.permissoes) : null,
          entrada.ultimoErro ?? null,
          agora,
          ...(entrada.marcarSincronizado ? [agora] : []),
          entrada.provedor,
        ] as never[]),
      );
    return;
  }

  db()
    .prepare(
      `INSERT INTO integracoes (id, provedor, identidade, estado, permissoes, ultimo_erro, ultima_sincronizacao)
       VALUES (?,?,?,?,?,?,?)`,
    )
    .run(
      crypto.randomUUID(),
      entrada.provedor,
      entrada.identidade ?? null,
      entrada.estado,
      entrada.permissoes ? JSON.stringify(entrada.permissoes) : null,
      entrada.ultimoErro ?? null,
      entrada.marcarSincronizado ? agora : null,
    );
}
