import type { NivelEvidencia } from "../prospeccao/inteligencia";

/**
 * Motor de síntese cross-model (Fase 9, seção 7) — função pura, sem I/O,
 * sem "server-only": normaliza -> concordância -> divergência -> alegação
 * sem suporte -> ranking de evidência -> síntese final. Reaproveita o MESMO
 * vocabulário FATO/OBSERVACAO/INFERENCIA/DESCONHECIDO já usado em
 * prospeccao/inteligencia.ts (instrução explícita da fase) em vez de criar
 * um segundo sistema de confiança paralelo.
 *
 * Nunca vira uma "inferência" em "fato": a síntese final carrega o menor
 * nível de evidência entre as fontes que concordam, nunca o maior.
 */

export type FonteSintese = {
  origem: string; // ex: "modelo:claude-sonnet-5", "determinístico:pontuacao", "evidencia:site"
  afirmacao: string;
  nivel: NivelEvidencia;
  /**
   * Chave de TEMA opcional — quando duas fontes tratam da MESMA pergunta
   * (ex: "endereço", "melhor ângulo de venda"), o chamador marca a mesma
   * chaveTema nas duas. Sem isso, comparação é só por texto normalizado
   * idêntico (nunca por embedding/LLM — mantém o motor determinístico e
   * barato). É essa chave que permite detectar DIVERGÊNCIA real (mesmo
   * tema, resposta diferente) em vez de só "concordância por coincidência
   * de texto".
   */
  chaveTema?: string;
};

export type ResultadoSintese = {
  concordancias: string[];
  divergencias: Array<{ tema: string; respostas: Array<{ afirmacao: string; origem: string }> }>;
  alegacoesSemSuporte: string[];
  sintese: string;
  nivelFinal: NivelEvidencia;
};

// Ordem de força — FATO é o mais forte, DESCONHECIDO o mais fraco. Usada
// pra "nunca promover inferência a fato": o nível final da síntese nunca é
// mais forte que o mais fraco entre as fontes que efetivamente concordam.
const FORCA: Record<NivelEvidencia, number> = { FATO: 3, OBSERVACAO: 2, INFERENCIA: 1, DESCONHECIDO: 0 };

function normalizar(texto: string): string {
  return texto.toLowerCase().trim().replace(/\s+/g, " ").replace(/[.,;!?]+$/, "");
}

export function sintetizar(fontes: FonteSintese[]): ResultadoSintese {
  // 1) Concordância/divergência por TEXTO (sem chaveTema): agrupa por
  //    afirmação normalizada idêntica — grupo com >1 fonte é concordância.
  const gruposPorTexto = new Map<string, typeof fontes>();
  for (const f of fontes) {
    const chave = normalizar(f.afirmacao);
    const lista = gruposPorTexto.get(chave) ?? [];
    lista.push(f);
    gruposPorTexto.set(chave, lista);
  }

  const concordancias: string[] = [];
  const alegacoesSemSuporte: string[] = [];
  let nivelMaisFraco: NivelEvidencia = fontes.length > 0 ? "FATO" : "DESCONHECIDO";

  for (const [, grupo] of gruposPorTexto) {
    const nivelMinimoDoGrupo = grupo.reduce<NivelEvidencia>((min, f) => (FORCA[f.nivel] < FORCA[min] ? f.nivel : min), "FATO");
    if (grupo.length > 1) {
      if (FORCA[nivelMinimoDoGrupo] < FORCA[nivelMaisFraco]) nivelMaisFraco = nivelMinimoDoGrupo;
      concordancias.push(`${grupo.length} fonte(s) concordam: "${grupo[0].afirmacao}" (${grupo.map((g) => g.origem).join(", ")}).`);
    }
  }

  // 2) Divergência real, por TEMA: mesma chaveTema, texto normalizado
  //    diferente entre fontes distintas — nunca escolhido um vencedor
  //    silenciosamente (mesmo princípio de "conflitante" da Fase 5/6).
  const gruposPorTema = new Map<string, typeof fontes>();
  for (const f of fontes) {
    if (!f.chaveTema) continue;
    const lista = gruposPorTema.get(f.chaveTema) ?? [];
    lista.push(f);
    gruposPorTema.set(f.chaveTema, lista);
  }
  const divergencias: ResultadoSintese["divergencias"] = [];
  for (const [tema, grupo] of gruposPorTema) {
    const textosDistintos = new Set(grupo.map((f) => normalizar(f.afirmacao)));
    if (textosDistintos.size > 1) {
      divergencias.push({ tema, respostas: grupo.map((f) => ({ afirmacao: f.afirmacao, origem: f.origem })) });
    }
  }

  // 3) Alegação sem suporte: fonte ÚNICA (sem chaveTema compartilhada e sem
  //    concordância textual) em nível INFERENCIA/DESCONHECIDO.
  for (const [, grupo] of gruposPorTexto) {
    if (grupo.length === 1 && (grupo[0].nivel === "INFERENCIA" || grupo[0].nivel === "DESCONHECIDO")) {
      alegacoesSemSuporte.push(`Fonte única, nível ${grupo[0].nivel}: "${grupo[0].afirmacao}" (${grupo[0].origem}) — sem segunda fonte confirmando.`);
    }
  }

  const nivelFinal = divergencias.length > 0 ? "INFERENCIA" : nivelMaisFraco; // divergência nunca vira FATO — rebaixa a síntese automaticamente
  const sintese =
    fontes.length === 0
      ? "Nenhuma fonte disponível para sintetizar."
      : divergencias.length > 0
        ? `${divergencias.length} divergência(s) real(is) encontrada(s) entre fontes — reportadas, nunca resolvidas escolhendo uma vencedora sozinho.`
        : concordancias.length > 0
          ? `${concordancias.length} ponto(s) de concordância entre fontes; nível de evidência da síntese: ${nivelFinal} (o mais fraco entre as fontes que concordam — nunca promovido).`
          : `Nenhuma concordância entre fontes — ${fontes.length} afirmação(ões) isolada(s), nível de evidência ${nivelFinal}.`;

  return { concordancias, divergencias, alegacoesSemSuporte, sintese, nivelFinal };
}
