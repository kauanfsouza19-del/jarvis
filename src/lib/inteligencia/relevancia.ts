/**
 * Pontuação de relevância (Fase 13) — determinística, explicável, nunca
 * "entendimento semântico" fingido. Três sinais reais, cada um com peso
 * declarado: palavra-chave configurada (Rule 7), recência, confiabilidade
 * da fonte. Função pura, sem I/O.
 */

export type Interesse = { termo: string; peso: number };
export type PrioridadeItem = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export type ResultadoRelevancia = {
  score: number; // 0-1
  prioridade: PrioridadeItem;
  motivo: string; // sempre explicável — nunca "a IA achou relevante"
  interessesCorrespondidos: string[];
};

const PESO_PALAVRA_CHAVE = 0.6;
const PESO_RECENCIA = 0.25;
const PESO_CONFIABILIDADE_FONTE = 0.15;
const JANELA_RECENCIA_DIAS = 14;

function pontuarPalavrasChave(texto: string, interesses: Interesse[]): { score: number; correspondidos: string[] } {
  const alvo = texto.toLowerCase();
  const correspondidos: Interesse[] = interesses.filter((i) => alvo.includes(i.termo.toLowerCase()));
  if (correspondidos.length === 0) return { score: 0, correspondidos: [] };

  const somaPesos = correspondidos.reduce((s, i) => s + i.peso, 0);
  const maxRazoavel = 5 * 3; // 3 termos de peso máximo (5) já é sinal forte o bastante — nunca precisa de mais pra saturar
  return { score: Math.min(1, somaPesos / maxRazoavel), correspondidos: correspondidos.map((i) => i.termo) };
}

function pontuarRecencia(publicadoEm: string | null): number {
  if (!publicadoEm) return 0.3; // sem data, nem penaliza nem beneficia — neutro
  const t = Date.parse(publicadoEm);
  if (Number.isNaN(t)) return 0.3;
  const diasAtras = (Date.now() - t) / 86_400_000;
  if (diasAtras < 0) return 1; // publicado "no futuro" (fuso/relógio) — trata como recente, nunca quebra
  return Math.max(0, 1 - diasAtras / JANELA_RECENCIA_DIAS);
}

function prioridadeParaScore(score: number): PrioridadeItem {
  if (score >= 0.75) return "CRITICAL";
  if (score >= 0.5) return "HIGH";
  if (score >= 0.25) return "MEDIUM";
  return "LOW";
}

export function calcularRelevancia(
  item: { titulo: string; resumo: string; publicadoEm: string | null },
  interesses: Interesse[],
  confiabilidadeFonte: number,
): ResultadoRelevancia {
  const { score: scorePalavras, correspondidos } = pontuarPalavrasChave(`${item.titulo} ${item.resumo}`, interesses);
  const scoreRecencia = pontuarRecencia(item.publicadoEm);
  const scoreFonte = Math.max(0, Math.min(1, confiabilidadeFonte));

  const score = scorePalavras * PESO_PALAVRA_CHAVE + scoreRecencia * PESO_RECENCIA + scoreFonte * PESO_CONFIABILIDADE_FONTE;
  const prioridade = prioridadeParaScore(score);

  const motivo =
    correspondidos.length > 0
      ? `Corresponde a interesse(s): ${correspondidos.join(", ")}. Recência ${(scoreRecencia * 100).toFixed(0)}%, confiabilidade da fonte ${(scoreFonte * 100).toFixed(0)}%.`
      : `Nenhum interesse configurado corresponde — pontuação só de recência (${(scoreRecencia * 100).toFixed(0)}%) e confiabilidade da fonte (${(scoreFonte * 100).toFixed(0)}%).`;

  return { score: Number(score.toFixed(3)), prioridade, motivo, interessesCorrespondidos: correspondidos };
}
