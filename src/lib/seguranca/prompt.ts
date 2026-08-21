/**
 * Higienização de texto de origem EXTERNA (nome de negócio achado em
 * descoberta pública, texto de site) antes de entrar num prompt de modelo.
 *
 * Nunca é a defesa principal — a defesa principal é a instrução explícita
 * no system prompt de quem chama, dizendo que texto externo é DADO, nunca
 * comando (ver modelo/anthropic.ts, comporResposta). Isto é defesa em
 * profundidade: reduz o quanto um nome de negócio malicioso (nome com
 * quebra de linha seguida de algo que parece instrução) consegue se
 * parecer com uma instrução de verdade — quebra de linha e caractere de
 * controle viram espaço, tamanho é limitado.
 */
const REGEX_CONTROLE = new RegExp("[" + String.fromCharCode(0) + "-" + String.fromCharCode(31) + String.fromCharCode(127) + "]", "g");

export function higienizarTextoExterno(texto: string, maxLen = 200): string {
  return texto
    .replace(REGEX_CONTROLE, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}
