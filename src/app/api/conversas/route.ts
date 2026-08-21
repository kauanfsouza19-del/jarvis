import { criarConversa, listarConversas } from "@/lib/dados/repositorio";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const incluirArquivadas = url.searchParams.get("arquivadas") === "1";
  return Response.json({ conversas: listarConversas(incluirArquivadas) });
}

export async function POST(req: Request) {
  const corpo = await req.json().catch(() => ({}));
  const conversa = criarConversa(corpo.titulo, corpo.projeto_id ?? null);
  return Response.json({ conversa }, { status: 201 });
}
