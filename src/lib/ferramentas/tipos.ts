/**
 * Abstração de Tool — o que um Orchestrator futuro vai chamar em vez de
 * código solto. Cada Tool declara sua própria fronteira de permissão; quem
 * executa a Tool não decide se precisa aprovação, o nível decide.
 *
 * `implementado: false` é o que impede uma Tool futura (gmail.search,
 * whatsapp.send, instagram.search…) de aparecer como conectada sem estar —
 * ela existe no registro para o Orchestrator "saber que existe", mas
 * chamar `executar` numa Tool não implementada lança, nunca finge sucesso.
 */

import type { NivelPermissao } from "../jobs/tipos";

/** A partir daqui, uma ação de alto impacto sempre exige aprovação explícita. */
const NIVEIS_QUE_EXIGEM_APROVACAO: NivelPermissao[] = [
  "SEND",
  "DELETE",
  "FINANCIAL",
  "EXTERNAL_COMMUNICATION",
  "ACCOUNT_ACCESS",
];

export function exigeAprovacao(nivel: NivelPermissao): boolean {
  return NIVEIS_QUE_EXIGEM_APROVACAO.includes(nivel);
}

export type ResultadoFerramenta<TSaida = unknown> = { ok: true; saida: TSaida } | { ok: false; erro: string };

export type Ferramenta<TEntrada = unknown, TSaida = unknown> = {
  nome: string;
  descricao: string;
  /** O que a Tool FAZ, em vocabulário de capacidade — é isto que o Planejador procura, nunca o nome da Tool direto. */
  capacidade: string;
  nivelPermissao: NivelPermissao;
  /** Quando true, o motor de job nunca executa direto — cria uma Aprovacao e para em AGUARDANDO_APROVACAO. */
  exigeAprovacaoExplicita: boolean;
  /** Falso até a Tool ser conectada de verdade — nunca reportado como conectado quando falso. */
  implementado: boolean;
  /** Nome da variável de ambiente que a Tool precisa — usada só para relatar REQUER_CREDENCIAL, nunca lida do valor aqui. */
  credencialNecessaria?: string;
  /**
   * Custo real da capacidade (Fase 6 — "free-first", nunca custo estimado
   * fictício). "gratis": nenhuma chamada paga envolvida (API pública, OSM,
   * ou navegação direta). "credencial_com_free_tier": exige credencial, mas
   * o provedor real tem uso gratuito dentro de um limite (ex: Brave Search).
   * "pago": cobra por uso real (ex: SerpApi, tokens de modelo). Omitido =
   * inferido de `credencialNecessaria` (sem credencial → gratis).
   */
  custo?: "gratis" | "credencial_com_free_tier" | "pago";
  /** Checagem barata de entrada — não é validação de schema completa, é a fronteira mínima: tipo e presença. */
  validarEntrada: (entrada: unknown) => entrada is TEntrada;
  executar?: (entrada: TEntrada) => Promise<ResultadoFerramenta<TSaida>>;
};

/** Custo real, nunca estimativa fictícia de economia — Fase 6. */
export function custoDe(f: Ferramenta): "gratis" | "credencial_com_free_tier" | "pago" {
  if (f.custo) return f.custo;
  return f.credencialNecessaria ? "pago" : "gratis";
}

/**
 * Estado real de uma Tool — o Orquestrador nunca trata "existe no registro"
 * como "posso usar agora". Cinco estados, nunca um booleano escondendo
 * qual dos cinco é o motivo real.
 */
export type Disponibilidade = "DISPONIVEL" | "INDISPONIVEL" | "REQUER_CREDENCIAL" | "REQUER_APROVACAO" | "NAO_IMPLEMENTADO";

export function disponibilidadeDe(f: Ferramenta): Disponibilidade {
  if (!f.implementado) return "NAO_IMPLEMENTADO";
  if (f.credencialNecessaria && !process.env[f.credencialNecessaria]) return "REQUER_CREDENCIAL";
  if (f.exigeAprovacaoExplicita || exigeAprovacao(f.nivelPermissao)) return "REQUER_APROVACAO";
  return "DISPONIVEL";
}

/**
 * Contrato de resultado normalizado — o que chega ao modelo/à UI depois de
 * QUALQUER execução de Tool. `ResultadoFerramenta` (acima) é o contrato
 * simples que quem ESCREVE uma Tool implementa; isto é o envelope mais rico
 * que o Orquestrador monta EM CIMA dele antes de decidir o próximo passo —
 * nunca a saída crua de uma Tool vira contexto de modelo sem passar por
 * aqui primeiro.
 */
export type ResultadoNormalizado = {
  sucesso: boolean;
  /** Distingue "rodou e o resultado é vazio" de "não rodou por erro" — crítico pro Orquestrador decidir o próximo passo certo. */
  status: "SUCESSO" | "SUCESSO_VAZIO" | "FALHA_EXECUCAO" | "NAO_DISPONIVEL";
  dados: unknown;
  metadados: Record<string, unknown>;
  avisos: string[];
  erros: string[];
  fonte: string;
  iniciadoEm: string;
  concluidoEm: string;
};

export function normalizarResultado(
  fonte: string,
  iniciadoEm: string,
  r: ResultadoFerramenta,
  vazio: (saida: unknown) => boolean = () => false,
): ResultadoNormalizado {
  const concluidoEm = new Date().toISOString().replace("T", " ").slice(0, 19);
  if (!r.ok) {
    return { sucesso: false, status: "FALHA_EXECUCAO", dados: null, metadados: {}, avisos: [], erros: [r.erro], fonte, iniciadoEm, concluidoEm };
  }
  const ehVazio = vazio(r.saida);
  return {
    sucesso: true,
    status: ehVazio ? "SUCESSO_VAZIO" : "SUCESSO",
    dados: r.saida,
    metadados: {},
    avisos: [],
    erros: [],
    fonte,
    iniciadoEm,
    concluidoEm,
  };
}

/** Sanitiza texto de entrada antes de qualquer Tool usá-lo — nunca deixa segredo entrar em log/prompt via entrada de Tool. */
export function sanitizarEntradaTexto(v: unknown, maxLen = 4000): string {
  if (typeof v !== "string") throw new Error("entrada_deve_ser_string");
  return v.slice(0, maxLen).trim();
}
