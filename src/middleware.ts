import { NextResponse, type NextRequest } from "next/server";
import { decidirAutorizacao } from "./lib/seguranca/autorizacao";
import { sessaoValida, NOME_COOKIE_SESSAO } from "./lib/seguranca/sessoes";

/**
 * Fronteira de autorização — API (Bearer, desde sempre) + navegador
 * (cookie de sessão, Fase 15/produção).
 *
 * Honesto sobre o histórico: até a Fase 14, isto só protegia `/api/*` via
 * `JARVIS_TOKEN` num header Bearer — bom pra script/teste/webhook, mas o
 * PRÓPRIO Command Center no navegador nunca mandava esse header (achado
 * real desta fase: configurar JARVIS_TOKEN sem o resto quebrava a UI
 * inteira, silenciosamente). Agora as rotas de página (fora de `/api`)
 * também exigem sessão válida quando `JARVIS_TOKEN` está configurado —
 * sem ela, redireciona pra /login. As rotas de API aceitam Bearer OU
 * cookie de sessão (script continua funcionando exatamente como antes,
 * navegador logado também funciona).
 *
 * Sem `JARVIS_TOKEN` configurado, nada disto entra em jogo — modo local
 * aberto de sempre, aviso único no log, nunca escondido.
 *
 * `runtime = "nodejs"`: a validação de sessão consulta o SQLite
 * (`sessoes_login`), que não existe no Edge Runtime (padrão do
 * middleware) — precisa do runtime Node explicitamente.
 */
export const runtime = "nodejs";

let avisouModoAberto = false;

export function middleware(req: NextRequest) {
  const token = process.env.JARVIS_TOKEN;
  if (!token && !avisouModoAberto) {
    console.warn("[jarvis] JARVIS_TOKEN não configurado — API rodando sem autorização (modo local).");
    avisouModoAberto = true;
  }

  const { pathname } = req.nextUrl;
  const cookieSessao = req.cookies.get(NOME_COOKIE_SESSAO)?.value;

  if (pathname.startsWith("/api")) {
    const decisao = decidirAutorizacao(pathname, req.headers.get("authorization"), token);
    if (decisao.permitido) return NextResponse.next();
    if (token && sessaoValida(cookieSessao)) return NextResponse.next();
    return NextResponse.json({ erro: decisao.motivo }, { status: 401 });
  }

  // Rota de página. Sem token configurado: modo aberto, nunca gateado
  // (comportamento local de sempre). Com token: exige sessão válida, exceto
  // a própria /login (senão o redirect vira um loop infinito) e as duas
  // páginas legais (Fase 22 — achado real: /politica-de-privacidade e
  // /termos-de-servico voltavam 307 pro /login, mas o Google exige essas
  // páginas acessíveis SEM autenticação pra revisão de verificação OAuth
  // — conteúdo é só texto público, nunca dado do operador).
  const PAGINAS_PUBLICAS = new Set(["/login", "/politica-de-privacidade", "/termos-de-servico"]);
  if (token && !PAGINAS_PUBLICAS.has(pathname) && !sessaoValida(cookieSessao)) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return NextResponse.next();
}

// Um padrão só — já cobre /api/* e toda rota de página, exceto os
// internos do Next e o favicon. Dois padrões separados rodava o
// middleware DUAS vezes pra /api/* (o segundo já englobava o primeiro).
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
