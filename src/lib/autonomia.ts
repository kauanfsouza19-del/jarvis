import "server-only";
import { db } from "./dados/db";

/**
 * Nível de autonomia — política global de quanto o Orquestrador age sozinho.
 *
 *   0 — só sugere: Plano fica em RASCUNHO, nenhum Job roda.
 *   1 — executa tarefa só-leitura sozinho (padrão, conservador).
 *   2 — executa ação de baixo risco sozinho.
 *   3 — comunicação externa após aprovação (aprovação continua obrigatória).
 *   4 — autonomia ampla sob política explícita do Cacique.
 *
 * Hoje só o nível 0 muda comportamento de verdade (bloqueia a criação de
 * Job) — os demais ficam definidos e persistidos, prontos para o
 * Orquestrador diferenciar mais quando houver Tool de risco médio/alto
 * implementada de verdade. Aprovação (READ/WRITE nunca pede, SEND em
 * diante sempre pede) já é reforçada pelo motor de job independente do
 * nível — autonomia nunca pula essa fronteira.
 */

export const NIVEL_PADRAO = 1;

export function obterNivelAutonomia(): number {
  const linha = db().prepare(`SELECT nivel FROM configuracao_autonomia WHERE id = 1`).get() as { nivel: number } | undefined;
  return linha?.nivel ?? NIVEL_PADRAO;
}

export function definirNivelAutonomia(nivel: number): number {
  if (!Number.isInteger(nivel) || nivel < 0 || nivel > 4) throw new Error("nivel_invalido");
  db()
    .prepare(
      `INSERT INTO configuracao_autonomia (id, nivel) VALUES (1, ?)
       ON CONFLICT(id) DO UPDATE SET nivel = excluded.nivel, atualizado_em = datetime('now')`,
    )
    .run(nivel);
  return nivel;
}

/**
 * Budget Modes (Fase 9, seção 10) — dimensão SEPARADA do nível de
 * autonomia (autonomia decide "posso agir sozinho", modo de orçamento
 * decide "quanto vale gastar em modelo pra isso"), mesma tabela singleton
 * por conveniência (mesmo padrão id=1 já usado acima), nunca a mesma coluna.
 *
 *   ECONOMY     — só CHEAP, nunca sobe de tier mesmo se o ideal pedir mais.
 *   BALANCED    — padrão: respeita o tier ideal calculado pelo Router.
 *   QUALITY     — nunca desce de BALANCED, mesmo sob pressão de orçamento.
 *   MAX_QUALITY — sempre tenta PREMIUM quando a capacidade existe.
 *
 * Nunca contorna credencial/disponibilidade real — só influencia a escolha
 * de TIER dentro do que já está disponível (ver modelo/roteador.ts).
 */
export type ModoOrcamento = "ECONOMY" | "BALANCED" | "QUALITY" | "MAX_QUALITY";
const MODOS_VALIDOS: ModoOrcamento[] = ["ECONOMY", "BALANCED", "QUALITY", "MAX_QUALITY"];
export const MODO_ORCAMENTO_PADRAO: ModoOrcamento = "BALANCED";

export function obterModoOrcamento(): ModoOrcamento {
  const linha = db().prepare(`SELECT modo_orcamento FROM configuracao_autonomia WHERE id = 1`).get() as { modo_orcamento: string } | undefined;
  const modo = linha?.modo_orcamento;
  return modo && (MODOS_VALIDOS as string[]).includes(modo) ? (modo as ModoOrcamento) : MODO_ORCAMENTO_PADRAO;
}

export function definirModoOrcamento(modo: string): ModoOrcamento {
  if (!MODOS_VALIDOS.includes(modo as ModoOrcamento)) throw new Error("modo_orcamento_invalido");
  db()
    .prepare(
      `INSERT INTO configuracao_autonomia (id, modo_orcamento) VALUES (1, ?)
       ON CONFLICT(id) DO UPDATE SET modo_orcamento = excluded.modo_orcamento, atualizado_em = datetime('now')`,
    )
    .run(modo);
  return modo as ModoOrcamento;
}
