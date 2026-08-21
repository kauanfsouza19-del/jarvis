import { obterPlano, passosDoPlano } from "@/lib/orquestrador/repositorio";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const plano = obterPlano(id);
  if (!plano) return Response.json({ erro: "plano_nao_encontrado" }, { status: 404 });
  return Response.json({ plano, passos: passosDoPlano(id) });
}
