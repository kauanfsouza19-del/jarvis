import { listarItens, contarPorPrioridade } from "@/lib/inteligencia/repositorio";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  return Response.json({
    itens: listarItens({
      status: url.searchParams.get("status") ?? undefined,
      prioridade: url.searchParams.get("prioridade") ?? undefined,
      categoria: url.searchParams.get("categoria") ?? undefined,
      limite: url.searchParams.get("limite") ? Number(url.searchParams.get("limite")) : undefined,
    }),
    porPrioridade: contarPorPrioridade(),
  });
}
