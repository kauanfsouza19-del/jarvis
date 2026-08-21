import { listarFontes, registrarFonte, listarProjetos } from "@/lib/dados/repositorio";
import { buscarConhecimento, buscarConhecimentoProjeto } from "@/lib/dados/busca";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const busca = url.searchParams.get("busca")?.trim();
  const projetoId = url.searchParams.get("projeto_id") || null;

  // A busca cobre os dois acervos porque eles respondem perguntas diferentes:
  // trecho é material de estudo, fato é o que os arquivos do projeto dizem.
  // Ficam separados na resposta — misturar apagaria a origem de cada um.
  if (busca) {
    return Response.json({
      trechos: buscarConhecimento(busca, { modulo: url.searchParams.get("modulo") }),
      fatos: buscarConhecimentoProjeto(busca, projetoId, 12),
      modo: "busca",
    });
  }

  return Response.json({
    fontes: listarFontes(),
    projetos: listarProjetos()
      .filter((p) => p.indexado_em)
      .map((p) => ({ id: p.id, nome: p.nome, arquivos: p.arquivos })),
    modo: "lista",
  });
}

export async function POST(req: Request) {
  const corpo = await req.json().catch(() => null);
  if (!corpo?.titulo) return Response.json({ erro: "titulo_obrigatorio" }, { status: 400 });

  const fonte = registrarFonte({
    titulo: corpo.titulo,
    tipo: corpo.tipo ?? "nota",
    url: corpo.url ?? null,
    autor: corpo.autor ?? null,
    categoria: corpo.categoria ?? null,
    projeto_id: corpo.projeto_id ?? null,
    estado: corpo.estado ?? "AGUARDANDO_CONTEUDO",
    observacao: corpo.observacao ?? null,
  });
  return Response.json({ fonte }, { status: 201 });
}
