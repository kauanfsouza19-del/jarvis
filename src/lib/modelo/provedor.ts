/**
 * Interface de provedor de modelo — a camada de raciocínio nunca fala com
 * o SDK da Anthropic direto. Trocar de provedor no futuro é escrever um
 * novo `ModelProvider`, nunca reescrever o Orquestrador.
 *
 * As quatro operações que o Orquestrador precisa, cada uma com entrada e
 * saída tipadas — nunca texto livre interpretado às cegas.
 */

import type { Disponibilidade } from "../ferramentas/tipos";

export type CapacidadeDescricao = {
  capacidade: string;
  descricao: string;
  disponibilidade: Disponibilidade;
};

/** O que o modelo propõe — sempre validado contra o registro real antes de virar Plano. */
export type PassoProposto = {
  descricao: string;
  capacidade: string;
  entrada: unknown;
  dependeDe: number[]; // índice de outros passos propostos, base 0
};

export type PlanoProposto = {
  resumoRaciocinio: string;
  passos: PassoProposto[];
  nivelRisco: "baixo" | "medio" | "alto";
};

export type InterpretacaoResultado = {
  classificacao: "SUCESSO_REAL" | "FALHA_EXECUCAO" | "RESULTADO_VAZIO_VALIDO";
  resumo: string;
};

export type DecisaoProximoPasso =
  | { acao: "CONTINUAR" }
  | { acao: "RETENTAR"; motivo: string }
  | { acao: "PULAR"; motivo: string }
  | { acao: "ADAPTAR_PLANO"; motivo: string }
  | { acao: "PEDIR_APROVACAO"; motivo: string }
  | { acao: "ENCERRAR"; motivo: string };

export interface ModelProvider {
  readonly nome: string;
  disponivel(): boolean;

  gerarPlano(objetivo: string, capacidades: CapacidadeDescricao[]): Promise<PlanoProposto>;
  interpretarResultado(descricaoPasso: string, resultado: unknown, erro: string | null): Promise<InterpretacaoResultado>;
  decidirProximoPasso(contexto: { objetivo: string; passosConcluidos: number; passosTotal: number; ultimoErro: string | null }): Promise<DecisaoProximoPasso>;
  comporResposta(objetivo: string, resumoResultado: string): Promise<string>;
}
