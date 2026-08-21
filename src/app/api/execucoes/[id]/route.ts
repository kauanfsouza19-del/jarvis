import "@/lib/jobs/registro-handlers";
import { obterJob, solicitarCancelamento, retentarJob, solicitarPausa, retomarJobPausado, eventosDoJob, passosDoJob, redefinirPrioridade } from "@/lib/jobs/motor";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** Polling de progresso real — o cliente bate aqui a cada ~1s enquanto EXECUTANDO. */
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const execucao = obterJob(id);
  if (!execucao) return Response.json({ erro: "nao_encontrada" }, { status: 404 });

  const url = new URL(req.url);
  if (url.searchParams.get("detalhe") === "1") {
    return Response.json({ execucao, eventos: eventosDoJob(id), passos: passosDoJob(id) });
  }
  return Response.json({ execucao });
}

/** { acao: "cancelar" } | { acao: "retentar" } | { acao: "pausar" } | { acao: "retomar" } */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const corpo = await req.json().catch(() => ({}));

  if (corpo.acao === "cancelar") {
    const r = solicitarCancelamento(id);
    return Response.json(r, { status: r.ok ? 200 : 400 });
  }
  if (corpo.acao === "retentar") {
    const r = retentarJob(id);
    return Response.json(r, { status: r.ok ? 200 : 400 });
  }
  if (corpo.acao === "pausar") {
    const r = solicitarPausa(id);
    return Response.json(r, { status: r.ok ? 200 : 400 });
  }
  if (corpo.acao === "retomar") {
    const r = retomarJobPausado(id);
    return Response.json(r, { status: r.ok ? 200 : 400 });
  }
  return Response.json({ erro: "acao_desconhecida" }, { status: 400 });
}

/** { prioridade: "CRITICAL"|"HIGH"|"NORMAL"|"LOW" } — Command Center (Fase 10), muda a ordem de disparo de um job ainda em FILA/EXECUTANDO. */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const corpo = await req.json().catch(() => ({}));
  if (typeof corpo.prioridade !== "string") return Response.json({ erro: "prioridade_obrigatoria" }, { status: 400 });
  const r = redefinirPrioridade(id, corpo.prioridade);
  return Response.json(r, { status: r.ok ? 200 : 400 });
}
