import { googleConfigurado, construirUrlAutorizacao, gerarState } from "@/lib/google/oauth";

export const runtime = "nodejs";

/**
 * Passo 1 do OAuth do Google — redireciona o navegador de verdade pro
 * consent screen do Google. Rota pública (ver seguranca/autorizacao.ts):
 * um redirect de topo nunca carrega o header Authorization do Jarvis.
 */
export async function GET(req: Request) {
  if (!googleConfigurado()) {
    return Response.json({ erro: "GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET não configurados em .env.local" }, { status: 400 });
  }
  const origem = new URL(req.url).origin;
  const redirectUri = `${origem}/api/integracoes/google/callback`;
  const state = gerarState();
  return Response.redirect(construirUrlAutorizacao(redirectUri, state), 307);
}
