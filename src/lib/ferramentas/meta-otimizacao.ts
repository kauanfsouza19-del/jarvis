import "server-only";
import type { InsightCampanhaMeta, CampanhaMeta } from "./meta-ads";

/**
 * Motor de Otimização Meta Ads (Fase 27c) — regras determinísticas sobre
 * dado REAL de insights, nunca modelo/IA decidindo threshold sozinho
 * (thresholds são configuráveis e documentados, nunca mágicos — pedido
 * explícito da missão: "Do not hardcode dangerous thresholds without
 * documenting them").
 *
 * Fluxo: ANÁLISE → OBSERVAÇÃO/RECOMENDAÇÃO → (aprovação, se a ação virar
 * mutação real) → EXECUÇÃO. Este módulo só produz o diagnóstico — nunca
 * executa nada sozinho. A execução de qualquer recomendação passa pelas
 * Tools já existentes (meta_ads.atualizar_status_campanha,
 * atualizar_orcamento_campanha), que já são aprovação-obrigatória.
 *
 * Limitação real, documentada (não escondida): as regras de TENDÊNCIA
 * (CPA subindo, CTR caindo, fadiga de criativo) exigem DUAS janelas de
 * tempo pra comparar — este motor aceita isso via `snapshotAnterior`
 * opcional; sem ele, essas regras simplesmente não disparam (nunca
 * inventam uma tendência a partir de um snapshot único).
 */

export type ThresholdsOtimizacao = {
  /** Gasto (em unidade da moeda da conta, ex: R$) acima do qual "zero resultado" vira observação crítica, não só um aviso. */
  gastoAltoSemResultado: number;
  /** CTR mínimo aceitável (%) antes de virar observação de CTR baixo. */
  ctrMinimo: number;
  /** Quantos desvios acima da mediana de CPC da conta um CPC individual precisa estar pra virar observação de CPC alto. */
  multiplicadorCpcAlto: number;
  /** Quantos desvios ABAIXO da média de CPA da conta uma campanha precisa estar (CPA melhor = menor) pra virar candidata a escalar. */
  multiplicadorCpaBomParaEscalar: number;
  /** Quantas vezes acima da média de CPA da conta vira candidata a pausar. */
  multiplicadorCpaRuimParaPausar: number;
  /** Leads mínimos pra uma campanha ser considerada "com volume suficiente" antes de recomendar escalar (evita recomendar escalar por causa de sorte com 1 lead). */
  leadsMinimosParaConfiabilidade: number;
};

// Defaults documentados, nunca mágicos — calibrados contra o painel real
// que já construímos à mão pra conta Klein (ver artifact "Painel de
// Campanhas — Klein", 25/08/2026): as mesmas 5 campanhas que marcamos
// manualmente como "Crítico" (TC1-TC5 de 11.08) precisam continuar caindo
// nessas regras, senão o threshold está calibrado errado.
export const THRESHOLDS_PADRAO: ThresholdsOtimizacao = {
  gastoAltoSemResultado: 150,
  ctrMinimo: 0.8,
  multiplicadorCpcAlto: 1.8,
  multiplicadorCpaBomParaEscalar: 0.7,
  multiplicadorCpaRuimParaPausar: 2.5,
  leadsMinimosParaConfiabilidade: 5,
};

export type SeveridadeOtimizacao = "OBSERVACAO" | "RECOMENDACAO" | "CRITICO";
export type CategoriaOtimizacao =
  | "ALTO_GASTO_SEM_RESULTADO"
  | "CTR_BAIXO"
  | "CPC_ALTO"
  | "CANDIDATA_A_ESCALAR"
  | "CANDIDATA_A_PAUSAR"
  | "ORCAMENTO_SUBUTILIZADO"
  | "NOME_DUPLICADO"
  | "CPA_SUBINDO" // exige snapshotAnterior — nunca dispara sem ele
  | "CTR_CAINDO"; // exige snapshotAnterior — nunca dispara sem ele

export type AchadoOtimizacao = {
  campanhaId: string | null;
  campanhaNome: string;
  categoria: CategoriaOtimizacao;
  severidade: SeveridadeOtimizacao;
  explicacao: string;
  metricas: Record<string, number | string>;
  acaoSugerida: string | null; // descrição em texto — a EXECUÇÃO real usa uma Tool existente, nunca este módulo diretamente
};

function extrairAcaoNumero(insight: InsightCampanhaMeta, actionType: string, campo: "actions" | "cost_per_action_type"): number | null {
  const lista = insight[campo];
  const item = lista?.find((a) => a.action_type === actionType);
  return item ? Number(item.value) : null;
}

/** Tenta achar o número de "resultado principal" (lead) de um jeito robusto — mesma lógica que usamos manualmente no painel Klein: prioriza 'lead' (contagem real de submissões de Instant Form), cai pra 'onsite_conversion.lead' se não existir. */
function leadsDoInsight(insight: InsightCampanhaMeta): number {
  return extrairAcaoNumero(insight, "lead", "actions") ?? extrairAcaoNumero(insight, "onsite_conversion.lead", "actions") ?? 0;
}

function cpaDoInsight(insight: InsightCampanhaMeta): number | null {
  const leads = leadsDoInsight(insight);
  const spend = Number(insight.spend ?? 0);
  return leads > 0 ? spend / leads : null;
}

export type ResultadoAnaliseOtimizacao = {
  achados: AchadoOtimizacao[];
  resumo: { totalGasto: number; totalLeads: number; cpaMedioBlended: number | null; campanhasAnalisadas: number };
};

/**
 * Analisa um conjunto de insights (nível campanha) de UMA conta e devolve
 * achados priorizados. `campanhas` (opcional) traz status/daily_budget —
 * sem isso, a regra de orçamento subutilizado e a de nome duplicado não
 * rodam (dependem de dado que insights sozinho não tem).
 */
export function analisarCampanhas(
  insights: InsightCampanhaMeta[],
  campanhas: CampanhaMeta[] = [],
  thresholds: ThresholdsOtimizacao = THRESHOLDS_PADRAO,
): ResultadoAnaliseOtimizacao {
  const achados: AchadoOtimizacao[] = [];

  const comCpa = insights.map((i) => ({ insight: i, cpa: cpaDoInsight(i) })).filter((x): x is { insight: InsightCampanhaMeta; cpa: number } => x.cpa !== null);
  const cpaMedio = comCpa.length > 0 ? comCpa.reduce((s, x) => s + x.cpa, 0) / comCpa.length : null;

  const cpcs = insights.map((i) => Number(i.cpc ?? 0)).filter((c) => c > 0).sort((a, b) => a - b);
  const cpcMediano = cpcs.length > 0 ? cpcs[Math.floor(cpcs.length / 2)] : null;

  let totalGasto = 0;
  let totalLeads = 0;

  for (const insight of insights) {
    const nome = insight.campaign_name ?? "(sem nome)";
    const id = insight.campaign_id ?? null;
    const spend = Number(insight.spend ?? 0);
    const ctr = Number(insight.ctr ?? 0);
    const cpc = Number(insight.cpc ?? 0);
    const leads = leadsDoInsight(insight);
    const cpa = cpaDoInsight(insight);
    totalGasto += spend;
    totalLeads += leads;

    // ALTO_GASTO_SEM_RESULTADO
    if (leads === 0 && spend >= thresholds.gastoAltoSemResultado) {
      achados.push({
        campanhaId: id,
        campanhaNome: nome,
        categoria: "ALTO_GASTO_SEM_RESULTADO",
        severidade: "CRITICO",
        explicacao: `Gastou ${spend.toFixed(2)} sem gerar nenhum lead (teto configurado: ${thresholds.gastoAltoSemResultado}).`,
        metricas: { spend, leads },
        acaoSugerida: "Pausar (meta_ads.atualizar_status_campanha, status PAUSED) — sujeita a aprovação.",
      });
    }

    // CTR_BAIXO
    if (ctr > 0 && ctr < thresholds.ctrMinimo) {
      achados.push({
        campanhaId: id,
        campanhaNome: nome,
        categoria: "CTR_BAIXO",
        severidade: "RECOMENDACAO",
        explicacao: `CTR de ${ctr.toFixed(2)}% está abaixo do mínimo configurado (${thresholds.ctrMinimo}%) — criativo ou segmentação podem não estar ressoando.`,
        metricas: { ctr },
        acaoSugerida: "Revisar criativo/segmentação; considerar troca de criativo (meta_ads.enviar_criativo) antes de pausar.",
      });
    }

    // CPC_ALTO (relativo à mediana da própria conta)
    if (cpcMediano && cpc > cpcMediano * thresholds.multiplicadorCpcAlto) {
      achados.push({
        campanhaId: id,
        campanhaNome: nome,
        categoria: "CPC_ALTO",
        severidade: "OBSERVACAO",
        explicacao: `CPC de ${cpc.toFixed(2)} é ${(cpc / cpcMediano).toFixed(1)}x a mediana da conta (${cpcMediano.toFixed(2)}).`,
        metricas: { cpc, cpcMediano },
        acaoSugerida: null,
      });
    }

    // CANDIDATA_A_ESCALAR
    if (cpa !== null && cpaMedio !== null && leads >= thresholds.leadsMinimosParaConfiabilidade && cpa <= cpaMedio * thresholds.multiplicadorCpaBomParaEscalar) {
      achados.push({
        campanhaId: id,
        campanhaNome: nome,
        categoria: "CANDIDATA_A_ESCALAR",
        severidade: "RECOMENDACAO",
        explicacao: `CPA de ${cpa.toFixed(2)} está ${(cpaMedio / cpa).toFixed(1)}x melhor que a média da conta (${cpaMedio.toFixed(2)}), com volume confiável (${leads} leads).`,
        metricas: { cpa, cpaMedio, leads },
        acaoSugerida: "Aumentar orçamento diário (meta_ads.atualizar_orcamento_campanha) — sujeita a aprovação.",
      });
    }

    // CANDIDATA_A_PAUSAR (CPA muito acima da média, com leads > 0 — o caso de zero leads já cai em ALTO_GASTO_SEM_RESULTADO)
    if (cpa !== null && cpaMedio !== null && cpa >= cpaMedio * thresholds.multiplicadorCpaRuimParaPausar) {
      achados.push({
        campanhaId: id,
        campanhaNome: nome,
        categoria: "CANDIDATA_A_PAUSAR",
        severidade: "CRITICO",
        explicacao: `CPA de ${cpa.toFixed(2)} é ${(cpa / cpaMedio).toFixed(1)}x pior que a média da conta (${cpaMedio.toFixed(2)}).`,
        metricas: { cpa, cpaMedio },
        acaoSugerida: "Pausar ou revisar segmentação/criativo — sujeita a aprovação.",
      });
    }
  }

  // NOME_DUPLICADO — precisa da lista de campanhas (nome não é único no insights sozinho, mas o objeto campanha real é)
  if (campanhas.length > 0) {
    const porNome = new Map<string, CampanhaMeta[]>();
    for (const c of campanhas) {
      const lista = porNome.get(c.name) ?? [];
      lista.push(c);
      porNome.set(c.name, lista);
    }
    for (const [nome, lista] of porNome) {
      if (lista.length > 1) {
        achados.push({
          campanhaId: null,
          campanhaNome: nome,
          categoria: "NOME_DUPLICADO",
          severidade: "OBSERVACAO",
          explicacao: `${lista.length} campanhas ativas com o nome exatamente igual ("${nome}") — dificulta rastrear qual é qual nos relatórios.`,
          metricas: { quantidade: lista.length },
          acaoSugerida: "Renomear com sufixo diferenciador (não há Tool de rename ainda — ação manual no Ads Manager).",
        });
      }
    }

    // ORCAMENTO_SUBUTILIZADO — compara gasto do insight com daily_budget * dias do período (usa date_start/date_stop quando disponível)
    for (const insight of insights) {
      const campanha = campanhas.find((c) => c.id === insight.campaign_id);
      if (!campanha?.daily_budget) continue;
      const orcamentoDiario = Number(campanha.daily_budget) / 100; // centavos -> unidade da moeda
      const dias = insight.date_start && insight.date_stop ? Math.max(1, Math.round((new Date(insight.date_stop).getTime() - new Date(insight.date_start).getTime()) / 86_400_000) + 1) : 30;
      const orcamentoTotal = orcamentoDiario * dias;
      const spend = Number(insight.spend ?? 0);
      if (orcamentoTotal > 0 && spend < orcamentoTotal * 0.5) {
        achados.push({
          campanhaId: insight.campaign_id ?? null,
          campanhaNome: insight.campaign_name ?? "(sem nome)",
          categoria: "ORCAMENTO_SUBUTILIZADO",
          severidade: "OBSERVACAO",
          explicacao: `Gastou ${spend.toFixed(2)} de um orçamento disponível de ~${orcamentoTotal.toFixed(2)} no período (${((spend / orcamentoTotal) * 100).toFixed(0)}% utilizado) — a entrega pode estar limitada por segmentação/lance, não por orçamento.`,
          metricas: { spend, orcamentoTotal },
          acaoSugerida: "Investigar limitação de entrega antes de aumentar orçamento — aumentar não resolve se o gargalo é audiência/lance.",
        });
      }
    }
  }

  // Prioriza CRITICO > RECOMENDACAO > OBSERVACAO
  const ordem: Record<SeveridadeOtimizacao, number> = { CRITICO: 0, RECOMENDACAO: 1, OBSERVACAO: 2 };
  achados.sort((a, b) => ordem[a.severidade] - ordem[b.severidade]);

  return {
    achados,
    resumo: {
      totalGasto,
      totalLeads,
      cpaMedioBlended: totalLeads > 0 ? totalGasto / totalLeads : null,
      campanhasAnalisadas: insights.length,
    },
  };
}
