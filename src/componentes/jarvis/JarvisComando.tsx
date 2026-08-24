"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { JarvisReator } from "./JarvisReator";
import { JarvisConstellation } from "./JarvisConstellation";
import { JarvisCommandConsole } from "./JarvisConsole";
import { JarvisVozOverlay } from "./JarvisVozOverlay";
import {
  PainelProximaAcao,
  PainelInbox,
  PainelAgenda,
  PainelOportunidades,
  PainelRiscos,
  PainelTarefaAtiva,
  PainelMemoriaRecente,
  PainelConteudoSocial,
  PainelInteligencia,
  useWarRoomResumo,
  useMemoriasRecentes,
  useConteudosAguardandoAprovacao,
  useInteligenciaImportante,
  destaquePorTexto,
} from "./JarvisPaineis";
import { JarvisBentoGrid } from "./JarvisBentoGrid";
import { JarvisActionStream, JarvisMemoryTrace, JarvisToolIndicator } from "./JarvisHud";
import { useJarvis } from "./useJarvis";
import { useVoz } from "./useVoz";
import { JarvisExecucao } from "./JarvisTarefa";
import { JarvisResultadoCard } from "./JarvisResultado";
import { JarvisTaskRail } from "./JarvisTaskRail";

type Turno = {
  id?: string;
  papel: "user" | "assistant";
  conteudo: string;
  contexto?: ContextoCliente | null;
  execucaoId?: string;
  resultadoId?: string;
};
type ConversaMeta = { id: string; titulo: string };

type ContextoCliente = {
  projetoNome: string | null;
  clienteNome: string | null;
  intencao: string;
  acao: string;
  urgencia: string;
  modo: string;
  confianca: "ALTA" | "MEDIA" | "BAIXA";
  rotulo: string;
  correcao: boolean;
  retomada: boolean;
};

const ROTULO_INTENCAO: Record<string, string> = {
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

const ROTULO_MODO: Record<string, string> = {
  consultivo: "consultivo",
  direto: "direto",
  socio_incomodo: "sócio incômodo",
};

/**
 * Command Center — a única tela principal do Jarvis.
 *
 * Nada de seletor de projeto, nada de seletor de modo. O Cacique fala, o
 * motor de contexto (server-side, custo zero) resolve projeto, cliente,
 * intenção e modo a partir da própria mensagem e do que já foi dito nesta
 * conversa. O chip de contexto no topo é informação, não controle — ele
 * mostra o que o Jarvis entendeu, nunca obriga a escolher antes de falar.
 */
export function JarvisComando({ onAbrirSistema }: { onAbrirSistema: (aba?: string) => void }) {
  const j = useJarvis();
  const voz = useVoz();

  const [conversas, setConversas] = useState<ConversaMeta[]>([]);
  const [conversaId, setConversaId] = useState<string | null>(null);
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [contextoAtual, setContextoAtual] = useState<ContextoCliente | null>(null);
  const [detalheContexto, setDetalheContexto] = useState(false);

  const [entrada, setEntrada] = useState("");
  const [parcial, setParcial] = useState("");
  const [painelAberto, setPainelAberto] = useState(false);
  const [vozAberta, setVozAberta] = useState(false);
  const [anexo, setAnexo] = useState<{ nome: string; tipo: string; tamanhoKB: number } | null>(
    null,
  );

  const fimRef = useRef<HTMLDivElement>(null);
  const arquivoRef = useRef<HTMLInputElement>(null);
  const transcricaoEnviadaRef = useRef<string | null>(null);

  const ocupado = j.estado === "pensando" || j.estado === "executando";

  // Um fetch cada, compartilhado pelas cartas bento que dependem deles.
  const warRoom = useWarRoomResumo();
  const memoriasRecentes = useMemoriasRecentes(3);
  const conteudosSociais = useConteudosAguardandoAprovacao();
  const inteligenciaRecente = useInteligenciaImportante();
  const destaque = destaquePorTexto(turnos.filter((t) => t.papel === "user").at(-1)?.conteudo);

  /* ─────────────── carga inicial ─────────────── */

  useEffect(() => {
    void (async () => {
      const c = await fetch("/api/conversas").then((r) => r.json());
      setConversas(c.conversas ?? []);
      if (c.conversas?.[0]) void abrir(c.conversas[0].id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turnos, parcial, j.eventos.length]);

  const abrir = useCallback(async (id: string) => {
    const r = await fetch(`/api/conversas/${id}`).then((x) => x.json());
    if (r.erro) return;
    setConversaId(id);
    setTurnos(
      (r.mensagens ?? [])
        .filter((m: { papel: string }) => m.papel !== "system")
        .map((m: { id: string; papel: Turno["papel"]; conteudo: string }) => ({
          id: m.id,
          papel: m.papel,
          conteudo: m.conteudo,
        })),
    );
    j.limpar();
    setParcial("");
    setPainelAberto(false);
    setContextoAtual(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ─────────────── envio (texto ou voz) ─────────────── */

  const enviar = useCallback(
    async (textoBruto: string, opcoes?: { viaVoz?: boolean }) => {
      const texto = textoBruto.trim();
      if (!texto || ocupado) return;

      let alvo = conversaId;
      if (!alvo) {
        const r = await fetch("/api/conversas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ titulo: texto.slice(0, 60) }),
        }).then((x) => x.json());
        alvo = r.conversa.id;
        setConversaId(alvo);
        setConversas((c) => [r.conversa, ...c]);
      }

      // Anexo entra como nota honesta — hoje só nome/tipo/tamanho, nunca
      // conteúdo binário fingido. O motor de contexto ainda infere categoria
      // pelo nome do arquivo.
      const textoFinal = anexo
        ? `${texto}\n\n[Anexo: ${anexo.nome} · ${anexo.tipo || "tipo desconhecido"} · ${anexo.tamanhoKB} KB — conteúdo binário não lido, apenas metadados.]`
        : texto;

      setEntrada("");
      setParcial("");
      setAnexo(null);
      j.limpar();
      j.emitir("COMANDO_RECEBIDO", "COMANDO", { detalhe: texto.slice(0, 70) });
      setTurnos((t) => [...t, { papel: "user", conteudo: texto }]);
      if (opcoes?.viaVoz) voz.pensando();

      let acumulado = "";
      let execucaoId: string | undefined;
      let resultadoId: string | undefined;

      try {
        j.emitir("TOOL_INICIOU", "TOOL", { tool: "banco", detalhe: "gravando comando" });

        const resp = await fetch("/api/conversar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversa_id: alvo,
            mensagem: textoFinal,
            voz: Boolean(opcoes?.viaVoz),
          }),
        });

        j.emitir("TOOL_CONCLUIU", "TOOL", { tool: "banco" });

        if (!resp.ok) {
          const dd = await resp.json().catch(() => ({}));
          if (dd.contexto) setContextoAtual(dd.contexto);
          if (dd.memorias > 0 || dd.conhecimento > 0) {
            j.emitir("MEMORIA_RECUPERADA", "MEMÓRIA", {
              detalhe: dd.contexto_recuperado,
              refs: dd.refs ?? [],
            });
          }
          throw new Error(dd.detalhe ?? `Falha ${resp.status}`);
        }
        if (!resp.body) throw new Error("Resposta sem corpo.");

        const leitor = resp.body.getReader();
        const dec = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { done, value } = await leitor.read();
          if (done) break;
          buffer += dec.decode(value, { stream: true });
          const linhas = buffer.split("\n");
          buffer = linhas.pop() ?? "";

          for (const linha of linhas) {
            if (!linha.trim()) continue;
            const ev = JSON.parse(linha);

            if (ev.tipo === "inicio") {
              if (ev.contexto) setContextoAtual(ev.contexto);
              if (ev.execucaoId) execucaoId = ev.execucaoId;
              if (ev.resultadoId) resultadoId = ev.resultadoId;
              if (ev.memorias > 0) {
                j.emitir("MEMORIA_RECUPERADA", "MEMÓRIA", {
                  detalhe: `${ev.memorias} memória(s) relevante(s)`,
                });
              }
              if (ev.conhecimento > 0) {
                j.emitir("CONHECIMENTO_RECUPERADO", "CONHECIMENTO", {
                  detalhe: `${ev.conhecimento} trecho(s) da base`,
                });
              }
              if (ev.modelo) j.emitir("PENSANDO_INICIOU", "PENSANDO", { detalhe: ev.modelo });
            } else if (ev.tipo === "texto") {
              acumulado += ev.texto;
              setParcial(acumulado);
            } else if (ev.tipo === "fim") {
              j.emitir("RESPOSTA_FINAL", "PRONTO", {
                detalhe: ev.uso?.entrada ? `${ev.uso.entrada}↓ ${ev.uso.saida}↑` : "resolvido localmente",
              });
            } else if (ev.tipo === "erro") {
              throw new Error(ev.detalhe);
            }
          }
        }

        setTurnos((t) => [...t, { papel: "assistant", conteudo: acumulado, execucaoId, resultadoId }]);
        setParcial("");

        if (opcoes?.viaVoz) voz.falar(acumulado);
      } catch (e) {
        j.emitir("ERRO", "ERRO", {
          detalhe: e instanceof Error ? e.message.slice(0, 140) : "erro desconhecido",
        });
        setParcial("");
        if (opcoes?.viaVoz) voz.parar();
      }
    },
    [ocupado, conversaId, j, voz, anexo],
  );

  /* ─────────────── voz ─────────────── */

  const abrirVoz = useCallback(() => {
    setVozAberta(true);
    transcricaoEnviadaRef.current = null;
    voz.iniciar();
  }, [voz]);

  const fecharVoz = useCallback(() => {
    voz.parar();
    setVozAberta(false);
  }, [voz]);

  // Reconhecimento terminou sozinho (silêncio) com transcrição não-vazia →
  // envia automaticamente. Evita um segundo clique que o fluxo de voz não pede.
  useEffect(() => {
    if (
      vozAberta &&
      voz.estado === "ocioso" &&
      voz.transcricao.trim() &&
      transcricaoEnviadaRef.current !== voz.transcricao
    ) {
      transcricaoEnviadaRef.current = voz.transcricao;
      void enviar(voz.transcricao, { viaVoz: true });
    }
  }, [vozAberta, voz.estado, voz.transcricao, enviar]);

  /* ─────────────── anexo ─────────────── */

  const escolherArquivo = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setAnexo({ nome: f.name, tipo: f.type, tamanhoKB: Math.round(f.size / 1024) });
  }, []);

  /* ─────────────── render ─────────────── */

  const HUD = (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4 rolagem">
      <JarvisTaskRail onAbrirJobs={() => onAbrirSistema("jobs")} />

      <ChipContexto contexto={contextoAtual} aberto={detalheContexto} onAlternar={() => setDetalheContexto((v) => !v)} />

      <JarvisBentoGrid>
        <PainelProximaAcao dados={warRoom} onAbrirWarRoom={() => onAbrirSistema("warroom")} />
        <PainelTarefaAtiva dados={warRoom} />
        <PainelConteudoSocial conteudos={conteudosSociais} onAbrirSocial={() => onAbrirSistema("social")} />
        <PainelInteligencia itens={inteligenciaRecente} onAbrirInteligencia={() => onAbrirSistema("intelligence")} />
        <PainelInbox onAbrirIntegracoes={() => onAbrirSistema("integracoes")} destaque={destaque.inbox} />
        <PainelAgenda dados={warRoom} onAbrirIntegracoes={() => onAbrirSistema("integracoes")} destaque={destaque.agenda} />
        <PainelOportunidades dados={warRoom} />
        <PainelRiscos dados={warRoom} />
        <PainelMemoriaRecente memorias={memoriasRecentes} />
      </JarvisBentoGrid>

      {conversas.length > 0 && (
        <div className="min-h-0">
          <p className="rotulo mb-1.5">CONVERSAS</p>
          <div className="flex flex-col gap-0.5">
            {conversas.slice(0, 8).map((c) => (
              <button
                key={c.id}
                onClick={() => void abrir(c.id)}
                className="flex min-h-11 items-center truncate px-1 text-left text-[12px] transition lg:min-h-7"
                style={{
                  color: c.id === conversaId ? "var(--color-tinta)" : "var(--color-tinta-fraca)",
                }}
              >
                {c.titulo}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="relative flex h-full min-h-0">
      {/* Ambiente — atrás de tudo. Recua quando a voz assume o primeiro plano. */}
      <JarvisConstellation
        estado={j.estado}
        atenuado={vozAberta}
        toolAtiva={j.toolsAtivas[0] ?? null}
        rotuloContexto={contextoAtual?.clienteNome ?? contextoAtual?.projetoNome ?? null}
      />

      <aside className="relative z-10 hidden w-64 shrink-0 border-r border-[var(--color-linha)] lg:block xl:w-[26rem]">
        {HUD}
      </aside>

      {painelAberto && (
        <div className="fixed inset-0 z-30 lg:hidden">
          <button
            className="absolute inset-0 bg-black/60"
            onClick={() => setPainelAberto(false)}
            aria-label="Fechar painel"
          />
          <aside className="entra-lado absolute left-0 top-0 h-full w-72 border-r border-[var(--color-linha)] bg-[var(--color-fundo-2)]">
            {HUD}
          </aside>
        </div>
      )}

      <main className="relative z-10 flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 flex-col items-center gap-3 border-b border-[var(--color-linha)] px-4 pb-4 pt-4 sm:flex-row sm:items-start sm:gap-6 sm:px-6">
          <button
            className="mono flex h-11 shrink-0 items-center px-2 text-[10px] tracking-[0.14em] text-[var(--color-tinta-fraca)] lg:hidden"
            onClick={() => setPainelAberto(true)}
            aria-label="Abrir painel do sistema"
          >
            ☰ HUD
          </button>

          <div className="shrink-0 sm:hidden">
            <JarvisReator estado={j.estado} amplitude={j.amplitude} tamanho={96} progresso={null} />
          </div>
          <div className="hidden shrink-0 sm:block">
            <JarvisReator estado={j.estado} amplitude={j.amplitude} tamanho={148} progresso={null} />
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-2 self-stretch pt-1">
            <div className="flex items-center gap-2">
              <p className="rotulo">ATIVIDADE</p>
              {j.toolsAtivas.map((t) => (
                <JarvisToolIndicator key={t} chave={t} estado="ativa" />
              ))}
            </div>
            <div className="min-h-[52px]">
              <JarvisActionStream eventos={j.eventos} />
            </div>
          </div>
        </div>

        <div className="rolagem min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
          <div className="mx-auto flex max-w-2xl flex-col gap-7">
            {turnos.length === 0 && !parcial && (
              <div className="pt-4">
                <p className="mb-2 text-lg text-[var(--color-tinta)]">Pronto, Cacique.</p>
                <p className="max-w-md text-sm leading-relaxed text-[var(--color-tinta-media)]">
                  Fale normalmente — sobre o Locatta, um cliente, uma campanha. O
                  Jarvis resolve o contexto sozinho. O que aparece acima é o que
                  está realmente acontecendo; nada é animação decorativa.
                </p>
              </div>
            )}

            {turnos.map((t, i) => (
              <div key={t.id ?? i} className="flex flex-col gap-3">
                <Mensagem papel={t.papel} texto={t.conteudo} />
                {t.execucaoId && !t.resultadoId && (
                  <JarvisExecucao
                    execucaoId={t.execucaoId}
                    onConcluida={(resultadoId) =>
                      setTurnos((atual) =>
                        atual.map((x) => (x.execucaoId === t.execucaoId ? { ...x, resultadoId } : x)),
                      )
                    }
                  />
                )}
                {t.resultadoId && <JarvisResultadoCard resultadoId={t.resultadoId} />}
              </div>
            ))}
            {parcial && <Mensagem papel="assistant" texto={parcial} />}

            {j.estado === "erro" && (
              <div className="entra border-l-2 border-[var(--color-atencao)] bg-[var(--color-atencao)]/[0.07] px-4 py-3">
                <p className="rotulo mb-1" style={{ color: "var(--atencao)" }}>
                  SISTEMA
                </p>
                <p className="text-[13.5px] leading-relaxed text-[var(--color-tinta-media)]">
                  {j.eventos.filter((e) => e.tipo === "ERRO").at(-1)?.detalhe}
                </p>
              </div>
            )}

            {j.eventos.some((e) => e.tipo === "MEMORIA_RECUPERADA" && e.refs?.length) && (
              <JarvisMemoryTrace refs={j.eventos.flatMap((e) => e.refs ?? [])} />
            )}

            <div ref={fimRef} />
          </div>
        </div>

        <div className="shrink-0 border-t border-[var(--color-linha)] px-4 py-3 sm:px-6">
          <div className="mx-auto max-w-2xl">
            {anexo && (
              <div className="entra mb-2 flex items-center gap-2 border border-[var(--color-linha)] px-2.5 py-1.5">
                <span className="mono text-[9px] tracking-[0.1em] text-[var(--reator)]">ANEXO</span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--color-tinta-media)]">
                  {anexo.nome}
                </span>
                <span className="mono text-[9px] text-[var(--color-tinta-fraca)]">
                  {anexo.tamanhoKB} KB
                </span>
                <button
                  onClick={() => setAnexo(null)}
                  aria-label="Remover anexo"
                  className="mono flex h-7 w-7 items-center justify-center text-[11px] text-[var(--color-tinta-fraca)] hover:text-[var(--risco)]"
                >
                  ✕
                </button>
              </div>
            )}

            <input
              ref={arquivoRef}
              type="file"
              className="hidden"
              accept=".pdf,.docx,.txt,.md,image/*"
              onChange={escolherArquivo}
            />

            <JarvisCommandConsole
              valor={entrada}
              onChange={setEntrada}
              onEnviar={() => void enviar(entrada)}
              onVoz={abrirVoz}
              onAnexo={() => arquivoRef.current?.click()}
              ocupado={ocupado}
              ouvindo={false}
              vozDisponivel={voz.disponivel}
            />
            <p className="mono mt-1.5 text-[9px] tracking-[0.1em] text-[var(--color-tinta-fraca)]">
              CTRL+J FOCA · ENTER ENVIA · SHIFT+ENTER QUEBRA LINHA
            </p>
          </div>
        </div>
      </main>

      <JarvisVozOverlay
        aberto={vozAberta}
        estado={voz.estado}
        transcricao={voz.transcricao}
        amostras={voz.amostras}
        erroTexto={voz.erro}
        respostaParcial={parcial || turnos.at(-1)?.conteudo || ""}
        onFechar={fecharVoz}
        onParar={fecharVoz}
      />
    </div>
  );
}

/* ─────────────── chip de contexto — informação, não seletor ─────────────── */

function ChipContexto({
  contexto,
  aberto,
  onAlternar,
}: {
  contexto: ContextoCliente | null;
  aberto: boolean;
  onAlternar: () => void;
}) {
  if (!contexto || (!contexto.projetoNome && !contexto.clienteNome)) {
    return (
      <div>
        <p className="rotulo mb-1">CONTEXTO</p>
        <p className="mono text-[11px] text-[var(--color-tinta-fraca)]">nenhum ainda — fale normalmente</p>
      </div>
    );
  }

  const corConfianca =
    contexto.confianca === "ALTA"
      ? "var(--ok)"
      : contexto.confianca === "MEDIA"
        ? "var(--atencao)"
        : "var(--risco)";

  return (
    <div>
      <button onClick={onAlternar} className="w-full text-left" aria-expanded={aberto}>
        <p className="rotulo mb-1">CONTEXTO ATUAL</p>
        <p className="mono mb-0.5 text-[13px] tracking-[0.1em] text-[var(--color-tinta)]">
          {contexto.clienteNome ?? contexto.projetoNome}
        </p>
        {ROTULO_INTENCAO[contexto.intencao] && (
          <p className="text-[11.5px] text-[var(--color-tinta-media)]">
            {ROTULO_INTENCAO[contexto.intencao]}
          </p>
        )}
      </button>

      {aberto && (
        <div className="entra mt-2 flex flex-col gap-1 border-l border-[var(--color-linha)] pl-2.5">
          {contexto.projetoNome && (
            <Linha rotulo="PROJETO" valor={contexto.projetoNome} />
          )}
          {contexto.clienteNome && <Linha rotulo="CLIENTE" valor={contexto.clienteNome} />}
          <Linha rotulo="AÇÃO" valor={contexto.acao} />
          <Linha rotulo="URGÊNCIA" valor={contexto.urgencia} />
          <Linha rotulo="MODO" valor={ROTULO_MODO[contexto.modo] ?? contexto.modo} />
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: corConfianca }} />
            <span className="mono text-[9px] tracking-[0.1em]" style={{ color: corConfianca }}>
              CONFIANÇA {contexto.confianca}
            </span>
          </div>
          {(contexto.correcao || contexto.retomada) && (
            <p className="mono mt-0.5 text-[9px] tracking-[0.1em] text-[var(--reator-claro)]">
              {contexto.correcao ? "correção aplicada" : "retomando contexto anterior"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="mono text-[9px] tracking-[0.1em] text-[var(--color-tinta-fraca)]">{rotulo}</span>
      <span className="text-[11px] text-[var(--color-tinta-media)]">{valor}</span>
    </div>
  );
}

function Mensagem({ papel, texto }: { papel: "user" | "assistant"; texto: string }) {
  const meu = papel === "user";
  return (
    <article className="entra">
      <header className="mb-1.5 flex items-baseline gap-2">
        <span
          className="mono text-[9px] tracking-[0.2em]"
          style={{ color: meu ? "var(--tinta-fraca)" : "var(--reator)" }}
        >
          {meu ? "CACIQUE" : "JARVIS"}
        </span>
        <span
          className="h-px flex-1"
          style={{
            background: meu
              ? "var(--color-linha-fraca)"
              : "linear-gradient(90deg, var(--reator), transparent)",
            opacity: 0.5,
          }}
        />
      </header>
      <div
        className={`whitespace-pre-wrap text-[14.5px] leading-relaxed ${
          meu ? "text-[var(--color-tinta-media)]" : "text-[var(--color-tinta)]"
        }`}
      >
        {texto}
      </div>
    </article>
  );
}
