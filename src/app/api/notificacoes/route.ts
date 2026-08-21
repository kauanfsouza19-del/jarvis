import { listarNotificacoes, marcarNotificacaoLida } from "@/lib/jobs/motor";

export const runtime = "nodejs";

/** GET ?nao_lidas=1 → só o que ainda não foi visto. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  return Response.json({ notificacoes: listarNotificacoes(url.searchParams.get("nao_lidas") === "1") });
}

/** { id } → marca como lida. */
export async function PATCH(req: Request) {
  const corpo = await req.json().catch(() => ({}));
  if (!corpo.id) return Response.json({ erro: "id_obrigatorio" }, { status: 400 });
  marcarNotificacaoLida(corpo.id);
  return Response.json({ ok: true });
}
