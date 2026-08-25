import "server-only";
import { provedorAnthropic } from "./anthropic";
import { provedorOpenAI } from "./openai";
import { provedorGemini } from "./gemini";
import { provedorOllama } from "./ollama";
import { rodarComContextoDeFallback, rodarComContextoDeRoteamento } from "../jobs/contexto-execucao";
import { statusOrcamento, downgradeSugerido } from "./orcamento";
import { obterModoOrcamento } from "../autonomia";
import { desempenhoPorOperacao } from "./uso";
import { MODELOS_REGISTRO, disponibilidadeDoProvedor, calcularCustoUsd, type ModeloRegistro, type CapacidadeModelo, type TierModelo } from "./registro";
import { tierIdeal, ORDEM_TIER, tiersAceitaveis, ajustarTierPorModo, calcularScoreRoteamento } from "./roteador-score";
import { classificarFalha, estrategiaParaFalha, MAX_RETENTATIVAS_MESMO_PROVEDOR } from "./falhas";
import type { ModelProvider } from "./provedor";

export { calcularScoreRoteamento };

/**
 * Model Router — fundação multi-provedor (Fase 7), evoluído nesta fase pra
 * decisão estruturada de verdade (Fase 8): recebe o formato da tarefa,
 * devolve provedor+modelo+motivo+custo+fallback, nunca só "o primeiro
 * disponível". Mesmo espírito do registro de Tools
 * (`ferramentasParaCapacidade`/`ferramentaDisponivelPara`): quem PRECISA de
 * modelo nunca importa um provedor direto, pede ao roteador.
 */

const INSTANCIAS_PROVEDOR: Record<string, ModelProvider> = {
  anthropic: provedorAnthropic,
  openai: provedorOpenAI,
  gemini: provedorGemini,
  ollama: provedorOllama,
};

/** Compat com chamadores da Fase 7 que só querem "qualquer provedor disponível, sem decisão fina". */
export function provedorDisponivel(): ModelProvider | null {
  for (const p of Object.values(INSTANCIAS_PROVEDOR)) {
    if (p.disponivel()) return p;
  }
  return null;
}

export function algumProvedorDisponivel(): boolean {
  return provedorDisponivel() !== null;
}

export type TipoTarefa = "classificacao" | "copy" | "pesquisa" | "planejamento" | "raciocinio_estrategico" | "codigo" | "conversa";

export type PedidoRoteamento = {
  tipoTarefa: TipoTarefa;
  complexidade: "baixa" | "media" | "alta";
  qualidadeNecessaria?: "baixa" | "media" | "alta";
  tamanhoContextoTokens?: number;
  nivelRisco?: "baixo" | "medio" | "alto";
  capacidadesNecessarias?: CapacidadeModelo[];
  provedorPreferido?: string;
  escopoOrcamento?: string;
};

export type Alternativa = { modeloId: string; provedorId: string; score: number; motivo: string };

export type DecisaoRoteamento = {
  provedor: ModelProvider | null;
  provedorId: string | null;
  modeloId: string | null;
  motivo: string;
  custoEstimadoUsd: number | null;
  /** model_id em ordem — o próprio decisão.modeloId não entra aqui, só o que vem DEPOIS dele. */
  cadeiaFallback: string[];
  confianca: number;
  /** Risco alto ou confiança baixa sugerem segunda opinião (ver validacao-cruzada.ts) — nunca decidido sozinho aqui, o chamador decide se vale o custo extra. */
  precisaValidacao: boolean;
  /** Fase 9 — candidatos que perderam para o escolhido, com o score de cada um (mesmo formato pedido pela fase: {task, selected, reason, alternatives}). */
  alternativas: Alternativa[];
  /** Score determinístico do escolhido (0-1) — ver calcularScoreRoteamento. */
  score: number;
};

/**
 * Decisão de roteamento — nunca chama modelo nenhum aqui, só decide QUAL
 * chamar (ou se nenhum está disponível). Orçamento excedido bloqueia antes
 * de qualquer outra coisa; crítico rebaixa o tier antes de sequer olhar
 * pros modelos.
 */
export function rotear(pedido: PedidoRoteamento): DecisaoRoteamento {
  const escopo = pedido.escopoOrcamento ?? "global";
  const decisaoOrcamento = downgradeSugerido(escopo);
  if (decisaoOrcamento === "bloquear") {
    const status = statusOrcamento(escopo);
    return {
      provedor: null,
      provedorId: null,
      modeloId: null,
      motivo: `Orçamento (${escopo}, ${status.periodo}) excedido: ${status.gastoUsd.toFixed(2)}/${status.limiteUsd?.toFixed(2)} USD.`,
      custoEstimadoUsd: null,
      cadeiaFallback: [],
      confianca: 0,
      precisaValidacao: false,
      alternativas: [],
      score: 0,
    };
  }

  let ideal = tierIdeal(pedido);
  const modo = obterModoOrcamento();
  ideal = ajustarTierPorModo(ideal, modo);
  if (decisaoOrcamento === "reduzir_tier" && modo !== "MAX_QUALITY") {
    const i = Math.max(0, ORDEM_TIER.indexOf(ideal) - 1);
    ideal = ORDEM_TIER[i];
  }

  // Candidatos: todo modelo dos tiers aceitáveis (ideal primeiro) que tem as
  // capacidades pedidas — provedor preferido entra antes dos outros dentro
  // do MESMO tier, nunca troca de tier só por preferência de provedor.
  const capacidadesNecessarias = pedido.capacidadesNecessarias ?? [];
  const candidatos: ModeloRegistro[] = [];
  for (const tier of tiersAceitaveis(ideal)) {
    const doTier = MODELOS_REGISTRO.filter((m) => m.tier === tier && capacidadesNecessarias.every((c) => m.capacidades.includes(c)));
    doTier.sort((a, b) => (a.provedorId === pedido.provedorPreferido ? -1 : 0) - (b.provedorId === pedido.provedorPreferido ? -1 : 0));
    candidatos.push(...doTier);
  }

  const disponiveis = candidatos.filter((m) => disponibilidadeDoProvedor(m.provedorId) === "AVAILABLE");
  if (disponiveis.length === 0) {
    const statusPorProvedor = [...new Set(candidatos.map((c) => c.provedorId))].map((id) => `${id}:${disponibilidadeDoProvedor(id)}`).join(", ");
    return {
      provedor: null,
      provedorId: null,
      modeloId: null,
      motivo: candidatos.length > 0 ? `Nenhum provedor candidato disponível (${statusPorProvedor}).` : `Nenhum modelo do registro atende as capacidades pedidas (${capacidadesNecessarias.join(", ") || "nenhuma"}).`,
      custoEstimadoUsd: null,
      cadeiaFallback: [],
      confianca: 0,
      precisaValidacao: false,
      alternativas: [],
      score: 0,
    };
  }

  // Score determinístico (seção 9) decide a ORDEM entre os disponíveis —
  // tiersAceitaveis já filtrou "aceitável em princípio", o score decide
  // "qual dos aceitáveis é melhor" combinando confiabilidade/custo/latência
  // reais, não só "primeiro da lista".
  const custoMaximoDoLote = Math.max(...disponiveis.map((m) => m.custoPor1M.entrada + m.custoPor1M.saida), 0.0001);
  // desempenhoPorOperacao agrega por operacao (ex: "gerar_plano"), que é um
  // vocabulário mais fino que tipoTarefa (ex: "planejamento") — aqui
  // combinamos TODAS as operações de um mesmo modelo num único indicador
  // ponderado por volume de chamadas, nunca um número inventado.
  const desempenhoPorModelo = new Map<string, { taxaSucesso: number; latenciaMediaMs: number | null }>();
  for (const linha of desempenhoPorOperacao()) {
    const atual = desempenhoPorModelo.get(linha.modelo);
    if (!atual) {
      desempenhoPorModelo.set(linha.modelo, { taxaSucesso: linha.taxaSucesso, latenciaMediaMs: linha.latenciaMediaMs });
    } else {
      desempenhoPorModelo.set(linha.modelo, {
        taxaSucesso: (atual.taxaSucesso + linha.taxaSucesso) / 2,
        latenciaMediaMs: atual.latenciaMediaMs != null && linha.latenciaMediaMs != null ? (atual.latenciaMediaMs + linha.latenciaMediaMs) / 2 : (atual.latenciaMediaMs ?? linha.latenciaMediaMs),
      });
    }
  }
  const pontuados = disponiveis
    .map((m) => ({ modelo: m, score: calcularScoreRoteamento(m, ideal, custoMaximoDoLote, desempenhoPorModelo.get(m.modeloId)) }))
    .sort((a, b) => b.score - a.score);

  const escolhido = pontuados[0].modelo;
  const scoreEscolhido = pontuados[0].score;
  const fallback = pontuados.slice(1).map((p) => p.modelo);
  const alternativas: Alternativa[] = pontuados.slice(1).map((p) => ({
    modeloId: p.modelo.modeloId,
    provedorId: p.modelo.provedorId,
    score: Number(p.score.toFixed(3)),
    motivo: `tier ${p.modelo.tier}, score ${p.score.toFixed(3)} < escolhido ${scoreEscolhido.toFixed(3)}`,
  }));
  const tokensEstimados = pedido.tamanhoContextoTokens ?? 500;
  const custoEstimadoUsd = calcularCustoUsd(escolhido.modeloId, tokensEstimados, Math.min(tokensEstimados, 1000));

  const motivo = `tarefa=${pedido.tipoTarefa} complexidade=${pedido.complexidade} modo=${modo} → tier ${escolhido.tier}${decisaoOrcamento === "reduzir_tier" ? " (rebaixado por orçamento)" : ""} → ${escolhido.modeloId} (${escolhido.provedorId}), score=${scoreEscolhido.toFixed(3)}.`;

  return {
    provedor: INSTANCIAS_PROVEDOR[escolhido.provedorId] ?? null,
    provedorId: escolhido.provedorId,
    modeloId: escolhido.modeloId,
    motivo,
    custoEstimadoUsd,
    cadeiaFallback: fallback.map((m) => m.modeloId),
    confianca: escolhido.tier === ideal ? 0.9 : 0.6,
    precisaValidacao: pedido.nivelRisco === "alto",
    alternativas,
    score: Number(scoreEscolhido.toFixed(3)),
  };
}

/**
 * Executa com fallback real — tenta o provedor decidido; se falhar,
 * CLASSIFICA a falha (ver modelo/falhas.ts) antes de decidir o que fazer:
 * erro claramente transitório (rede/timeout) ganha UMA retentativa no MESMO
 * provedor (teto explícito, nunca indefinido — MAX_RETENTATIVAS_MESMO_PROVEDOR);
 * qualquer outra categoria vai direto pro PRÓXIMO provedor da cadeia cuja
 * capacidade ainda atenda. Nunca troca de provedor em silêncio — cada
 * tentativa grava sua própria linha em chamadas_modelo, sucesso ou falha.
 */
export async function chamarComFallback<T>(decisao: DecisaoRoteamento, operacao: (provedor: ModelProvider) => Promise<T>): Promise<T> {
  if (!decisao.provedor || !decisao.modeloId) throw new Error(decisao.motivo);

  try {
    // Fase 9 — motivo do roteamento gravado SEMPRE, não só em fallback (ver
    // modelo/uso.ts, que lê isso via motivoRoteamentoAtual()). Fase 10 — o
    // model_id decidido (decisao.modeloId) também vai no contexto, pra
    // anthropic.ts/openai.ts pararem de re-decidir o modelo sozinhos via
    // mapeamento interno de complexidade (pendência documentada na Fase 8).
    return await rodarComContextoDeRoteamento(decisao.motivo, decisao.modeloId, decisao.score, () => operacao(decisao.provedor!));
  } catch (primeiroErro) {
    let motivo = primeiroErro instanceof Error ? primeiroErro.message.slice(0, 150) : "erro desconhecido";
    let categoria = classificarFalha(motivo);

    // Fase 10 — retentativa ÚNICA no mesmo provedor, só quando a falha é
    // claramente transitória (rede/timeout) — nunca pra credencial ausente,
    // orçamento, rejeição de segurança ou resposta inválida (essas nunca
    // se resolvem tentando de novo o mesmo jeito).
    if (estrategiaParaFalha(categoria, 0) === "RETENTAR_MESMO_PROVEDOR") {
      try {
        return await rodarComContextoDeRoteamento(`${decisao.motivo} (retentativa após ${categoria})`, decisao.modeloId, decisao.score, () => operacao(decisao.provedor!));
      } catch (segundoErro) {
        motivo = segundoErro instanceof Error ? segundoErro.message.slice(0, 150) : motivo;
        categoria = classificarFalha(motivo);
      }
    }

    if (estrategiaParaFalha(categoria, MAX_RETENTATIVAS_MESMO_PROVEDOR) === "FALHAR_HONESTO") {
      throw primeiroErro; // rejeição de segurança/resposta inválida — nunca insiste trocando de provedor pra "tentar escapar" do motivo real
    }

    for (const modeloFallbackId of decisao.cadeiaFallback) {
      const modelo = MODELOS_REGISTRO.find((m) => m.modeloId === modeloFallbackId);
      if (!modelo) continue;
      const provedorFallback = INSTANCIAS_PROVEDOR[modelo.provedorId];
      if (!provedorFallback || disponibilidadeDoProvedor(modelo.provedorId) !== "AVAILABLE") continue;

      try {
        // modeloFallbackId (não decisao.modeloId) é o model_id desta
        // tentativa — decisao.modeloId aqui é só "o original que falhou",
        // registrado à parte (ver contexto-execucao.ts).
        return await rodarComContextoDeFallback(decisao.modeloId, `${motivo} [${categoria}]`, modeloFallbackId, () => operacao(provedorFallback));
      } catch {
        continue; // tenta o próximo da cadeia
      }
    }
    throw primeiroErro; // cadeia inteira falhou — nunca esconde o erro original
  }
}
