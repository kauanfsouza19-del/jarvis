import { mensagensDoNumero, listarConversasWhatsapp } from "@/lib/whatsapp/conversas";
import { listarJobsDaConversa } from "@/lib/jobs/motor";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ numero: string }> };

/** Mensagens + tarefas (Jobs) relacionadas — a mesma conversa da web, vista pela lente do WhatsApp. */
export async function GET(_req: Request, { params }: Ctx) {
  const { numero } = await params;
  const mensagens = mensagensDoNumero(decodeURIComponent(numero));
  const conversa = listarConversasWhatsapp().find((c) => c.numeroRemoto === decodeURIComponent(numero));
  const jobs = conversa?.conversaId ? listarJobsDaConversa(conversa.conversaId) : [];
  return Response.json({ conversa, mensagens, jobs });
}
