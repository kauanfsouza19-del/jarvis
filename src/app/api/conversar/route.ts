import Anthropic from "@anthropic-ai/sdk";
import { montarNucleo } from "@/lib/nucleo";
import { MODELOS, escolherComplexidade, escolherEsforco } from "@/lib/modelos";
import {
  adicionarMensagem,
  mensagensDa,
  obterConversa,
  timelineDaConversa,
} from "@/lib/dados/repositorio";
import { montarContexto } from "@/lib/contexto";
import { resolverContexto } from "@/lib/contexto/resolver";
import { construirLexico } from "@/lib/contexto/lexico";
import { detectarComandoDeTarefa, detectarFollowUp } from "@/lib/tarefas/roteador";
import { detectarComandoDeConteudo } from "@/lib/social/deteccao";
import "@/lib/jobs/registro-handlers";
import { ultimoResultadoDaConversa, filtrarResultado } from "@/lib/jobs/resultados";
import { orquestrar } from "@/lib/orquestrador/orquestrador";
import { interpretarComandoDerivado } from "@/lib/orquestrador/interpretador";

export const runtime = "nodejs";
export const maxDuration = 300;

type Corpo = {
  conversa_id: string;
  mensagem: string;
  /** Override explícito — clique no chip de contexto, nunca escolha obrigatória. */
  projeto_id?: string | null;
  /** Veio do overlay de voz — resposta concisa por padrão, texto continua completo. */
  voz?: boolean;
};

export async function POST(req: Request) {
  let corpo: Corpo;
  try {
    corpo = await req.json();
  } catch {
    return Response.json({ erro: "json_invalido" }, { status: 400 });
  }

  const mensagem = (corpo.mensagem ?? "").trim();
  if (!mensagem) return Response.json({ erro: "mensagem_vazia" }, { status: 400 });
  if (!corpo.conversa_id) return Response.json({ erro: "conversa_id_obrigatorio" }, { status: 400 });

  const conversa = obterConversa(corpo.conversa_id);
  if (!conversa) return Response.json({ erro: "conversa_nao_encontrada" }, { status: 404 });

  // ── resolução de contexto — sem chamada de modelo, custo zero ──
  // A timeline vem do que foi PERSISTIDO nos turnos anteriores desta conversa,
  // não de estado de componente. É isso que faz o contexto sobreviver a reload
  // e a restart de servidor.
  const lexico = construirLexico();
  const timeline = timelineDaConversa(corpo.conversa_id);
  const resolvido = resolverContexto(mensagem, lexico, timeline);

  // Override explícito (clique no chip) vence a inferência, mas não apaga o
  // resto do que foi resolvido — só substitui o projeto.
  const projetoId = corpo.projeto_id !== undefined ? corpo.projeto_id : resolvido.projetoId;
  const modo = resolvido.modo;

  // A pergunta é gravada ANTES de qualquer chamada de modelo. Se a API falhar,
  // a mensagem do Cacique não se perde.
  adicionarMensagem({
    conversa_id: corpo.conversa_id,
    papel: "user",
    conteudo: mensagem,
    projeto_id: projetoId,
    cliente_nome: resolvido.clienteNome,
    intencao: resolvido.intencao,
    confianca_contexto: resolvido.confianca,
    modo,
  });

  const codificador = new TextEncoder();

  /** Resposta sem modelo — pergunta de esclarecimento, confirmação de tarefa
   * ou resultado atualizado. Mesmo protocolo ndjson que a resposta de
   * modelo usa, então o cliente não precisa de um caminho especial. */
  function respostaLocal(texto: string, estadoExec: string, extra: Record<string, unknown> = {}) {
    adicionarMensagem({
      conversa_id: corpo.conversa_id,
      papel: "assistant",
      conteudo: texto,
      projeto_id: projetoId,
      cliente_nome: resolvido.clienteNome,
      intencao: resolvido.intencao,
      confianca_contexto: resolvido.confianca,
      modo,
      estado_exec: estadoExec,
    });

    const fluxo = new ReadableStream({
      start(controlador) {
        const enviar = (e: object) => controlador.enqueue(codificador.encode(JSON.stringify(e) + "\n"));
        enviar({
          tipo: "inicio",
          modelo: null,
          esforco: null,
          memorias: 0,
          conhecimento: 0,
          contexto: contextoParaCliente(resolvido),
          ...extra,
        });
        enviar({ tipo: "texto", texto });
        enviar({ tipo: "fim", uso: { entrada: 0, saida: 0, cache_lido: 0 }, local: true });
        controlador.close();
      },
    });
    return new Response(fluxo, {
      headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  // ── comando derivado sobre resultado existente: "enriqueça esses leads",
  // "analise o marketing delas", "crie uma abordagem para elas" ──
  // Checado ANTES do gate de confiança BAIXA de propósito: o motor de
  // contexto não tem como saber que "enriqueça com telefone e Instagram"
  // tem contexto suficiente — ele não nomeia projeto/cliente, então cairia
  // em BAIXA/"é sobre qual projeto?" mesmo sendo uma continuação óbvia do
  // resultado que a própria conversa já tem. Achado testando de verdade: o
  // comando derivado nunca chegava a ser interpretado, sempre virava
  // pergunta de esclarecimento. Vocabulário bater (regex, custo zero) não
  // basta sozinho — só entra no Orquestrador se EXISTIR resultado anterior
  // nesta conversa (checagem de banco por índice, sub-milissegundo, não é
  // chamada de modelo), o que evita sequestrar uma pergunta comum só
  // porque ela menciona "instagram" ou "e-mail" sem ter nada a ver com
  // prospecção.
  const candidatoDerivado = interpretarComandoDerivado(mensagem);
  // Mesmo problema vale pro filtro SIMPLES ("mostra só os com telefone") —
  // achado testando de verdade: passou no gate do comando derivado (não é
  // um, `interpretarComandoDerivado` devolve null de propósito pra frase
  // de filtro) mas caía no MESMO buraco de confiança BAIXA logo depois,
  // porque também não nomeia projeto/cliente. Os dois precisam do mesmo
  // adiantamento de checagem.
  const candidatoFiltroSimples = detectarFollowUp(mensagem);
  const resultadoAnteriorDaConversa =
    candidatoDerivado || candidatoFiltroSimples ? ultimoResultadoDaConversa(corpo.conversa_id) : null;
  const temResultadoAnteriorParaDerivar = candidatoDerivado ? Boolean(resultadoAnteriorDaConversa) : false;
  const temResultadoAnteriorParaFiltrar = candidatoFiltroSimples ? Boolean(resultadoAnteriorDaConversa) : false;

  // Fase 11 — mesmo problema documentado acima pro comando derivado: "prepare
  // 5 posts sobre X" não nomeia projeto/cliente nenhum, então o resolvedor de
  // contexto (que não conhece "conteúdo social" como intenção) classificava
  // como confiança BAIXA e a mensagem nunca chegava a ser reconhecida como
  // comando — sempre virava pergunta de esclarecimento. Achado testando de
  // verdade (ver testes/social-fase11.mjs seção 5).
  const candidatoConteudo = detectarComandoDeConteudo(mensagem);

  // ── confiança BAIXA: uma pergunta concisa, sem gastar modelo nenhum ──
  // Nunca dispara quando já identificamos um comando derivado, um filtro
  // simples válido sobre um resultado que realmente existe, OU um comando
  // de conteúdo social reconhecido.
  if (resolvido.confianca === "BAIXA" && resolvido.pergunta && !temResultadoAnteriorParaDerivar && !temResultadoAnteriorParaFiltrar && !candidatoConteudo) {
    return respostaLocal(resolvido.pergunta, "esclarecendo");
  }

  // ── comando de tarefa: "encontre 50 pizzarias em Osasco" ──
  // detectarComandoDeTarefa aqui é só um filtro barato (regex, custo zero)
  // pra não chamar o Orquestrador em toda mensagem — a decisão de verdade
  // (que capacidades usar, em que ordem) é do Orquestrador/Planejador, nunca
  // fixada aqui. Mensagem que não bate o filtro pode ainda assim virar
  // tarefa via planejamento por modelo dentro de orquestrar(), então o
  // filtro só evita o caminho mais óbvio, não é a única porta de entrada.
  //
  // Fase 11 — detectarComandoDeConteudo é o MESMO tipo de filtro barato,
  // pra "prepare 5 posts sobre X" também disparar orquestrar() (que já
  // reconhece o comando de verdade dentro de planejar(), ver
  // orquestrador/planejador.ts) — sem isto, a mensagem caía direto na
  // resposta conversacional normal, nunca chegando ao Planejador.
  // Fase 20 (missão de agente) — mesmo tipo de filtro barato acima, agora
  // pra ação de EXECUÇÃO com alvo suficientemente claro ("corrija o login
  // do Jarvis", "audite o código") também chegar ao Orquestrador/Planejador
  // em vez de só virar conversa normal. BAIXA fica de fora de propósito —
  // ação sem alvo (ver bloco de esclarecimento acima) já nunca chega aqui;
  // isto só amplia a PORTA DE ENTRADA, nunca decide sozinho o que fazer —
  // orquestrar()/planejar() continuam livres pra devolver null (não
  // orquestrável) e cair na conversa normal, exatamente como já acontece
  // pros outros gatilhos desta condição.
  const acaoExecutarComAlvo = resolvido.acao === "EXECUTAR" && resolvido.confianca !== "BAIXA";

  if (detectarComandoDeTarefa(mensagem, resolvido) || candidatoConteudo || (candidatoDerivado && temResultadoAnteriorParaDerivar) || acaoExecutarComAlvo) {
    const orquestrado = await orquestrar(corpo.conversa_id, mensagem, resolvido);
    if (orquestrado) {
      const texto = orquestrado.jobId
        ? `Entendi. ${orquestrado.resumoRaciocinio}`
        : `Plano pronto (nível de autonomia em "só sugerir" — nada foi executado ainda). ${orquestrado.resumoRaciocinio}`;
      return respostaLocal(texto, orquestrado.jobId ? "executando_tarefa" : "plano_sugerido", {
        execucaoId: orquestrado.jobId ?? undefined,
        planoId: orquestrado.planoId,
      });
    }
  }

  // ── follow-up sobre resultado existente: "mostra só os com whatsapp" ──
  // Nunca dispara busca nova — filtra o snapshot que a tarefa anterior já
  // gravou. Isso é o que faz "uma tarefa, várias ações de acompanhamento"
  // funcionar sem gastar um centavo de modelo a cada pergunta. Reusa o
  // resultado já buscado acima (mesma checagem que liberou o gate de
  // confiança BAIXA) — nunca consulta o banco duas vezes pra mesma coisa.
  if (candidatoFiltroSimples && resultadoAnteriorDaConversa) {
    const { resultadoId, resumo } = candidatoFiltroSimples.apenasExibir
      ? { resultadoId: resultadoAnteriorDaConversa.resultado.id, resumo: JSON.parse(resultadoAnteriorDaConversa.resultado.resumo) }
      : await filtrarResultado(resultadoAnteriorDaConversa.resultado.id, candidatoFiltroSimples);

    const texto = candidatoFiltroSimples.apenasExibir ? "Aqui está o resultado." : `Filtrei: ${resumo.total} prospect(s) atendem o critério.`;
    return respostaLocal(texto, "resultado_atualizado", { resultadoId });
  }
  // Sem resultado anterior nesta conversa (ou sem filtro reconhecido) —
  // segue para o modelo responder normalmente, sem inventar um resultado
  // que não existe.

  // Recuperação: memórias + conhecimento relevantes. Custo zero, sem modelo.
  const contexto = montarContexto(mensagem, projetoId);

  const chave = process.env.ANTHROPIC_API_KEY;
  if (!chave) {
    // A recuperação ACONTECEU — só a chamada de modelo não. Reportar as
    // contagens reais para a interface poder mostrar o que de fato rodou.
    return Response.json(
      {
        erro: "sem_chave",
        detalhe:
          "ANTHROPIC_API_KEY não está definida. A pergunta foi salva na conversa; o Jarvis responde assim que a chave existir.",
        contexto_recuperado: contexto.resumo,
        memorias: contexto.memorias.length,
        conhecimento: contexto.trechos.length,
        contexto: contextoParaCliente(resolvido),
        refs: [
          ...contexto.memorias.map((m) => ({ tipo: "MEMÓRIA", valor: m.titulo, origem: "memorias" })),
          ...contexto.trechos.map((t) => ({
            tipo: "BASE",
            valor: t.afirmacao,
            origem: "trechos_conhecimento",
          })),
        ],
      },
      { status: 503 },
    );
  }

  const complexidade = escolherComplexidade(mensagem);
  const modelo = MODELOS[complexidade];
  const esforco = escolherEsforco(complexidade);
  const cliente = new Anthropic({ apiKey: chave });

  const historico = mensagensDa(corpo.conversa_id)
    .filter((m) => m.papel === "user" || m.papel === "assistant")
    .slice(-30)
    .map((m) => ({ role: m.papel as "user" | "assistant", content: m.conteudo }));

  const fluxo = new ReadableStream({
    async start(controlador) {
      const enviar = (e: object) =>
        controlador.enqueue(codificador.encode(JSON.stringify(e) + "\n"));
      let acumulado = "";

      try {
        enviar({
          tipo: "inicio",
          modelo,
          esforco,
          memorias: contexto.memorias.length,
          conhecimento: contexto.trechos.length,
          contexto: contextoParaCliente(resolvido),
        });

        const stream = cliente.messages.stream({
          model: modelo,
          max_tokens: 16000,
          system: [
            // Bloco estável — cai no cache.
            {
              type: "text",
              text: montarNucleo(modo),
              cache_control: { type: "ephemeral" },
            },
            // Bloco volátil — contexto recuperado desta pergunta.
            ...(contexto.bloco ? [{ type: "text" as const, text: contexto.bloco }] : []),
            // Instrução de voz: concisa por padrão, sem truncar o texto depois —
            // é o próprio modelo que gera curto, não um corte artificial nosso.
            ...(corpo.voz
              ? [
                  {
                    type: "text" as const,
                    text:
                      "## MODO VOZ\nEsta pergunta veio do overlay de voz e a resposta será falada em voz alta. Responda em até 4 frases. Se precisar de mais detalhe, diga que o Cacique pode ver a versão completa em texto — mas não gere a versão longa agora.",
                  },
                ]
              : []),
          ],
          output_config: { effort: esforco },
          messages: historico,
        });

        for await (const evento of stream) {
          if (evento.type === "content_block_delta" && evento.delta.type === "text_delta") {
            acumulado += evento.delta.text;
            enviar({ tipo: "texto", texto: evento.delta.text });
          }
        }

        const final = await stream.finalMessage();

        adicionarMensagem({
          conversa_id: corpo.conversa_id,
          papel: "assistant",
          conteudo: acumulado,
          projeto_id: projetoId,
          cliente_nome: resolvido.clienteNome,
          intencao: resolvido.intencao,
          confianca_contexto: resolvido.confianca,
          modo,
          modelo,
          esforco,
          tokens_entrada: final.usage.input_tokens,
          tokens_saida: final.usage.output_tokens,
          cache_lido: final.usage.cache_read_input_tokens ?? 0,
          estado_exec: "ok",
          fontes: contexto.trechos.map((t) => t.id),
          memorias_ref: contexto.memorias.map((m) => m.id),
        });

        enviar({
          tipo: "fim",
          uso: {
            entrada: final.usage.input_tokens,
            saida: final.usage.output_tokens,
            cache_lido: final.usage.cache_read_input_tokens ?? 0,
          },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "erro desconhecido";
        if (acumulado) {
          adicionarMensagem({
            conversa_id: corpo.conversa_id,
            papel: "assistant",
            conteudo: acumulado,
            estado_exec: "erro",
          });
        }
        enviar({ tipo: "erro", detalhe: msg });
      } finally {
        controlador.close();
      }
    },
  });

  return new Response(fluxo, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

/** Forma enxuta do contexto resolvido que vai pro cliente — sem os regexes internos. */
function contextoParaCliente(r: ReturnType<typeof resolverContexto>) {
  return {
    projetoNome: r.projetoNome,
    clienteNome: r.clienteNome,
    intencao: r.intencao,
    acao: r.acao,
    urgencia: r.urgencia,
    modo: r.modo,
    confianca: r.confianca,
    rotulo: r.rotulo,
    correcao: r.correcao,
    retomada: r.retomada,
  };
}
