import "server-only";
import { detectarComandoDeTarefa } from "../tarefas/roteador";
import type { ContextoResolvido } from "../contexto/resolver";
import { listarProspects } from "../prospeccao/repositorio";
import { disponibilidadeDaCapacidade, listarCapacidadesDisponiveis } from "./capacidades";
import { interpretarComandoDerivado, validarInterpretacaoDerivada, type TipoOperacaoDerivada } from "./interpretador";
import { ultimoResultadoDaConversa } from "../jobs/resultados";
import { rotear, chamarComFallback, algumProvedorDisponivel } from "../modelo/roteador";
import { chaveCache, obterCache, gravarCache } from "../modelo/cache";
import { detectarComandoDeConteudo } from "../social/deteccao";
import type { PassoParaCriar } from "./repositorio";

/**
 * Planejador — três estratégias, nunca uma quarta escondida.
 *
 *  1. Derivado: o objetivo se refere a um resultado que JÁ existe nesta
 *     conversa ("enriqueça esses", "analise o marketing delas", "crie uma
 *     abordagem") — nunca dispara descoberta nova, opera sobre o snapshot
 *     que já está gravado. Checado ANTES do determinístico de descoberta:
 *     "pesquise o Instagram delas" não pode virar "procurar negócio novo
 *     chamado Instagram".
 *  2. Determinístico de descoberta: reconhece o formato do objetivo (hoje
 *     prospecção, qualquer vertical — não só pizzaria, ver
 *     contexto/resolver.ts) e monta o plano por CONSULTA REAL às
 *     capacidades disponíveis — nunca um plano fixo que finge ter
 *     descoberto algo. Custo zero de modelo.
 *  3. Modelo: quando nenhuma das duas acima reconhece o objetivo E há
 *     chave configurada, pede ao modelo um plano — sempre restrito às
 *     capacidades REAIS (a lista é enviada no prompt) e sempre validado
 *     contra o registro depois (ver orquestrador.ts) antes de virar Plano
 *     de verdade.
 *
 * Se nenhuma das três estratégias produz um plano, devolve null — quem
 * chama trata isso como "não é uma tarefa orquestrável", não como erro.
 */

export type PlanoCandidato = {
  origem: "deterministico" | "modelo";
  resumoRaciocinio: string;
  nivelRisco: "baixo" | "medio" | "alto";
  passos: PassoParaCriar[];
};

export async function planejar(objetivo: string, resolvido: ContextoResolvido, conversaId: string | null): Promise<PlanoCandidato | null> {
  // Checado ANTES de prospecção de propósito: "prepare 5 posts sobre
  // pizzarias no Instagram" contém uma vertical conhecida (pizzarias) e
  // poderia disparar o resolvedor de contexto pra PROSPECCAO — o verbo de
  // autoria + substantivo de conteúdo (ver social/deteccao.ts) é um sinal
  // mais específico e sempre vence quando presente.
  const conteudoSocial = planejarConteudoSocialDeterministico(objetivo);
  if (conteudoSocial) return conteudoSocial;

  const derivado = planejarDerivadoDeterministico(objetivo, conversaId, resolvido);
  if (derivado) return derivado;

  const determinístico = planejarProspeccaoDeterministico(objetivo, resolvido);
  if (determinístico) return determinístico;

  if (algumProvedorDisponivel()) {
    return planejarComModelo(objetivo);
  }

  return null;
}

/* ══════════════════════════ 0. determinístico: conteúdo social ══════════════════════════ */

const ROTULO_PLATAFORMA: Record<string, string> = {
  instagram: "Instagram", facebook: "Facebook", whatsapp_status: "Status do WhatsApp", linkedin: "LinkedIn", tiktok: "TikTok", outro: "rede social",
};

function planejarConteudoSocialDeterministico(objetivo: string): PlanoCandidato | null {
  const comando = detectarComandoDeConteudo(objetivo);
  if (!comando) return null;

  // Cada rascunho é independente — sem dependência entre passos (ao
  // contrário da cadeia de prospecção, gerar o post 3 nunca depende do 2).
  const passos: PassoParaCriar[] = Array.from({ length: comando.quantidade }, (_, i) => ({
    descricao: `Gerar rascunho de ${comando.tipoConteudo} ${comando.quantidade > 1 ? `#${i + 1} ` : ""}para ${ROTULO_PLATAFORMA[comando.plataforma]} sobre "${comando.tema}"`,
    capacidade: "gerar_conteudo_social",
    entrada: { tema: comando.tema, plataforma: comando.plataforma, tipoConteudo: comando.tipoConteudo },
    dependeDe: [],
  }));

  return {
    origem: "deterministico",
    resumoRaciocinio: `${comando.quantidade} rascunho(s) de ${comando.tipoConteudo} para ${ROTULO_PLATAFORMA[comando.plataforma]} sobre "${comando.tema}".`,
    nivelRisco: "baixo", // gera rascunho, nunca publica — nunca precisa de aprovação pra RODAR o job
    passos,
  };
}

/* ══════════════════════════ 1. derivado: opera sobre resultado existente ══════════════════════════ */

const ROTULO_OPERACAO: Record<TipoOperacaoDerivada, string> = {
  ENRIQUECER: "Enriquecer contato público",
  ANALISAR_MARKETING: "Analisar sinais de marketing digital",
  PONTUAR: "Repontuar",
  GERAR_ABORDAGEM: "Gerar abordagem comercial",
};

const CAPACIDADE_POR_OPERACAO: Record<TipoOperacaoDerivada, string> = {
  ENRIQUECER: "enriquecer_prospect",
  ANALISAR_MARKETING: "analisar_marketing_digital",
  PONTUAR: "pontuar_prospect",
  GERAR_ABORDAGEM: "gerar_abordagem",
};

const OPERACAO_PARA_LINHAGEM: Record<TipoOperacaoDerivada, string> = {
  ENRIQUECER: "enriquecimento",
  ANALISAR_MARKETING: "analise_marketing",
  PONTUAR: "pontuacao",
  GERAR_ABORDAGEM: "abordagem",
};

function planejarDerivadoDeterministico(objetivo: string, conversaId: string | null, resolvido: ContextoResolvido): PlanoCandidato | null {
  if (!conversaId) return null;
  // Achado rodando de verdade (Fase 5): "Encontre 2 academias em Osasco...
  // e prepare abordagem para as melhores 2." menciona "abordagem" (gatilho
  // derivado forte) NA MESMA frase que uma descoberta nova — sem esta
  // guarda, virava "gerar abordagem" isolado, achava que não tinha
  // resultado anterior e parava com plano vazio, nunca chegando a
  // descobrir negócio nenhum. Quando a MESMA mensagem também é reconhecida
  // como comando de descoberta nova, a descoberta sempre vence — abordagem
  // encadeada é uma decisão do Planejador determinístico de descoberta
  // (ver detectarEstagiosDesejados), não do intérprete derivado.
  if (resolvido.intencao === "PROSPECCAO") return null;
  const bruto = interpretarComandoDerivado(objetivo);
  if (!bruto) return null;
  const interpretacao = validarInterpretacaoDerivada(bruto);

  const anterior = ultimoResultadoDaConversa(conversaId);
  if (!anterior || anterior.prospects.length === 0) {
    return {
      origem: "deterministico",
      resumoRaciocinio: `Nenhum resultado anterior nesta conversa para ${ROTULO_OPERACAO[interpretacao.operacao].toLowerCase()}.`,
      nivelRisco: "baixo",
      passos: [],
    };
  }

  let alvos = anterior.prospects;
  if (interpretacao.limite) {
    alvos = [...alvos].sort((a, b) => (b.score ?? -1) - (a.score ?? -1)).slice(0, interpretacao.limite);
  }

  const capacidade = CAPACIDADE_POR_OPERACAO[interpretacao.operacao];
  const passos: PassoParaCriar[] = alvos.map((p) => ({
    descricao: `${ROTULO_OPERACAO[interpretacao.operacao]}: ${p.negocio}`,
    capacidade,
    entrada: interpretacao.operacao === "ENRIQUECER" ? { prospectId: p.id, campos: interpretacao.camposSolicitados } : { prospectId: p.id },
    dependeDe: [],
  }));

  // Enriquecer sem repontuar deixaria o score desatualizado com o contato
  // novo — encadeia uma repontuação por prospect, dependente do
  // enriquecimento dele (sem custo de rede, é só recálculo).
  if (interpretacao.operacao === "ENRIQUECER") {
    alvos.forEach((p, i) => {
      passos.push({
        descricao: `Repontuar após enriquecimento: ${p.negocio}`,
        capacidade: "pontuar_prospect",
        entrada: { prospectId: p.id },
        dependeDe: [i],
      });
    });
  }

  const indicesFinais = passos.map((_, i) => i);

  passos.push({
    descricao: "Gerar arquivo de resultado (CSV/XLSX)",
    capacidade: "gerar_arquivo_resultado",
    entrada: { prospectIds: alvos.map((p) => p.id), parentResultId: anterior.resultado.id, operacao: OPERACAO_PARA_LINHAGEM[interpretacao.operacao] },
    dependeDe: indicesFinais,
  });

  return {
    origem: "deterministico",
    resumoRaciocinio: `${ROTULO_OPERACAO[interpretacao.operacao]} para ${alvos.length} prospect(s) do resultado anterior.`,
    nivelRisco: "baixo",
    passos,
  };
}

/* ══════════════════════════ 2. determinístico: descoberta de negócio (qualquer vertical) ══════════════════════════ */

/**
 * Estágios do pipeline dinâmico — o Planejador nunca força TODOS os
 * estágios em toda descoberta (instrução explícita do Cacique). "Descobrir
 * pizzarias" fica no caminho raso (só diagnóstico, que já grava score); só
 * quando o objetivo pede algo que exige mais evidência (qualificar como
 * "boa oportunidade", avaliar marketing, ou pedir contato/redes sociais) é
 * que o Orquestrador encadeia enriquecimento e análise de marketing antes de
 * pontuar (ver jobs/handlers/plano-orquestrado.ts — o encadeamento em si é
 * dinâmico, um estágio por vez, nunca um DAG fixo com N passos por estágio
 * pré-calculado, porque N só existe depois da descoberta rodar). A cadeia
 * não é um binário raso/profundo fixo — enriquecimento e marketing entram
 * cada um por seu próprio gatilho (podem vir junto ou separados).
 */
const RE_QUALIFICACAO = /boas?\s+oportunidades?|bons?\s+prospects?|vale a pena|potencial de|qualificad|prontos?\s+para|melhor(es)?\s+(oportunidade|prospect|neg[oó]cio)/i;
const RE_MARKETING = /marketing digital|an[uú]ncio|\bads\b|tr[aá]fego pago|propaganda online|meta pixel|facebook ads|google ads|meta ads|investe em (an[uú]ncio|marketing)|marketing forte/i;
const RE_ENRIQUECIMENTO = /telefone|whatsapp|e-?mail|contato p[uú]blico|redes sociais/i;
const RE_INSTAGRAM = /instagram/i;
const RE_ABORDAGEM = /abordagem|abordar|mensagem (de vendas|comercial)|prepar[ae].*contato|escrev[ae].*mensagem|texto de (venda|abordagem)/i;
const RE_MELHORES_N = /melhor(?:es)?\s+(\d+)/i;
// "Pesquisa profunda" (Fase 6, níveis de pesquisa) força a cadeia completa
// — inclui Instagram mesmo sem a palavra aparecer, porque "profundo" É
// pedir todo sinal público disponível, não só marketing/contato.
const RE_PESQUISA_PROFUNDA = /pesquisa profunda|pesquis\w*\s+profundamente|an[aá]lise completa|investiga[çc][aã]o completa|em profundidade|n[íi]vel\s*[34]\b/i;

export type EstagiosDesejados = { estagios: string[]; desejaAbordagem: boolean; limiteAbordagem: number | null };

/** Lê o objetivo em português e decide QUAIS estágios o pipeline precisa — nunca todos por padrão. */
function detectarEstagiosDesejados(objetivo: string): EstagiosDesejados {
  const t = objetivo.toLowerCase();
  const querProfundo = RE_PESQUISA_PROFUNDA.test(t);
  const querQualificacao = RE_QUALIFICACAO.test(t) || querProfundo; // pipeline fundo: evidência rica antes de julgar oportunidade
  const querMarketing = RE_MARKETING.test(t) || querQualificacao;
  const querEnriquecimento = RE_ENRIQUECIMENTO.test(t) || querQualificacao;
  const querInstagram = RE_INSTAGRAM.test(t) || querProfundo;

  const estagios: string[] = [];
  if (querEnriquecimento) estagios.push("enriquecer_prospect");
  estagios.push("diagnosticar_prospect"); // sempre — é o estágio que visita o site e grava o score
  if (querMarketing) estagios.push("analisar_marketing_digital");
  // Instagram sempre por ÚLTIMO: só faz sentido depois que enriquecimento/
  // descoberta já pode ter preenchido o handle — pesquisar sem handle
  // conhecido não pesquisa nada (nunca adivinha), então rodar cedo demais
  // desperdiçaria o passo.
  if (querInstagram) estagios.push("pesquisar_instagram");

  const desejaAbordagem = RE_ABORDAGEM.test(t);
  const matchN = t.match(RE_MELHORES_N);
  const limiteAbordagem = matchN ? Math.min(parseInt(matchN[1], 10), 50) : null;

  return { estagios, desejaAbordagem, limiteAbordagem };
}

function planejarProspeccaoDeterministico(objetivo: string, resolvido: ContextoResolvido): PlanoCandidato | null {
  const comando = detectarComandoDeTarefa(objetivo, resolvido);
  if (!comando) return null;

  const { estagios, desejaAbordagem, limiteAbordagem } = detectarEstagiosDesejados(objetivo);
  const passos: PassoParaCriar[] = [];
  const dispDescoberta = disponibilidadeDaCapacidade("descobrir_negocios");

  let prospectIds: string[];
  let notaDescoberta = "";
  let indiceDescoberta: number | null = null;

  if (dispDescoberta === "DISPONIVEL") {
    // Google Places configurado de verdade — descobre negócio novo por
    // texto livre (nunca precisa de enum de vertical, ver pesquisa/places.ts).
    // A descoberta cria os registros de prospect; ela não sabe ainda quais
    // IDs vai gerar (só existem depois de rodar), então a finalização
    // (ver jobs/handlers/plano-orquestrado.ts) recolhe o resultado da saída
    // deste passo, não de uma lista fixada aqui. Os estágios seguintes
    // (enriquecimento/diagnóstico/marketing) são inseridos dinamicamente,
    // um por negócio achado — nunca fixados aqui, porque a quantidade real
    // só existe depois da descoberta rodar.
    passos.push({
      descricao: `Descobrir ${comando.rotuloVertical ?? comando.vertical ?? "negócios"} em ${comando.localizacao ?? "qualquer localização"}`,
      capacidade: "descobrir_negocios",
      entrada: { vertical: comando.vertical, rotuloVertical: comando.rotuloVertical, localizacao: comando.localizacao, quantidade: comando.quantidade },
      dependeDe: [],
    });
    indiceDescoberta = 0;
    prospectIds = [];
  } else {
    const existentes = listarProspects({ vertical: comando.vertical ?? undefined, cidade: comando.localizacao ?? undefined });
    prospectIds = existentes.slice(0, comando.quantidade).map((p) => p.id);
    notaDescoberta =
      dispDescoberta === "REQUER_CREDENCIAL"
        ? "Descoberta automática de negócio novo indisponível (falta credencial) — usando prospects já cadastrados."
        : "Capacidade de descoberta não implementada — usando prospects já cadastrados.";
  }

  // Path SEM descoberta ao vivo: os IDs já são conhecidos agora, então o
  // primeiro estágio da cadeia entra direto no Plano (com o resto da cadeia
  // embutido na entrada — ver cadeiaRestante). Path COM descoberta ao vivo:
  // nenhum passo de estágio aqui — expandirAposDescoberta insere o primeiro
  // estágio por negócio DEPOIS que a descoberta roda de verdade.
  const indicePrimeiroEstagio: number[] = [];
  if (indiceDescoberta === null) {
    for (const id of prospectIds) {
      passos.push({
        descricao: `${rotuloEstagio(estagios[0])}: ${id.slice(0, 8)}`,
        capacidade: estagios[0],
        entrada: { prospectId: id, cadeiaRestante: estagios.slice(1) },
        dependeDe: [],
      });
      indicePrimeiroEstagio.push(passos.length - 1);
    }
  }

  if (passos.length === 0) {
    return {
      origem: "deterministico",
      resumoRaciocinio: `Nenhum prospect de ${comando.rotuloVertical ?? comando.vertical ?? "qualquer vertical"} em ${comando.localizacao ?? "qualquer lugar"} para trabalhar. ${notaDescoberta}`.trim(),
      nivelRisco: "baixo",
      passos: [],
    };
  }

  // Finalização — a entrada carrega os IDs já conhecidos (path sem
  // descoberta nova); no path com descoberta real, prospectIds fica vazio
  // aqui de propósito e a finalização soma com a saída do passo de
  // descoberta (ver plano-orquestrado.ts). Também é onde a configuração do
  // pipeline (quais estágios, se quer abordagem, limite) fica gravada —
  // é o único passo garantido em QUALQUER dos dois paths, então
  // garantirExpansoes() sempre sabe onde ler a configuração.
  passos.push({
    descricao: "Gerar arquivo de resultado (CSV/XLSX)",
    capacidade: "gerar_arquivo_resultado",
    entrada: { prospectIds, aguardaDescobertaDoPasso: indiceDescoberta, estagiosDesejados: estagios, desejaAbordagem, limiteAbordagem },
    dependeDe: indiceDescoberta !== null ? [indiceDescoberta, ...indicePrimeiroEstagio] : indicePrimeiroEstagio,
  });

  // Achado rodando de verdade: quando a descoberta ao vivo está disponível,
  // `prospectIds` fica vazio de PROPÓSITO (os IDs só existem depois da
  // descoberta rodar) — mas o texto de fallback "Diagnosticar 0 prospect(s)
  // já cadastrados" descrevia exatamente o CONTRÁRIO do que ia acontecer
  // (a mensagem que o Cacique via dizia "cadastrados" quando o plano ia
  // descobrir negócio NOVO). Cada path tem sua própria frase honesta agora.
  const descricaoCadeia = estagios.length > 1 ? ` (${estagios.map(rotuloEstagio).join(" → ")})` : "";
  const resumoPadrao =
    indiceDescoberta !== null
      ? `Descobrir ${comando.rotuloVertical ?? comando.vertical ?? "negócios"} em ${comando.localizacao ?? "qualquer localização"}, processar cada um${descricaoCadeia} e gerar arquivo de resultado.`
      : `Processar ${prospectIds.length} prospect(s) já cadastrados${descricaoCadeia} e gerar arquivo de resultado.`;

  return {
    origem: "deterministico",
    resumoRaciocinio: notaDescoberta || resumoPadrao,
    nivelRisco: "baixo",
    passos,
  };
}

function rotuloEstagio(capacidade: string): string {
  const rotulos: Record<string, string> = {
    enriquecer_prospect: "Enriquecer contato",
    diagnosticar_prospect: "Diagnosticar site",
    analisar_marketing_digital: "Analisar marketing",
    pesquisar_instagram: "Pesquisar Instagram",
  };
  return rotulos[capacidade] ?? capacidade;
}

/* ══════════════════════════ 3. modelo (fallback para objetivo não reconhecido) ══════════════════════════ */

async function planejarComModelo(objetivo: string): Promise<PlanoCandidato | null> {
  const capacidades = listarCapacidadesDisponiveis();

  // Cache (Fase 8) — o MESMO objetivo não reconhecido pelo determinístico,
  // perguntado de novo minutos depois com as MESMAS capacidades disponíveis,
  // reaproveita o plano em vez de gastar token de novo. Nunca usado nos
  // caminhos determinístico/derivado acima (nada ali chama modelo).
  const chave = chaveCache("gerar_plano", objetivo, capacidades.map((c) => `${c.capacidade}:${c.disponibilidade}`).join(","));
  const emCache = obterCache<PlanoCandidato>(chave);
  if (emCache) return emCache;

  const decisao = rotear({
    tipoTarefa: "planejamento",
    complexidade: "media",
    capacidadesNecessarias: ["structured_output"],
    tamanhoContextoTokens: 300 + capacidades.length * 30,
  });
  if (!decisao.provedor) return null; // sem provedor/orçamento — nunca finge que planejou

  try {
    const proposto = await chamarComFallback(decisao, (p) => p.gerarPlano(objetivo, capacidades));
    const resultado: PlanoCandidato = {
      origem: "modelo",
      resumoRaciocinio: proposto.resumoRaciocinio,
      nivelRisco: proposto.nivelRisco,
      passos: proposto.passos.map((p) => ({
        descricao: p.descricao,
        capacidade: p.capacidade,
        entrada: p.entrada,
        dependeDe: p.dependeDe,
      })),
    };
    gravarCache(chave, "gerar_plano", resultado);
    return resultado;
  } catch {
    // Modelo indisponível/erro/JSON malformado — nunca finge que planejou.
    return null;
  }
}
