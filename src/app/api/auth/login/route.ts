import { criarSessao, senhaConfere, NOME_COOKIE_SESSAO } from "@/lib/seguranca/sessoes";
import { estaBloqueado, registrarFalha, registrarSucesso } from "@/lib/seguranca/tentativas-login";

export const runtime = "nodejs";

function ipDoRequest(req: Request): string {
  const encaminhado = req.headers.get("x-forwarded-for");
  return encaminhado?.split(",")[0]?.trim() || "desconhecido";
}

/**
 * Login do navegador (Fase 15) — a senha É o JARVIS_TOKEN (mesmo segredo já
 * usado pelo Bearer de API, nenhum segredo novo pra gerenciar/vazar).
 * Rota pública por natureza (é ela que autentica) — protegida por
 * comparação em tempo constante + bloqueio de força bruta, não por header.
 */
export async function POST(req: Request) {
  const token = process.env.JARVIS_TOKEN;
  if (!token) {
    // Sem JARVIS_TOKEN configurado, o Jarvis roda em modo local aberto
    // (decisão já existente desde a Fase 1 da autorização) — login não faz
    // sentido nesse modo; nunca cria sessão "válida" pra um segredo que
    // não existe.
    return Response.json({ erro: "JARVIS_TOKEN não configurado — login não se aplica em modo local aberto" }, { status: 400 });
  }

  const ip = ipDoRequest(req);
  const bloqueio = estaBloqueado(ip);
  if (bloqueio.bloqueado) {
    return Response.json({ erro: "muitas_tentativas", tentarNovamenteEm: new Date(bloqueio.ateMs).toISOString() }, { status: 429 });
  }

  const corpo = await req.json().catch(() => null);
  const senha = typeof corpo?.senha === "string" ? corpo.senha : "";
  if (!senhaConfere(senha, token)) {
    registrarFalha(ip);
    return Response.json({ erro: "senha_incorreta" }, { status: 401 });
  }

  registrarSucesso(ip);
  const idSessao = criarSessao(ip);
  const resposta = Response.json({ ok: true });
  resposta.headers.append(
    "Set-Cookie",
    `${NOME_COOKIE_SESSAO}=${idSessao}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
  );
  return resposta;
}
