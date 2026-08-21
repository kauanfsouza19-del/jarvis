/**
 * Roteador determinístico: mensagem → tarefa executável ou follow-up sobre
 * resultado existente. Zero chamada de modelo — regex e o que já foi
 * resolvido pelo motor de contexto, igual ao resto do Cost Engine.
 *
 * Função pura, testável sem servidor de pé.
 */

import { extrairSinaisProspeccao, normalizar, type ContextoResolvido } from "../contexto/resolver.ts";

/** Rótulo plural de exibição por vertical — mesma lista usada no formulário de prospecção. */
export const ROTULO_PLURAL_VERTICAL: Record<string, string> = {
  delivery_pizzaria: "pizzarias",
  delivery_hamburgueria: "hamburguerias",
  delivery_acaiteria: "açaiterias",
  delivery_esfiharia: "esfiharias",
  delivery_lanchonete: "lanchonetes",
  delivery_restaurante: "restaurantes",
  ecommerce: "e-commerces",
  locatta_corretor: "corretores/imobiliárias",
};

export type ComandoProspeccao = {
  tipo: "prospeccao";
  vertical: string | null;
  /** Rótulo de exibição quando `vertical` é livre (fora do enum fechado) — null quando é um vertical conhecido (usa ROTULO_PLURAL_VERTICAL). */
  rotuloVertical: string | null;
  localizacao: string | null;
  quantidade: number;
};

export function detectarComandoDeTarefa(texto: string, resolvido: ContextoResolvido): ComandoProspeccao | null {
  if (resolvido.intencao !== "PROSPECCAO") return null;

  const sinais = extrairSinaisProspeccao(texto);
  const qtdMatch = /\b(\d{1,4})\b/.exec(texto);
  return {
    tipo: "prospeccao",
    vertical: sinais.vertical,
    rotuloVertical: sinais.rotuloVertical,
    localizacao: sinais.localizacao,
    quantidade: qtdMatch ? Math.min(200, parseInt(qtdMatch[1], 10)) : 25,
  };
}

/** Rótulo plural pra exibir — conhecido usa o mapa, livre usa a própria frase que o Cacique escreveu. */
export function rotuloDeVertical(vertical: string | null, rotuloVertical: string | null): string {
  if (rotuloVertical) return rotuloVertical;
  if (vertical && ROTULO_PLURAL_VERTICAL[vertical]) return ROTULO_PLURAL_VERTICAL[vertical];
  return "negócios";
}

export type FiltroFollowUp = {
  comWhatsapp?: boolean;
  comTelefone?: boolean;
  /** Só negócios nesta cidade/região — string livre, comparação exata contra prospects.cidade. */
  cidade?: string;
  scoreMin?: number;
  limite?: number;
  /** Sem filtro nenhum — só quer ver de novo o que já existe (ex: pedir download). */
  apenasExibir?: boolean;
};

// "só"/"apenas" sozinhos são comuns demais em português pra virar gatilho
// (apareceriam em qualquer frase casual) — ficam de fora de propósito;
// "remov"/"exclu"/"filtr" já são específicos o bastante sem esse risco.
const PALAVRAS_DE_RESULTADO =
  /\b(mostra|lista|lead|prospect|resultado|melhor|melhores|baixa|baixar|download|csv|excel|xlsx|planilha|remov|exclu|filtr)\b/;

export function detectarFollowUp(texto: string): FiltroFollowUp | null {
  const t = normalizar(texto);
  if (!PALAVRAS_DE_RESULTADO.test(t)) return null;

  const filtro: FiltroFollowUp = {};
  if (/\bwhatsapp\b/.test(t)) filtro.comWhatsapp = true;
  if (/\btelefone\b|\bfone\b/.test(t)) filtro.comTelefone = true;

  // Localização — mesmo padrão de contexto/resolver.ts extrairLocalizacao,
  // aplicado ao texto ORIGINAL (não normalizado) pra preservar a
  // capitalização que identifica o nome próprio ("Alphaville", não
  // "alphaville" já perdido no `t` normalizado).
  const local = /\b(?:em|na regi[aã]o de|na cidade de)\s+([A-ZÀ-Ú][\wÀ-ú]*(?:\s+[A-ZÀ-Ú][\wÀ-ú]*){0,2})/.exec(texto);
  if (local) filtro.cidade = local[1].trim();

  const numero = /\b(\d{1,3})\b/.exec(t);
  if (/melhor/.test(t) && numero) {
    filtro.limite = parseInt(numero[1], 10);
  }

  if (Object.keys(filtro).length === 0) {
    // "baixa a lista" / "mostra o resultado" — sem filtro específico, só
    // quer ver/baixar de novo o que já existe.
    filtro.apenasExibir = true;
  }

  return filtro;
}
