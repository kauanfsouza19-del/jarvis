import type { Prospect } from "./repositorio";
import type { SinaisSite } from "../pesquisa/navegador";
import type { RelatorioMarketing } from "./marketing";
import type { SinaisInstagram } from "../pesquisa/instagram";

/**
 * Camada de Lead Intelligence (Fase 6) — função pura, sem I/O, que traduz o
 * que já foi coletado (prospect + sinais de site + relatório de marketing +
 * sinais de Instagram) em sinais estruturados de venda. A distinção
 * FATO/OBSERVAÇÃO/INFERÊNCIA/DESCONHECIDO é obrigatória (instrução
 * explícita da fase): FATO é o que foi observado sem interpretação,
 * OBSERVAÇÃO é uma leitura descritiva do que foi visto, INFERÊNCIA é uma
 * conclusão derivada (marcada como tal, nunca disfarçada de fato), e
 * DESCONHECIDO é o que o Jarvis genuinamente não sabe — sempre explícito,
 * nunca omitido silenciosamente.
 */

export type NivelEvidencia = "FATO" | "OBSERVACAO" | "INFERENCIA" | "DESCONHECIDO";

export type SinalLead = {
  rotulo: string;
  nivel: NivelEvidencia;
  detalhe: string;
};

export type AnguloVenda = { angulo: string; motivo: string };

/**
 * Vocabulário fechado de classificação de contato — nunca inferido além do
 * que a evidência sustenta. OWNER_VERIFIED exige confirmação forte (hoje,
 * nenhuma fonte deste sistema atinge esse padrão sozinha — ver relatório);
 * dado estruturado que o PRÓPRIO site declara sobre si (schema.org founder)
 * é OWNER_CLAIMED — o negócio afirma, o Jarvis não confirmou de fora.
 */
export type StatusContato = "OWNER_VERIFIED" | "OWNER_CLAIMED" | "PUBLIC_CONTACT" | "TEAM_MEMBER" | "UNVERIFIED_PERSON" | "UNKNOWN";

export function classificarContato(nome: string | null, cargo: string | null): StatusContato {
  if (!nome) return "UNKNOWN";
  if (cargo && /fundador|founder|propriet[aá]ri[oa]|\bdon[oa]\b|s[oó]ci[oa]/i.test(cargo)) return "OWNER_CLAIMED";
  if (cargo && /\bceo\b|diretor/i.test(cargo)) return "PUBLIC_CONTACT";
  return "UNVERIFIED_PERSON";
}

export function construirInteligenciaDeLead(
  p: Prospect,
  sinaisSite?: SinaisSite | null,
  marketing?: RelatorioMarketing | null,
  instagram?: SinaisInstagram | null,
): SinalLead[] {
  const sinais: SinalLead[] = [];

  // FATO — direto do que já está gravado/observado, sem leitura nenhuma em cima.
  if (p.whatsapp_publico) sinais.push({ rotulo: "WhatsApp público", nivel: "FATO", detalhe: `Link/número de WhatsApp encontrado: ${p.whatsapp_publico}.` });
  if (p.website) sinais.push({ rotulo: "Site próprio", nivel: "FATO", detalhe: `Prospect tem site cadastrado: ${p.website}.` });
  if (p.instagram) sinais.push({ rotulo: "Instagram cadastrado", nivel: "FATO", detalhe: `Perfil público conhecido: ${p.instagram}.` });
  if (marketing?.provavelAtivoEmMidiaPaga) {
    sinais.push({ rotulo: "Infraestrutura de rastreamento pago", nivel: "FATO", detalhe: "Meta Pixel, GTM ou GA4 detectado no site na visita mais recente." });
  }

  // OBSERVAÇÃO — leitura descritiva do que foi visto, ainda sem inferir motivo/consequência.
  if (sinaisSite && !sinaisSite.erro) {
    if (sinaisSite.tempoCarregamentoMs !== null) {
      sinais.push({ rotulo: "Tempo de carregamento", nivel: "OBSERVACAO", detalhe: `Site carregou em ${sinaisSite.tempoCarregamentoMs}ms na visita.` });
    }
    if (!sinaisSite.viewportMobile) {
      sinais.push({ rotulo: "Sem viewport mobile declarado", nivel: "OBSERVACAO", detalhe: "A página não declara meta viewport — layout pode não se adaptar a celular." });
    }
  }
  if (instagram?.perfilPublicoAcessivel) {
    sinais.push({
      rotulo: "Atividade pública no Instagram",
      nivel: "OBSERVACAO",
      detalhe: `Perfil público acessível: ${instagram.publicacoes ?? "?"} publicações, ${instagram.seguidores ?? "?"} seguidores.`,
    });
  }

  // INFERÊNCIA — conclusão derivada dos sinais acima, sempre rotulada como leitura, nunca fato.
  if (p.website && p.whatsapp_publico && marketing && !marketing.provavelAtivoEmMidiaPaga) {
    sinais.push({
      rotulo: "Oportunidade de mensuração",
      nivel: "INFERENCIA",
      detalhe: "Site e WhatsApp existem, mas nenhuma infraestrutura de rastreamento foi detectada — pode haver contato acontecendo sem nenhuma métrica de origem.",
    });
  }
  if (instagram?.perfilPublicoAcessivel && (!p.website || sinaisSite?.erro)) {
    sinais.push({
      rotulo: "Captação fora de site próprio",
      nivel: "INFERENCIA",
      detalhe: "Presença ativa no Instagram com site ausente ou inacessível — negócio pode depender principalmente da rede social pra captar cliente.",
    });
  }

  // DESCONHECIDO — sempre explícito, nunca omitido em silêncio.
  sinais.push({ rotulo: "Investimento em mídia paga", nivel: "DESCONHECIDO", detalhe: "Gasto de anúncio não é observável publicamente — infraestrutura de rastreamento é o máximo que dá pra confirmar de fora." });
  if (!p.contato_nome) {
    sinais.push({ rotulo: "Responsável pelo negócio", nivel: "DESCONHECIDO", detalhe: "Nenhum nome de proprietário/contato encontrado em dado público estruturado." });
  }

  return sinais;
}

/**
 * Ângulo de venda — recomendação determinística, nunca fato. O motivo por
 * trás de cada recomendação é sempre gravado junto (instrução explícita da
 * fase) — quem lê o resultado vê POR QUE aquele ângulo foi sugerido, nunca
 * uma etiqueta solta sem lastro.
 */
export function sugerirAnguloVenda(p: Prospect, sinaisSite?: SinaisSite | null, marketing?: RelatorioMarketing | null, instagram?: SinaisInstagram | null): AnguloVenda | null {
  if (p.website && p.whatsapp_publico && marketing && !marketing.provavelAtivoEmMidiaPaga) {
    return {
      angulo: "Conversão/WhatsApp",
      motivo: "Site e WhatsApp já existem, mas não há rastreamento detectado — proposta de medir e otimizar o caminho até o contato, antes de qualquer investimento em mídia.",
    };
  }
  if (instagram?.perfilPublicoAcessivel && (!p.website || sinaisSite?.erro)) {
    return {
      angulo: "Captação própria fora das redes",
      motivo: "Presença ativa no Instagram sem site funcional — proposta de trazer parte da captação para um canal que o negócio controla.",
    };
  }
  if (p.website && !sinaisSite?.erro && marketing && !marketing.provavelAtivoEmMidiaPaga) {
    return {
      angulo: "Mensuração/performance",
      motivo: "Site existe e carrega, mas nenhum pixel/tag de rastreamento foi detectado — proposta de implementar mensuração antes de rodar campanha paga.",
    };
  }
  return null;
}
