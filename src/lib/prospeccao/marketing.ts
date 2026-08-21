import type { SinaisSite } from "../pesquisa/navegador";

/**
 * Análise de sinal de marketing — traduz o que foi OBSERVADO numa página
 * carregada em linguagem de probabilidade, nunca de certeza. `SinaisSite`
 * já é honesto na origem ("temMetaPixel: false" = não achei o script agora,
 * não "essa empresa não anuncia") — este módulo só formaliza esse
 * vocabulário pra quem lê o resultado, com confiança e evidência por sinal.
 *
 * Função pura, sem I/O — recebe o que o navegador já observou.
 */

export type StatusSinal = "detectado" | "nao_detectado" | "inconclusivo";

export type SinalMarketing = {
  sinal: string;
  status: StatusSinal;
  evidencia: string;
  confianca: "alta" | "media" | "baixa";
};

export type RelatorioMarketing = {
  sinais: SinalMarketing[];
  /** Leitura agregada, sempre qualificada — nunca "não anuncia", só "não detectado com a evidência disponível". */
  resumo: string;
  /** true só quando pelo menos um sinal de rastreamento pago foi detectado com confiança alta. */
  provavelAtivoEmMidiaPaga: boolean;
};

export function analisarSinaisMarketing(sinais: SinaisSite): RelatorioMarketing {
  const lista: SinalMarketing[] = [];

  if (sinais.erro) {
    // Página não carregou — TODO sinal vira inconclusivo, nunca "não
    // detectado". "Não detectado" exige ter conseguido olhar a página.
    lista.push({
      sinal: "Meta Pixel",
      status: "inconclusivo",
      evidencia: `Página não carregou (${sinais.erro}) — sem evidência pra afirmar nada.`,
      confianca: "baixa",
    });
    lista.push({ sinal: "Google Ads / GTM", status: "inconclusivo", evidencia: "Página não carregou.", confianca: "baixa" });
    lista.push({ sinal: "GA4", status: "inconclusivo", evidencia: "Página não carregou.", confianca: "baixa" });
    return {
      sinais: lista,
      resumo: "Não foi possível avaliar sinais de marketing — o site não carregou na visita.",
      provavelAtivoEmMidiaPaga: false,
    };
  }

  lista.push({
    sinal: "Meta Pixel",
    status: sinais.temMetaPixel ? "detectado" : "nao_detectado",
    evidencia: sinais.temMetaPixel
      ? "Script do Facebook Pixel (fbevents.js / fbq) encontrado na página carregada."
      : "Nenhum script de Meta Pixel encontrado na página carregada agora.",
    confianca: "alta",
  });

  lista.push({
    sinal: "Google Tag Manager",
    status: sinais.temGtm ? "detectado" : "nao_detectado",
    evidencia: sinais.temGtm ? "Container do GTM encontrado na página." : "Nenhum container GTM encontrado na página carregada.",
    confianca: "alta",
  });

  lista.push({
    sinal: "Google Analytics 4",
    status: sinais.temGa4 ? "detectado" : "nao_detectado",
    evidencia: sinais.temGa4 ? "Tag gtag/GA4 encontrada na página." : "Nenhuma tag GA4 encontrada na página carregada.",
    confianca: "alta",
  });

  lista.push({
    sinal: "Infraestrutura de e-commerce",
    status: sinais.plataformaDetectada ? "detectado" : "nao_detectado",
    evidencia: sinais.plataformaDetectada
      ? `Plataforma identificada: ${sinais.plataformaDetectada}.`
      : "Nenhuma plataforma de e-commerce conhecida identificada.",
    confianca: "media",
  });

  // Anúncio ATIVO (campanha rodando agora) não é observável a partir do
  // site sozinho — só a INFRAESTRUTURA de rastreamento é. Isto fica
  // explícito em vez de virar uma quinta linha fingindo a mesma confiança.
  lista.push({
    sinal: "Campanha de anúncio ativa",
    status: "inconclusivo",
    evidencia: "Evidência de campanha ativa (não só o pixel de rastreamento) exigiria acesso à biblioteca de anúncios — indisponível nesta fase.",
    confianca: "baixa",
  });

  const pixelOuGtmDetectado = sinais.temMetaPixel || sinais.temGtm || sinais.temGa4;
  const resumo = pixelOuGtmDetectado
    ? "Infraestrutura de rastreamento de anúncio detectada no site — maturidade de mídia paga provável, mas campanha ativa não confirmada."
    : "Nenhuma infraestrutura de rastreamento de anúncio (Meta Pixel, GTM, GA4) detectada na página pública — sinal de baixa maturidade de mídia paga, não prova de ausência total.";

  return { sinais: lista, resumo, provavelAtivoEmMidiaPaga: pixelOuGtmDetectado };
}
