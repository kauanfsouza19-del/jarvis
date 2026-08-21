"use client";

export type EstadoReator =
  | "ocioso"
  | "ouvindo"
  | "pensando"
  | "executando"
  | "aguardando_aprovacao"
  | "falando"
  | "erro"
  | "offline";

const ROTULOS: Record<EstadoReator, string> = {
  ocioso: "OCIOSO",
  ouvindo: "OUVINDO",
  pensando: "PENSANDO",
  executando: "EXECUTANDO",
  aguardando_aprovacao: "AGUARDANDO APROVAÇÃO",
  falando: "FALANDO",
  erro: "ERRO",
  offline: "OFFLINE",
};

const CORES: Record<EstadoReator, string> = {
  ocioso: "var(--color-reator)",
  ouvindo: "var(--color-reator-forte)",
  pensando: "var(--color-reator-forte)",
  executando: "var(--color-ok)",
  aguardando_aprovacao: "var(--color-atencao)",
  falando: "var(--color-reator-forte)",
  erro: "var(--color-risco)",
  offline: "var(--color-tinta-fraca)",
};

export function Reator({
  estado,
  tamanho = 132,
}: {
  estado: EstadoReator;
  tamanho?: number;
}) {
  const cor = CORES[estado];
  const classeEstado = `estado-${estado}`;

  return (
    <div className={`flex flex-col items-center gap-3 ${classeEstado}`}>
      <svg
        width={tamanho}
        height={tamanho}
        viewBox="0 0 120 120"
        role="img"
        aria-label={`Reator do Jarvis — estado ${ROTULOS[estado]}`}
      >
        <defs>
          <radialGradient id="brilhoNucleo">
            <stop offset="0%" stopColor={cor} stopOpacity="0.95" />
            <stop offset="55%" stopColor={cor} stopOpacity="0.25" />
            <stop offset="100%" stopColor={cor} stopOpacity="0" />
          </radialGradient>
        </defs>

        <circle
          className="reator-nucleo"
          cx="60"
          cy="60"
          r="34"
          fill="url(#brilhoNucleo)"
          style={{ transformOrigin: "60px 60px" }}
        />

        <circle cx="60" cy="60" r="13" fill={cor} opacity="0.9" />
        <circle cx="60" cy="60" r="21" fill="none" stroke={cor} strokeWidth="1" opacity="0.55" />

        <g
          className="reator-anel"
          style={{ transformOrigin: "60px 60px" }}
          fill="none"
          stroke={cor}
          strokeWidth="1.2"
          opacity="0.7"
        >
          <circle cx="60" cy="60" r="40" strokeDasharray="52 18" />
          <circle cx="60" cy="60" r="49" strokeDasharray="8 26" opacity="0.5" />
        </g>
      </svg>

      <span
        className="mono text-[10px] tracking-[0.22em]"
        style={{ color: cor }}
      >
        {ROTULOS[estado]}
      </span>
    </div>
  );
}
