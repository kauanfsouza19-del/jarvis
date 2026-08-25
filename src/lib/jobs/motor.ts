import "server-only";
import { createHash } from "node:crypto";
import { db, id as gerarId, auditar } from "../dados/db";
import { rodarComContextoDeJob } from "./contexto-execucao";
import type { Job, JobPasso, JobStatus, TipoEventoJob, HandlerJob, Notificacao, TipoNotificacao, PrioridadeJob } from "./tipos";

/**
 * Fila com prioridade (Fase 7) — CRITICAL > HIGH > NORMAL > LOW nunca é
 * absoluto: um job esperando mais de 5min tem a prioridade EFETIVA subida
 * um nível, o que impede fome indefinida de LOW quando HIGH não para de
 * chegar. `MAX_JOBS_CONCORRENTES` é o teto global de jobs em EXECUTANDO ao
 * mesmo tempo — cada job ainda tem seu próprio teto de passos concorrentes
 * (LIMITE_CONCORRENCIA em plano-orquestrado.ts), então o pior caso real de
 * navegador/rede simultâneo é MAX_JOBS_CONCORRENTES × esse teto, não
 * ilimitado.
 */
const MAX_JOBS_CONCORRENTES = 3;
const ORDEM_PRIORIDADE: Record<PrioridadeJob, number> = { CRITICAL: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
const ESPERA_PARA_PROMOCAO_MIN = 5;

function contarJobsExecutando(): number {
  return (db().prepare(`SELECT COUNT(*) n FROM jobs WHERE status = 'EXECUTANDO'`).get() as { n: number }).n;
}

function minutosDesde(timestamp: string): number {
  return (Date.now() - new Date(timestamp.replace(" ", "T") + "Z").getTime()) / 60000;
}

/** `pausado=1` fica de fora — pausa só termina quando o Cacique pede explicitamente, nunca por promoção automática. */
function proximosDaFila(vagas: number): Job[] {
  if (vagas <= 0) return [];
  const candidatos = db().prepare(`SELECT * FROM jobs WHERE status = 'FILA' AND pausado = 0`).all() as Job[];
  const comRank = candidatos.map((job) => {
    const boost = minutosDesde(job.criado_em) > ESPERA_PARA_PROMOCAO_MIN ? 1 : 0;
    return { job, rank: Math.max(0, ORDEM_PRIORIDADE[job.prioridade] - boost) };
  });
  comRank.sort((a, b) => a.rank - b.rank || a.job.criado_em.localeCompare(b.job.criado_em));
  return comRank.slice(0, vagas).map((x) => x.job);
}

/** Chamada depois de QUALQUER transição terminal (concluir/falhar/bloquear/cancelar) — libera vaga(s) pro próximo da fila, por prioridade. */
export function promoverProximosDaFila(): void {
  const vagas = MAX_JOBS_CONCORRENTES - contarJobsExecutando();
  for (const job of proximosDaFila(vagas)) {
    dispararExecucao(job.id, job.tipo, JSON.parse(job.parametros));
  }
}

/**
 * Motor de jobs — fundação persistente para execução em background.
 *
 * Três garantias que este arquivo existe para cumprir, todas testadas:
 *  1. Nunca mente sobre estado — um job não fica "executando" para sempre
 *     depois que o processo que o rodava morreu (ver `recuperarJobsOrfaos`).
 *  2. Nunca duplica trabalho por acidente — `criarJob` recusa uma segunda
 *     cópia idêntica ainda em FILA/EXECUTANDO (ver `chaveDedup`).
 *  3. Todo tipo de job passa pelo MESMO ciclo de vida — um Orchestrator
 *     futuro registra um handler novo em `REGISTRO_HANDLERS`, não reescreve
 *     o motor.
 */

const registro = new Map<string, HandlerJob>();

/** Chamado pelos módulos de handler na inicialização — ver src/lib/jobs/handlers/*. */
export function registrarHandler(h: HandlerJob) {
  registro.set(h.tipo, h);
}

function agora(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function chaveDedup(conversaId: string | null, tipo: string, parametros: unknown): string {
  const base = `${conversaId ?? ""}::${tipo}::${JSON.stringify(parametros)}`;
  return createHash("sha256").update(base).digest("hex").slice(0, 24);
}

/* ══════════════════════════ ciclo de vida do job ══════════════════════════ */

export type ResultadoCriarJob = { job: Job; novo: boolean };

/**
 * Cria e IMEDIATAMENTE dispara o job (fire-and-forget — quem chama não
 * espera terminar). Se um job idêntico já está em FILA ou EXECUTANDO para a
 * mesma conversa, devolve ELE em vez de criar um segundo — essa é a garantia
 * de "nunca duplicar trabalho por acidente".
 */
export function criarJob(conversaId: string | null, tipo: string, parametros: unknown, prioridade: PrioridadeJob = "NORMAL"): ResultadoCriarJob {
  const dedup = chaveDedup(conversaId, tipo, parametros);

  const existente = db()
    .prepare(`SELECT * FROM jobs WHERE chave_dedup = ? AND status IN ('FILA','EXECUTANDO') LIMIT 1`)
    .get(dedup) as Job | undefined;
  if (existente) return { job: existente, novo: false };

  const handler = registro.get(tipo);
  const id = gerarId();
  db()
    .prepare(
      `INSERT INTO jobs (id, conversa_id, tipo, parametros, chave_dedup, retomavel, prioridade)
       VALUES (?,?,?,?,?,?,?)`,
    )
    .run(id, conversaId, tipo, JSON.stringify(parametros), dedup, handler?.retomavel ? 1 : 0, prioridade);

  emitirEvento(id, "criado", `Job ${tipo} criado (prioridade ${prioridade}).`);
  auditar({ acao: "job.criar", resultado: id, motivo: tipo });

  // Teto global de concorrência (Fase 7) — sob capacidade, dispara já
  // (comportamento idêntico ao de antes pro caso comum de 1 job por vez);
  // no teto, fica em FILA de verdade até promoverProximosDaFila() abrir vaga.
  if (contarJobsExecutando() < MAX_JOBS_CONCORRENTES) {
    dispararExecucao(id, tipo, parametros);
  } else {
    emitirEvento(id, "criado", `Na fila — ${MAX_JOBS_CONCORRENTES} job(s) já em execução.`);
  }
  return { job: obterJob(id)!, novo: true };
}

/** Dispara sem `await` de propósito — é isso que torna o job "background". */
function dispararExecucao(jobId: string, tipo: string, parametros: unknown) {
  const handler = registro.get(tipo);
  if (!handler) {
    falharJob(jobId, `Nenhum handler registrado para o tipo "${tipo}".`);
    return;
  }
  atualizarJob(jobId, { status: "EXECUTANDO", iniciado_em: agora() });
  emitirEvento(jobId, "iniciado", "Execução iniciada.");

  // Contexto assíncrono (Fase 7) — qualquer chamada de modelo feita a
  // partir daqui, por mais fundo que esteja na pilha, sabe a que job
  // atribuir custo (ver jobs/contexto-execucao.ts, modelo/uso.ts).
  void rodarComContextoDeJob(jobId, () => handler.executar(jobId, parametros)).catch((e) => {
    falharJob(jobId, e instanceof Error ? e.message.slice(0, 300) : "erro desconhecido");
  });
}

export function obterJob(id: string): Job | undefined {
  return db().prepare(`SELECT * FROM jobs WHERE id = ?`).get(id) as Job | undefined;
}

export function listarJobsDaConversa(conversaId: string): Job[] {
  return db()
    .prepare(`SELECT * FROM jobs WHERE conversa_id = ? ORDER BY criado_em DESC LIMIT 30`)
    .all(conversaId) as Job[];
}

export function listarJobsAtivos(): Job[] {
  return db()
    .prepare(`SELECT * FROM jobs WHERE status IN ('FILA','EXECUTANDO','AGUARDANDO_APROVACAO') ORDER BY criado_em DESC`)
    .all() as Job[];
}

/** Ativos + terminais recentes — o painel JOBS do Command Center usa isto para mostrar tudo num só lugar. */
export function listarJobsRecentes(limite = 50): Job[] {
  return db().prepare(`SELECT * FROM jobs ORDER BY criado_em DESC LIMIT ?`).all(limite) as Job[];
}

export function atualizarJob(id: string, campos: Partial<Record<keyof Job, unknown>>) {
  const chaves = Object.keys(campos);
  if (chaves.length === 0) return;
  db()
    .prepare(`UPDATE jobs SET ${chaves.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`)
    .run(...([...chaves.map((k) => campos[k as keyof Job]), id] as never[]));
}

export function concluirJob(id: string, resultadoId: string, resumoParaEvento: string) {
  atualizarJob(id, {
    status: "CONCLUIDO",
    resultado_id: resultadoId,
    concluido_em: agora(),
    etapa: "Concluído",
  });
  emitirEvento(id, "concluido", resumoParaEvento);
  criarNotificacao("JOB_CONCLUIDO", id, "Tarefa concluída", resumoParaEvento);
  auditar({ acao: "job.concluir", resultado: resultadoId, impacto: resumoParaEvento });
  promoverProximosDaFila();
}

export function falharJob(id: string, motivo: string) {
  atualizarJob(id, { status: "FALHOU", erro: motivo, concluido_em: agora() });
  emitirEvento(id, "falhou", motivo);
  criarNotificacao("JOB_FALHOU", id, "Tarefa falhou", motivo);
  auditar({ acao: "job.falhar", resultado: id, erro: motivo });
  promoverProximosDaFila();
}

/** Achado revisando o motor (Fase 7): bloquearJob nunca notificava — um job BLOQUEADO (ex: falta credencial) ficava mudo pro Cacique, indistinguível de "ainda rodando" sem abrir o painel. */
export function bloquearJob(id: string, motivo: string) {
  atualizarJob(id, { status: "BLOQUEADO", erro: motivo, concluido_em: agora() });
  emitirEvento(id, "falhou", motivo);
  criarNotificacao("JOB_BLOQUEADO", id, "Tarefa bloqueada", motivo);
  auditar({ acao: "job.bloquear", resultado: id, erro: motivo });
  promoverProximosDaFila();
}

/** Cooperativo: o handler precisa checar isso entre passos — não interrompe uma chamada em voo. */
export function cancelamentoPedido(jobId: string): boolean {
  const j = obterJob(jobId);
  return j?.cancelamento_solicitado === 1;
}

export function solicitarCancelamento(jobId: string): { ok: boolean; motivo?: string } {
  const j = obterJob(jobId);
  if (!j) return { ok: false, motivo: "job_nao_encontrado" };
  if (j.status !== "FILA" && j.status !== "EXECUTANDO") {
    return { ok: false, motivo: `job já está em estado final (${j.status})` };
  }
  atualizarJob(jobId, { cancelamento_solicitado: 1 });
  emitirEvento(jobId, "cancelado", "Cancelamento solicitado pelo Cacique.");
  return { ok: true };
}

/** Handler chama isto quando percebe o pedido — fecha o job como CANCELADO de verdade. */
export function confirmarCancelamento(jobId: string, feitoAteAgora: string) {
  atualizarJob(jobId, { status: "CANCELADO", erro: null, concluido_em: agora(), etapa: "Cancelado" });
  emitirEvento(jobId, "cancelado", `Cancelado. ${feitoAteAgora}`);
  auditar({ acao: "job.cancelar", resultado: jobId });
  promoverProximosDaFila();
}

/**
 * Pausa cooperativa (Fase 7) — mesmo espírito do cancelamento (o handler
 * precisa checar entre passos, nunca interrompe uma chamada em voo), mas
 * devolve pra FILA em vez de encerrar. `pausado=1` (não `status`) é o que
 * marca isso — jobs.status continua só com os 7 valores já testados/
 * referenciados por FK em outras tabelas, nenhuma migração arriscada de
 * CHECK na tabela mais referenciada do schema. A fila NUNCA promove um job
 * pausado sozinha (ver proximosDaFila) — só volta a rodar quando o Cacique
 * chama retomarJobPausado.
 */
export function pausaPedida(jobId: string): boolean {
  const j = obterJob(jobId);
  return j?.pausa_solicitada === 1;
}

export function solicitarPausa(jobId: string): { ok: boolean; motivo?: string } {
  const j = obterJob(jobId);
  if (!j) return { ok: false, motivo: "job_nao_encontrado" };
  if (j.status !== "EXECUTANDO") return { ok: false, motivo: `só é possível pausar job EXECUTANDO (está ${j.status})` };
  atualizarJob(jobId, { pausa_solicitada: 1 });
  emitirEvento(jobId, "pausado", "Pausa solicitada pelo Cacique.");
  auditar({ acao: "job.solicitar_pausa", resultado: jobId });
  return { ok: true };
}

/** Handler chama isto quando percebe o pedido — devolve pra FILA (não é falha, não perde trabalho já feito). */
export function confirmarPausa(jobId: string, feitoAteAgora: string) {
  atualizarJob(jobId, { status: "FILA", pausa_solicitada: 0, pausado: 1, etapa: `Pausado — ${feitoAteAgora}` });
  emitirEvento(jobId, "pausado", `Pausado. ${feitoAteAgora}`);
  auditar({ acao: "job.pausar", resultado: jobId, impacto: feitoAteAgora });
  promoverProximosDaFila();
}

export function retomarJobPausado(jobId: string): { ok: boolean; motivo?: string } {
  const j = obterJob(jobId);
  if (!j) return { ok: false, motivo: "job_nao_encontrado" };
  if (j.status !== "FILA" || j.pausado !== 1) return { ok: false, motivo: "job não está pausado" };
  atualizarJob(jobId, { pausado: 0 });
  emitirEvento(jobId, "retomado", "Retomado pelo Cacique após pausa.");
  auditar({ acao: "job.retomar_pausa", resultado: jobId });
  if (contarJobsExecutando() < MAX_JOBS_CONCORRENTES) dispararExecucao(jobId, j.tipo, JSON.parse(j.parametros));
  return { ok: true };
}

/**
 * Mudar prioridade DEPOIS de criado (Command Center, Fase 10) — mesmo
 * vocabulário fechado de `criarJob`, validado aqui (não confia em campo
 * dinâmico vindo direto do corpo da requisição — `atualizarJob` monta SQL
 * a partir das chaves do objeto, então só chaves literais conhecidas
 * chegam nele). Só faz sentido enquanto o job ainda pode ser reordenado —
 * mudar prioridade de um job já terminal é rejeitado com motivo honesto.
 */
export function redefinirPrioridade(jobId: string, prioridade: string): { ok: boolean; motivo?: string; prioridade?: PrioridadeJob } {
  if (!(prioridade in ORDEM_PRIORIDADE)) return { ok: false, motivo: `prioridade inválida (use ${Object.keys(ORDEM_PRIORIDADE).join("/")})` };
  const j = obterJob(jobId);
  if (!j) return { ok: false, motivo: "job_nao_encontrado" };
  if (j.status !== "FILA" && j.status !== "EXECUTANDO") return { ok: false, motivo: `job já está em estado terminal (${j.status}) — prioridade não muda mais nada` };
  const validada = prioridade as PrioridadeJob;
  atualizarJob(jobId, { prioridade: validada });
  emitirEvento(jobId, "prioridade_alterada", `Prioridade alterada para ${validada} pelo Cacique.`);
  auditar({ acao: "job.redefinir_prioridade", resultado: jobId, impacto: validada });
  return { ok: true, prioridade: validada };
}

/** Só jobs FALHOU podem ser retentados — reabre em FILA e redispara. */
export function retentarJob(jobId: string): { ok: boolean; motivo?: string } {
  const j = obterJob(jobId);
  if (!j) return { ok: false, motivo: "job_nao_encontrado" };
  if (j.status !== "FALHOU") return { ok: false, motivo: `só é possível retentar job FALHOU (está ${j.status})` };

  atualizarJob(jobId, {
    status: "FILA",
    erro: null,
    tentativas: j.tentativas + 1,
    cancelamento_solicitado: 0,
  });
  emitirEvento(jobId, "retomado", `Retentativa #${j.tentativas + 1}.`);
  dispararExecucao(jobId, j.tipo, JSON.parse(j.parametros));
  return { ok: true };
}

/* ══════════════════════════ aprovação de ação de alto impacto ══════════════════════════ */

/**
 * Um handler chama isto quando a Tool que precisa usar tem
 * `exigeAprovacaoExplicita: true` (SEND/DELETE/FINANCIAL/EXTERNAL_COMMUNICATION/
 * ACCOUNT_ACCESS — ver src/lib/ferramentas/tipos.ts). O job para em
 * AGUARDANDO_APROVACAO e só continua se o Cacique aprovar explicitamente.
 *
 * `planoPassoId` (Fase 22, achado real): sem isto, aprovação de um Plano
 * de DAG só era rastreada por job_id+ferramenta — em um Plano com VÁRIOS
 * passos usando a MESMA capacidade (ex: editar dois arquivos diferentes),
 * aprovar um aprovava os outros também, e nada fazia o passo pausado
 * voltar a rodar de verdade (ver responderAprovacao). Job de Tool única
 * (handlers/executar-ferramenta.ts) não precisa disto — não recebe
 * planoPassoId, comportamento idêntico a antes.
 */
export function pausarParaAprovacao(
  jobId: string,
  entrada: { ferramenta: string; nivelPermissao: string; titulo: string; descricao: string; risco?: string; planoPassoId?: string },
): string {
  const id = gerarId();
  db()
    .prepare(
      `INSERT INTO aprovacoes (id, job_id, ferramenta, nivel_permissao, titulo, descricao, risco, plano_passo_id)
       VALUES (?,?,?,?,?,?,?,?)`,
    )
    .run(id, jobId, entrada.ferramenta, entrada.nivelPermissao, entrada.titulo, entrada.descricao, entrada.risco ?? null, entrada.planoPassoId ?? null);

  atualizarJob(jobId, { status: "AGUARDANDO_APROVACAO", etapa: `Aguardando aprovação: ${entrada.titulo}` });
  emitirEvento(jobId, "aguardando_aprovacao", entrada.titulo);
  criarNotificacao("APROVACAO_NECESSARIA", jobId, "Aprovação necessária", entrada.descricao);
  auditar({ acao: "aprovacao.solicitar", resultado: id, motivo: entrada.ferramenta, permissao: null });
  promoverProximosDaFila(); // este job parou de contar como EXECUTANDO — abre vaga pro próximo da fila
  return id;
}

export function listarAprovacoes(soPendentes = false) {
  const where = soPendentes ? "WHERE estado = 'PENDENTE'" : "";
  return db().prepare(`SELECT * FROM aprovacoes ${where} ORDER BY criado_em DESC LIMIT 50`).all();
}

/**
 * Aprovar RETOMA o job (redispara o handler); rejeitar CANCELA o job com o
 * motivo dito.
 *
 * Fase 22 — passo de Plano (plano_passo_id preenchido) precisa de um passo
 * extra que o job de Tool única nunca precisou: o `plano_passos.status`
 * dele fica travado em AGUARDANDO_APROVACAO, e `passosProntos()` só
 * escolhe passo PENDENTE — sem resetar aqui, redisparar o handler nunca
 * fazia esse passo específico rodar de novo (achado real, nunca chegou a
 * aparecer porque nenhuma Tool com aprovação tinha rodado dentro de um
 * Plano de DAG até agora). `executarPasso` (plano-orquestrado.ts) já
 * checa se existe aprovação APROVADA para o próprio passo.id antes de
 * pausar de novo — mesma idempotência que executar-ferramenta.ts sempre
 * teve pra job_id+ferramenta, agora no nível certo pra Plano.
 */
export function responderAprovacao(aprovacaoId: string, aprovada: boolean): { ok: boolean; motivo?: string } {
  const a = db().prepare(`SELECT * FROM aprovacoes WHERE id = ?`).get(aprovacaoId) as
    | { id: string; job_id: string | null; estado: string; titulo: string; plano_passo_id: string | null }
    | undefined;
  if (!a) return { ok: false, motivo: "aprovacao_nao_encontrada" };
  if (a.estado !== "PENDENTE") return { ok: false, motivo: `já respondida (${a.estado})` };

  db()
    .prepare(`UPDATE aprovacoes SET estado = ?, respondido_em = ? WHERE id = ?`)
    .run(aprovada ? "APROVADA" : "REJEITADA", agora(), aprovacaoId);
  auditar({ acao: aprovada ? "aprovacao.aprovar" : "aprovacao.rejeitar", resultado: aprovacaoId });

  if (a.plano_passo_id) {
    if (aprovada) {
      db().prepare(`UPDATE plano_passos SET status = 'PENDENTE', erro = NULL WHERE id = ?`).run(a.plano_passo_id);
    } else {
      db()
        .prepare(`UPDATE plano_passos SET status = 'FALHOU', erro = ?, concluido_em = ? WHERE id = ?`)
        .run("Aprovação rejeitada pelo Cacique.", agora(), a.plano_passo_id);
    }
  }

  if (!a.job_id) return { ok: true };
  const job = obterJob(a.job_id);
  if (!job) return { ok: true };

  if (aprovada) {
    emitirEvento(a.job_id, "retomado", `Aprovado: ${a.titulo}.`);
    dispararExecucao(a.job_id, job.tipo, JSON.parse(job.parametros));
  } else {
    // Job de Tool única (plano_passo_id null) continua cancelando o job
    // inteiro — comportamento de sempre. Job de Plano com o passo já
    // marcado FALHOU acima: redispara em vez de cancelar de propósito —
    // o loop principal decide sozinho se os OUTROS passos independentes
    // continuam (isolamento de falha já existente) ou se o plano fecha.
    if (a.plano_passo_id) {
      emitirEvento(a.job_id, "retomado", `Rejeitado: ${a.titulo}. Continuando com os demais passos, se houver.`);
      dispararExecucao(a.job_id, job.tipo, JSON.parse(job.parametros));
      return { ok: true };
    }
    atualizarJob(a.job_id, { status: "CANCELADO", concluido_em: agora() });
    emitirEvento(a.job_id, "cancelado", `Rejeitado: ${a.titulo}.`);
    promoverProximosDaFila();
  }
  return { ok: true };
}

/* ══════════════════════════ passos ══════════════════════════ */

export function registrarPasso(jobId: string, ordem: number, nome: string): string {
  const id = gerarId();
  db()
    .prepare(`INSERT INTO job_passos (id, job_id, ordem, nome, status, iniciado_em) VALUES (?,?,?,?,?,?)`)
    .run(id, jobId, ordem, nome, "EXECUTANDO", agora());
  emitirEvento(jobId, "passo", nome);
  return id;
}

export function concluirPasso(passoId: string, detalhe?: string) {
  db()
    .prepare(`UPDATE job_passos SET status='CONCLUIDO', detalhe=?, concluido_em=? WHERE id=?`)
    .run(detalhe ?? null, agora(), passoId);
}

export function falharPasso(passoId: string, erro: string) {
  db().prepare(`UPDATE job_passos SET status='FALHOU', erro=?, concluido_em=? WHERE id=?`).run(erro, agora(), passoId);
}

export function passosDoJob(jobId: string): JobPasso[] {
  return db().prepare(`SELECT * FROM job_passos WHERE job_id = ? ORDER BY ordem`).all(jobId) as JobPasso[];
}

/** Nomes de passo já CONCLUIDO — é isso que uma retomada usa pra pular trabalho feito. */
export function passosConcluidos(jobId: string): Set<string> {
  const linhas = db()
    .prepare(`SELECT nome FROM job_passos WHERE job_id = ? AND status = 'CONCLUIDO'`)
    .all(jobId) as Array<{ nome: string }>;
  return new Set(linhas.map((l) => l.nome));
}

/* ══════════════════════════ eventos ══════════════════════════ */

export function emitirEvento(jobId: string, tipo: TipoEventoJob, mensagem: string) {
  db()
    .prepare(`INSERT INTO job_eventos (id, job_id, tipo, mensagem) VALUES (?,?,?,?)`)
    .run(gerarId(), jobId, tipo, mensagem);
}

export function eventosDoJob(jobId: string) {
  return db().prepare(`SELECT * FROM job_eventos WHERE job_id = ? ORDER BY criado_em`).all(jobId);
}

/* ══════════════════════════ notificações ══════════════════════════ */

export function criarNotificacao(
  tipo: TipoNotificacao,
  jobId: string | null,
  titulo: string,
  mensagem: string,
  conteudoId: string | null = null,
  itemInteligenciaId: string | null = null,
): string {
  const id = gerarId();
  db()
    .prepare(`INSERT INTO notificacoes (id, tipo, job_id, conteudo_id, item_inteligencia_id, titulo, mensagem) VALUES (?,?,?,?,?,?,?)`)
    .run(id, tipo, jobId, conteudoId, itemInteligenciaId, titulo, mensagem);
  return id;
}

export function listarNotificacoes(soNaoLidas = false): Notificacao[] {
  const where = soNaoLidas ? "WHERE lida = 0" : "";
  return db().prepare(`SELECT * FROM notificacoes ${where} ORDER BY criado_em DESC LIMIT 50`).all() as Notificacao[];
}

export function marcarNotificacaoLida(id: string) {
  db().prepare(`UPDATE notificacoes SET lida = 1 WHERE id = ?`).run(id);
}

/* ══════════════════════════ recuperação após reinício ══════════════════════════ */

/**
 * Roda uma vez, na inicialização do servidor (ver instrumentation.ts).
 *
 * Um job em EXECUTANDO quando o servidor caiu está mentindo — o processo que
 * o rodava não existe mais. Duas saídas, nunca uma terceira:
 *   - handler é retomável E tem passo concluído → volta pra FILA, e o
 *     handler pula os passos já feitos quando rodar de novo.
 *   - senão → FALHOU, com o motivo dito com todas as letras.
 * Nunca fica "executando" para sempre. Nunca finge que terminou.
 */
export function recuperarJobsOrfaos(): { retomados: number; falhados: number } {
  const orfaos = db().prepare(`SELECT * FROM jobs WHERE status = 'EXECUTANDO'`).all() as Job[];
  let retomados = 0;
  let falhados = 0;

  for (const j of orfaos) {
    const handler = registro.get(j.tipo);
    const temPassoFeito = passosConcluidos(j.id).size > 0;

    if (handler?.retomavel && temPassoFeito) {
      atualizarJob(j.id, { status: "FILA", cancelamento_solicitado: 0 });
      emitirEvento(j.id, "retomado", "Servidor reiniciou durante a execução — retomando do último passo concluído.");
      dispararExecucao(j.id, j.tipo, JSON.parse(j.parametros));
      retomados++;
    } else {
      falharJob(j.id, "Interrompido por reinício do servidor antes de terminar. Peça de novo para reiniciar do zero.");
      falhados++;
    }
  }

  return { retomados, falhados };
}
