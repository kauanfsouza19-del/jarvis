import { obterConteudo, mudarStatusConteudo, definirPrioridadeConteudo, agendarConteudo, editarConteudo, transicoesPermitidas } from "@/lib/social/repositorio";
import { criarNotificacao } from "@/lib/jobs/motor";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const conteudo = obterConteudo(id);
  if (!conteudo) return Response.json({ erro: "nao_encontrado" }, { status: 404 });
  return Response.json({ conteudo, transicoesPermitidas: transicoesPermitidas(conteudo.status) });
}

/**
 * PATCH aceita QUALQUER combinação de: { status, motivoRejeicao }, { prioridade },
 * { agendadoPara }, { titulo, conceito, legenda, cta, hashtags } — cada campo
 * passa pela função de repositório dona da regra (nunca um UPDATE genérico
 * aceitando coluna arbitrária vinda do corpo da requisição).
 */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const corpo = await req.json().catch(() => ({}));
  const respostas: Record<string, unknown> = {};

  if (corpo.status !== undefined) {
    if (typeof corpo.status !== "string") return Response.json({ erro: "status_invalido" }, { status: 400 });
    const r = mudarStatusConteudo(id, corpo.status, { motivoRejeicao: corpo.motivoRejeicao });
    if (!r.ok) return Response.json({ erro: r.motivo }, { status: 400 });
    respostas.conteudo = r.conteudo;

    // Notificação real (Rule 21/23) — só quando o conteúdo de fato ENTROU
    // em aguardando_aprovacao nesta chamada, nunca em outro momento.
    if (corpo.status === "AGUARDANDO_APROVACAO" && r.conteudo) {
      criarNotificacao(
        "CONTEUDO_AGUARDANDO_APROVACAO",
        r.conteudo.job_id,
        "Conteúdo aguardando aprovação",
        `"${r.conteudo.titulo}" (${r.conteudo.plataforma}) está pronto para revisão.`,
        r.conteudo.id,
      );
    }
  }

  if (corpo.prioridade !== undefined) {
    if (typeof corpo.prioridade !== "string") return Response.json({ erro: "prioridade_invalida" }, { status: 400 });
    const r = definirPrioridadeConteudo(id, corpo.prioridade);
    if (!r.ok) return Response.json({ erro: r.motivo }, { status: 400 });
    respostas.conteudo = r.conteudo;
  }

  if (corpo.agendadoPara !== undefined) {
    const r = agendarConteudo(id, corpo.agendadoPara);
    if (!r.ok) return Response.json({ erro: r.motivo }, { status: 400 });
    respostas.conteudo = r.conteudo;
  }

  const camposEdicao = ["titulo", "conceito", "legenda", "cta", "hashtags"].filter((c) => corpo[c] !== undefined);
  if (camposEdicao.length > 0) {
    const r = editarConteudo(id, Object.fromEntries(camposEdicao.map((c) => [c, corpo[c]])));
    if (!r.ok) return Response.json({ erro: r.motivo }, { status: 400 });
    respostas.conteudo = r.conteudo;
  }

  if (Object.keys(respostas).length === 0) return Response.json({ erro: "nada_para_atualizar" }, { status: 400 });
  return Response.json(respostas);
}
