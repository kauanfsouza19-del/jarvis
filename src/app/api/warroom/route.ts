import { db } from "@/lib/dados/db";
import { conteudosAgendadosProximos } from "@/lib/social/repositorio";

export const runtime = "nodejs";

type Acao = {
  id: string;
  titulo: string;
  detalhe: string;
  projeto: string | null;
  impacto: number;
  urgencia: number;
  esforcoMin: number | null;
  prazo: string | null;
  score: number;
  origem: string;
};

/**
 * War Room — só dado real do banco.
 *
 * Se não há tarefa cadastrada, a resposta diz isso em vez de inventar
 * prioridade. O ranking exige impacto e urgência reais; sem eles, o score é
 * chute com aparência de cálculo.
 */
export async function GET() {
  const d = db();

  const tarefas = d
    .prepare(
      `SELECT t.id, t.titulo, t.detalhe, t.impacto, t.urgencia, t.esforco_min, t.prazo,
              t.origem, t.estado, p.nome AS projeto
         FROM tarefas t
         LEFT JOIN projetos p ON p.id = t.projeto_id
        WHERE t.estado IN ('aberta','fazendo')`,
    )
    .all() as Array<{
    id: string;
    titulo: string;
    detalhe: string;
    impacto: number;
    urgencia: number;
    esforco_min: number | null;
    prazo: string | null;
    origem: string;
    estado: string;
    projeto: string | null;
  }>;

  // Tarefa que está de fato em andamento — card ACTIVE TASK do bento não
  // reaproveita a próxima da fila, mostra o que está "fazendo" de verdade.
  const tarefaAtiva = tarefas.find((t) => t.estado === "fazendo") ?? null;

  const hoje = Date.now();

  const acoes: Acao[] = tarefas
    .map((t) => {
      const diasAteOPrazo = t.prazo
        ? Math.ceil((new Date(t.prazo).getTime() - hoje) / 86400000)
        : null;
      // Prazo próximo empurra urgência para cima; esforço divide, não soma.
      const pesoPrazo =
        diasAteOPrazo === null ? 1 : diasAteOPrazo <= 0 ? 2 : diasAteOPrazo <= 3 ? 1.5 : 1;
      const horas = (t.esforco_min ?? 60) / 60;
      const score = ((t.impacto * 2 + t.urgencia * pesoPrazo) / Math.max(0.5, Math.sqrt(horas))) * 10;
      return {
        id: t.id,
        titulo: t.titulo,
        detalhe: t.detalhe,
        projeto: t.projeto,
        impacto: t.impacto,
        urgencia: t.urgencia,
        esforcoMin: t.esforco_min,
        prazo: t.prazo,
        origem: t.origem,
        score: Math.round(score),
      };
    })
    .sort((a, b) => b.score - a.score);

  const projetos = d
    .prepare(
      `SELECT p.nome, p.saude, p.permissao, p.indexado_em, p.arquivos,
              (SELECT COUNT(*) FROM projeto_conhecimento k WHERE k.projeto_id = p.id) AS fatos
         FROM projetos p ORDER BY p.nome`,
    )
    .all();

  // tipo entra na seleção para o Bento poder separar OPORTUNIDADE de DECISAO
  // sem duas queries — "riscos" no nome é histórico, o card usa o campo tipo.
  const riscos = d
    .prepare(
      `SELECT id, tipo, titulo, corpo, atualizado_em FROM memorias
        WHERE estado='ATIVA' AND tipo IN ('DECISAO','OPORTUNIDADE')
        ORDER BY importancia DESC, atualizado_em DESC LIMIT 8`,
    )
    .all() as Array<{ id: string; tipo: string; titulo: string; corpo: string; atualizado_em: string }>;

  const oportunidades = riscos.filter((r) => r.tipo === "OPORTUNIDADE");

  const decisoesParaRevisar = d
    .prepare(
      `SELECT id, titulo, revisar_em FROM decisoes
        WHERE resultado_real IS NULL AND revisar_em IS NOT NULL AND revisar_em <= date('now')
        ORDER BY revisar_em LIMIT 5`,
    )
    .all();

  // Fase 11 — conteúdo social AGENDADO é a única fonte real de "próximo
  // evento" hoje sem calendário conectado (Rule 15: agenda compacta mostra
  // data de publicação de conteúdo mesmo sem Google Calendar).
  const conteudoAgendado = conteudosAgendadosProximos(14).map((c) => ({
    id: c.id, titulo: c.titulo, plataforma: c.plataforma, agendadoPara: c.agendado_para,
  }));

  return Response.json({
    proximaAcao: acoes[0] ?? null,
    acoes: acoes.slice(0, 12),
    tarefaAtiva,
    projetos,
    destaques: riscos,
    oportunidades,
    decisoesParaRevisar,
    conteudoAgendado,
    // Honestidade: por que o ranking pode estar vazio ou fraco.
    lacunas: [
      ...(tarefas.length === 0 ? ["Nenhuma tarefa cadastrada — o ranking não tem o que ordenar."] : []),
      "Receita, MRR e clientes não estão no sistema — o peso de impacto não considera dinheiro real.",
    ],
  });
}
