import { listarConversasWhatsapp } from "@/lib/whatsapp/conversas";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const busca = url.searchParams.get("busca") ?? undefined;
  const soPendentes = url.searchParams.get("pendentes") === "1";
  return Response.json({ conversas: listarConversasWhatsapp({ busca, soPendentes }) });
}
