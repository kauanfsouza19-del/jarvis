import "server-only";
import {
  obterPlano,
  passosDoPlano,
  passosProntos,
  atualizarPasso,
  atualizarPlano,
  inserirPassosDinamicos,
  adicionarDependencias,
  type PlanoPasso,
} from "../../orquestrador/repositorio";
import { ferramentaDisponivelPara, ferramentaQueRequerAprovacao, disponibilidadeDaCapacidade } from "../../orquestrador/capacidades";
import { listarProspects } from "../../prospeccao/repositorio";
import { fecharResultadoDeProspects } from "../resultados";
import {
  registrarHandler,
  atualizarJob,
  concluirJob,
  falharJob,
  bloquearJob,
  cancelamentoPedido,
  confirmarCancelamento,
  pausaPedida,
  confirmarPausa,
  pausarParaAprovacao,
  emitirEvento,
  obterJob,
} from "../motor";
import type { HandlerJob } from "../tipos";

/**
 * Executor de Plano — o Orquestrador vira trabalho real aqui. Respeita
 * dependências (só roda um passo quando tudo que ele depende terminou),
 * roda passos independentes em paralelo até um limite, isola falha por
 * passo (um prospect falhar não derruba o plano inteiro), para pra pedir
 * aprovação quando a capacidade exige, e EXPANDE o plano dinamicamente
 * quando um passo concluído revela trabalho que só existe depois de rodar
 * (ver EXPANSORES/garantirExpansoes abaixo) — o Plano deixa de ser um DAG
 * 100% fixado na criação.
 *
 * Limites de segurança (Fase 5 — nunca paralelismo/crescimento ilimitado):
 * LIMITE_CONCORRENCIA trava quantos passos rodam ao mesmo tempo (inclui
 * visitas reais de navegador — é o limite de "browser jobs simultâneos" e
 * de requisições de rede simultâneas, já que cada passo faz no máximo uma
 * visita); MAX_PASSOS_POR_PLANO trava o quanto um plano pode crescer
 * dinamicamente; MAX_TEMPO_EXECUCAO_MS trava o tempo total (persistido —
 * conta desde a CRIAÇÃO do job, sobrevive a retomada após restart, nunca
 * reseta o relógio só porque o processo reiniciou no meio).
 */

const LIMITE_CONCORRENCIA = 3;
const MAX_PASSOS_POR_PLANO = 500;
const MAX_TEMPO_EXECUCAO_MS = 30 * 60 * 1000;

function tempoDecorridoMs(jobId: string): number {
  const job = obterJob(jobId);
  if (!job) return 0;
  return Date.now() - new Date(job.criado_em.replace(" ", "T") + "Z").getTime();
}

const CAPACIDADES_PIPELINE = new Set(["enriquecer_prospect", "diagnosticar_prospect", "analisar_marketing_digital", "pesquisar_instagram"]);
const ESTADOS_TERMINAIS = new Set(["CONCLUIDO", "FALHOU", "PULADO"]);

const ROTULOS_ESTAGIO: Record<string, string> = {
  enriquecer_prospect: "Enriquecer contato",
  diagnosticar_prospect: "Diagnosticar site",
  analisar_marketing_digital: "Analisar marketing",
  pesquisar_instagram: "Pesquisar Instagram",
};
function rotuloEstagio(capacidade: string): string {
  return ROTULOS_ESTAGIO[capacidade] ?? capacidade;
}

/**
 * Registro de expansão — capacidade concluída -> passos novos, se houver.
 * Genérico de propósito: nova regra de expansão é registrar aqui, nunca
 * reescrever o loop principal. pesquisar_instagram entra na MESMA cadeia
 * genérica (expandirProximoEstagioDoPipeline) — Fase 6.
 */
const EXPANSORES: Record<string, (jobId: string, planoId: string, passo: PlanoPasso) => void> = {
  descobrir_negocios: expandirAposDescoberta,
  enriquecer_prospect: expandirProximoEstagioDoPipeline,
  diagnosticar_prospect: expandirProximoEstagioDoPipeline,
  analisar_marketing_digital: expandirProximoEstagioDoPipeline,
  pesquisar_instagram: expandirProximoEstagioDoPipeline,
};

/**
 * Config do pipeline (quais estágios encadear, se quer abordagem e pra
 * quantos) — gravada na entrada do passo de finalização por ser o ÚNICO
 * passo garantido em QUALQUER dos dois caminhos (com ou sem descoberta ao
 * vivo, ver orquestrador/planejador.ts), então todo expansor sabe onde ler.
 */
type ConfigPipeline = { estagiosDesejados?: string[]; desejaAbordagem?: boolean; limiteAbordagem?: number | null };
function lerConfigPipeline(passosExistentes: PlanoPasso[]): ConfigPipeline {
  const passoFinal = passosExistentes.find((p) => p.capacidade === "gerar_arquivo_resultado");
  if (!passoFinal) return {};
  try {
    return JSON.parse(passoFinal.entrada) as ConfigPipeline;
  } catch {
    return {};
  }
}

/**
 * Descoberta encontrou N negócios — só existe DEPOIS de rodar, então o
 * PRIMEIRO estágio da cadeia configurada (ver planejador.ts,
 * detectarEstagiosDesejados — nunca todos os estágios por padrão) é
 * inserido agora, um por negócio achado, carregando o resto da cadeia na
 * própria entrada (cadeiaRestante). Idempotente: se os passos já existem
 * (retomada após restart, ou chamada repetida — `garantirExpansoes` roda a
 * cada giro do loop de propósito), não insere de novo.
 */
function expandirAposDescoberta(jobId: string, planoId: string, passo: PlanoPasso): void {
  if (!passo.saida) return;
  let saida: { prospectIds?: string[] };
  try {
    saida = JSON.parse(passo.saida);
  } catch {
    return;
  }
  const idsDescobertos = saida.prospectIds ?? [];
  if (idsDescobertos.length === 0) return;

  const passosExistentes = passosDoPlano(planoId);
  const { estagiosDesejados } = lerConfigPipeline(passosExistentes);
  const cadeia = estagiosDesejados && estagiosDesejados.length > 0 ? estagiosDesejados : ["diagnosticar_prospect"];
  const [primeiroEstagio, ...restoCadeia] = cadeia;

  const idsJaTemPasso = new Set(
    passosExistentes
      .filter((p) => p.capacidade === primeiroEstagio)
      .map((p) => extrairProspectIdDaEntrada(p.entrada))
      .filter((id): id is string => Boolean(id)),
  );
  const idsNovos = idsDescobertos.filter((id) => !idsJaTemPasso.has(id));
  if (idsNovos.length === 0) return; // já expandido — não duplica trabalho

  const inseridos = inserirPassosDinamicos(
    planoId,
    idsNovos.map((id) => ({
      descricao: `${rotuloEstagio(primeiroEstagio)}: ${id.slice(0, 8)} (descoberto dinamicamente)`,
      capacidade: primeiroEstagio,
      entrada: { prospectId: id, cadeiaRestante: restoCadeia },
      dependeDeIds: [],
    })),
  );
  emitirEvento(
    jobId,
    "passo",
    `Descoberta encontrou ${idsNovos.length} negócio(s) novo(s) — plano expandido com "${rotuloEstagio(primeiroEstagio).toLowerCase()}" por negócio.`,
  );

  // A finalização precisa esperar o trabalho novo também, senão fecharia o
  // resultado antes dos passos recém-inseridos terminarem.
  const passoFinal = passosExistentes.find((p) => p.capacidade === "gerar_arquivo_resultado");
  if (passoFinal) adicionarDependencias(passoFinal.id, inseridos.map((p) => p.id));
}

/** Lê `sinaisSite` da saída de um passo (enriquecimento/diagnóstico/marketing todos podem produzir) — null se não teve ou se o passo falhou. */
function extrairSinaisSiteDaSaida(passo: PlanoPasso): unknown {
  if (passo.status !== "CONCLUIDO" || !passo.saida) return null;
  try {
    const saida = JSON.parse(passo.saida) as { sinaisSite?: unknown };
    return saida.sinaisSite ?? null;
  } catch {
    return null;
  }
}

/**
 * Um estágio do pipeline (enriquecimento/diagnóstico/análise de marketing)
 * terminou — se a entrada dele carregava mais estágios (cadeiaRestante),
 * insere o PRÓXIMO agora, pro MESMO prospect, repassando o sinal de site já
 * coletado (evita revisitar o mesmo site de novo dentro do mesmo pipeline —
 * ver prospeccao/diagnostico.ts, garantirSinais — reaproveitamento só
 * acontece quando o Orquestrador encadeia explicitamente, nunca por
 * adivinhação de tempo).
 */
function expandirProximoEstagioDoPipeline(jobId: string, planoId: string, passo: PlanoPasso): void {
  let entrada: { prospectId?: string; cadeiaRestante?: string[] };
  try {
    entrada = JSON.parse(passo.entrada);
  } catch {
    return;
  }
  const prospectId = entrada.prospectId;
  const cadeiaRestante = entrada.cadeiaRestante ?? [];
  if (!prospectId || cadeiaRestante.length === 0) return;

  const [proximoEstagio, ...restoCadeia] = cadeiaRestante;
  const passosExistentes = passosDoPlano(planoId);
  const jaExiste = passosExistentes.some((p) => p.capacidade === proximoEstagio && extrairProspectIdDaEntrada(p.entrada) === prospectId);
  if (jaExiste) return;

  const sinaisSite = extrairSinaisSiteDaSaida(passo);
  const inseridos = inserirPassosDinamicos(planoId, [
    {
      descricao: `${rotuloEstagio(proximoEstagio)}: ${prospectId.slice(0, 8)}`,
      capacidade: proximoEstagio,
      entrada: { prospectId, cadeiaRestante: restoCadeia, sinaisPreCarregados: sinaisSite },
      dependeDeIds: [passo.id],
    },
  ]);

  const passoFinal = passosExistentes.find((p) => p.capacidade === "gerar_arquivo_resultado");
  if (passoFinal && inseridos[0]) adicionarDependencias(passoFinal.id, [inseridos[0].id]);
}

/**
 * Abordagem é uma decisão de SELEÇÃO entre prospects (as "melhores N", ou
 * HOT/HIGH até um teto) — só dá pra decidir depois que TODO o pipeline por
 * prospect chegou num estado final, nunca encadeada por prospect isolado
 * como os outros estágios. Chamada a cada giro do loop (não por capacidade
 * concluída — é uma checagem de "o lote inteiro terminou?"), idempotente.
 */
function expandirAbordagemAposPipelineCompleto(jobId: string, planoId: string): void {
  const passosExistentes = passosDoPlano(planoId);
  const { desejaAbordagem, limiteAbordagem } = lerConfigPipeline(passosExistentes);
  if (!desejaAbordagem) return;
  if (passosExistentes.some((p) => p.capacidade === "gerar_abordagem")) return; // já expandido

  const passoDescoberta = passosExistentes.find((p) => p.capacidade === "descobrir_negocios");
  if (passoDescoberta && passoDescoberta.status !== "CONCLUIDO") return; // descoberta ainda não rodou — nada pra selecionar ainda

  const passosPipeline = passosExistentes.filter((p) => CAPACIDADES_PIPELINE.has(p.capacidade));
  if (passosPipeline.length === 0) return; // pipeline ainda não expandiu nenhum passo
  if (!passosPipeline.every((p) => ESTADOS_TERMINAIS.has(p.status))) return; // ainda tem estágio rodando

  // Só considera quem foi diagnosticado com sucesso (score real gravado) —
  // enriquecimento/marketing falhar isoladamente não impede abordagem (o
  // score não depende deles, ver prospeccao/repositorio.ts salvarDiagnostico),
  // mas SEM score não há evidência nenhuma pra basear a abordagem em cima.
  const passosDiagnostico = passosPipeline.filter((p) => p.capacidade === "diagnosticar_prospect" && p.status === "CONCLUIDO");
  const idsDiagnosticados = new Set(passosDiagnostico.map((p) => extrairProspectIdDaEntrada(p.entrada)).filter((id): id is string => Boolean(id)));
  if (idsDiagnosticados.size === 0) return;

  const prospects = [...idsDiagnosticados]
    .map((id) => listarProspects().find((x) => x.id === id))
    .filter((x): x is NonNullable<typeof x> => Boolean(x))
    .filter((x) => x.score !== null);

  const ordenados = [...prospects].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const selecionados = limiteAbordagem
    ? ordenados.slice(0, limiteAbordagem)
    : ordenados.filter((p) => p.classificacao_oportunidade === "HOT" || p.classificacao_oportunidade === "HIGH").slice(0, 10);

  if (selecionados.length === 0) {
    emitirEvento(jobId, "passo", "Nenhum prospect qualificado (HOT/HIGH) para gerar abordagem — nenhuma abordagem foi gerada.");
    return;
  }

  const inseridos = inserirPassosDinamicos(
    planoId,
    selecionados.map((p) => ({
      descricao: `Gerar abordagem: ${p.negocio}`,
      capacidade: "gerar_abordagem",
      entrada: { prospectId: p.id },
      dependeDeIds: passosDiagnostico.filter((ps) => extrairProspectIdDaEntrada(ps.entrada) === p.id).map((ps) => ps.id),
    })),
  );
  emitirEvento(jobId, "passo", `Pipeline concluído — gerando abordagem para ${selecionados.length} prospect(s) selecionado(s).`);

  const passoFinal = passosExistentes.find((p) => p.capacidade === "gerar_arquivo_resultado");
  if (passoFinal) adicionarDependencias(passoFinal.id, inseridos.map((p) => p.id));
}

/** Roda todo expansor aplicável — chamado a cada giro do loop (idempotente), cobre tanto progresso ao vivo quanto retomada após restart. */
function garantirExpansoes(jobId: string, planoId: string): void {
  // Teto de segurança contra crescimento sem fim — nunca deixa uma
  // descoberta grande demais (ou um encadeamento mal comportado) inflar o
  // plano indefinidamente. Passa do teto: para de EXPANDIR (novos estágios),
  // mas os passos que já existem continuam rodando normalmente até o fim.
  if (passosDoPlano(planoId).length >= MAX_PASSOS_POR_PLANO) {
    emitirEvento(jobId, "passo", `Limite de ${MAX_PASSOS_POR_PLANO} passos por plano atingido — parando de expandir novos estágios (o que já foi inserido continua rodando).`);
    return;
  }
  for (const passo of passosDoPlano(planoId)) {
    if (passo.status !== "CONCLUIDO") continue;
    const expansor = EXPANSORES[passo.capacidade];
    if (expansor) expansor(jobId, planoId, passo);
  }
  expandirAbordagemAposPipelineCompleto(jobId, planoId);
}

async function executar(jobId: string, parametrosBrutos: unknown): Promise<void> {
  const { planoId } = parametrosBrutos as { planoId: string };
  const plano = obterPlano(planoId);
  if (!plano) {
    falharJob(jobId, `Plano ${planoId} não encontrado.`);
    return;
  }

  atualizarPlano(planoId, { estado: "EXECUTANDO" });
  atualizarJob(jobId, { progresso_total: passosDoPlano(planoId).length });

  let tempoEsgotado = false;
  for (;;) {
    if (cancelamentoPedido(jobId)) {
      const passosAgora = passosDoPlano(planoId);
      const concluidos = passosAgora.filter((p) => p.status === "CONCLUIDO").length;
      confirmarCancelamento(jobId, `${concluidos}/${passosAgora.length} passos concluídos antes do cancelamento.`);
      return;
    }

    // Pausa (Fase 7) — mesmo ponto de checagem do cancelamento, mesma
    // disciplina cooperativa (nunca interrompe um passo em voo). Devolve pra
    // FILA em vez de encerrar; retomarJobPausado relança executar() do zero,
    // e garantirExpansoes()/passosProntos() já são idempotentes o bastante
    // pra pular direto pro que falta (mesmo mecanismo de retomada após
    // restart do servidor, reaproveitado).
    if (pausaPedida(jobId)) {
      const passosAgora = passosDoPlano(planoId);
      const concluidos = passosAgora.filter((p) => p.status === "CONCLUIDO").length;
      confirmarPausa(jobId, `${concluidos}/${passosAgora.length} passos concluídos antes da pausa.`);
      return;
    }

    // Tempo total desde a CRIAÇÃO do job (persistido — sobrevive a
    // retomada após restart, nunca reseta o relógio por reinício de
    // processo). Ao atingir o teto, para de tomar passos NOVOS — o que já
    // está em andamento neste lote termina, e a finalização abaixo fecha o
    // resultado com o que foi possível concluir, nunca trava pra sempre.
    if (tempoDecorridoMs(jobId) > MAX_TEMPO_EXECUCAO_MS) {
      tempoEsgotado = true;
      emitirEvento(jobId, "passo", `Tempo máximo de execução (${Math.round(MAX_TEMPO_EXECUCAO_MS / 60000)} min) atingido — finalizando com o que foi concluído até agora.`);
      break;
    }

    // Idempotente — seguro chamar todo giro, e é o que faz retomada após
    // restart re-expandir o que tiver ficado pendente de expansão.
    garantirExpansoes(jobId, planoId);

    const prontos = passosProntos(planoId);
    if (prontos.length === 0) break; // nada mais pronto — ou terminou, ou travou em dependência não resolvível

    const lote = prontos.slice(0, LIMITE_CONCORRENCIA);
    await Promise.all(lote.map((passo) => executarPasso(jobId, plano.objetivo, passo)));

    const passosAtualizados = passosDoPlano(planoId);
    const concluidosAgora = passosAtualizados.filter((p) => p.status !== "PENDENTE").length;
    atualizarJob(jobId, { progresso_atual: concluidosAgora, progresso_total: passosAtualizados.length, etapa: lote[0]?.descricao ?? null });

    // Algum passo pausou pra aprovação — o job já foi movido para
    // AGUARDANDO_APROVACAO por dentro de executarPasso; para o loop aqui,
    // quem retoma é responderAprovacao() recriando a execução.
    const algumAguardando = passosAtualizados.some((p) => p.status === "AGUARDANDO_APROVACAO");
    if (algumAguardando) return;
  }

  const passosFinais = passosDoPlano(planoId);
  const falharam = passosFinais.filter((p) => p.status === "FALHOU");
  const pendentesPresos = passosFinais.filter((p) => p.status === "PENDENTE"); // dependência nunca resolvida (ex: dependia de um passo que falhou)

  for (const p of pendentesPresos) {
    atualizarPasso(p.id, { status: "PULADO", erro: tempoEsgotado ? "Tempo máximo de execução do job atingido." : "Dependência não foi concluída." });
  }

  // Finalização — capacidade especial, ver nota no planejador. Genérica de
  // propósito: NUNCA filtra por uma capacidade específica (tipo
  // "diagnosticar_prospect") — os IDs vêm da própria entrada do passo
  // (fixados na hora de montar o plano, path derivado/existente) OU da
  // saída do passo de descoberta (path com Places real, onde os IDs só
  // existem depois de rodar). Isso é o que faz a MESMA finalização servir
  // descoberta, enriquecimento, análise de marketing, pontuação e
  // abordagem sem duplicar lógica por operação.
  const passoResultado = passosFinais.find((p) => p.capacidade === "gerar_arquivo_resultado");
  if (passoResultado) {
    const entradaFinal = JSON.parse(passoResultado.entrada) as {
      prospectIds?: string[];
      aguardaDescobertaDoPasso?: number | null;
      parentResultId?: string | null;
      operacao?: string | null;
    };

    let idsProspects = [...(entradaFinal.prospectIds ?? [])];

    if (entradaFinal.aguardaDescobertaDoPasso !== null && entradaFinal.aguardaDescobertaDoPasso !== undefined) {
      const passoDescoberta = passosFinais.find((p) => p.capacidade === "descobrir_negocios");
      if (passoDescoberta?.status === "CONCLUIDO" && passoDescoberta.saida) {
        const saidaDescoberta = JSON.parse(passoDescoberta.saida) as { prospectIds?: string[] };
        idsProspects.push(...(saidaDescoberta.prospectIds ?? []));
      }
    }

    // Isolamento de falha: exclui só o prospect cujo PRÓPRIO passo falhou
    // (casado por prospectId na entrada dele) — nunca o lote inteiro
    // porque um item sem relação deu erro. Exceção: quando abordagem é só
    // um COMPLEMENTO opcional encadeado no fim de um pipeline de descoberta
    // (operacao !== "abordagem" — ver planejador.ts/plano-orquestrado.ts,
    // expandirAbordagemAposPipelineCompleto), falhar em gerar abordagem
    // (ex: sem ANTHROPIC_API_KEY) NUNCA derruba um prospect já descoberto e
    // pontuado com sucesso — só fica sem abordagem_sugerida. Quando
    // abordagem É o propósito do job (comando derivado "gere abordagem
    // para esses"), falhar continua excluindo, como sempre foi.
    const abordagemEhOPropositoDoJob = entradaFinal.operacao === "abordagem";
    const idsComFalha = new Set(
      passosFinais
        .filter((p) => p.capacidade !== "gerar_arquivo_resultado")
        .filter((p) => p.capacidade !== "gerar_abordagem" || abordagemEhOPropositoDoJob)
        .filter((p) => p.status === "FALHOU")
        .map((p) => extrairProspectIdDaEntrada(p.entrada))
        .filter((id): id is string => Boolean(id)),
    );
    idsProspects = [...new Set(idsProspects)].filter((id) => !idsComFalha.has(id));

    if (idsProspects.length > 0) {
      const prospects = idsProspects.map((id) => listarProspects().find((x) => x.id === id)).filter((x): x is NonNullable<typeof x> => Boolean(x));
      const { resultadoId, resumo } = await fecharResultadoDeProspects(
        jobId,
        "lista_prospects",
        prospects,
        {},
        { parentResultId: entradaFinal.parentResultId ?? null, operacao: entradaFinal.operacao ?? "descoberta" },
      );
      atualizarPasso(passoResultado.id, { status: "CONCLUIDO", saida: JSON.stringify(resumo), concluido_em: agora() });
      atualizarPlano(planoId, { estado: "CONCLUIDO" });
      concluirJob(jobId, resultadoId, `${resumo.total} prospect(s) — ${resumo.hotOportunidade} HOT, ${resumo.altaOportunidade} de alta oportunidade.`);
      return;
    }
    atualizarPasso(passoResultado.id, { status: "PULADO", erro: "Nenhum prospect disponível após a execução dos passos anteriores." });
  }

  if (falharam.length > 0 && falharam.length === passosFinais.filter((p) => p.capacidade !== "gerar_arquivo_resultado").length) {
    atualizarPlano(planoId, { estado: "FALHOU" });
    falharJob(jobId, "Todos os passos do plano falharam.");
    return;
  }

  // Chegou aqui sem gerar resultado e sem "todos falharam" tratado acima —
  // ou o plano nunca teve passo nenhum (nada para trabalhar, ver
  // planejador.ts), ou um plano de origem modelo travou numa configuração
  // que não bate com o formato de prospecção. BLOQUEADO, não FALHOU: não é
  // um erro de execução, é "não consegui prosseguir", com o motivo dito.
  atualizarPlano(planoId, { estado: "ADAPTADO" });
  bloquearJob(jobId, plano.resumo_raciocinio || "Plano sem passos executáveis.");
}

function agora(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

/** Toda Tool desta esteira (diagnosticar/enriquecer/analisar/pontuar/abordar) recebe `{prospectId}` — leitura tolerante, nunca lança. */
function extrairProspectIdDaEntrada(entradaJson: string): string | undefined {
  try {
    const e = JSON.parse(entradaJson) as { prospectId?: unknown };
    return typeof e.prospectId === "string" ? e.prospectId : undefined;
  } catch {
    return undefined;
  }
}

async function executarPasso(jobId: string, objetivo: string, passo: PlanoPasso): Promise<void> {
  atualizarPasso(passo.id, { status: "EXECUTANDO", iniciado_em: agora() });
  emitirEvento(jobId, "passo", passo.descricao);

  // Especial: sem Tool própria, tratado na finalização do executar() acima.
  // NUNCA volta pra PENDENTE aqui — PENDENTE é o status que passosProntos()
  // usa pra decidir o que está pronto pra rodar; devolver PENDENTE fazia
  // este passo virar "pronto" de novo no próximo giro do loop, pra sempre
  // (suas dependências já estavam satisfeitas — é por isso que ele foi
  // escolhido pra rodar agora), travando o processo inteiro. AGUARDANDO_
  // FINALIZACAO sai do radar de passosProntos() sem fingir estar concluído.
  if (passo.capacidade === "gerar_arquivo_resultado") {
    atualizarPasso(passo.id, { status: "AGUARDANDO_FINALIZACAO" }); // fica pra finalização decidir
    return;
  }

  const ferramenta = ferramentaDisponivelPara(passo.capacidade);
  if (!ferramenta) {
    const requerAprovacao = ferramentaQueRequerAprovacao(passo.capacidade);
    if (requerAprovacao) {
      atualizarPasso(passo.id, { status: "AGUARDANDO_APROVACAO" });
      pausarParaAprovacao(jobId, {
        ferramenta: requerAprovacao.nome,
        nivelPermissao: requerAprovacao.nivelPermissao,
        titulo: passo.descricao,
        descricao: `Objetivo: ${objetivo}. Passo: ${passo.descricao}.`,
        risco: `Nível de permissão: ${requerAprovacao.nivelPermissao}.`,
      });
      return;
    }
    // Mensagem honesta sobre O MOTIVO real, não um "indisponível" genérico —
    // é a diferença entre "isso não existe ainda" (NAO_IMPLEMENTADO) e "isso
    // existe mas falta credencial" (REQUER_CREDENCIAL), a mesma distinção
    // que /api/ferramentas já expõe.
    const disp = disponibilidadeDaCapacidade(passo.capacidade);
    const motivo =
      disp === "REQUER_CREDENCIAL"
        ? `Capacidade "${passo.capacidade}" existe mas falta credencial configurada.`
        : `Capacidade "${passo.capacidade}" ainda não está implementada.`;
    atualizarPasso(passo.id, { status: "FALHOU", erro: motivo, concluido_em: agora() });
    return;
  }

  try {
    const entrada = JSON.parse(passo.entrada);
    if (!ferramenta.validarEntrada(entrada)) throw new Error("entrada inválida para a ferramenta");
    const resultado = await ferramenta.executar!(entrada);
    if (!resultado.ok) {
      atualizarPasso(passo.id, { status: "FALHOU", erro: resultado.erro, concluido_em: agora() });
      return;
    }
    atualizarPasso(passo.id, { status: "CONCLUIDO", saida: JSON.stringify(resultado.saida), concluido_em: agora() });
  } catch (e) {
    atualizarPasso(passo.id, {
      status: "FALHOU",
      erro: e instanceof Error ? e.message.slice(0, 200) : "erro desconhecido",
      concluido_em: agora(),
    });
  }
}

export const handlerPlanoOrquestrado: HandlerJob = {
  tipo: "plano_orquestrado",
  retomavel: true,
  executar,
};

registrarHandler(handlerPlanoOrquestrado);
