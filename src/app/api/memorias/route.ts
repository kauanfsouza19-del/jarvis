import { criarMemoria, listarMemorias, esquecerMemoria } from "@/lib/dados/repositorio";
import { buscarMemorias } from "@/lib/dados/busca";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const busca = url.searchParams.get("busca")?.trim();

  if (busca) {
    return Response.json({
      memorias: buscarMemorias(busca, {
        projeto_id: url.searchParams.get("projeto_id"),
        incluirInativas: url.searchParams.get("inativas") === "1",
      }),
      modo: "busca",
    });
  }

  return Response.json({
    memorias: listarMemorias({
      estado: url.searchParams.get("estado") ?? undefined,
      tipo: url.searchParams.get("tipo") ?? undefined,
      projeto_id: url.searchParams.get("projeto_id") ?? undefined,
    }),
    modo: "lista",
  });
}

export async function POST(req: Request) {
  const corpo = await req.json().catch(() => null);
  if (!corpo?.titulo || !corpo?.corpo) {
    return Response.json({ erro: "titulo_e_corpo_obrigatorios" }, { status: 400 });
  }

  try {
    const memoria = criarMemoria({
      tipo: corpo.tipo ?? "FATO",
      titulo: corpo.titulo,
      corpo: corpo.corpo,
      camada: corpo.camada,
      projeto_id: corpo.projeto_id ?? null,
      confianca: corpo.confianca,
      importancia: corpo.importancia,
    });
    return Response.json({ memoria }, { status: 201 });
  } catch (e) {
    // Filtro de segredo recusou a escrita — é o comportamento correto.
    return Response.json(
      { erro: "recusada", detalhe: e instanceof Error ? e.message : "erro" },
      { status: 422 },
    );
  }
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return Response.json({ erro: "id_obrigatorio" }, { status: 400 });
  esquecerMemoria(id);
  return Response.json({ ok: true });
}
