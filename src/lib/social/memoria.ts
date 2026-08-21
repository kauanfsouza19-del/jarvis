import "server-only";
import { criarMemoria } from "../dados/repositorio";
import { obterConteudo } from "./repositorio";

/**
 * Captura de conhecimento durável a partir de conteúdo social (Fase 11,
 * Rule 19) — FUNDAÇÃO, nunca gatilho automático hoje: publicação/analytics
 * real ainda não existe nesta fase (ver integracoes/registro.ts, Instagram
 * NAO_CONFIGURADO), então não existe métrica de performance real pra
 * decidir "isto foi um ângulo/CTA que funcionou" — inventar esse julgamento
 * sem dado real violaria a Rule 2 (nunca fake analytics).
 *
 * Quando uma pipeline de analytics real existir (publicação + métrica de
 * volta da plataforma), ela chama capturarInsightDeConteudo(id) — a função
 * já decide o que é durável (reaproveita criarMemoria, tipo LICAO, mesmo
 * dedup por título já usado desde a Fase 9) e o que é ruído.
 */

const LIMIAR_ENGAJAMENTO_NOTAVEL = 0.05; // 5% de alcance -> ação é um piso razoável, ajustável quando houver dado real

export type MetadadosPerformance = { alcance?: number; curtidas?: number; comentarios?: number; compartilhamentos?: number };

export function avaliarConteudoParaMemoria(conteudoId: string): { capturado: boolean; motivo: string } {
  const c = obterConteudo(conteudoId);
  if (!c) return { capturado: false, motivo: "conteudo_nao_encontrado" };
  if (c.status !== "ANALISADO" || !c.metadados_performance) {
    return { capturado: false, motivo: "sem dado de performance real ainda — nunca captura sem métrica de verdade" };
  }

  let metricas: MetadadosPerformance;
  try {
    metricas = JSON.parse(c.metadados_performance);
  } catch {
    return { capturado: false, motivo: "metadados_performance malformado" };
  }

  const engajamento = (metricas.curtidas ?? 0) + (metricas.comentarios ?? 0) + (metricas.compartilhamentos ?? 0);
  const taxa = metricas.alcance ? engajamento / metricas.alcance : 0;
  if (taxa < LIMIAR_ENGAJAMENTO_NOTAVEL) {
    return { capturado: false, motivo: `engajamento (${(taxa * 100).toFixed(1)}%) abaixo do piso notável — nunca vira memória por padrão` };
  }

  criarMemoria({
    tipo: "LICAO",
    titulo: `Ângulo de conteúdo que funcionou: ${c.conceito || c.titulo}`,
    corpo: `Post de ${c.plataforma} (${c.tipo_conteudo}) com engajamento de ${(taxa * 100).toFixed(1)}% teve CTA "${c.cta ?? "nenhum registrado"}" e conceito "${c.conceito}".`,
    camada: "recuperavel",
    origem: `conteudo:${c.id}`,
    confianca: 0.7,
    importancia: 3,
  });
  return { capturado: true, motivo: `engajamento notável (${(taxa * 100).toFixed(1)}%)` };
}
