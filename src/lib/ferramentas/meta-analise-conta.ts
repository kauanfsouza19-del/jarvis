import "server-only";
import { listarContasAnuncio, listarCampanhas, obterInsightsCampanhas, type ContaAnuncioMeta } from "./meta-ads";
import { analisarCampanhas, THRESHOLDS_PADRAO, type ResultadoAnaliseOtimizacao, type ThresholdsOtimizacao } from "./meta-otimizacao";

/**
 * Composição atômica: busca dado real (insights + campanhas) e roda o
 * motor de otimização NUMA SÓ chamada de Tool (Fase 28). Achado real
 * (Fase 27j, testando "abre a conta" -> "quais campanhas tem" em
 * produção): o motor de Plano não encadeia a SAÍDA real de um passo pro
 * INPUT do próximo — o Planejador por modelo monta os passos todos
 * ANTES de qualquer execução, então não tem como saber o `contaId` (ou
 * qualquer outro valor) que só existe depois que um passo anterior
 * rodou de verdade. Isso quebraria "analisa a conta X" (precisa: listar
 * campanhas -> pegar IDs -> buscar insights -> alimentar o motor —
 * MÚLTIPLAS dependências de saída-pra-entrada). Em vez de construir um
 * sistema de templating passo-a-passo genérico (mudança grande, arriscada
 * no motor de DAG existente), a correção pragmática e robusta é compor
 * tudo dentro de UMA função — sem cruzar a fronteira do Job/Plano no
 * meio, nunca precisa de encadeamento externo.
 */

export type ResultadoAnaliseConta = {
  contaId: string;
  nomeConta: string | null;
  analise: ResultadoAnaliseOtimizacao;
};

export async function analisarContaMeta(contaId: string, datePreset = "last_30d", thresholds: ThresholdsOtimizacao = THRESHOLDS_PADRAO): Promise<ResultadoAnaliseConta> {
  const [campanhas, insights] = await Promise.all([listarCampanhas(contaId), obterInsightsCampanhas(contaId, datePreset)]);
  const analise = analisarCampanhas(insights, campanhas, thresholds);
  return { contaId, nomeConta: null, analise };
}

export type ResultadoAnaliseMultiConta = {
  contasAnalisadas: number;
  contasComErro: Array<{ contaId: string; nome: string; erro: string }>;
  resultados: Array<{ contaId: string; nome: string; analise: ResultadoAnaliseOtimizacao }>;
  /** Ordenado por severidade — conta com mais achados CRITICO primeiro, é a "prioridade 1" que o Cacique pediu. */
  ordemPrioridade: string[];
};

const TETO_CONTAS_ANALISE_EM_LOTE = 30; // nunca varre centenas de contas numa chamada só — teto de segurança, ajustável se a agência crescer muito além disso

/**
 * "Analisa todas as minhas contas" (Fase 28) — varre as contas ATIVAS
 * (account_status 1) em paralelo controlado, nunca sequencial (25 contas
 * sequenciais custaria segundos demais numa resposta de chat). Conta que
 * falha (rate limit, sem campanha no período, etc.) não derruba a
 * análise das outras — erro fica registrado, nunca silenciado.
 */
export async function analisarTodasContasMeta(datePreset = "last_30d", thresholds: ThresholdsOtimizacao = THRESHOLDS_PADRAO): Promise<ResultadoAnaliseMultiConta> {
  const todasContas = await listarContasAnuncio();
  const ativas = todasContas.filter((c) => c.account_status === 1).slice(0, TETO_CONTAS_ANALISE_EM_LOTE);

  const contasComErro: ResultadoAnaliseMultiConta["contasComErro"] = [];
  const resultados: ResultadoAnaliseMultiConta["resultados"] = [];

  const LOTE = 5; // paralelismo controlado — nunca 25 chamadas simultâneas pra API real de uma vez
  for (let i = 0; i < ativas.length; i += LOTE) {
    const fatia = ativas.slice(i, i + LOTE);
    await Promise.all(
      fatia.map(async (conta: ContaAnuncioMeta) => {
        try {
          const [campanhas, insights] = await Promise.all([listarCampanhas(conta.id), obterInsightsCampanhas(conta.id, datePreset)]);
          if (insights.length === 0) return; // sem campanha no período — nunca reporta como "erro", só não entra no ranking
          const analise = analisarCampanhas(insights, campanhas, thresholds);
          resultados.push({ contaId: conta.id, nome: conta.name, analise });
        } catch (e) {
          contasComErro.push({ contaId: conta.id, nome: conta.name, erro: e instanceof Error ? e.message : "erro desconhecido" });
        }
      }),
    );
  }

  const contarCriticos = (a: ResultadoAnaliseOtimizacao) => a.achados.filter((x) => x.severidade === "CRITICO").length;
  const ordenados = [...resultados].sort((a, b) => contarCriticos(b.analise) - contarCriticos(a.analise));

  return {
    contasAnalisadas: resultados.length,
    contasComErro,
    resultados: ordenados,
    ordemPrioridade: ordenados.map((r) => r.nome),
  };
}
