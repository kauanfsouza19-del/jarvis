import { readFileSync } from "node:fs";
import { db } from "@/lib/dados/db";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Download real — serve o arquivo que de fato foi gravado em disco por
 * gerarCsv/gerarXlsx. Se a linha não existe ou o arquivo sumiu, 404 de
 * verdade, nunca um download vazio fingindo sucesso.
 */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const linha = db()
    .prepare(`SELECT nome, mime_type, caminho FROM arquivos_gerados WHERE id = ?`)
    .get(id) as { nome: string; mime_type: string; caminho: string } | undefined;

  if (!linha) return Response.json({ erro: "arquivo_nao_encontrado" }, { status: 404 });

  let conteudo: Buffer;
  try {
    conteudo = readFileSync(linha.caminho);
  } catch {
    return Response.json({ erro: "arquivo_sumiu_do_disco" }, { status: 404 });
  }

  return new Response(new Uint8Array(conteudo), {
    headers: {
      "Content-Type": linha.mime_type,
      "Content-Disposition": `attachment; filename="${linha.nome}"`,
      "Content-Length": String(conteudo.length),
    },
  });
}
