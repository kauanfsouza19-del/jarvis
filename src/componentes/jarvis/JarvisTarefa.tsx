"use client";

import { useEffect, useState } from "react";

/**
 * Execução visível — a mensagem virou trabalho de verdade, e isto mostra o
 * estado REAL, lido por polling em /api/execucoes/:id. Nada aqui é
 * progresso fingido: a barra só se move quando `progresso_atual` mudou no
 * banco, gravado pelo motor de job rodando no servidor.
 */

type StatusJob = "FILA" | "EXECUTANDO" | "AGUARDANDO_APROVACAO" | "CONCLUIDO" | "FALHOU" | "BLOQUEADO" | "CANCELADO";

type Execucao = {
  id: string;
  status: StatusJob;
  progresso_atual: number;
  progresso_total: number;
  etapa: string | null;
  resultado_id: string | null;
  erro: string | null;
  tentativas: number;
  iniciado_em: string | null;
  concluido_em: string | null;
};

const ROTULO_STATUS: Record<StatusJob, string> = {
  FILA: "AGUARDANDO EXECUÇÃO",
  EXECUTANDO: "EXECUTANDO",
  AGUARDANDO_APROVACAO: "AGUARDANDO SUA APROVAÇÃO",
  CONCLUIDO: "CONCLUÍDO",
  FALHOU: "FALHOU",
  BLOQUEADO: "BLOQUEADO",
  CANCELADO: "CANCELADO",
};

const ESTADOS_FINAIS: StatusJob[] = ["CONCLUIDO", "FALHOU", "BLOQUEADO", "CANCELADO"];

export function JarvisExecucao({
  execucaoId,
  onConcluida,
}: {
  execucaoId: string;
  onConcluida: (resultadoId: string) => void;
}) {
  const [ex, setEx] = useState<Execucao | null>(null);
  const [acaoPendente, setAcaoPendente] = useState(false);
  const [agoraMs, setAgoraMs] = useState(() => Date.now());

  useEffect(() => {
    let vivo = true;
    let concluidaAvisada = false;

    async function checar() {
      const r = await fetch(`/api/execucoes/${execucaoId}`).then((x) => x.json());
      if (!vivo || !r.execucao) return;
      setEx(r.execucao);
      if (r.execucao.status === "CONCLUIDO" && r.execucao.resultado_id && !concluidaAvisada) {
        concluidaAvisada = true;
        onConcluida(r.execucao.resultado_id);
      }
    }

    void checar();
    const intervalo = setInterval(() => {
      setAgoraMs(Date.now());
      if (ex && ESTADOS_FINAIS.includes(ex.status)) return;
      void checar();
    }, 1200);

    return () => {
      vivo = false;
      clearInterval(intervalo);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [execucaoId]);

  if (!ex) return <p className="mono text-[10px] text-[var(--color-tinta-fraca)]">carregando tarefa…</p>;

  const pct = ex.progresso_total > 0 ? Math.round((ex.progresso_atual / ex.progresso_total) * 100) : 0;
  const tempoDecorrido = ex.iniciado_em
    ? formatarDuracao((ex.concluido_em ? new Date(ex.concluido_em + "Z").getTime() : agoraMs) - new Date(ex.iniciado_em + "Z").getTime())
    : null;

  async function cancelar() {
    setAcaoPendente(true);
    await fetch(`/api/execucoes/${execucaoId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acao: "cancelar" }),
    });
    setAcaoPendente(false);
  }

  async function retentar() {
    setAcaoPendente(true);
    await fetch(`/api/execucoes/${execucaoId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acao: "retentar" }),
    });
    setAcaoPendente(false);
  }

  return (
    <div className="entra border-l-2 pl-3" style={{ borderColor: corStatus(ex.status) }}>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: corStatus(ex.status) }} />
        <span className="mono text-[9px] tracking-[0.14em]" style={{ color: corStatus(ex.status) }}>
          {ROTULO_STATUS[ex.status]}
        </span>
        {tempoDecorrido && (
          <span className="mono text-[9px] text-[var(--color-tinta-fraca)]">{tempoDecorrido}</span>
        )}
        {ex.tentativas > 0 && (
          <span className="mono text-[9px] text-[var(--color-tinta-fraca)]">tentativa #{ex.tentativas + 1}</span>
        )}
      </div>

      {(ex.status === "EXECUTANDO" || ex.status === "FILA") && (
        <>
          {ex.etapa && <p className="mb-1.5 text-[12.5px] text-[var(--color-tinta-media)]">{ex.etapa}</p>}
          {ex.progresso_total > 0 && (
            <div className="mb-1.5 h-1 w-full max-w-xs overflow-hidden bg-[var(--color-linha)]">
              <div
                className="h-full transition-[width] duration-300"
                style={{ width: `${pct}%`, background: "var(--reator)" }}
              />
            </div>
          )}
          <button
            onClick={() => void cancelar()}
            disabled={acaoPendente}
            className="mono min-h-9 border border-[var(--color-linha)] px-2.5 text-[9px] tracking-[0.1em] text-[var(--color-tinta-fraca)] transition hover:border-[var(--risco)] hover:text-[var(--risco)] disabled:opacity-40"
          >
            CANCELAR
          </button>
        </>
      )}

      {ex.status === "AGUARDANDO_APROVACAO" && (
        <p className="text-[12.5px] leading-relaxed text-[var(--atencao)]">
          {ex.etapa} — ver SISTEMA → JOBS para aprovar ou rejeitar.
        </p>
      )}

      {(ex.status === "FALHOU" || ex.status === "BLOQUEADO") && (
        <>
          {ex.erro && <p className="mb-1.5 text-[12.5px] leading-relaxed text-[var(--risco)]">{ex.erro}</p>}
          {ex.status === "FALHOU" && (
            <button
              onClick={() => void retentar()}
              disabled={acaoPendente}
              className="mono min-h-9 border border-[var(--color-linha)] px-2.5 text-[9px] tracking-[0.1em] text-[var(--color-tinta-media)] transition hover:border-[var(--reator)] hover:text-[var(--reator-claro)] disabled:opacity-40"
            >
              RETENTAR
            </button>
          )}
        </>
      )}

      {ex.status === "CANCELADO" && (
        <p className="text-[12.5px] text-[var(--color-tinta-fraca)]">Cancelado a pedido.</p>
      )}
    </div>
  );
}

function corStatus(s: StatusJob): string {
  if (s === "CONCLUIDO") return "var(--ok)";
  if (s === "FALHOU") return "var(--risco)";
  if (s === "BLOQUEADO" || s === "AGUARDANDO_APROVACAO") return "var(--atencao)";
  if (s === "CANCELADO") return "var(--color-tinta-fraca)";
  return "var(--reator-claro)";
}

function formatarDuracao(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m${String(s % 60).padStart(2, "0")}s`;
}
