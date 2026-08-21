import { cookies } from "next/headers";
import { encerrarSessao, NOME_COOKIE_SESSAO } from "@/lib/seguranca/sessoes";

export const runtime = "nodejs";

export async function POST() {
  const jar = await cookies();
  encerrarSessao(jar.get(NOME_COOKIE_SESSAO)?.value);
  const resposta = Response.json({ ok: true });
  resposta.headers.append("Set-Cookie", `${NOME_COOKIE_SESSAO}=; Path=/; HttpOnly; Max-Age=0`);
  return resposta;
}
