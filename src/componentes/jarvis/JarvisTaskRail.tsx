"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Trilha de tarefas ativas (Fase 12) — a pilha compacta que fica SEMPRE
 * visível na coluna esquerda do Command Center, não escondida atrás de
 * SISTEMA → JOBS. Mesmo backend real da Fase 7/10 (prioridade, pausa,
 * cancelamento já existiam e funcionam) — isto só dá o lugar de destaque
 * que a tarefa ativa merece, sem reescrever nada do motor.
 *
 * Nunca deixa concluído dominar: no máximo 2 concluídos recentes aparecem,
 * o resto fica em SISTEMA → JOBS (histórico completo).
 */

type StatusJobRail = "FILA" | "EXECUTANDO" | "AGUARDANDO_APROVACAO" | "CONCLUIDO" | "FALHOU" | "BLOQUEADO" | "CANCELADO";
type PrioridadeRail = "CRITICAL" | "HIGH" | "NORMAL" | "LOW";

type JobRail = {
  id: string;
  tipo: string;
  status: StatusJobRail;
  progresso_atual: number;
  progresso_total: number;
  etapa: string | null;
  erro: string | null;
  prioridade: PrioridadeRail;
  pausado: number;
  agente_id: string | null;
  ferramenta_usada: string | null;
  iniciado_em: string | null;
  criado_em: string;
};

const ROTULO_PRIORIDADE_RAIL: Record<PrioridadeRail, string> = { CRITICAL: "CRÍTICA", HIGH: "ALTA", NORMAL: "NORMAL", LOW: "BAIXA" };
const COR_PRIORIDADE_RAIL: Record<PrioridadeRail, string> = {
  CRITICAL: "var(--risco)", HIGH: "var(--atencao)", NORMAL: "var(--color-tinta-media)", LOW: "var(--color-tinta-fraca)",
};
const PRIORIDADES_RAIL: PrioridadeRail[] = ["CRITICAL", "HIGH", "NORMAL", "LOW"];
const COR_STATUS_RAIL: Record<StatusJobRail, string> = {
  FILA: "var(--reator-claro)", EXECUTANDO: "var(--reator-claro)", AGUARDANDO_APROVACAO: "var(--atencao)",
  CONCLUIDO: "var(--ok)", FALHOU: "var(--risco)", BLOQUEADO: "var(--atencao)", CANCELADO: "var(--color-tinta-fraca)",
};
const ROTULO_STATUS_RAIL: Record<StatusJobRail, string> = {
  FILA: "NA FILA", EXECUTANDO: "EXECUTANDO", AGUARDANDO_APROVACAO: "AGUARDANDO APROVAÇÃO",
  CONCLUIDO: "CONCLUÍDO", FALHOU: "FALHOU", BLOQUEADO: "BLOQUEADO", CANCELADO: "CANCELADO",
};

export function JarvisTaskRail({ onAbrirJobs }: { onAbrirJobs: () => void }) {
  const [jobs, setJobs] = useState<JobRail[] | null>(null);
  const [agentes, setAgentes] = useState<Record<string, string>>({});
  const [processando, setProcessando] = useState<string | null>(null);
  const [prioridadeAberta, setPrioridadeAberta] = useState<string | null>(null);

  const carregar = useCallback(() => {
    void fetch("/api/execucoes").then((r) => r.json()).then((d) => setJobs(d.execucoes ?? []));
  }, []);

  useEffect(() => {
    void fetch("/api/agentes")
      .then((r) => r.json())
      .then((d) => {
        const mapa: Record<string, string> = {};
        for (const a of d.agentes ?? []) mapa[a.id] = a.nome;
        setAgentes(mapa);
      });
  }, []);

  useEffect(() => {
    carregar();
    const intervalo = setInterval(carregar, 3000);
    return () => clearInterval(intervalo);
  }, [carregar]);

  const agir = useCallback(
    async (id: string, acao: "cancelar" | "retentar" | "pausar" | "retomar") => {
      setProcessando(id);
      await fetch(`/api/execucoes/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acao }) });
      setProcessando(null);
      carregar();
    },
    [carregar],
  );

  const mudarPrioridade = useCallback(
    async (id: string, prioridade: PrioridadeRail) => {
      setProcessando(id);
      await fetch(`/api/execucoes/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prioridade }) });
      setProcessando(null);
      carregar();
    },
    [carregar],
  );

  if (!jobs) return null;

  const emAprovacao = jobs.filter((j) => j.status === "AGUARDANDO_APROVACAO");
  const ativos = jobs.filter((j) => (j.status === "EXECUTANDO" || j.status === "FILA") && j.pausado !== 1);
  const pausados = jobs.filter((j) => j.pausado === 1);
  const falhos = jobs.filter((j) => j.status === "FALHOU" || j.status === "BLOQUEADO").slice(0, 2);
  const concluidos = jobs.filter((j) => j.status === "CONCLUIDO").slice(0, 2);
  const visiveis = [...emAprovacao, ...ativos, ...pausados, ...falhos, ...concluidos];

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <p className="rotulo">TAREFAS ATIVAS</p>
        <button onClick={onAbrirJobs} className="mono text-[9px] tracking-[0.1em] text-[var(--color-tinta-fraca)] hover:text-[var(--reator-claro)]">
          VER TODAS
        </button>
      </div>

      {visiveis.length === 0 && <p className="mono text-[11px] text-[var(--color-tinta-fraca)]">Nada rodando agora.</p>}

      <div className="flex flex-col gap-1.5">
        {visiveis.map((j) => {
          const pct = j.progresso_total > 0 ? Math.round((j.progresso_atual / j.progresso_total) * 100) : 0;
          const podeMudarPrioridade = j.status === "FILA" || j.status === "EXECUTANDO";
          const proc = processando === j.id;

          return (
            <div key={j.id} className="painel canto p-2.5">
              <div className="mb-1 flex flex-wrap items-center gap-1.5">
                <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: COR_STATUS_RAIL[j.status] }} />
                <span className="mono truncate text-[10px] text-[var(--color-tinta)]">{j.tipo}</span>
                {j.pausado === 1 && <span className="mono text-[8.5px] text-[var(--atencao)]">PAUSADO</span>}
              </div>

              <div className="mb-1 flex flex-wrap items-center gap-1.5">
                <span className="mono text-[8.5px] tracking-[0.08em]" style={{ color: COR_STATUS_RAIL[j.status] }}>{ROTULO_STATUS_RAIL[j.status]}</span>
                {j.agente_id && agentes[j.agente_id] && <span className="mono text-[8.5px] text-[var(--color-tinta-fraca)]">· {agentes[j.agente_id]}</span>}
                {j.ferramenta_usada && <span className="mono text-[8.5px] text-[var(--color-tinta-fraca)]">· {j.ferramenta_usada}</span>}
              </div>

              {j.etapa && (j.status === "EXECUTANDO" || j.status === "FILA") && (
                <p className="mb-1 truncate text-[10.5px] text-[var(--color-tinta-media)]">{j.etapa}</p>
              )}
              {j.progresso_total > 0 && (j.status === "EXECUTANDO" || j.status === "FILA") && (
                <div className="mb-1 h-0.5 w-full overflow-hidden bg-[var(--color-linha)]">
                  <div className="h-full transition-[width] duration-300" style={{ width: `${pct}%`, background: "var(--reator)" }} />
                </div>
              )}
              {j.erro && <p className="mb-1 truncate text-[10px] text-[var(--risco)]">{j.erro}</p>}

              <div className="flex flex-wrap items-center gap-1.5">
                {podeMudarPrioridade ? (
                  <div className="relative">
                    <button
                      onClick={() => setPrioridadeAberta(prioridadeAberta === j.id ? null : j.id)}
                      disabled={proc}
                      className="mono flex min-h-6 items-center gap-0.5 border border-[var(--color-linha)] px-1 text-[8.5px] tracking-[0.08em] disabled:opacity-40"
                      style={{ color: COR_PRIORIDADE_RAIL[j.prioridade] }}
                    >
                      {ROTULO_PRIORIDADE_RAIL[j.prioridade]} ▾
                    </button>
                    {prioridadeAberta === j.id && (
                      <div className="absolute left-0 top-full z-20 mt-1 flex flex-col border border-[var(--color-linha)] bg-[var(--color-fundo-2)]">
                        {PRIORIDADES_RAIL.map((p) => (
                          <button
                            key={p}
                            onClick={() => { setPrioridadeAberta(null); if (p !== j.prioridade) void mudarPrioridade(j.id, p); }}
                            className="mono min-h-7 whitespace-nowrap px-2.5 text-left text-[8.5px] tracking-[0.08em] hover:bg-[var(--color-linha)]"
                            style={{ color: COR_PRIORIDADE_RAIL[p] }}
                          >
                            {ROTULO_PRIORIDADE_RAIL[p]}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <span className="mono text-[8.5px]" style={{ color: COR_PRIORIDADE_RAIL[j.prioridade] }}>{ROTULO_PRIORIDADE_RAIL[j.prioridade]}</span>
                )}

                {j.status === "EXECUTANDO" && (
                  <button onClick={() => void agir(j.id, "pausar")} disabled={proc} className="mono min-h-6 border border-[var(--color-linha)] px-1.5 text-[8.5px] text-[var(--color-tinta-fraca)] hover:border-[var(--atencao)] hover:text-[var(--atencao)] disabled:opacity-40">
                    PAUSAR
                  </button>
                )}
                {j.status === "FILA" && j.pausado === 1 && (
                  <button onClick={() => void agir(j.id, "retomar")} disabled={proc} className="mono min-h-6 border border-[var(--color-linha)] px-1.5 text-[8.5px] text-[var(--color-tinta-media)] hover:border-[var(--ok)] hover:text-[var(--ok)] disabled:opacity-40">
                    RETOMAR
                  </button>
                )}
                {(j.status === "EXECUTANDO" || j.status === "FILA") && (
                  <button onClick={() => void agir(j.id, "cancelar")} disabled={proc} className="mono min-h-6 border border-[var(--color-linha)] px-1.5 text-[8.5px] text-[var(--color-tinta-fraca)] hover:border-[var(--risco)] hover:text-[var(--risco)] disabled:opacity-40">
                    ✕
                  </button>
                )}
                {j.status === "FALHOU" && (
                  <button onClick={() => void agir(j.id, "retentar")} disabled={proc} className="mono min-h-6 border border-[var(--color-linha)] px-1.5 text-[8.5px] text-[var(--color-tinta-media)] hover:border-[var(--reator)] hover:text-[var(--reator-claro)] disabled:opacity-40">
                    RETENTAR
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
