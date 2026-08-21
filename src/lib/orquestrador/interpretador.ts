/**
 * Interpretação de comando derivado — a fronteira entre "nova descoberta"
 * (cara, dispara Playwright/Places pra achar negócio novo) e "operação sobre
 * resultado que já existe" (barata, opera em cima do que a conversa já tem).
 *
 * Função pura, sem servidor, sem modelo — vocabulário fechado por operação,
 * nunca string matching solto no meio da lógica de negócio. Quando nada
 * bate, devolve null: quem chama decide o que fazer (hoje, cai pro chat
 * normal) — nunca inventa uma operação por chute.
 *
 * Isto NÃO decide se dispara descoberta nova: quem decide isso é
 * detectarComandoDeTarefa (verbo de busca + tipo de negócio). Este módulo
 * só entra em jogo depois que aquele já disse "não é descoberta nova" —
 * ver orquestrador/planejador.ts, onde os dois são consultados em ordem.
 */

import { normalizar } from "../contexto/resolver.ts";

export type TipoOperacaoDerivada = "ENRIQUECER" | "ANALISAR_MARKETING" | "PONTUAR" | "GERAR_ABORDAGEM";

export type InterpretacaoComandoDerivado = {
  operacao: TipoOperacaoDerivada;
  objetivo: string;
  /** Só usado por ENRIQUECER — vazio = conjunto padrão (instagram, whatsapp, telefone, email, facebook). */
  camposSolicitados: string[];
  /** "as 10 melhores" — filtra o resultado de origem ANTES de aplicar a operação. null = usa o resultado inteiro. */
  limite: number | null;
  confianca: "ALTA" | "MEDIA";
};

const CAMPOS_ENRIQUECIMENTO: Array<[string, RegExp]> = [
  ["instagram", /\binstagram\b/],
  ["whatsapp", /\bwhatsapp\b/],
  ["telefone", /\btelefone|\bfone\b|\bcelular\b/],
  ["email", /\be-?mail\b/],
  ["facebook", /\bfacebook\b/],
  ["site", /\bsite\b|\bwebsite\b/],
];

const GATILHO_ABORDAGEM =
  /\babordagem\w*|\bmensage\w*\s+(personalizad\w*|de\s+venda|comercial)|\bprepar\w*\s+uma\s+mensage\w*|\bcri\w*\s+uma\s+mensage\w*|\bcopy\s+(de\s+venda|comercial)/;

const GATILHO_MARKETING =
  /\bmarketing\s+digital\b|\banunci\w*|\ban[uú]ncio\w*|\bpixel\b|\bmeta\s+ads\b|\bgoogle\s+ads\b|\btr[aá]fego\s+pago\b|\bpublicidade\b|\binvest\w*\s+em\s+(an[uú]ncio|m[ií]dia|tr[aá]fego)/;

const GATILHO_PONTUACAO = /\bpontu\w*|\breclassifi\w*|\breavali\w*|\bre-?score\b/;

const GATILHO_ENRIQUECIMENTO = /\benriquec\w*|\bpesquis\w*\s+(o\s+)?instagram|\bcompleta\w*\s+(o\s+)?cadastro|\bcoleta\w*\s+(contato|telefone|email|instagram)/;

/** "mostra"/"lista"/"só"/"apenas"/"filtra" — sinal de FILTRO sobre o que já existe, nunca de coleta nova. */
const GATILHO_FILTRO = /\bmostra|\blista|\bapenas\b|\bs[oó]\s+(o|a|os|as)\b|\bfiltr\w*|\bexib\w*/;

/** "as 10 melhores" / "os 5 melhores" — mesmo padrão que detectarFollowUp usa, reaproveitado aqui. */
function extrairLimite(t: string): number | null {
  const numero = /\b(\d{1,3})\b/.exec(t);
  if (/melhor/.test(t) && numero) return parseInt(numero[1], 10);
  return null;
}

function camposDoTexto(t: string): string[] {
  return CAMPOS_ENRIQUECIMENTO.filter(([, re]) => re.test(t)).map(([campo]) => campo);
}

/**
 * Interpreta um comando que se refere a um resultado JÁ EXISTENTE — nunca
 * decide sozinho SE existe resultado anterior (quem chama, com a
 * conversa em mãos, checa isso e ignora o retorno se não houver nada pra
 * operar em cima). Ordem de checagem é por especificidade: abordagem e
 * marketing são vocabulário mais específico que "enriquecer" genérico.
 */
export function interpretarComandoDerivado(textoOriginal: string): InterpretacaoComandoDerivado | null {
  const t = normalizar(textoOriginal);
  const limite = extrairLimite(t);

  if (GATILHO_ABORDAGEM.test(t)) {
    return { operacao: "GERAR_ABORDAGEM", objetivo: textoOriginal, camposSolicitados: [], limite, confianca: "ALTA" };
  }
  if (GATILHO_MARKETING.test(t)) {
    return { operacao: "ANALISAR_MARKETING", objetivo: textoOriginal, camposSolicitados: [], limite, confianca: "ALTA" };
  }
  if (GATILHO_PONTUACAO.test(t)) {
    return { operacao: "PONTUAR", objetivo: textoOriginal, camposSolicitados: [], limite, confianca: "ALTA" };
  }
  // "Mostra só os com telefone" é FILTRO sobre o que já existe, não pedido
  // pra coletar telefone novo — achado testando de verdade: só mencionar
  // "telefone"/"instagram" bastava pra virar ENRIQUECER antes desta
  // checagem, sequestrando o follow-up de filtro simples (detectarFollowUp,
  // mais barato, nunca cria job). Só cai em ENRIQUECER pelo campo sozinho
  // quando NÃO tem verbo de filtro/exibição junto.
  const campos = camposDoTexto(t);
  const pareceFiltroOuExibicao = GATILHO_FILTRO.test(t);
  if (GATILHO_ENRIQUECIMENTO.test(t) || (campos.length > 0 && !pareceFiltroOuExibicao)) {
    return {
      operacao: "ENRIQUECER",
      objetivo: textoOriginal,
      camposSolicitados: campos,
      limite,
      confianca: GATILHO_ENRIQUECIMENTO.test(t) ? "ALTA" : "MEDIA",
    };
  }
  return null;
}

/**
 * Validação antes de virar Plano — hoje a interpretação é 100% determinística
 * (nunca sai de um LLM), mas a fronteira existe do mesmo jeito: nenhuma
 * interpretação vira passo de Plano sem passar por aqui, e é o mesmo lugar
 * que absorveria uma interpretação por modelo no futuro sem o Orquestrador
 * mudar de forma.
 */
export function validarInterpretacaoDerivada(v: unknown): InterpretacaoComandoDerivado {
  if (typeof v !== "object" || v === null) throw new Error("interpretação derivada não é um objeto");
  const o = v as Record<string, unknown>;
  const operacoesValidas: TipoOperacaoDerivada[] = ["ENRIQUECER", "ANALISAR_MARKETING", "PONTUAR", "GERAR_ABORDAGEM"];
  if (typeof o.operacao !== "string" || !operacoesValidas.includes(o.operacao as TipoOperacaoDerivada)) {
    throw new Error("operação derivada inválida ou fora do vocabulário fechado");
  }
  if (typeof o.objetivo !== "string" || !o.objetivo.trim()) throw new Error("interpretação derivada sem objetivo");
  const camposSolicitados = Array.isArray(o.camposSolicitados) ? o.camposSolicitados.filter((c): c is string => typeof c === "string") : [];
  const limite = typeof o.limite === "number" && o.limite > 0 ? Math.min(500, Math.round(o.limite)) : null;
  const confianca = o.confianca === "ALTA" ? "ALTA" : "MEDIA";
  return { operacao: o.operacao as TipoOperacaoDerivada, objetivo: o.objetivo, camposSolicitados, limite, confianca };
}
