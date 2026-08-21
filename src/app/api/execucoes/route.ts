import "@/lib/jobs/registro-handlers";
import { criarJob, listarJobsDaConversa, listarJobsAtivos, listarJobsRecentes } from "@/lib/jobs/motor";
import type { ParametrosProspeccao } from "@/lib/jobs/handlers/prospeccao";
import type { ParametrosExecutarFerramenta } from "@/lib/jobs/handlers/executar-ferramenta";

export const runtime = "nodejs";

/**
 * GET ?conversa_id=X → jobs de uma conversa (usado pelo chat).
 * GET ?ativos=1      → só FILA/EXECUTANDO/AGUARDANDO_APROVACAO.
 * GET (sem filtro)   → ativos + terminais recentes — painel JOBS do Command Center.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("ativos") === "1") {
    return Response.json({ execucoes: listarJobsAtivos() });
  }
  const conversaId = url.searchParams.get("conversa_id");
  if (conversaId) return Response.json({ execucoes: listarJobsDaConversa(conversaId) });
  return Response.json({ execucoes: listarJobsRecentes() });
}

/**
 * Cria e DISPARA um job — não espera terminar. O cliente recebe o id na
 * hora e faz polling em /api/execucoes/:id para ver o progresso real.
 */
const PRIORIDADES_VALIDAS = new Set(["CRITICAL", "HIGH", "NORMAL", "LOW"]);

export async function POST(req: Request) {
  const corpo = await req.json().catch(() => null);
  if (!corpo?.tipo) return Response.json({ erro: "tipo_obrigatorio" }, { status: 400 });
  // Fase 7 — prioridade opcional, vocabulário fechado; entrada fora da
  // lista nunca vira prioridade inventada, cai no padrão seguro NORMAL.
  const prioridade = PRIORIDADES_VALIDAS.has(corpo.prioridade) ? corpo.prioridade : "NORMAL";

  if (corpo.tipo === "prospeccao") {
    const params: ParametrosProspeccao = {
      vertical: corpo.vertical ?? null,
      localizacao: corpo.localizacao ?? null,
      quantidade: Number(corpo.quantidade) || 25,
      prospectIds: corpo.prospectIds ?? undefined,
    };
    const { job, novo } = criarJob(corpo.conversa_id ?? null, "prospeccao_diagnostico", params, prioridade);
    return Response.json({ execucaoId: job.id }, { status: novo ? 201 : 200 });
  }

  // Job genérico que chama uma Tool do registro — é a demonstração real da
  // fronteira de permissão (ver src/lib/ferramentas/), não só tipos ociosos.
  if (corpo.tipo === "ferramenta") {
    if (!corpo.ferramenta) return Response.json({ erro: "ferramenta_obrigatoria" }, { status: 400 });
    const params: ParametrosExecutarFerramenta = { ferramenta: corpo.ferramenta, entrada: corpo.entrada ?? {} };
    const { job, novo } = criarJob(corpo.conversa_id ?? null, "executar_ferramenta", params, prioridade);
    return Response.json({ execucaoId: job.id }, { status: novo ? 201 : 200 });
  }

  return Response.json({ erro: "tipo_desconhecido" }, { status: 400 });
}
