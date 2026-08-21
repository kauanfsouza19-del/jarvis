/**
 * Decisão de autorização — função pura, sem dependência do runtime do
 * Next.js. Extraída de `middleware.ts` de propósito: `next/server` não
 * resolve fora do processo gerenciado pelo Next, então testar a decisão
 * direto (sem subir servidor) exige que ela não dependa de `NextRequest`.
 */

// /api/integracoes/google/callback precisa ser público: é o GOOGLE
// redirecionando o navegador de volta (redirect de topo vindo do domínio
// deles), nunca vai carregar Bearer nem, de forma confiável, o cookie de
// sessão. A segurança dele não vem de exigir sessão — vem de só aceitar
// um `code` real emitido pelo Google + `state` batendo com o que
// /conectar gerou (ver oauth.ts). CSRF de login OAuth é exatamente o que
// esse `state` existe pra impedir.
//
// /conectar, por outro lado, NÃO está mais aqui (achado real da Fase 16):
// era público até esta fase, mas /conectar É uma navegação de topo comum
// (não vem de domínio externo) — o cookie de sessão (Fase 15) é enviado
// nela normalmente. Deixar público significava que QUALQUER visitante não
// autenticado podia completar o consent do Google com a PRÓPRIA conta
// dele e sobrescrever a conexão Gmail/Calendar do Cacique. Corrigido:
// /conectar agora exige sessão/Bearer como qualquer outra rota — só uma
// pessoa já logada consegue gerar um `state` válido pra começar o fluxo.
//
// /api/auth/* é público — são as rotas que FAZEM login/logout/status;
// elas se autenticam sozinhas (senha comparada em tempo constante +
// bloqueio de força bruta em /login, cookie HttpOnly em /status), não
// fazem sentido atrás do próprio Bearer que ainda não existe antes do
// login (Fase 15).
//
// /api/whatsapp/webhook precisa ser público pelo mesmo motivo do /callback
// do Google: quem chama é o Evolution API, nunca vai mandar Bearer nem
// cookie. Segurança real dele não é este middleware — é o `?segredo=`
// checado dentro da própria rota (webhookAutorizado(), Fase 16 — achado
// real: sem isto, um POST forjado com o número do Cacique passava batido).
export const CAMINHOS_PUBLICOS = [
  "/api/saude",
  "/api/integracoes/google/callback",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/status",
  "/api/whatsapp/webhook",
];

export type DecisaoAutorizacao = { permitido: true } | { permitido: false; motivo: string };

export function decidirAutorizacao(
  pathname: string,
  cabecalhoAutorizacao: string | null,
  tokenConfigurado: string | undefined,
): DecisaoAutorizacao {
  if (!tokenConfigurado) return { permitido: true };
  // Igualdade exata ou prefixo de SEGMENTO — "/api/saude" não pode liberar
  // "/api/saude-outra-coisa" por acaso de nome. Achado escrevendo o teste
  // desta função: startsWith puro colaria em qualquer rota que começasse
  // com o mesmo texto, não só a rota pública de verdade.
  if (CAMINHOS_PUBLICOS.some((c) => pathname === c || pathname.startsWith(`${c}/`))) return { permitido: true };

  const recebido = cabecalhoAutorizacao?.replace(/^Bearer\s+/i, "");
  if (recebido !== tokenConfigurado) return { permitido: false, motivo: "nao_autorizado" };
  return { permitido: true };
}
