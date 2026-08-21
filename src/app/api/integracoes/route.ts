import { listarIntegracoes } from "@/lib/integracoes/registro";

export const runtime = "nodejs";

/** Estado real de cada integração — nunca promessa, sempre condição verificável. */
export async function GET(req: Request) {
  return Response.json({ integracoes: listarIntegracoes(new URL(req.url).origin) });
}
