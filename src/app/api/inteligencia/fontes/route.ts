import { listarFontes, criarFonte, type TipoFonte } from "@/lib/inteligencia/repositorio";
import { urlFeedYoutube } from "@/lib/inteligencia/rss";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ fontes: listarFontes() });
}

/**
 * POST { tipo: "YOUTUBE_RSS", nome, canalId, categoria? }
 * POST { tipo: "RSS", nome, url, categoria? }
 * YouTube nunca precisa de credencial — a URL do feed é montada aqui a
 * partir só do ID do canal (feed público, sem API key).
 */
export async function POST(req: Request) {
  const corpo = await req.json().catch(() => null);
  if (!corpo?.nome || !corpo?.tipo) return Response.json({ erro: "nome_e_tipo_obrigatorios" }, { status: 400 });

  const tipo = corpo.tipo as TipoFonte;
  let url: string;
  if (tipo === "YOUTUBE_RSS") {
    if (!corpo.canalId) return Response.json({ erro: "canalId_obrigatorio_para_youtube" }, { status: 400 });
    url = urlFeedYoutube(corpo.canalId);
  } else {
    if (!corpo.url) return Response.json({ erro: "url_obrigatoria" }, { status: 400 });
    url = corpo.url;
  }

  const r = criarFonte({
    nome: corpo.nome,
    tipo,
    url,
    categoria: corpo.categoria,
    custo: corpo.custo,
    confiabilidade: corpo.confiabilidade,
    frequenciaMinutos: corpo.frequenciaMinutos,
    config: tipo === "YOUTUBE_RSS" ? { canalId: corpo.canalId } : undefined,
  });
  if (!r.ok) return Response.json({ erro: r.motivo }, { status: 400 });
  return Response.json({ fonte: r.fonte }, { status: 201 });
}
