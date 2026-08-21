import { listarProjetos } from "@/lib/dados/repositorio";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ projetos: listarProjetos() });
}
