import { trocarCodigoPorToken, obterEmailConta, registrarConexaoGoogle, registrarErroGoogle, validarStateConsumir } from "@/lib/google/oauth";

export const runtime = "nodejs";

/**
 * Passo 2 do OAuth do Google — Google redireciona pra cá com `code`+`state`
 * depois do Cacique aprovar o consent. Rota pública (mesmo motivo do
 * /conectar) — a segurança aqui vem de validar `state` (CSRF) e de o
 * `code` só ser trocável por token uma vez, direto com o Google.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const origem = url.origin;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const erroGoogle = url.searchParams.get("error");

  const redirecionarComResultado = (resultado: "conectado" | "erro", detalhe?: string) =>
    Response.redirect(`${origem}/?google=${resultado}${detalhe ? `&google_detalhe=${encodeURIComponent(detalhe)}` : ""}`, 307);

  if (erroGoogle) return redirecionarComResultado("erro", erroGoogle);
  if (!code) return redirecionarComResultado("erro", "codigo_ausente");
  if (!validarStateConsumir(state)) return redirecionarComResultado("erro", "state_invalido_ou_expirado");

  const redirectUri = `${origem}/api/integracoes/google/callback`;
  const resultado = await trocarCodigoPorToken(code, redirectUri);
  if (!resultado.ok) {
    registrarErroGoogle("google_gmail", resultado.erro);
    registrarErroGoogle("google_calendar", resultado.erro);
    registrarErroGoogle("google_drive", resultado.erro);
    return redirecionarComResultado("erro", resultado.erro);
  }

  const email = await obterEmailConta(resultado.token.access_token);
  // Mesmo token serve três capacidades agora (Gmail + Calendar + Drive,
  // Fase 27b) — grava nas três linhas de integração porque
  // /api/integracoes já lê cada uma separadamente (ver
  // integracoes/registro.ts).
  registrarConexaoGoogle("google_gmail", resultado.token, email);
  registrarConexaoGoogle("google_calendar", resultado.token, email);
  registrarConexaoGoogle("google_drive", resultado.token, email);

  return redirecionarComResultado("conectado");
}
