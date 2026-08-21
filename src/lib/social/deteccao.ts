/**
 * Detecção determinística de comando de conteúdo social (Fase 11) — mesmo
 * espírito de tarefas/roteador.ts (regex, zero custo de modelo, função pura
 * testável sem servidor). "Prepare 5 posts de Instagram sobre X" nunca
 * precisa de modelo pra virar um Plano — só precisa reconhecer o formato.
 */

export type ComandoConteudo = {
  tipo: "conteudo_social";
  quantidade: number;
  tema: string;
  plataforma: "instagram" | "facebook" | "whatsapp_status" | "linkedin" | "tiktok" | "outro";
  tipoConteudo: "post" | "reels" | "story" | "carrossel" | "video" | "texto" | "outro";
};

// Verbo de autoria + substantivo de conteúdo — as DUAS partes precisam
// aparecer, nunca só uma (evita falso positivo em "poste isso no grupo" ou
// "conteúdo do site", que não são pedido de GERAR conteúdo novo).
const VERBO_AUTORIA = /\b(prepar[ae]|cri[ae]|escrev[ae]|ger[ae]|produz[ai])/i;
const SUBSTANTIVO_CONTEUDO = /\b(post|posts|conte[uú]do|conte[uú]dos|legenda|legendas|reels?|stor(y|ies)|carross[eé]l)\b/i;

const PLATAFORMAS: Array<[ComandoConteudo["plataforma"], RegExp]> = [
  ["instagram", /\binstagram|\binsta\b|\big\b/i],
  ["facebook", /\bfacebook|\bface\b/i],
  ["whatsapp_status", /\bstatus (do )?whatsapp\b/i],
  ["linkedin", /\blinkedin\b/i],
  ["tiktok", /\btiktok\b/i],
];

const TIPOS: Array<[ComandoConteudo["tipoConteudo"], RegExp]> = [
  ["reels", /\breels?\b/i],
  ["story", /\bstor(y|ies)\b/i],
  ["carrossel", /\bcarross[eé]l\b/i],
  ["video", /\bv[ií]deo\b/i],
];

const MAX_QUANTIDADE = 20; // teto de custo — nunca gera uma quantidade absurda de rascunho numa tacada só

export function detectarComandoDeConteudo(texto: string): ComandoConteudo | null {
  if (!VERBO_AUTORIA.test(texto) || !SUBSTANTIVO_CONTEUDO.test(texto)) return null;

  const qtdMatch = /\b(\d{1,3})\b/.exec(texto);
  const quantidade = qtdMatch ? Math.min(MAX_QUANTIDADE, Math.max(1, parseInt(qtdMatch[1], 10))) : 1;

  const plataforma = PLATAFORMAS.find(([, re]) => re.test(texto))?.[0] ?? "instagram";
  const tipoConteudo = TIPOS.find(([, re]) => re.test(texto))?.[0] ?? "post";

  // Tema = o que vem depois de "sobre"/"a respeito de"/"falando de" — nunca
  // inventado; sem esse marcador, usa o texto inteiro higienizado depois
  // (ver ferramentas/registro.ts, que já higieniza tema externo).
  const temaMatch = /\bsobre\s+(.+?)(?:\.|$)/i.exec(texto) ?? /\ba respeito de\s+(.+?)(?:\.|$)/i.exec(texto);
  const tema = temaMatch ? temaMatch[1].trim() : texto.trim();

  return { tipo: "conteudo_social", quantidade, tema, plataforma, tipoConteudo };
}
