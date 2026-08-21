import { cookies } from "next/headers";
import { sessaoValida, NOME_COOKIE_SESSAO } from "@/lib/seguranca/sessoes";

export const runtime = "nodejs";

/** O frontend usa isto pra decidir entre mostrar o Command Center ou a tela de login. */
export async function GET() {
  const semTravaConfigurada = !process.env.JARVIS_TOKEN;
  if (semTravaConfigurada) return Response.json({ autenticado: true, modo: "local_aberto" });

  const jar = await cookies();
  const autenticado = sessaoValida(jar.get(NOME_COOKIE_SESSAO)?.value);
  return Response.json({ autenticado, modo: "producao" });
}
