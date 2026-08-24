/**
 * MOTOR DE RESOLUÇÃO DE CONTEXTO
 *
 * Recebe linguagem natural e devolve projeto, cliente, intenção, ação, urgência
 * e modo — sem chamar modelo nenhum. Custo R$ 0 por resolução.
 *
 * Função pura de propósito: não toca banco, não toca rede. O léxico entra como
 * argumento, montado por quem tem acesso aos dados. Isso é o que torna o motor
 * testável sem servidor de pé e o que impede a inferência de virar caixa-preta.
 *
 * Regra que governa tudo aqui: **quando não dá para saber, o motor diz que não
 * sabe.** Confiança baixa devolve BAIXA e uma pergunta — nunca um chute
 * apresentado como certeza.
 */

/* ══════════════════════════ tipos ══════════════════════════ */

export type Confianca = "ALTA" | "MEDIA" | "BAIXA";

export const INTENCOES_VALIDAS = [
  "PROSPECCAO",
  "PRODUTO",
  "AUDITORIA_ADS",
  "PRODUCAO_CRIATIVA",
  "ESTRATEGIA",
  "ANALISE",
  "OPERACAO",
  "CONHECIMENTO",
  "PESSOAL",
  "INDEFINIDA",
] as const;

export type Intencao = (typeof INTENCOES_VALIDAS)[number];

/** Valida um valor lido do banco (TEXT livre) contra a união real. */
export function paraIntencao(v: string | null | undefined): Intencao {
  return (INTENCOES_VALIDAS as readonly string[]).includes(v ?? "")
    ? (v as Intencao)
    : "INDEFINIDA";
}

export type Acao = "PLANEJAR" | "EXECUTAR" | "ANALISAR" | "REVISAR" | "RESPONDER" | "INDEFINIDA";

export type Urgencia = "CRITICA" | "ALTA" | "NORMAL" | "BAIXA";

export type Modo = "consultivo" | "direto" | "socio_incomodo";

/** Uma entidade que existe de verdade no sistema — projeto, cliente, ativo. */
export type Entidade = {
  id: string;
  nome: string;
  /** Formas como o Cacique escreve isso na prática. */
  apelidos: string[];
  genero: "projeto" | "cliente";
  /** Projeto ao qual a entidade pertence, quando é cliente. */
  projetoId?: string;
};

export type Lexico = {
  entidades: Entidade[];
};

/** De onde saiu cada pedaço da inferência. Sem isso não dá para auditar. */
export type Sinal = {
  campo: string;
  valor: string;
  origem: "texto" | "timeline" | "padrao";
  trecho?: string;
};

export type ContextoResolvido = {
  projetoId: string | null;
  projetoNome: string | null;
  clienteId: string | null;
  clienteNome: string | null;
  intencao: Intencao;
  acao: Acao;
  urgencia: Urgencia;
  modo: Modo;
  confianca: Confianca;
  /** Preenchido só quando confiança é BAIXA. Uma pergunta, nunca várias. */
  pergunta: string | null;
  /** Verdadeiro quando o Cacique corrigiu o contexto explicitamente. */
  correcao: boolean;
  /** Verdadeiro quando ele pediu para voltar a um contexto anterior. */
  retomada: boolean;
  sinais: Sinal[];
  rotulo: string;
};

/* ══════════════════════════ normalização ══════════════════════════ */

/** Sem acento, minúsculo, espaço único. Comparação de nome tem que ser robusta. */
export function normalizar(t: string): string {
  return t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ══════════════════════════ dicionários ══════════════════════════ */

/**
 * Intenção por verbo e objeto. Ordem importa: o primeiro que casa vence, então
 * o mais específico vem antes do mais genérico.
 */
/** Vocabulário de vertical de prospecção — vira sinal de PROSPECCAO e entra no rótulo. */
const VERTICAIS_PROSPECCAO: Array<[string, RegExp]> = [
  ["delivery_pizzaria", /\bpizzari/],
  ["delivery_hamburgueria", /\bhamburgu/],
  ["delivery_acaiteria", /\ba[cç]a[ií]/],
  ["delivery_esfiharia", /\besfirrari|esfihari/],
  ["delivery_lanchonete", /\blanchonete/],
  ["delivery_restaurante", /\brestaurante/],
  ["ecommerce", /\be-?commerce|loja virtual|shopify|nuvemshop/],
  ["locatta_corretor", /\bcorretor(es)? de im[oó]ve|imobiliari|administradora de im[oó]ve/],
];

/** "em Osasco" / "perto de Osasco" / "próximo a Osasco" — string bruta, sem gazetteer. */
function extrairLocalizacao(texto: string): string | null {
  const m = /\b(?:em|perto de|pr[oó]xim[oa] a|na regi[aã]o de)\s+([A-ZÀ-Ú][\wÀ-ú]*(?:\s+[A-ZÀ-Ú][\wÀ-ú]*){0,2})/.exec(
    texto,
  );
  return m ? m[1].trim() : null;
}

/**
 * Verbo de descoberta — o mesmo vocabulário que já dispara PROSPECCAO em
 * INTENCOES, extraído aqui pra reuso: é o que separa "encontre academias"
 * (descoberta) de "pesquise o Instagram delas" (verbo de pesquisa genérico,
 * mas sem frase de negócio depois — a extração livre abaixo simplesmente não
 * casa, porque "o instagram delas" começa com artigo+substantivo comum, não
 * com o padrão de "tipo de negócio no plural").
 */
const VERBO_DESCOBERTA = /\b(procur\w*|encontr\w*|pesquis\w*|busc\w*|prospect\w*|localiz\w*)\b/;

/**
 * Frase de negócio livre — fallback pra quando o vocabulário fixo
 * (VERTICAIS_PROSPECCAO) não reconhece o tipo. Nunca hardcoda "pizzaria":
 * pega o SUBSTANTIVO PLURAL depois do verbo de busca (e da quantidade,
 * quando houver), até a preposição de local ou o fim da frase. Funciona
 * para "academias", "clínicas odontológicas", "estéticas automotivas",
 * "assistências técnicas", "personal trainers" — qualquer coisa que o
 * Cacique escrever ali, sem lista fechada.
 */
function extrairFraseNegocioLivre(texto: string): string | null {
  const t = normalizar(texto);
  // VERBO_DESCOBERTA já tem um grupo de captura próprio (o verbo em si) —
  // a frase de negócio sai no grupo 2, não no 1. Achado rodando contra os
  // próprios exemplos da missão: sem isso, m[1] pegava o VERBO ("encontre"),
  // nunca o tipo de negócio, e todo vertical livre saía null silenciosamente.
  const m = new RegExp(
    VERBO_DESCOBERTA.source +
      String.raw`\s+(?:\d{1,4}\s+)?([a-zà-ú][a-zà-ú\s]{2,60}?)(?=\s+(?:em|na|no|perto de|pr[oó]xim[oa] a|na regi[aã]o de|com|que|para)\b|[.,!?]|$)`,
  ).exec(t);
  if (!m) return null;
  const frase = m[2].trim();
  if (!frase || frase.length < 3) return null;
  // Ruído comum: artigo/pronome solto não é tipo de negócio ("o instagram
  // delas", "um horário melhor") — descarta em vez de fingir que é vertical.
  if (/^(o|a|os|as|um|uma|uns|umas|isso|esse|essa|esses|essas|ele|ela|eles|elas|aquele|aquela)\b/.test(frase)) {
    return null;
  }
  // "Tipo de negócio" é sempre pedido no plural ("academias", "clínicas
  // odontológicas", "personal trainers") — exigir a última palavra no
  // plural é o filtro mais barato contra falso positivo tipo "procure um
  // horário melhor" (frase real, mas não é vertical de prospecção nenhuma).
  const ultimaPalavra = frase.split(/\s+/).at(-1) ?? "";
  if (!/(s|is)$/.test(ultimaPalavra)) return null;
  return frase;
}

/** Sinais específicos de prospecção — vertical e localização, quando o texto os carrega. */
export function extrairSinaisProspeccao(
  texto: string,
): { vertical: string | null; rotuloVertical: string | null; localizacao: string | null } {
  const t = normalizar(texto);
  const conhecido = VERTICAIS_PROSPECCAO.find(([, re]) => re.test(t))?.[0] ?? null;
  if (conhecido) return { vertical: conhecido, rotuloVertical: null, localizacao: extrairLocalizacao(texto) };

  // Vertical livre — nunca força no enum fechado. O slug vira a própria
  // frase normalizada (com espaço trocado por _), o rótulo de exibição vira
  // a frase como o Cacique escreveu (plural natural, sem tentar conjugar).
  const livre = extrairFraseNegocioLivre(texto);
  if (!livre) return { vertical: null, rotuloVertical: null, localizacao: extrairLocalizacao(texto) };

  return {
    vertical: `livre:${livre.replace(/\s+/g, "_")}`,
    rotuloVertical: livre,
    localizacao: extrairLocalizacao(texto),
  };
}

const INTENCOES: Array<[Intencao, RegExp]> = [
  [
    "PROSPECCAO",
    // Duas formas de disparar: verbo de busca + vertical ("procura pizzarias
    // em..."), OU vertical no PLURAL sozinho ("quero e-commerces com...") —
    // achado testando o próprio exemplo do Cacique: "Quero e-commerces..."
    // não tem verbo de busca, mas plural de tipo de negócio já é o sinal de
    // "categoria de mercado a buscar", não "meu cliente específico".
    /\b(procura|encontra|pesquisa|prospect)\w*\b.{0,60}\b(pizzari|hamburgu|a[cç]a[ií]|esfirrari|esfihari|lanchonete|restaurante|e-?commerce|loja virtual|corretor|imobiliari|neg[oó]cio|lead|cliente potencial)|\bprospec[cç][aã]o\b|\b(pizzarias|hamburguerias|a[cç]a[ií]terias|esfirrarias|esfihar[ií]as|lanchonetes|restaurantes|e-?commerces|lojas virtuais)\b/,
  ],
  ["AUDITORIA_ADS", /\b(campanh|an[uú]nci|google ads|meta ads|adwords|palavra-?chave|negativa|lance|cpa|cpc|roas|ctr|conjunto de an[uú]ncio|audit)/],
  ["PRODUCAO_CRIATIVA", /\b(criativ|copy|headline|hook|gancho|vsl|roteiro|thumb|carrossel|est[eé]tica|arte|pe[cç]a|storyboard|legenda)/],
  ["PRODUTO", /\b(onboarding|feature|funcionalidade|tela|fluxo do (app|produto|usu[aá]rio)|ux do produto|bug|backlog|roadmap|cadastro|checkout)/],
  ["ESTRATEGIA", /\b(posicionament|estrat[eé]gi|pre[cç]ific|oferta|funil|lan[cç]amento|concorr|mercado|proposta de valor|icp)/],
  ["ANALISE", /\b(analis|diagnostic|investig|entender por que|por que (caiu|subiu)|m[eé]tric|n[uú]mero|resultado|desempenho|performance)/],
  ["OPERACAO", /\b(indexa|deploy|rodar|script|banco|migra|backup|servidor|build|commit|teste)/],
  ["CONHECIMENTO", /\b(o que (eu )?(j[aá] )?(tenho|sei)|quais (lps?|vsls?|criativos?|materiais)|busca|consulta|onde est[aá]|me lembra|documenta)/],
  ["PESSOAL", /\b(minha rotina|meu dia|minha agenda|pessoal|descans|sa[uú]de|estud(ar|o))/],
];

const ACOES: Array<[Acao, RegExp]> = [
  // RESPONDER vem ANTES de EXECUTAR (achado real na Fase 19, testando a
  // própria frase-exemplo da missão: "explique o que o Jarvis é capaz de
  // FAZER hoje"). "fazer" é ao mesmo tempo o verbo genérico de ordem
  // ("faça isso") e o verbo de capacidade em pergunta ("o que você faz",
  // "capaz de fazer") — ambíguo por natureza da língua. Checar RESPONDER
  // primeiro resolve a pergunta corretamente sem exigir NLP de verdade:
  // os verbos realmente inequívocos de EXECUTAR (cria, corrige, publica,
  // manda, roda, sobe, monta, gera, escreve, implementa, ajusta, muda,
  // altera) não aparecem no vocabulário de RESPONDER, então uma ordem
  // real ("corrija X") nunca é desviada — só "fazer" tem essa ambiguidade,
  // e ela sempre resolve a favor de não travar uma pergunta comum.
  //
  // expli(c|qu)\w* (achado real na Fase 19): "explicar" muda a raiz na
  // conjugação formal por regra ortográfica do português (c→qu antes de
  // e/i, pra manter o som de /k/) — "explica" (informal) vs "explique"
  // (formal/você, a forma mais comum). Um stem só ("explic\w*") nunca
  // casava "explique"/"expliquei"/"expliquem". "como (está|vai|anda)"
  // também faltava — "como está o Jarvis" é pergunta de status, não a
  // mesma coisa que "como eu faço/devo" (que já é PLANEJAR e não colide:
  // exige "faço"/"devo" depois de "como").
  ["RESPONDER", /\b(o que [eé]|quanto|quando|quem|onde|quais|como (voc[eê]\s+)?(est[aá]|vai|anda)|me (expli(c|qu)\w*|diz|conta)|expli(c|qu)\w*)/],
  ["EXECUTAR", /\b(cri(a|ar|e)|faz|fa[cç]a|fazer|roda|rodar|executa|executar|sobe|subir|monta|montar|gera|gerar|escreve|escrever|manda|enviar|publica|implementa|corrig|ajusta|muda|mudar|altera)/],
  ["ANALISAR", /\b(analis|revis[aá]|audit|diagnostic|investig|compar|avali|checa|verifica|olha|conferir)/],
  ["PLANEJAR", /\b(plane|planeja|estrutura|organiza|define|definir|decide|decidir|pensa|pensar em|como (eu )?(fa[cç]o|devo)|qual (o )?melhor|estrat[eé]gi)/],
  ["REVISAR", /\b(revis|melhor(a|ar)|otimiz|refina|ajust|aprimor)/],
];

// "agora" sozinho é ambíguo de propósito — falso positivo achado testando ao
// vivo: "Agora quero analisar a SS Aquecedores" é troca de assunto, não
// urgência, e "agora" sozinho marcava CRÍTICA. "agora mesmo" e "urgente
// agora" continuam fortes o bastante para ficar.
const URGENCIAS: Array<[Urgencia, RegExp]> = [
  ["CRITICA", /\b(urgente|agora mesmo|imediat|parou|caiu|quebr|suspens|bloquead|fora do ar|emerg[eê]nci|perdendo dinheiro|vazou)/],
  ["ALTA", /\b(hoje|ainda hoje|at[eé] amanh[aã]|prazo|deadline|atrasad|prioridade|r[aá]pido)/],
  ["BAIXA", /\b(algum dia|quando der|sem pressa|depois|eventualmente|futuro|ideia solta)/],
];

/** Correção explícita de contexto: "não, é do cliente X". */
const CORRECAO =
  /\b(n[aã]o[,.]?\s*(e|é|estou|to|tava|era|quis dizer|falo|falando)|na verdade|me enganei|corrig(e|indo)|quis dizer|troca pra|muda pra|volta pra o|era sobre)/;

/** Retomada de contexto anterior: "volta pro assunto de antes". */
const RETOMADA =
  /\b(volt(a|ando|emos)|retom(a|ando|ar)|de volta|voltando (pra|para)|assunto anterior|o que est[aá]vamos|aquele (cliente|projeto|assunto)|antes (a gente|n[oó]s))/;

/* ══════════════════════════ motor de modo ══════════════════════════ */

/**
 * O Cacique afirmou uma hipótese sem evidência. É o gatilho do sócio incômodo:
 * "acho que precisamos colocar mais passos" antes de olhar onde quebra.
 */
const HIPOTESE_SEM_EVIDENCIA =
  /\b(acho que|acredito que|tenho a impress[aã]o|imagino que|deve ser|com certeza [eé]|tenho certeza|na minha opini[aã]o|sinto que|parece que o problema)/;

/** Ação de risco declarada sem medição: aumentar escopo, dobrar verba, etc. */
const RISCO_DECLARADO =
  /\b(dobr(a|ar)|triplic|aumentar (a )?(verba|or[cç]amento|investiment)|mais passos|mais etapas|mais campos|escala(r)? (tudo|agora)|todos os clientes|de uma vez|para(r)? tudo|demitir|cancelar tudo|migrar tudo)/;

/** Pergunta com opções legítimas em aberto. */
const MULTIPLA_ESCOLHA =
  /\b(ou\b.{0,40}\?|qual (dos|das|deles|seria|faz mais sentido)|vale mais a pena|melhor op[cç][aã]o|devo (ir|fazer|usar|escolher)|prefiro saber|o que voc[eê] acha|alternativa)/;

/** Ordem operacional clara — não há o que consultar, há o que fazer. */
const ORDEM_CLARA =
  /^(cri(a|e)|faz|fa[cç]a|roda|executa|sobe|monta|gera|escreve|manda|indexa|lista|mostra|abre|busca|analisa)\b/;

export function escolherModo(texto: string, urgencia: Urgencia): { modo: Modo; motivo: string } {
  const t = normalizar(texto);

  // Sócio incômodo primeiro: se ele está prestes a errar, isso vence
  // conveniência. Precisa de hipótese E risco — só opinar não basta, senão o
  // Jarvis vira o chato que contesta tudo.
  const temHipotese = HIPOTESE_SEM_EVIDENCIA.test(t);
  const temRisco = RISCO_DECLARADO.test(t);
  if (temHipotese && temRisco) {
    return { modo: "socio_incomodo", motivo: "hipótese afirmada + ação de risco, sem medição citada" };
  }
  if (temRisco && urgencia !== "CRITICA") {
    return { modo: "socio_incomodo", motivo: "ação de risco declarada sem urgência que a justifique" };
  }

  if (MULTIPLA_ESCOLHA.test(t)) {
    return { modo: "consultivo", motivo: "pergunta com opções legítimas em aberto" };
  }
  if (temHipotese) {
    return { modo: "consultivo", motivo: "hipótese afirmada sem risco imediato — cabe examinar" };
  }
  if (urgencia === "CRITICA" || ORDEM_CLARA.test(t)) {
    return { modo: "direto", motivo: urgencia === "CRITICA" ? "urgência crítica" : "ordem operacional clara" };
  }
  return { modo: "direto", motivo: "caminho operacional definido" };
}

/* ══════════════════════════ casamento de entidade ══════════════════════════ */

/**
 * Casa por palavra inteira. Substring solta daria falso positivo grosseiro —
 * "ss" casaria dentro de "assunto", e o Jarvis trocaria de cliente sozinho.
 */
function casa(textoNorm: string, termo: string): boolean {
  const t = normalizar(termo);
  if (t.length < 2) return false;
  const escapado = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escapado}([^a-z0-9]|$)`).test(textoNorm);
}

function acharEntidade(
  textoNorm: string,
  lexico: Lexico,
  genero: Entidade["genero"],
): { ent: Entidade; termo: string } | null {
  let melhor: { ent: Entidade; termo: string } | null = null;
  for (const ent of lexico.entidades) {
    if (ent.genero !== genero) continue;
    for (const termo of [ent.nome, ...ent.apelidos]) {
      if (!casa(textoNorm, termo)) continue;
      // Termo mais longo vence: "ss aquecedores" é mais específico que "ss".
      if (!melhor || normalizar(termo).length > normalizar(melhor.termo).length) {
        melhor = { ent, termo };
      }
    }
  }
  return melhor;
}

/* ══════════════════════════ resolução ══════════════════════════ */

function primeiro<T>(pares: Array<[T, RegExp]>, texto: string, padrao: T): { valor: T; achou: boolean } {
  for (const [valor, re] of pares) if (re.test(texto)) return { valor, achou: true };
  return { valor: padrao, achou: false };
}

export type ContextoAnterior = {
  projetoId: string | null;
  projetoNome: string | null;
  clienteId: string | null;
  clienteNome: string | null;
  intencao: Intencao;
};

export function resolverContexto(
  texto: string,
  lexico: Lexico,
  timeline: ContextoAnterior[] = [],
): ContextoResolvido {
  const t = normalizar(texto);
  const sinais: Sinal[] = [];

  const correcao = CORRECAO.test(t);
  const retomada = RETOMADA.test(t);

  /* entidades explícitas no texto */
  const cliente = acharEntidade(t, lexico, "cliente");
  const projetoDireto = acharEntidade(t, lexico, "projeto");

  let projetoId: string | null = null;
  let projetoNome: string | null = null;
  let clienteId: string | null = null;
  let clienteNome: string | null = null;

  if (cliente) {
    clienteId = cliente.ent.id;
    clienteNome = cliente.ent.nome;
    projetoId = cliente.ent.projetoId ?? null;
    projetoNome = lexico.entidades.find((e) => e.id === projetoId)?.nome ?? null;
    sinais.push({ campo: "cliente", valor: cliente.ent.nome, origem: "texto", trecho: cliente.termo });
  } else if (projetoDireto) {
    projetoId = projetoDireto.ent.id;
    projetoNome = projetoDireto.ent.nome;
    sinais.push({
      campo: "projeto",
      valor: projetoDireto.ent.nome,
      origem: "texto",
      trecho: projetoDireto.termo,
    });
  }

  /* intenção, ação, urgência */
  // Verbo de busca + tipo de negócio no plural ("encontre academias em
  // Osasco") é sinal FORTE e específico de descoberta — checado ANTES do
  // dispatcher genérico de INTENCOES, não depois. Achado testando com o
  // próprio vocabulário da missão: "estéticas automotivas" também bate no
  // regex de PRODUCAO_CRIATIVA (palavra "estética" é ambígua — visual de
  // criativo vs. clínica de estética), e como PRODUCAO_CRIATIVA vem antes
  // na lista só por ordem de array, ele venceria por acaso se isto rodasse
  // depois de primeiro() em vez de antes.
  let int: { valor: Intencao; achou: boolean };
  if (VERBO_DESCOBERTA.test(t) && extrairFraseNegocioLivre(texto)) {
    int = { valor: "PROSPECCAO", achou: true };
  } else {
    int = primeiro(INTENCOES, t, "INDEFINIDA" as Intencao);
  }
  const ac = primeiro(ACOES, t, "INDEFINIDA" as Acao);
  const urg = primeiro(URGENCIAS, t, "NORMAL" as Urgencia);

  let intencao = int.valor;
  if (int.achou) sinais.push({ campo: "intencao", valor: intencao, origem: "texto" });
  if (ac.achou) sinais.push({ campo: "acao", valor: ac.valor, origem: "texto" });
  if (urg.achou) sinais.push({ campo: "urgencia", valor: urg.valor, origem: "texto" });

  /* herança da timeline quando o texto não nomeia entidade */
  const anterior = timeline.at(-1) ?? null;
  const penultimo = timeline.at(-2) ?? null;

  if (!projetoId && !clienteId) {
    // Retomada explícita pula para o contexto de dois passos atrás quando ele
    // existe — "volta pro assunto anterior" quer o de antes, não o de agora.
    const fonte = retomada && penultimo ? penultimo : anterior;
    if (fonte && (fonte.projetoId || fonte.clienteId)) {
      projetoId = fonte.projetoId;
      projetoNome = fonte.projetoNome;
      clienteId = fonte.clienteId;
      clienteNome = fonte.clienteNome;
      sinais.push({
        campo: retomada ? "retomada" : "heranca",
        valor: fonte.clienteNome ?? fonte.projetoNome ?? "—",
        origem: "timeline",
      });
      if (intencao === "INDEFINIDA" && fonte.intencao !== "INDEFINIDA") {
        intencao = fonte.intencao;
        sinais.push({ campo: "intencao", valor: intencao, origem: "timeline" });
      }
    }
  }

  /* confiança */
  const nomeouEntidade = Boolean(cliente || projetoDireto);
  const herdouEntidade = Boolean(!nomeouEntidade && (projetoId || clienteId));
  const temIntencao = intencao !== "INDEFINIDA";
  // Achado real (Fase 19): uma pergunta comum — "explique recursão", "como
  // está o Jarvis hoje", "o que é X" — nunca nomeia projeto/cliente E nunca
  // bate nenhuma das 9 categorias de INTENCOES (que são todas de negócio de
  // agência: prospecção, ads, criativo...). Isso sempre caía em BAIXA e
  // travava a conversa numa pergunta de esclarecimento antes de chegar no
  // modelo — mesmo pra pergunta que claramente não precisa de projeto
  // nenhum pra ser respondida. AÇÃO=RESPONDER (o mesmo vocabulário que já
  // reconhece "o que é/quanto/quando/quem/onde/quais/explica") é o sinal
  // certo: perguntar-e-explicar nunca precisa de um alvo escopado, ao
  // contrário de EXECUTAR ("corrija", "publica", "envia") que legitimamente
  // pode precisar saber em qual sistema agir.
  const perguntaGenerica = ac.valor === "RESPONDER";

  let confianca: Confianca;
  if (nomeouEntidade) confianca = "ALTA";
  else if (herdouEntidade && temIntencao) confianca = "MEDIA";
  else if (herdouEntidade || temIntencao) confianca = "MEDIA";
  else if (perguntaGenerica) confianca = "MEDIA"; // conversa geral com o Jarvis — nunca bloqueia esperando projeto
  else confianca = "BAIXA";

  // Correção sem entidade nomeada é o pior caso: ele disse que erramos mas não
  // disse o alvo. Perguntar aqui economiza um ciclo inteiro de trabalho errado.
  if (correcao && !nomeouEntidade) confianca = "BAIXA";

  const { modo, motivo } = escolherModo(texto, urg.valor);
  sinais.push({ campo: "modo", valor: `${modo} — ${motivo}`, origem: "padrao" });

  const pergunta =
    confianca === "BAIXA"
      ? correcao
        ? "Qual projeto ou cliente, Cacique?"
        : "É sobre qual projeto ou cliente?"
      : null;

  const rotulo = [clienteNome ?? projetoNome, rotuloIntencao(intencao)]
    .filter(Boolean)
    .join(" · ");

  return {
    projetoId,
    projetoNome,
    clienteId,
    clienteNome,
    intencao,
    acao: ac.valor,
    urgencia: urg.valor,
    modo,
    confianca,
    pergunta,
    correcao,
    retomada,
    sinais,
    rotulo: rotulo || "sem contexto",
  };
}

export function rotuloIntencao(i: Intencao): string {
  const m: Record<Intencao, string> = {
    PROSPECCAO: "Prospecção",
    PRODUTO: "Produto",
    AUDITORIA_ADS: "Auditoria de Ads",
    PRODUCAO_CRIATIVA: "Produção criativa",
    ESTRATEGIA: "Estratégia",
    ANALISE: "Análise",
    OPERACAO: "Operação",
    CONHECIMENTO: "Consulta",
    PESSOAL: "Pessoal",
    INDEFINIDA: "",
  };
  return m[i];
}
