import { listarConteudos, criarConteudo, contarPorStatus, type StatusConteudo, type PlataformaConteudo, type PrioridadeConteudo } from "@/lib/social/repositorio";

export const runtime = "nodejs";

/**
 * Fila de conteúdo (Fase 11) — GET lista real (filtros opcionais), POST cria
 * manualmente (o caminho automático é a Tool modelo.gerar_conteudo_social,
 * via Job/Plano — ver orquestrador/planejador.ts).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const status = url.searchParams.get("status") as StatusConteudo | null;
  const plataforma = url.searchParams.get("plataforma") as PlataformaConteudo | null;
  const prioridade = url.searchParams.get("prioridade") as PrioridadeConteudo | null;

  return Response.json({
    conteudos: listarConteudos({
      status: status ?? undefined,
      plataforma: plataforma ?? undefined,
      prioridade: prioridade ?? undefined,
    }),
    porStatus: contarPorStatus(),
  });
}

export async function POST(req: Request) {
  const corpo = await req.json().catch(() => null);
  if (!corpo?.titulo) return Response.json({ erro: "titulo_obrigatorio" }, { status: 400 });

  const conteudo = criarConteudo({
    titulo: corpo.titulo,
    conceito: corpo.conceito,
    tipoConteudo: corpo.tipoConteudo,
    plataforma: corpo.plataforma,
    legenda: corpo.legenda,
    cta: corpo.cta,
    hashtags: corpo.hashtags,
    prioridade: corpo.prioridade,
    criadoPor: "cacique",
  });
  return Response.json({ conteudo }, { status: 201 });
}
