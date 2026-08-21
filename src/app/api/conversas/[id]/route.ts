import {
  obterConversa,
  mensagensDa,
  renomearConversa,
  arquivarConversa,
} from "@/lib/dados/repositorio";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const conversa = obterConversa(id);
  if (!conversa) return Response.json({ erro: "nao_encontrada" }, { status: 404 });
  return Response.json({ conversa, mensagens: mensagensDa(id) });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const corpo = await req.json().catch(() => ({}));

  if (typeof corpo.titulo === "string" && corpo.titulo.trim()) {
    renomearConversa(id, corpo.titulo);
  }
  if (typeof corpo.arquivar === "boolean") {
    arquivarConversa(id, corpo.arquivar);
  }

  const conversa = obterConversa(id);
  if (!conversa) return Response.json({ erro: "nao_encontrada" }, { status: 404 });
  return Response.json({ conversa });
}
