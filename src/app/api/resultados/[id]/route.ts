import { obterResultado, filtrarResultado, obterLinhagem } from "@/lib/jobs/resultados";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const r = obterResultado(id);
  if (!r) return Response.json({ erro: "nao_encontrado" }, { status: 404 });
  // Linhagem — "de onde este resultado veio", visível até a descoberta raiz.
  return Response.json({ ...r, linhagem: obterLinhagem(id) });
}

/**
 * Follow-up conversacional — "me mostra só os com whatsapp" vira isto.
 * Nunca dispara uma busca nova: filtra o snapshot que já existe.
 */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const corpo = await req.json().catch(() => ({}));
  try {
    const r = await filtrarResultado(id, {
      comWhatsapp: corpo.comWhatsapp,
      comTelefone: corpo.comTelefone,
      cidade: corpo.cidade,
      scoreMin: corpo.scoreMin,
      limite: corpo.limite,
    });
    return Response.json(r, { status: 201 });
  } catch (e) {
    return Response.json({ erro: e instanceof Error ? e.message : "erro" }, { status: 400 });
  }
}
