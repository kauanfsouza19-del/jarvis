import "server-only";
import { db } from "./db";

/**
 * Recuperação híbrida.
 *
 * Hoje: full-text (FTS5 com ranking BM25) + filtro de projeto + filtro de fonte
 * + recência. Custo zero, nenhuma chamada de modelo.
 *
 * O slot semântico existe no esquema (`trechos_conhecimento.embedding`) e entra
 * quando escolhermos o provedor de embedding mais barato que sirva. A assinatura
 * destas funções não muda quando isso acontecer.
 */

export type MemoriaAchada = {
  id: string;
  tipo: string;
  titulo: string;
  corpo: string;
  estado: string;
  confianca: number;
  importancia: number;
  projeto_id: string | null;
  atualizado_em: string;
  score: number;
};

export type TrechoAchado = {
  id: string;
  afirmacao: string;
  corpo: string;
  modulo: string | null;
  evidencia: string;
  natureza: string;
  confianca: number;
  fonte_titulo: string;
  score: number;
};

/** Transforma texto livre numa consulta FTS5 segura (OR entre termos). */
function consultaFts(texto: string): string | null {
  const termos = texto
    .toLowerCase()
    .replace(/["'*()]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !PARADAS.has(t))
    .slice(0, 12);
  if (termos.length === 0) return null;
  return termos.map((t) => `"${t}"*`).join(" OR ");
}

const PARADAS = new Set([
  "que","com","para","por","uma","dos","das","não","nao","mais","mas","como",
  "isso","essa","esse","está","esta","são","sao","foi","ser","tem","quando",
  "onde","qual","quais","meu","minha","seu","sua","the","and","for","você","voce",
]);

export function buscarMemorias(
  texto: string,
  opcoes?: { projeto_id?: string | null; limite?: number; incluirInativas?: boolean },
): MemoriaAchada[] {
  const q = consultaFts(texto);
  const limite = opcoes?.limite ?? 8;
  if (!q) return [];

  const cond: string[] = ["memorias_fts MATCH ?"];
  const args: unknown[] = [q];

  if (!opcoes?.incluirInativas) cond.push("m.estado = 'ATIVA'");
  if (opcoes?.projeto_id) {
    cond.push("(m.projeto_id = ? OR m.projeto_id IS NULL)");
    args.push(opcoes.projeto_id);
  }

  const linhas = db()
    .prepare(
      `SELECT m.id, m.tipo, m.titulo, m.corpo, m.estado, m.confianca, m.importancia,
              m.projeto_id, m.atualizado_em,
              bm25(memorias_fts) AS bm
         FROM memorias_fts
         JOIN memorias m ON m.rowid = memorias_fts.rowid
        WHERE ${cond.join(" AND ")}
        ORDER BY bm
        LIMIT ?`,
    )
    .all(...(args as never[]), limite) as Array<MemoriaAchada & { bm: number }>;

  // BM25 é negativo (mais negativo = melhor). Combina com importância e
  // confiança para que memória importante não perca para uma nota solta.
  return linhas
    .map((l) => ({
      ...l,
      score: -l.bm * (0.6 + 0.08 * l.importancia) * (0.7 + 0.3 * l.confianca),
    }))
    .sort((a, b) => b.score - a.score);
}

export function buscarConhecimento(
  texto: string,
  opcoes?: { modulo?: string | null; fonte_id?: string | null; limite?: number },
): TrechoAchado[] {
  const q = consultaFts(texto);
  const limite = opcoes?.limite ?? 8;
  if (!q) return [];

  const cond: string[] = ["trechos_fts MATCH ?", "t.obsoleto = 0"];
  const args: unknown[] = [q];

  if (opcoes?.modulo) {
    cond.push("t.modulo = ?");
    args.push(opcoes.modulo);
  }
  if (opcoes?.fonte_id) {
    cond.push("t.fonte_id = ?");
    args.push(opcoes.fonte_id);
  }

  const linhas = db()
    .prepare(
      `SELECT t.id, t.afirmacao, t.corpo, t.modulo, t.evidencia, t.natureza, t.confianca,
              f.titulo AS fonte_titulo,
              bm25(trechos_fts) AS bm
         FROM trechos_fts
         JOIN trechos_conhecimento t ON t.rowid = trechos_fts.rowid
         JOIN fontes_conhecimento f ON f.id = t.fonte_id
        WHERE ${cond.join(" AND ")}
        ORDER BY bm
        LIMIT ?`,
    )
    .all(...(args as never[]), limite) as Array<TrechoAchado & { bm: number }>;

  // Peso por nível de evidência — consenso forte vence menção isolada.
  const pesoEvidencia: Record<string, number> = {
    CONSENSO_FORTE: 1.0,
    CONSENSO_PARCIAL: 0.8,
    MENCAO_ISOLADA: 0.55,
  };

  return linhas
    .map((l) => ({
      ...l,
      score: -l.bm * (pesoEvidencia[l.evidencia] ?? 0.5) * (0.7 + 0.3 * l.confianca),
    }))
    .sort((a, b) => b.score - a.score);
}

export type FatoAchado = {
  id: string;
  titulo: string;
  corpo: string;
  caminho: string | null;
  confianca: number;
  projeto_nome: string;
  score: number;
};

/** projetoId nulo = busca em todos os projetos indexados. */
export function buscarConhecimentoProjeto(
  texto: string,
  projetoId: string | null,
  limite = 6,
): FatoAchado[] {
  const q = consultaFts(texto);
  if (!q) return [];

  const cond = ["projeto_conhecimento_fts MATCH ?", "p.obsoleto = 0"];
  const args: unknown[] = [q];
  if (projetoId) {
    cond.push("p.projeto_id = ?");
    args.push(projetoId);
  }

  const linhas = db()
    .prepare(
      `SELECT p.id, p.titulo, p.corpo, p.caminho, p.confianca,
              j.nome AS projeto_nome, bm25(projeto_conhecimento_fts) AS bm
         FROM projeto_conhecimento_fts
         JOIN projeto_conhecimento p ON p.rowid = projeto_conhecimento_fts.rowid
         JOIN projetos j ON j.id = p.projeto_id
        WHERE ${cond.join(" AND ")}
        ORDER BY bm
        LIMIT ?`,
    )
    .all(...(args as never[]), limite) as Array<FatoAchado & { bm: number }>;

  return linhas.map((l) => ({ ...l, score: -l.bm * (0.7 + 0.3 * l.confianca) }));
}
