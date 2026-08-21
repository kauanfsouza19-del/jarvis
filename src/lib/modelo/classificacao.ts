/**
 * Classificação determinística de tarefa (Fase 9) — antes de QUALQUER
 * chamada de modelo, decide a CLASSE da tarefa por regex/heurística, nunca
 * perguntando a um modelo "que tipo de tarefa é essa" (isso já seria gasto
 * de token pra decidir se vale gastar token). Função pura, sem I/O — mesmo
 * padrão de modelos.ts (escolherComplexidade), que ela substitui como
 * fonte de classe de tarefa mais granular (complexidade continua existindo
 * como um EIXO separado, não uma classe).
 */

export type ClasseTarefa =
  | "SIMPLE_CLASSIFICATION"
  | "EXTRACTION"
  | "STRUCTURED_TRANSFORMATION"
  | "WEB_RESEARCH"
  | "REASONING"
  | "STRATEGY"
  | "COPYWRITING"
  | "CODE"
  | "COMPLEX_PLANNING"
  | "FINAL_SYNTHESIS"
  | "CONVERSATIONAL";

export type ResultadoClassificacao = {
  classe: ClasseTarefa;
  /** true = decidido por regra determinística; false nunca deveria acontecer nesta função (ela É o caminho determinístico) — existe só pra deixar auditável que NENHUMA classificação aqui gastou modelo. */
  deterministico: true;
  motivo: string;
};

const REGRAS: Array<[ClasseTarefa, RegExp]> = [
  ["COMPLEX_PLANNING", /\bplano\b|\bplaneja|arquitetura|estrutura da campanha|passo a passo completo/i],
  ["STRATEGY", /estrat[ée]gia|prioriza|decidir entre|vale a pena|compare|compara\b/i],
  ["REASONING", /por que|porque|analis|diagn[óo]stico|audita/i],
  ["FINAL_SYNTHESIS", /s[íi]ntese|resumo final|recomenda[çc][ãa]o final|conclus[ãa]o geral/i],
  ["COPYWRITING", /abordagem comercial|copy|texto de venda|mensagem de vendas|escrever.*mensagem/i],
  ["CODE", /c[óo]digo|function\s|script|debug|refatora/i],
  ["WEB_RESEARCH", /pesquis|busca na web|instagram|site p[úu]blico/i],
  ["EXTRACTION", /extrai|extract|encontre o (nome|telefone|email)/i],
  ["STRUCTURED_TRANSFORMATION", /json|estrutura(r|do)|formata|transforma em/i],
  ["SIMPLE_CLASSIFICATION", /classifica|categoriza|é (sim ou n[ãa]o|verdadeiro ou falso)/i],
];

/**
 * `contexto` é um rótulo opcional de quem chama (ex: "gerar_plano",
 * "compor_resposta") — quando o texto livre não bate nenhuma regra, o
 * rótulo do CHAMADOR ainda decide algo determinístico em vez de cair num
 * "CONVERSATIONAL" genérico errado.
 */
const CLASSE_POR_OPERACAO: Record<string, ClasseTarefa> = {
  gerar_plano: "COMPLEX_PLANNING",
  interpretar_resultado: "SIMPLE_CLASSIFICATION",
  decidir_proximo_passo: "SIMPLE_CLASSIFICATION",
  compor_resposta: "CONVERSATIONAL",
  copy: "COPYWRITING",
};

export function classificarTarefa(textoOuOperacao: string, contextoOperacao?: string): ResultadoClassificacao {
  const t = textoOuOperacao.toLowerCase();
  for (const [classe, re] of REGRAS) {
    if (re.test(t)) return { classe, deterministico: true, motivo: `padrão textual bateu com ${classe}` };
  }
  if (contextoOperacao && CLASSE_POR_OPERACAO[contextoOperacao]) {
    return { classe: CLASSE_POR_OPERACAO[contextoOperacao], deterministico: true, motivo: `operação conhecida (${contextoOperacao})` };
  }
  return { classe: "CONVERSATIONAL", deterministico: true, motivo: "nenhum padrão bateu — padrão seguro conversacional" };
}
