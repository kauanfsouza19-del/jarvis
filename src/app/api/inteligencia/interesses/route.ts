import { listarInteressesCompletos, criarInteresse, removerInteresse } from "@/lib/inteligencia/repositorio";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ interesses: listarInteressesCompletos() });
}

export async function POST(req: Request) {
  const corpo = await req.json().catch(() => null);
  if (!corpo?.termo) return Response.json({ erro: "termo_obrigatorio" }, { status: 400 });
  const r = criarInteresse(corpo.termo, corpo.categoria, corpo.peso);
  if (!r.ok) return Response.json({ erro: r.motivo }, { status: 400 });
  return Response.json({ ok: true }, { status: 201 });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return Response.json({ erro: "id_obrigatorio" }, { status: 400 });
  removerInteresse(id);
  return Response.json({ ok: true });
}
