import "server-only";
import { db } from "../dados/db";
import { normalizar, type Entidade, type Lexico } from "./resolver";

/**
 * Léxico de entidades — construído a partir do que EXISTE no banco.
 *
 * Nada aqui é lista escrita à mão. Projeto vem da tabela `projetos`; cliente
 * vem da pasta raiz dos caminhos indexados em CLIENTES. Se o Cacique criar um
 * cliente novo e indexar, ele passa a ser reconhecido sem tocar em código.
 *
 * Consequência que vale dizer em voz alta: o Jarvis só infere contexto de
 * cliente que já foi indexado. Cliente que ele nunca indexou não é reconhecido,
 * e o motor devolve confiança BAIXA em vez de inventar.
 */

let cache: { lexico: Lexico; em: number } | null = null;
const VALIDADE_MS = 30_000;

/** "Cliente - SS Aquecedores" → "SS Aquecedores". Contrato solto é ignorado. */
function nomeDeCliente(raiz: string): string | null {
  const m = /^cliente\s*[-–]\s*(.+)$/i.exec(raiz.trim());
  if (!m) return null;
  const nome = m[1].replace(/\.(docx|pdf|md|html)$/i, "").trim();
  return nome.length >= 3 ? nome : null;
}

/**
 * Apelidos plausíveis para um nome composto. Conservador de propósito: sigla e
 * palavra distintiva longa. Gerar apelido curto demais faria "ss" casar em
 * qualquer lugar, e o contexto trocaria sozinho.
 */
function apelidosDe(nome: string): string[] {
  const n = normalizar(nome);
  const palavras = n.split(" ").filter((p) => p.length > 2 && !PALAVRAS_VAZIAS.has(p));
  const saida = new Set<string>();

  // Palavra distintiva: a mais longa, quando é longa o bastante para ser única.
  const maisLonga = palavras.slice().sort((a, b) => b.length - a.length)[0];
  if (maisLonga && maisLonga.length >= 6) saida.add(maisLonga);

  // Duas primeiras palavras, que é como se fala no dia a dia.
  if (palavras.length >= 2) saida.add(`${palavras[0]} ${palavras[1]}`);

  saida.delete(n);
  return [...saida];
}

const PALAVRAS_VAZIAS = new Set(["de", "da", "do", "das", "dos", "e", "para", "com"]);

export function construirLexico(): Lexico {
  if (cache && Date.now() - cache.em < VALIDADE_MS) return cache.lexico;

  const entidades: Entidade[] = [];

  const projetos = db()
    .prepare(`SELECT id, nome FROM projetos WHERE estado = 'ativo'`)
    .all() as Array<{ id: string; nome: string }>;

  for (const p of projetos) {
    entidades.push({
      id: p.id,
      nome: p.nome,
      apelidos: APELIDOS_FIXOS[p.nome] ?? [],
      genero: "projeto",
    });
  }

  const clientesProj = projetos.find((p) => p.nome === "CLIENTES");
  if (clientesProj) {
    const raizes = new Set<string>();
    for (const r of db()
      .prepare(`SELECT DISTINCT caminho FROM projeto_conhecimento WHERE projeto_id = ?`)
      .all(clientesProj.id) as Array<{ caminho: string }>) {
      raizes.add(r.caminho.split(/[\\/]/)[0]);
    }
    for (const raiz of raizes) {
      const nome = nomeDeCliente(raiz);
      if (!nome) continue;
      entidades.push({
        id: `cliente:${normalizar(nome).replace(/\s+/g, "-")}`,
        nome,
        apelidos: apelidosDe(nome),
        genero: "cliente",
        projetoId: clientesProj.id,
      });
    }
  }

  const lexico = { entidades };
  cache = { lexico, em: Date.now() };
  return lexico;
}

/**
 * Apelidos de projeto que o Cacique usa e que o nome da tabela não revela.
 * Só entram formas que ele de fato escreve — não sinônimo inventado.
 */
const APELIDOS_FIXOS: Record<string, string[]> = {
  MARKETING: ["marketing", "mkt"],
  LOCATTA: ["locatta", "locata"],
  CLIENTES: ["clientes", "cliente"],
  CRIATIVOS: ["criativos"],
  DESENVOLVIMENTO: ["desenvolvimento", "dev"],
  PESSOAL: ["pessoal"],
  JARVIS: ["jarvis"],
};

/** Zera o cache — usado pelos testes e após reindexação. */
export function invalidarLexico(): void {
  cache = null;
}
