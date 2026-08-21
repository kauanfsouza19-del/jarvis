import "server-only";
import { db } from "../dados/db";
import { calcularCustoUsd } from "./registro";

/**
 * Orçamento (Fase 8) — liga a tabela `orcamentos`, que já existia no schema
 * desde fases anteriores mas nunca era lida por nenhum código real (achado
 * revisando o schema: só `/api/custo` fazia um SELECT * bruto, sem
 * comparar contra gasto nenhum). Fase 8 fecha esse circuito: gasto real
 * comparado contra o limite configurado.
 *
 * Nunca cria orçamento sozinho — sem nenhuma linha em `orcamentos`, todo
 * escopo reporta "sem limite configurado" (nível "ok", sem teto), nunca
 * bloqueia por um limite que o Cacique não pediu.
 */

export type NivelOrcamento = "sem_limite" | "ok" | "aviso" | "critico" | "excedido";

export type StatusOrcamento = {
  escopo: string;
  periodo: "diario" | "semanal" | "mensal" | null;
  limiteUsd: number | null;
  gastoUsd: number;
  percentualUsado: number | null;
  nivel: NivelOrcamento;
};

function inicioDoPeriodo(periodo: "diario" | "semanal" | "mensal"): string {
  const agora = new Date();
  if (periodo === "diario") return agora.toISOString().slice(0, 10) + " 00:00:00";
  if (periodo === "semanal") {
    const diaSemana = agora.getUTCDay();
    const inicio = new Date(agora);
    inicio.setUTCDate(agora.getUTCDate() - diaSemana);
    return inicio.toISOString().slice(0, 10) + " 00:00:00";
  }
  return agora.toISOString().slice(0, 7) + "-01 00:00:00"; // mensal
}

/**
 * Gasto real desde o início do período — soma as DUAS fontes de custo que
 * existem hoje: mensagens conversacionais (tokens gravados, custo calculado
 * na leitura via o registro central) e chamadas_modelo (Tool/Orquestrador,
 * já grava custo_usd direto). Escopo "global" soma tudo; "projeto:<id>"
 * filtra mensagens por projeto_id e chamadas_modelo pelos jobs daquela
 * conversa/projeto.
 */
function gastoDesde(desde: string, escopo: string): number {
  const projetoId = escopo.startsWith("projeto:") ? escopo.slice("projeto:".length) : null;

  const whereMsg = projetoId ? "AND projeto_id = ?" : "";
  const argsMsg = projetoId ? [desde, projetoId] : [desde];
  const mensagens = db()
    .prepare(`SELECT modelo, tokens_entrada, tokens_saida FROM mensagens WHERE criado_em >= ? ${whereMsg} AND papel = 'assistant' AND modelo IS NOT NULL`)
    .all(...argsMsg) as Array<{ modelo: string; tokens_entrada: number | null; tokens_saida: number | null }>;
  const custoMensagens = mensagens.reduce((soma, m) => soma + calcularCustoUsd(m.modelo, m.tokens_entrada ?? 0, m.tokens_saida ?? 0), 0);

  const whereChamadas = projetoId
    ? "AND job_id IN (SELECT j.id FROM jobs j JOIN conversas c ON c.id = j.conversa_id WHERE c.projeto_id = ?)"
    : "";
  const argsChamadas = projetoId ? [desde, projetoId] : [desde];
  const custoChamadas = (
    db()
      .prepare(`SELECT COALESCE(SUM(custo_usd), 0) AS total FROM chamadas_modelo WHERE criado_em >= ? ${whereChamadas}`)
      .get(...argsChamadas) as { total: number }
  ).total;

  return custoMensagens + custoChamadas;
}

function nivelDe(percentual: number | null, aviso: number, critico: number): NivelOrcamento {
  if (percentual === null) return "sem_limite";
  if (percentual >= 1) return "excedido";
  if (percentual >= critico) return "critico";
  if (percentual >= aviso) return "aviso";
  return "ok";
}

/** Status de um escopo específico — "global" é o mais comum; "projeto:<id>" filtra por conversas daquele projeto. */
export function statusOrcamento(escopo = "global"): StatusOrcamento {
  const orcamento = db().prepare(`SELECT * FROM orcamentos WHERE escopo = ? ORDER BY criado_em DESC LIMIT 1`).get(escopo) as
    | { periodo: "diario" | "semanal" | "mensal"; limite_usd: number; aviso_em: number; critico_em: number }
    | undefined;

  if (!orcamento) {
    return { escopo, periodo: null, limiteUsd: null, gastoUsd: gastoDesde(inicioDoPeriodo("mensal"), escopo), percentualUsado: null, nivel: "sem_limite" };
  }

  const desde = inicioDoPeriodo(orcamento.periodo);
  const gasto = gastoDesde(desde, escopo);
  const percentual = orcamento.limite_usd > 0 ? gasto / orcamento.limite_usd : null;

  return {
    escopo,
    periodo: orcamento.periodo,
    limiteUsd: orcamento.limite_usd,
    gastoUsd: gasto,
    percentualUsado: percentual,
    nivel: nivelDe(percentual, orcamento.aviso_em, orcamento.critico_em),
  };
}

/**
 * Decisão prática pro Router: orçamento "excedido" nunca bloqueia
 * silenciosamente — rebaixa pra tier mais barato quando a operação permite,
 * ou reporta bloqueio honesto quando nem CHEAP cabe. "crítico" já empurra
 * pra baixo o tier antes de estourar de vez.
 */
export function downgradeSugerido(escopo = "global"): "nenhum" | "reduzir_tier" | "bloquear" {
  const status = statusOrcamento(escopo);
  if (status.nivel === "excedido") return "bloquear";
  if (status.nivel === "critico") return "reduzir_tier";
  return "nenhum";
}
