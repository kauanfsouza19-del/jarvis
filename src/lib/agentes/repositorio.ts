import "server-only";
import { db, id as gerarId } from "../dados/db";

/**
 * Agente — configuração persistida, nunca código gerado/executado. Criar um
 * agente é gravar papel/objetivo/capacidades/instruções; o Orquestrador
 * consulta isto para saber que capacidades um papel autoriza, mas quem
 * executa continua sendo o mesmo despachante de Tool por capacidade — um
 * Agente não é um segundo motor de execução.
 */

export type Agente = {
  id: string;
  nome: string;
  papel: string;
  objetivo: string;
  capacidades: string; // JSON: array de capacidade
  instrucoes: string | null;
  nivel_autonomia_padrao: number;
  estado: "ATIVO" | "INATIVO";
  criado_em: string;
};

export function criarAgente(entrada: {
  nome: string;
  papel: string;
  objetivo: string;
  capacidades: string[];
  instrucoes?: string | null;
  nivelAutonomiaPadrao?: number;
}): Agente {
  const id = gerarId();
  db()
    .prepare(
      `INSERT INTO agentes (id, nome, papel, objetivo, capacidades, instrucoes, nivel_autonomia_padrao)
       VALUES (?,?,?,?,?,?,?)`,
    )
    .run(
      id,
      entrada.nome,
      entrada.papel,
      entrada.objetivo,
      JSON.stringify(entrada.capacidades),
      entrada.instrucoes ?? null,
      entrada.nivelAutonomiaPadrao ?? 1,
    );
  return obterAgente(id)!;
}

export function obterAgente(id: string): Agente | undefined {
  return db().prepare(`SELECT * FROM agentes WHERE id = ?`).get(id) as Agente | undefined;
}

export function listarAgentes(soAtivos = true): Agente[] {
  const where = soAtivos ? "WHERE estado = 'ATIVO'" : "";
  return db().prepare(`SELECT * FROM agentes ${where} ORDER BY criado_em`).all() as Agente[];
}

export function agentePorPapel(papel: string): Agente | undefined {
  return db().prepare(`SELECT * FROM agentes WHERE papel = ? AND estado = 'ATIVO' LIMIT 1`).get(papel) as Agente | undefined;
}

/**
 * Seleção de Agente por capacidade (Fase 7) — fundação pro Orquestrador
 * "escolher o agente certo" (antes disso, `agente_id` do Plano nunca era
 * preenchido; Agentes existiam só como configuração decorativa). Escolhe o
 * ATIVO cujas capacidades têm a MAIOR interseção com as que o Plano
 * realmente precisa; empate ou zero interseção → null, nunca força um
 * agente sem relação real com o trabalho.
 */
export function escolherAgentePorCapacidades(capacidadesNecessarias: string[]): Agente | undefined {
  if (capacidadesNecessarias.length === 0) return undefined;
  const necessarias = new Set(capacidadesNecessarias);

  let melhor: Agente | undefined;
  let melhorSobreposicao = 0;
  for (const agente of listarAgentes(true)) {
    let capacidadesAgente: string[];
    try {
      capacidadesAgente = JSON.parse(agente.capacidades);
    } catch {
      continue;
    }
    const sobreposicao = capacidadesAgente.filter((c) => necessarias.has(c)).length;
    if (sobreposicao > melhorSobreposicao) {
      melhor = agente;
      melhorSobreposicao = sobreposicao;
    }
  }
  return melhor;
}
