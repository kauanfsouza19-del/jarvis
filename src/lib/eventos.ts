/**
 * Barramento de eventos do Jarvis.
 *
 * Regra que governa a interface inteira: **o reator só mostra o que está
 * realmente acontecendo.** Cada evento aqui é emitido por código que de fato
 * executou — busca no banco, chamada de tool, erro real. Não existe evento
 * decorativo, e a UI nunca inventa atividade para parecer ocupada.
 */

export type TipoEvento =
  | "COMANDO_RECEBIDO"
  | "PENSANDO_INICIOU"
  | "MEMORIA_RECUPERADA"
  | "CONHECIMENTO_RECUPERADO"
  | "PLANO_CRIADO"
  | "TOOL_INICIOU"
  | "TOOL_CONCLUIU"
  | "TOOL_FALHOU"
  | "SKILL_INICIOU"
  | "SKILL_CONCLUIU"
  | "APROVACAO_NECESSARIA"
  | "EXECUCAO_INICIOU"
  | "EXECUCAO_CONCLUIU"
  | "RESPOSTA_FINAL"
  | "ERRO";

export type Evento = {
  id: string;
  tipo: TipoEvento;
  em: number;
  rotulo: string;
  detalhe?: string;
  tool?: string;
  /** Referências reais — id de memória, caminho de arquivo, id de trecho. */
  refs?: Array<{ tipo: string; valor: string; origem?: string }>;
  duracaoMs?: number;
};

/** Estados do reator. Derivados do evento mais recente, nunca escolhidos à mão. */
export type EstadoReator =
  | "ocioso"
  | "ouvindo"
  | "pensando"
  | "planejando"
  | "executando"
  | "aguardando_aprovacao"
  | "falando"
  | "erro"
  | "offline";

/** Mapeia evento → estado. Único lugar onde essa tradução acontece. */
export function estadoDoEvento(tipo: TipoEvento): EstadoReator | null {
  switch (tipo) {
    case "COMANDO_RECEBIDO":
    case "PENSANDO_INICIOU":
    case "MEMORIA_RECUPERADA":
    case "CONHECIMENTO_RECUPERADO":
      return "pensando";
    case "PLANO_CRIADO":
      return "planejando";
    case "TOOL_INICIOU":
    case "SKILL_INICIOU":
    case "EXECUCAO_INICIOU":
      return "executando";
    case "APROVACAO_NECESSARIA":
      return "aguardando_aprovacao";
    case "ERRO":
    case "TOOL_FALHOU":
      return "erro";
    case "RESPOSTA_FINAL":
    case "EXECUCAO_CONCLUIU":
      return "ocioso";
    default:
      return null;
  }
}

/** Rótulo curto e honesto por tipo de evento. */
export const ROTULO_EVENTO: Record<TipoEvento, string> = {
  COMANDO_RECEBIDO: "COMANDO",
  PENSANDO_INICIOU: "PENSANDO",
  MEMORIA_RECUPERADA: "MEMÓRIA",
  CONHECIMENTO_RECUPERADO: "CONHECIMENTO",
  PLANO_CRIADO: "PLANO",
  TOOL_INICIOU: "TOOL",
  TOOL_CONCLUIU: "TOOL",
  TOOL_FALHOU: "TOOL",
  SKILL_INICIOU: "SKILL",
  SKILL_CONCLUIU: "SKILL",
  APROVACAO_NECESSARIA: "APROVAÇÃO",
  EXECUCAO_INICIOU: "EXECUÇÃO",
  EXECUCAO_CONCLUIU: "EXECUÇÃO",
  RESPOSTA_FINAL: "PRONTO",
  ERRO: "ERRO",
};

/** Tools que o sistema pode acionar. Só entram aqui quando existem de verdade. */
export const TOOLS_CONHECIDAS = {
  banco: { rotulo: "BANCO", disponivel: true },
  memoria: { rotulo: "MEMÓRIA", disponivel: true },
  conhecimento: { rotulo: "CONHECIMENTO", disponivel: true },
  arquivo: { rotulo: "ARQUIVO", disponivel: true },
  indexador: { rotulo: "INDEXADOR", disponivel: true },
  modelo: { rotulo: "MODELO", disponivel: false },
  web: { rotulo: "WEB", disponivel: false },
  google_ads: { rotulo: "GOOGLE ADS", disponivel: false },
  meta: { rotulo: "META", disponivel: false },
  youtube: { rotulo: "YOUTUBE", disponivel: false },
  agenda: { rotulo: "AGENDA", disponivel: false },
  email: { rotulo: "E-MAIL", disponivel: false },
  criativo: { rotulo: "CRIATIVO", disponivel: false },
  agendador: { rotulo: "AGENDADOR", disponivel: false },
} as const;

export type ChaveTool = keyof typeof TOOLS_CONHECIDAS;
