"use client";

import { TOOLS_CONHECIDAS, type Evento } from "@/lib/eventos";

/* ─────────────────────────── indicador de tool ─────────────────────────── */

export function JarvisToolIndicator({
  chave,
  estado,
  duracaoMs,
}: {
  chave: string;
  estado: "ativa" | "concluida" | "falhou";
  duracaoMs?: number;
}) {
  const info = TOOLS_CONHECIDAS[chave as keyof typeof TOOLS_CONHECIDAS];
  const rotulo = info?.rotulo ?? chave.toUpperCase();

  const cor =
    estado === "falhou"
      ? "var(--risco)"
      : estado === "ativa"
        ? "var(--reator-claro)"
        : "var(--tinta-fraca)";

  return (
    <span
      className="mono inline-flex items-center gap-1.5 border px-1.5 py-0.5 text-[9px] tracking-[0.12em]"
      style={{ color: cor, borderColor: cor, opacity: estado === "concluida" ? 0.55 : 1 }}
    >
      <span
        className="inline-block h-1 w-1 rounded-full"
        style={{
          background: cor,
          animation: estado === "ativa" ? "atenuar 1.2s ease-in-out infinite" : "none",
        }}
      />
      {rotulo}
      {duracaoMs !== undefined && estado !== "ativa" && (
        <span className="opacity-60">{duracaoMs}ms</span>
      )}
    </span>
  );
}

/* ─────────────────────────── traço de memória ─────────────────────────── */

export function JarvisMemoryTrace({
  refs,
}: {
  refs: Array<{ tipo: string; valor: string; origem?: string }>;
}) {
  if (!refs.length) return null;
  return (
    <div className="entra-lado flex flex-col gap-1 border-l border-[var(--color-reator)]/40 pl-3">
      {refs.slice(0, 6).map((r, i) => (
        <div key={i} className="flex flex-wrap items-baseline gap-2">
          <span className="rotulo" style={{ color: "var(--reator)" }}>
            {r.tipo}
          </span>
          <span className="text-[12.5px] text-[var(--color-tinta-media)]">{r.valor}</span>
          {r.origem && (
            <span className="mono text-[9px] text-[var(--color-tinta-fraca)]">{r.origem}</span>
          )}
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────── fluxo de ações ─────────────────────────── */

const COR_EVENTO: Record<string, string> = {
  ERRO: "var(--risco)",
  TOOL_FALHOU: "var(--risco)",
  APROVACAO_NECESSARIA: "var(--atencao)",
  EXECUCAO_CONCLUIU: "var(--ok)",
  RESPOSTA_FINAL: "var(--ok)",
};

export function JarvisActionStream({ eventos }: { eventos: Evento[] }) {
  if (!eventos.length) {
    return (
      <p className="mono text-[10px] tracking-[0.14em] text-[var(--color-tinta-fraca)]">
        SEM ATIVIDADE
      </p>
    );
  }

  return (
    <ol className="flex flex-col gap-1.5" aria-label="Fluxo de ações do sistema">
      {eventos.slice(-14).map((ev) => (
        <li key={ev.id} className="entra-lado flex items-baseline gap-2.5">
          <span
            className="mono shrink-0 text-[9px] tracking-[0.14em]"
            style={{ color: COR_EVENTO[ev.tipo] ?? "var(--reator)" }}
          >
            {ev.rotulo}
          </span>
          {ev.detalhe && (
            <span className="min-w-0 truncate text-[12px] text-[var(--color-tinta-media)]">
              {ev.detalhe}
            </span>
          )}
          {ev.duracaoMs !== undefined && (
            <span className="mono ml-auto shrink-0 text-[9px] text-[var(--color-tinta-fraca)]">
              {ev.duracaoMs}ms
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

/* ─────────────────────────── status do sistema ─────────────────────────── */

export type Saude = {
  banco: boolean;
  memorias: number;
  conhecimentoProjeto: number;
  fontes: number;
  modelo: boolean;
};

export function JarvisStatus({ saude }: { saude: Saude | null }) {
  if (!saude) {
    return <p className="rotulo">CARREGANDO STATUS…</p>;
  }

  const linhas: Array<[string, string, boolean | null]> = [
    ["BANCO", saude.banco ? "online" : "offline", saude.banco],
    ["MEMÓRIA", `${saude.memorias} registro(s)`, null],
    ["ÍNDICE", `${saude.conhecimentoProjeto} fato(s)`, null],
    ["BASE", `${saude.fontes} fonte(s)`, null],
    ["MODELO", saude.modelo ? "conectado" : "sem chave", saude.modelo],
  ];

  return (
    <dl className="flex flex-col gap-1">
      {linhas.map(([k, v, ok]) => (
        <div key={k} className="flex items-baseline justify-between gap-3">
          <dt className="rotulo">{k}</dt>
          <dd
            className="mono text-[10px]"
            style={{
              color:
                ok === false
                  ? "var(--atencao)"
                  : ok === true
                    ? "var(--ok)"
                    : "var(--color-tinta-media)",
            }}
          >
            {v}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// JarvisProjectContext (seletor manual de projeto) foi removido nesta fase —
// o contexto agora é inferido por src/lib/contexto/resolver.ts e mostrado
// como informação em ChipContexto, dentro de JarvisComando.tsx. Ver
// [[refatoracao-ux-command-center]] no histórico do projeto.
