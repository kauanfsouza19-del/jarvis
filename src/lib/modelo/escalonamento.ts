/**
 * Níveis de escalonamento de validação cruzada (Fase 9, seção 6) — função
 * pura, sem "server-only", sem I/O — separada de validacao-cruzada.ts (que
 * PRECISA de server-only pra chamar modelo de verdade) só pra continuar
 * testável direto, mesmo padrão de validacao.ts/registro.ts/sintese.ts.
 *
 *   0 — só determinístico, nenhuma chamada de modelo.
 *   1 — um modelo, sem segunda opinião (caso comum).
 *   2 — segundo modelo SÓ quando justificado: alto impacto, confiança
 *       baixa, divergência entre determinístico e modelo, saída
 *       estruturalmente suspeita, ou política de segurança exige.
 *   3 — síntese multi-modelo — só pra decisão genuinamente complexa/de
 *       alto valor (nunca o padrão).
 *
 * Aviso explícito da fase citado aqui de propósito: "JARVIS não deve virar
 * um sistema que gasta dinheiro perguntando a mesma coisa simples pra cinco
 * IAs" — por isso o nível 1 é o padrão, e subir de nível sempre exige um
 * sinal concreto, nunca "por precaução".
 */
export type SinaisEscalonamento = {
  altoImpacto?: boolean; // ex: decisão financeira, comunicação externa, plano com nivelRisco alto
  confiancaBaixa?: boolean; // confianca da DecisaoRoteamento < ~0.7, ou pontuação de prospect "baixa"
  divergenciaDeterministicoModelo?: boolean; // heurística determinística e resposta do modelo discordam
  saidaEstruturalmenteSuspeita?: boolean; // JSON malformado corrigido à força, campo vazio onde não devia
  politicaExigeSegundaOpiniao?: boolean; // ex: dado sensível, ação irreversível
  decisaoComplexaOuAltoValor?: boolean; // só isso pode justificar nível 3
};

export function decidirNivelEscalonamento(sinais: SinaisEscalonamento): { nivel: 0 | 1 | 2 | 3; motivo: string } {
  if (sinais.decisaoComplexaOuAltoValor) {
    return { nivel: 3, motivo: "Decisão complexa/alto valor — síntese multi-modelo justificada." };
  }
  const gatilhosNivel2 = [
    sinais.altoImpacto && "alto impacto",
    sinais.confiancaBaixa && "confiança baixa",
    sinais.divergenciaDeterministicoModelo && "divergência determinístico×modelo",
    sinais.saidaEstruturalmenteSuspeita && "saída estruturalmente suspeita",
    sinais.politicaExigeSegundaOpiniao && "política de segurança",
  ].filter((x): x is string => Boolean(x));
  if (gatilhosNivel2.length > 0) {
    return { nivel: 2, motivo: `Segunda opinião justificada por: ${gatilhosNivel2.join(", ")}.` };
  }
  return { nivel: 1, motivo: "Nenhum sinal de risco — um modelo é suficiente, sem custo extra." };
}
