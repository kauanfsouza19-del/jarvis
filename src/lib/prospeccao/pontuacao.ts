/**
 * Motor de pontuação de prospect — função pura, sem I/O, sem modelo.
 *
 * Regra que governa cada fator: só entra o que foi OBSERVADO. Sem dado de
 * porte/faturamento/avaliações (isso vem da API do Google Places, ainda não
 * conectada), o fator "porte" fica marcado como AUSENTE em vez de chutado —
 * `fatoresAusentes` existe justamente para o motor nunca fingir que sabe mais
 * do que sabe. `contatabilidade` é UM fator entre vários, nunca o único.
 */

export type EntradaPontuacao = {
  vertical: string;
  /** Canais de contato observados — cada um é um fato, não estimativa. */
  temWebsite: boolean;
  temWhatsapp: boolean;
  temInstagram: boolean;
  temEmail: boolean;
  temTelefone: boolean;
  /** null = não verificado ainda (sem diagnóstico de site rodado). */
  temMetaPixel: boolean | null;
  temGtm: boolean | null;
  temGa4: boolean | null;
  viewportMobile: boolean | null;
  plataformaEcommerce: string | null;
  cnpjEncontrado: boolean;
};

export type ClassificacaoOportunidade = "HOT" | "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";

/**
 * Limiares configuráveis — fora da lógica de negócio de propósito (Fase de
 * Prospecção Comercial, item "o score deve ser configurável em vez de
 * enterrado na lógica de negócio"). Mudar o corte de HOT não deveria exigir
 * ler `pontuarProspect` inteira pra achar o número mágico.
 */
export const LIMIARES_OPORTUNIDADE: Record<Exclude<ClassificacaoOportunidade, "UNKNOWN">, number> = {
  HOT: 70,
  HIGH: 50,
  MEDIUM: 30,
  LOW: 0,
};

/** Abaixo disto, poucos canais observados o bastante pra classificar com confiança — UNKNOWN, nunca um chute com nome de classificação forte. */
const MINIMO_FATORES_OBSERVADOS_PARA_CLASSIFICAR = 1;

export type ResultadoPontuacao = {
  score: number;
  motivos: string[];
  /** Subconjunto de `motivos` que jogou a favor do prospect (site, tracking já presente, CNPJ...). */
  fatoresPositivos: string[];
  /** Subconjunto de `motivos` que é dor/ausência observada — a oportunidade em si. */
  fatoresNegativos: string[];
  oportunidades: string[];
  contatabilidade: number;
  /** Fatores do modelo de negócio (impacto, porte, demanda) sem dado hoje. */
  fatoresAusentes: string[];
  classificacao: ClassificacaoOportunidade;
  /** Quão bem observado está este prospect — poucos sinais reais = confiança baixa, mesmo com score alto. */
  confianca: "alta" | "media" | "baixa";
};

const CANAIS: Array<[keyof EntradaPontuacao, string]> = [
  ["temWebsite", "site"],
  ["temWhatsapp", "WhatsApp"],
  ["temInstagram", "Instagram"],
  ["temEmail", "e-mail"],
  ["temTelefone", "telefone"],
];

export function pontuarProspect(e: EntradaPontuacao): ResultadoPontuacao {
  const motivos: string[] = [];
  const fatoresPositivos: string[] = [];
  const fatoresNegativos: string[] = [];
  const oportunidades: string[] = [];
  let score = 0;
  let fatoresObservados = 0; // sinais que exigiram diagnóstico real (não só cadastro) — base da confiança

  const positivo = (m: string) => {
    motivos.push(m);
    fatoresPositivos.push(m);
  };
  const negativo = (m: string) => {
    motivos.push(m);
    fatoresNegativos.push(m);
  };

  /* ── contatabilidade — 1 de vários fatores, nunca o único ── */
  const canaisPresentes = CANAIS.filter(([campo]) => e[campo]).length;
  const contatabilidade = Math.max(1, Math.min(5, canaisPresentes + 1));
  score += contatabilidade * 4; // até 20 pontos

  /* ── presença digital de base ── */
  if (!e.temWebsite) {
    negativo("Sem site público encontrado — ausência digital observada.");
    oportunidades.push("website_lp");
    score += 8; // dor real, oportunidade clara de LP/site
  } else {
    score += 12;
    positivo("Site público encontrado.");
  }

  /* ── maturidade de rastreamento — ausência em site existente é oportunidade forte ── */
  if (e.temWebsite && e.temMetaPixel === false && e.temGtm === false && e.temGa4 === false) {
    negativo("Site existe mas não encontrei Meta Pixel, GTM nem GA4 na página carregada.");
    oportunidades.push("meta_ads");
    oportunidades.push("google_ads");
    score += 18;
    fatoresObservados++;
  } else if (e.temWebsite && (e.temMetaPixel || e.temGtm || e.temGa4)) {
    positivo("Rastreamento de anúncio já presente no site — maturidade de mídia paga maior.");
    score += 6;
    fatoresObservados++;
  }

  /* ── mobile ── */
  if (e.temWebsite && e.viewportMobile === false) {
    negativo("Site sem meta viewport — provável experiência ruim em celular.");
    oportunidades.push("website_lp");
    score += 10;
    fatoresObservados++;
  }

  /* ── e-commerce ── */
  if (e.plataformaEcommerce) {
    positivo(`Plataforma de e-commerce detectada: ${e.plataformaEcommerce}.`);
    if (e.temMetaPixel === false && e.temGtm === false) {
      oportunidades.push("remarketing");
      score += 8;
    }
  }

  /* ── CNPJ público ── */
  if (e.cnpjEncontrado) {
    score += 4;
    positivo("CNPJ público localizado — abordagem formal possível.");
  }

  if (!oportunidades.includes("crm") && canaisPresentes >= 3) {
    oportunidades.push("crm");
  }

  const fatoresAusentes = [
    "porte do negócio (faturamento estimado) — requer Google Places API",
    "volume e nota de avaliações — requer Google Places API",
    "evidência de anúncio ativo — requer biblioteca de anúncios",
  ];

  const scoreFinal = Math.max(0, Math.min(100, Math.round(score)));

  // Confiança nunca é sobre o SCORE, é sobre QUANTO FOI OBSERVADO pra
  // chegar nele — um score alto sobre um único sinal (só "tem site") vale
  // menos do que o mesmo score sustentado por diagnóstico de site real.
  const confianca: ResultadoPontuacao["confianca"] = !e.temWebsite ? "media" : fatoresObservados >= 2 ? "alta" : fatoresObservados >= 1 ? "media" : "baixa";

  // Classificação é sempre UNKNOWN quando não há sinal real o bastante pra
  // sustentar HOT/HIGH/MEDIUM/LOW — nunca finge saber a partir de score
  // vazio (prospect sem diagnóstico nenhum rodado ainda).
  let classificacao: ClassificacaoOportunidade = "UNKNOWN";
  if (fatoresObservados >= MINIMO_FATORES_OBSERVADOS_PARA_CLASSIFICAR || e.temWebsite || canaisPresentes > 0) {
    if (scoreFinal >= LIMIARES_OPORTUNIDADE.HOT) classificacao = "HOT";
    else if (scoreFinal >= LIMIARES_OPORTUNIDADE.HIGH) classificacao = "HIGH";
    else if (scoreFinal >= LIMIARES_OPORTUNIDADE.MEDIUM) classificacao = "MEDIUM";
    else classificacao = "LOW";
  }

  return {
    score: scoreFinal,
    motivos,
    fatoresPositivos,
    fatoresNegativos,
    oportunidades: [...new Set(oportunidades)],
    contatabilidade,
    fatoresAusentes,
    classificacao,
    confianca,
  };
}

/** Deduplicação — nunca o mesmo negócio quatro vezes com nome levemente diferente. */
export function chaveDeduplicacao(e: {
  placeId?: string | null;
  cnpj?: string | null;
  website?: string | null;
  telefone?: string | null;
  negocio: string;
}): string {
  if (e.placeId) return `place:${e.placeId}`;
  if (e.cnpj) return `cnpj:${e.cnpj.replace(/\D/g, "")}`;
  if (e.website) {
    try {
      const host = new URL(normalizarParaUrl(e.website)).hostname.replace(/^www\./, "");
      return `dominio:${host}`;
    } catch {
      /* segue para os próximos critérios */
    }
  }
  if (e.telefone) return `telefone:${e.telefone.replace(/\D/g, "")}`;
  return `nome:${normalizarNome(e.negocio)}`;
}

function normalizarParaUrl(u: string): string {
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}

function normalizarNome(n: string): string {
  return n
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}
