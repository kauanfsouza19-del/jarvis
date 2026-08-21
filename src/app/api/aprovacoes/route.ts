import "@/lib/jobs/registro-handlers";
import { listarAprovacoes, responderAprovacao } from "@/lib/jobs/motor";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  return Response.json({ aprovacoes: listarAprovacoes(url.searchParams.get("pendentes") === "1") });
}

/** { id, aprovar: boolean } */
export async function POST(req: Request) {
  const corpo = await req.json().catch(() => ({}));
  if (!corpo.id || typeof corpo.aprovar !== "boolean") {
    return Response.json({ erro: "id_e_aprovar_obrigatorios" }, { status: 400 });
  }
  const r = responderAprovacao(corpo.id, corpo.aprovar);
  return Response.json(r, { status: r.ok ? 200 : 400 });
}
