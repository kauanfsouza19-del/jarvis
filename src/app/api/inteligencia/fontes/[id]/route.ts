import { obterFonte, definirAtivaFonte, removerFonte } from "@/lib/inteligencia/repositorio";
import { buscarFeed } from "@/lib/inteligencia/rss";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const fonte = obterFonte(id);
  if (!fonte) return Response.json({ erro: "nao_encontrada" }, { status: 404 });
  return Response.json({ fonte });
}

/** PATCH { ativa: boolean } | POST { acao: "testar" } — teste NUNCA grava item, só reporta se a fonte responde. */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const corpo = await req.json().catch(() => ({}));
  if (typeof corpo.ativa !== "boolean") return Response.json({ erro: "ativa_obrigatorio_boolean" }, { status: 400 });
  const r = definirAtivaFonte(id, corpo.ativa);
  if (!r.ok) return Response.json({ erro: r.motivo }, { status: 400 });
  return Response.json({ ok: true, fonte: obterFonte(id) });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const r = removerFonte(id);
  if (!r.ok) return Response.json({ erro: r.motivo }, { status: 400 });
  return Response.json({ ok: true });
}

/** Teste real da fonte — busca o feed de verdade, nunca ingere. Mostra honestamente se a fonte responde antes do Cacique ativar de fato. */
export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const fonte = obterFonte(id);
  if (!fonte) return Response.json({ erro: "nao_encontrada" }, { status: 404 });

  const resultado = await buscarFeed(fonte.url);
  if (!resultado.ok) return Response.json({ ok: false, erro: resultado.erro }, { status: 200 });
  return Response.json({
    ok: true,
    itensEncontrados: resultado.itens.length,
    amostra: resultado.itens.slice(0, 3).map((i) => ({ titulo: i.titulo, url: i.url, publicadoEm: i.publicadoEm })),
  });
}
