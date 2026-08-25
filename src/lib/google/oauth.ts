import "server-only";
import { db, id as gerarId } from "../dados/db";

/**
 * OAuth2 do Google (Fase 14/2) — troca de código por token e renovação,
 * via fetch puro contra os endpoints oficiais do Google. Nenhuma dependência
 * nova (googleapis não entra só por isto — as rotas REST do Gmail/Calendar
 * são simples o bastante pra chamar direto, mesma disciplina de
 * pesquisa/places.ts e whatsapp/adaptador.ts).
 *
 * Duas linhas em `integracoes` (google_gmail, google_calendar) compartilham
 * o MESMO token — é a mesma conta Google, só escopos diferentes — porque
 * `integracoes/registro.ts` já lê cada provedor como linha separada.
 */

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v2/userinfo";

// gmail.buscar/gmail.ler são só leitura — nunca pedimos escopo de envio.
// calendar precisa de escrita de verdade (calendar.criar existe), então
// calendar.events (não o calendar.readonly documentado antes — corrigido
// nesta fase, ver integracoes/registro.ts) é o escopo mínimo que ainda
// cobre leitura+criação de evento sem dar acesso a gerenciar o calendário
// inteiro (criar/apagar calendário, mudar compartilhamento).
//
// drive.readonly (Fase 27b — pipeline de criativo): só leitura, nunca
// escrita/organização no Drive do Cacique — o Jarvis LÊ criativo de uma
// pasta configurada, nunca cria/move/apaga nada no Drive dele. Pesquisado
// contra developers.google.com/workspace/drive/api/guides/api-specific-auth
// em 25/08/2026: drive.readonly é o escopo documentado pra "ver e baixar
// todos os arquivos do Drive do usuário", sem o superset de escrita de
// `drive` nem o escopo restrito `drive.file` (que só enxergaria arquivo
// criado PELO app — errado aqui, o Cacique já tem os criativos na pasta
// antes do Jarvis existir).
export const ESCOPOS_GOOGLE = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/drive.readonly",
];

export type ProvedorGoogle = "google_gmail" | "google_calendar" | "google_drive";

export function googleConfigurado(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

// Estado CSRF em memória — suficiente pra um servidor de operador único,
// local (mesmo padrão de custo-baixo já usado no `iniciado` do agendador).
// Nunca persistido: sobreviver a um restart do servidor não é objetivo —
// o pior caso de perder o state no meio do fluxo é o Cacique clicar
// "Conectar" de novo, não uma falha de segurança.
const estadosPendentes = new Map<string, number>();
const VALIDADE_STATE_MS = 10 * 60 * 1000;

export function gerarState(): string {
  const state = gerarId();
  estadosPendentes.set(state, Date.now() + VALIDADE_STATE_MS);
  // limpeza oportunista — nunca deixa o Map crescer sem limite numa sessão longa
  for (const [s, expira] of estadosPendentes) if (expira < Date.now()) estadosPendentes.delete(s);
  return state;
}

export function validarStateConsumir(state: string | null): boolean {
  if (!state) return false;
  const expira = estadosPendentes.get(state);
  estadosPendentes.delete(state); // uso único, mesmo se inválido
  return Boolean(expira && expira >= Date.now());
}

export function construirUrlAutorizacao(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: ESCOPOS_GOOGLE.join(" "),
    access_type: "offline", // necessário pra ganhar refresh_token
    prompt: "consent", // força novo refresh_token mesmo em reconexão
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

type RespostaToken = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
};

export async function trocarCodigoPorToken(code: string, redirectUri: string): Promise<{ ok: true; token: RespostaToken } | { ok: false; erro: string }> {
  try {
    const r = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return { ok: false, erro: `token endpoint HTTP ${r.status}: ${(await r.text()).slice(0, 300)}` };
    return { ok: true, token: (await r.json()) as RespostaToken };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message.slice(0, 200) : "erro de rede desconhecido" };
  }
}

async function renovarToken(refreshToken: string): Promise<{ ok: true; token: RespostaToken } | { ok: false; erro: string }> {
  try {
    const r = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return { ok: false, erro: `refresh HTTP ${r.status}` };
    return { ok: true, token: (await r.json()) as RespostaToken };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message.slice(0, 200) : "erro de rede desconhecido" };
  }
}

export async function obterEmailConta(accessToken: string): Promise<string | null> {
  try {
    const r = await fetch(USERINFO_ENDPOINT, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { email?: string };
    return j.email ?? null;
  } catch {
    return null;
  }
}

type LinhaIntegracao = { id: string; token_acesso: string | null; token_atualizacao: string | null; token_expira_em: string | null; identidade: string | null };

function linhaMaisRecente(provedor: string): LinhaIntegracao | undefined {
  return db()
    .prepare(`SELECT id, token_acesso, token_atualizacao, token_expira_em, identidade FROM integracoes WHERE provedor = ? ORDER BY atualizado_em DESC LIMIT 1`)
    .get(provedor) as LinhaIntegracao | undefined;
}

/** Grava conexão nova (uma linha por provedor — mesmo padrão de histórico já usado em `linhaDb`/registro.ts). */
export function registrarConexaoGoogle(provedor: ProvedorGoogle, token: RespostaToken, email: string | null): void {
  const anterior = linhaMaisRecente(provedor);
  const expiraEm = new Date(Date.now() + token.expires_in * 1000).toISOString().replace("T", " ").slice(0, 19);
  db()
    .prepare(
      `INSERT INTO integracoes (id, provedor, identidade, estado, permissoes, ultima_sincronizacao, ultimo_erro, token_acesso, token_atualizacao, token_expira_em, escopos_concedidos)
       VALUES (?,?,?,?,?,datetime('now'),NULL,?,?,?,?)`,
    )
    .run(
      gerarId(),
      provedor,
      email,
      "CONECTADO",
      null,
      token.access_token,
      // Google só manda refresh_token na PRIMEIRA autorização (com prompt=consent
      // força de novo, mas se por algum motivo vier vazio, preserva o anterior
      // em vez de apagar um refresh_token válido que já existia).
      token.refresh_token ?? anterior?.token_atualizacao ?? null,
      expiraEm,
      token.scope,
    );
}

export function registrarErroGoogle(provedor: ProvedorGoogle, erro: string): void {
  db()
    .prepare(`INSERT INTO integracoes (id, provedor, identidade, estado, ultimo_erro) VALUES (?,?,?,?,?)`)
    .run(gerarId(), provedor, null, "ERRO", erro.slice(0, 300));
}

/**
 * Access token válido pra chamar Gmail/Calendar agora — renova sozinho se
 * perto de expirar. Retorna null (nunca lança) quando não há conexão real
 * ainda — quem chama trata isso como "não conectado", nunca como bug.
 */
export async function obterAccessTokenValido(provedor: ProvedorGoogle): Promise<string | null> {
  const linha = linhaMaisRecente(provedor);
  if (!linha?.token_acesso) return null;

  const expiraEm = linha.token_expira_em ? new Date(linha.token_expira_em.replace(" ", "T") + "Z").getTime() : 0;
  const prestesAExpirar = expiraEm - Date.now() < 60_000; // 1min de margem
  if (!prestesAExpirar) return linha.token_acesso;

  if (!linha.token_atualizacao) return linha.token_acesso; // sem refresh_token — usa o que tem, deixa a chamada real decidir se falha

  const renovado = await renovarToken(linha.token_atualizacao);
  if (!renovado.ok) {
    registrarErroGoogle(provedor, `falha ao renovar token: ${renovado.erro}`);
    return linha.token_acesso; // tenta com o antigo — melhor que travar
  }
  registrarConexaoGoogle(provedor, { ...renovado.token, refresh_token: renovado.token.refresh_token ?? linha.token_atualizacao }, linha.identidade);
  return renovado.token.access_token;
}
