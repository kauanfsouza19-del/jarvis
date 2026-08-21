/**
 * Vocabulário do motor de jobs — fundação para o Orchestrator futuro.
 *
 * Estes tipos não são decoração de arquitetura: cada um corresponde a uma
 * tabela real (`jobs`, `job_passos`, `job_eventos`, `notificacoes`,
 * `aprovacoes`) e a um comportamento testado. Um Orchestrator futuro que
 * coordene agentes especializados usa o MESMO Job — ele não precisa de outro
 * sistema de execução, só de um `tipo` novo registrado no despachante.
 */

export type JobStatus =
  | "FILA"
  | "EXECUTANDO"
  | "AGUARDANDO_APROVACAO"
  | "CONCLUIDO"
  | "FALHOU"
  | "BLOQUEADO"
  | "CANCELADO";

/** CRITICAL nunca espera atrás de HIGH/NORMAL/LOW; dentro da mesma prioridade, ordem de chegada. Fase 7. */
export type PrioridadeJob = "CRITICAL" | "HIGH" | "NORMAL" | "LOW";

export type Job = {
  id: string;
  conversa_id: string | null;
  tipo: string;
  parametros: string; // JSON
  chave_dedup: string | null;
  status: JobStatus;
  progresso_atual: number;
  progresso_total: number;
  etapa: string | null;
  resultado_id: string | null;
  erro: string | null;
  tentativas: number;
  retomavel: number;
  cancelamento_solicitado: number;
  criado_em: string;
  iniciado_em: string | null;
  concluido_em: string | null;
  /** Fase 7 — Jobs como núcleo operacional. */
  prioridade: PrioridadeJob;
  custo_usd: number;
  ferramenta_usada: string | null;
  agente_id: string | null;
  pausa_solicitada: number;
  pausado: number;
};

export type StatusPasso = "PENDENTE" | "EXECUTANDO" | "CONCLUIDO" | "FALHOU" | "PULADO";

export type JobPasso = {
  id: string;
  job_id: string;
  ordem: number;
  nome: string;
  status: StatusPasso;
  detalhe: string | null;
  erro: string | null;
  iniciado_em: string | null;
  concluido_em: string | null;
};

export type TipoEventoJob =
  | "criado"
  | "iniciado"
  | "passo"
  | "progresso"
  | "aguardando_aprovacao"
  | "concluido"
  | "falhou"
  | "cancelado"
  | "pausado"
  | "retomado"
  | "prioridade_alterada";

export type JobEvento = {
  id: string;
  job_id: string;
  tipo: TipoEventoJob;
  mensagem: string;
  criado_em: string;
};

/**
 * Nível de permissão de uma ferramenta ou ação. Ferramenta futura declara o
 * seu nível — ela não escolhe se precisa de aprovação, o nível decide isso.
 * READ/WRITE nunca pedem aprovação por si só; a partir de SEND, sim (ver
 * `exigeAprovacao` em `../ferramentas/tipos`).
 */
export type NivelPermissao =
  | "READ"
  | "WRITE"
  | "SEND"
  | "DELETE"
  | "FINANCIAL"
  | "EXTERNAL_COMMUNICATION"
  | "ACCOUNT_ACCESS";

export type EstadoAprovacao = "PENDENTE" | "APROVADA" | "REJEITADA" | "EXPIRADA";

export type Aprovacao = {
  id: string;
  job_id: string | null;
  ferramenta: string | null;
  nivel_permissao: NivelPermissao | null;
  titulo: string;
  descricao: string;
  risco: string | null;
  estado: EstadoAprovacao;
  criado_em: string;
  respondido_em: string | null;
};

export type TipoNotificacao =
  | "JOB_CONCLUIDO"
  | "JOB_FALHOU"
  | "APROVACAO_NECESSARIA"
  | "ERRO_SISTEMA"
  | "INFO"
  | "JOB_BLOQUEADO"
  | "OPORTUNIDADE_ENCONTRADA"
  | "CONTEUDO_AGUARDANDO_APROVACAO"
  | "INTELIGENCIA_IMPORTANTE";

export type Notificacao = {
  id: string;
  tipo: TipoNotificacao;
  job_id: string | null;
  /** Fase 11 — Social Media Operating System. Conteúdo criado à mão não tem job_id; isto rastreia mesmo assim. */
  conteudo_id: string | null;
  /** Fase 13 — Intelligence Engine. Coleta de inteligência não tem job_id (pode rodar fora de um Job também). */
  item_inteligencia_id: string | null;
  titulo: string;
  mensagem: string;
  lida: number;
  criado_em: string;
};

/**
 * Contrato que um tipo de job implementa para entrar no despachante.
 * `retomavel: true` diz ao motor que, se o job for encontrado EXECUTANDO
 * após reinício do servidor, ele pode voltar para FILA e o handler vai ler
 * `job_passos` para saber o que já estava concluído em vez de refazer tudo.
 */
export type HandlerJob = {
  tipo: string;
  retomavel: boolean;
  executar: (jobId: string, parametros: unknown) => Promise<void>;
};
