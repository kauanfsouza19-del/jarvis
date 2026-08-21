import { obterItem, mudarStatusItem } from "@/lib/inteligencia/repositorio";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const item = obterItem(id);
  if (!item) return Response.json({ erro: "nao_encontrado" }, { status: 404 });
  return Response.json({ item });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const corpo = await req.json().catch(() => ({}));
  if (typeof corpo.status !== "string") return Response.json({ erro: "status_obrigatorio" }, { status: 400 });
  const r = mudarStatusItem(id, corpo.status);
  if (!r.ok) return Response.json({ erro: r.motivo }, { status: 400 });
  return Response.json({ item: obterItem(id) });
}
