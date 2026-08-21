"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Reator, type EstadoReator } from "./Reator";

type Turno = { id?: string; papel: "user" | "assistant"; conteudo: string; modelo?: string | null };
type ConversaMeta = { id: string; titulo: string; atualizado_em: string; estado: string };
type Projeto = { id: string; nome: string; permissao: string };
type Modo = "consultivo" | "direto" | "socio_incomodo";

const ROTULO_MODO: Record<Modo, string> = {
  consultivo: "Consultivo",
  direto: "Direto",
  socio_incomodo: "Sócio incômodo",
};

export function Conversa() {
  const [conversas, setConversas] = useState<ConversaMeta[]>([]);
  const [conversaId, setConversaId] = useState<string | null>(null);
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [projetos, setProjetos] = useState<Projeto[]>([]);
  const [projetoId, setProjetoId] = useState<string | null>(null);

  const [entrada, setEntrada] = useState("");
  const [parcial, setParcial] = useState("");
  const [estado, setEstado] = useState<EstadoReator>("ocioso");
  const [modo, setModo] = useState<Modo>("direto");
  const [recuperado, setRecuperado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const fimRef = useRef<HTMLDivElement>(null);

  // Carrega conversas e projetos ao montar.
  useEffect(() => {
    void (async () => {
      const [c, p] = await Promise.all([
        fetch("/api/conversas").then((r) => r.json()),
        fetch("/api/projetos").then((r) => r.json()),
      ]);
      setConversas(c.conversas ?? []);
      setProjetos(p.projetos ?? []);
      if (c.conversas?.length) void abrir(c.conversas[0].id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turnos, parcial]);

  const abrir = useCallback(async (id: string) => {
    const r = await fetch(`/api/conversas/${id}`).then((x) => x.json());
    if (r.erro) return;
    setConversaId(id);
    setProjetoId(r.conversa.projeto_id);
    setModo(r.conversa.modo);
    setTurnos(
      (r.mensagens ?? [])
        .filter((m: { papel: string }) => m.papel !== "system")
        .map((m: { id: string; papel: Turno["papel"]; conteudo: string; modelo: string | null }) => ({
          id: m.id,
          papel: m.papel,
          conteudo: m.conteudo,
          modelo: m.modelo,
        })),
    );
    setErro(null);
    setParcial("");
  }, []);

  const nova = useCallback(async () => {
    const r = await fetch("/api/conversas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projeto_id: projetoId }),
    }).then((x) => x.json());
    setConversas((c) => [r.conversa, ...c]);
    setConversaId(r.conversa.id);
    setTurnos([]);
    setParcial("");
    setErro(null);
  }, [projetoId]);

  const enviar = useCallback(async () => {
    const texto = entrada.trim();
    if (!texto || estado === "pensando") return;

    let alvo = conversaId;
    if (!alvo) {
      const r = await fetch("/api/conversas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ titulo: texto.slice(0, 60), projeto_id: projetoId }),
      }).then((x) => x.json());
      alvo = r.conversa.id;
      setConversaId(alvo);
      setConversas((c) => [r.conversa, ...c]);
    }

    setEntrada("");
    setErro(null);
    setParcial("");
    setEstado("pensando");
    setTurnos((t) => [...t, { papel: "user", conteudo: texto }]);

    let acumulado = "";

    try {
      const resposta = await fetch("/api/conversar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversa_id: alvo, mensagem: texto, modo, projeto_id: projetoId }),
      });

      if (!resposta.ok) {
        const d = await resposta.json().catch(() => ({}));
        if (d.contexto_recuperado) setRecuperado(d.contexto_recuperado);
        throw new Error(d.detalhe ?? `Falha ${resposta.status}`);
      }
      if (!resposta.body) throw new Error("Resposta sem corpo.");

      const leitor = resposta.body.getReader();
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
            setRecuperado(`${ev.memorias} memória(s) · ${ev.conhecimento} trecho(s)`);
          } else if (ev.tipo === "texto") {
            acumulado += ev.texto;
            setParcial(acumulado);
          } else if (ev.tipo === "erro") {
            throw new Error(ev.detalhe);
          }
        }
      }

      setTurnos((t) => [...t, { papel: "assistant", conteudo: acumulado }]);
      setParcial("");
      setEstado("ocioso");
      void fetch("/api/conversas")
        .then((r) => r.json())
        .then((c) => setConversas(c.conversas ?? []));
    } catch (e) {
      setParcial("");
      setEstado("erro");
      setErro(e instanceof Error ? e.message : "Erro desconhecido.");
    }
  }, [entrada, estado, conversaId, modo, projetoId]);

  return (
    <div className="flex h-full min-h-0">
      {/* Conversas */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-[var(--color-linha)] md:flex">
        <div className="flex items-center justify-between border-b border-[var(--color-linha)] px-3 py-2.5">
          <span className="mono text-[10px] tracking-[0.16em] text-[var(--color-tinta-fraca)]">
            CONVERSAS
          </span>
          <button
            onClick={() => void nova()}
            className="mono rounded-sm border border-[var(--color-linha)] px-2 py-0.5 text-[10px] text-[var(--color-tinta-media)] hover:border-[var(--color-reator)] hover:text-[var(--color-reator)]"
          >
            + NOVA
          </button>
        </div>
        <div className="rolagem flex-1 overflow-y-auto">
          {conversas.length === 0 && (
            <p className="px-3 py-3 text-xs text-[var(--color-tinta-fraca)]">
              Nenhuma ainda.
            </p>
          )}
          {conversas.map((c) => (
            <button
              key={c.id}
              onClick={() => void abrir(c.id)}
              className={`block w-full truncate border-b border-[var(--color-linha)]/50 px-3 py-2.5 text-left text-[13px] transition ${
                c.id === conversaId
                  ? "bg-[var(--color-superficie-2)] text-[var(--color-tinta)]"
                  : "text-[var(--color-tinta-media)] hover:bg-[var(--color-superficie)]"
              }`}
            >
              {c.titulo}
            </button>
          ))}
        </div>
      </aside>

      {/* Conversa */}
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-3 border-b border-[var(--color-linha)] px-5 py-2.5">
          <Reator estado={estado} tamanho={30} />
          <select
            value={projetoId ?? ""}
            onChange={(e) => setProjetoId(e.target.value || null)}
            className="mono rounded-sm border border-[var(--color-linha)] bg-[var(--color-superficie)] px-2 py-1 text-[11px] text-[var(--color-tinta-media)]"
          >
            <option value="">sem projeto</option>
            {projetos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
          <select
            value={modo}
            onChange={(e) => setModo(e.target.value as Modo)}
            className="mono rounded-sm border border-[var(--color-linha)] bg-[var(--color-superficie)] px-2 py-1 text-[11px] text-[var(--color-tinta-media)]"
          >
            {(Object.keys(ROTULO_MODO) as Modo[]).map((m) => (
              <option key={m} value={m}>
                {ROTULO_MODO[m]}
              </option>
            ))}
          </select>
          {recuperado && (
            <span className="mono text-[10px] text-[var(--color-tinta-fraca)]">
              contexto · {recuperado}
            </span>
          )}
        </div>

        <div className="rolagem flex-1 overflow-y-auto px-5 py-6">
          <div className="mx-auto flex max-w-2xl flex-col gap-6">
            {turnos.length === 0 && !parcial && (
              <div className="pt-6">
                <p className="mb-2 text-lg">Pronto, Cacique.</p>
                <p className="max-w-md text-sm leading-relaxed text-[var(--color-tinta-media)]">
                  Agora tudo persiste: conversa, memória, projetos e base de
                  conhecimento. Recarregue a página e a conversa continua onde parou.
                </p>
              </div>
            )}
            {turnos.map((t, i) => (
              <Bolha key={t.id ?? i} papel={t.papel} texto={t.conteudo} />
            ))}
            {parcial && <Bolha papel="assistant" texto={parcial} />}
            {estado === "pensando" && !parcial && (
              <p className="mono text-xs text-[var(--color-tinta-fraca)]">pensando…</p>
            )}
            {erro && (
              <div className="border-l-2 border-[var(--color-atencao)] bg-[var(--color-atencao)]/10 px-4 py-3">
                <p className="mono mb-1 text-[10px] tracking-[0.14em] text-[var(--color-atencao)]">
                  AVISO
                </p>
                <p className="text-sm text-[var(--color-tinta-media)]">{erro}</p>
              </div>
            )}
            <div ref={fimRef} />
          </div>
        </div>

        <div className="border-t border-[var(--color-linha)] px-5 py-4">
          <div className="mx-auto flex max-w-2xl items-end gap-3">
            <textarea
              value={entrada}
              onChange={(e) => setEntrada(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void enviar();
                }
              }}
              rows={1}
              placeholder="Fala, Cacique."
              className="max-h-40 min-h-[44px] flex-1 resize-none rounded-sm border border-[var(--color-linha)] bg-[var(--color-superficie)] px-4 py-3 text-[15px] outline-none placeholder:text-[var(--color-tinta-fraca)] focus:border-[var(--color-reator)]"
            />
            <button
              onClick={() => void enviar()}
              disabled={!entrada.trim() || estado === "pensando"}
              className="mono h-[44px] rounded-sm border border-[var(--color-reator)] px-5 text-[11px] tracking-[0.14em] text-[var(--color-reator)] hover:bg-[var(--color-reator)]/10 disabled:cursor-not-allowed disabled:border-[var(--color-linha)] disabled:text-[var(--color-tinta-fraca)]"
            >
              ENVIAR
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

function Bolha({ papel, texto }: { papel: "user" | "assistant"; texto: string }) {
  const meu = papel === "user";
  return (
    <div className={meu ? "flex justify-end" : ""}>
      <div className={meu ? "max-w-[85%]" : "w-full"}>
        <p
          className={`mono mb-1.5 text-[10px] tracking-[0.14em] ${
            meu ? "text-right text-[var(--color-tinta-fraca)]" : "text-[var(--color-reator)]"
          }`}
        >
          {meu ? "CACIQUE" : "JARVIS"}
        </p>
        <div
          className={`whitespace-pre-wrap text-[15px] leading-relaxed ${
            meu ? "rounded-sm bg-[var(--color-superficie-2)] px-4 py-3" : ""
          }`}
        >
          {texto}
        </div>
      </div>
    </div>
  );
}
