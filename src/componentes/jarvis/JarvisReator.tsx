"use client";

import { useMemo } from "react";
import type { EstadoReator } from "@/lib/eventos";

/**
 * O reator.
 *
 * Camadas independentes que ligam e desligam conforme o estado real: núcleo,
 * anel de energia, anel analítico, segmentos radiais, órbita, malha técnica,
 * anel de progresso e marcas.
 *
 * Cada movimento significa uma coisa específica — pulso é sistema vivo, anel
 * girando é processamento, órbita é pesquisa, ramos são planejamento, anel de
 * progresso é execução. Nada gira só para parecer bonito.
 */

type Props = {
  estado: EstadoReator;
  /** 0–1, amplitude real do microfone ou do TTS. Só usado em ouvindo/falando. */
  amplitude?: number;
  /** Progresso real 0–1. Só desenhado quando existe execução com progresso. */
  progresso?: number | null;
  tamanho?: number;
  compacto?: boolean;
};

const ROTULO: Record<EstadoReator, string> = {
  ocioso: "OCIOSO",
  ouvindo: "OUVINDO",
  pensando: "PROCESSANDO",
  planejando: "PLANEJANDO",
  executando: "EXECUTANDO",
  aguardando_aprovacao: "AGUARDANDO APROVAÇÃO",
  falando: "FALANDO",
  erro: "ERRO",
  offline: "OFFLINE",
};

const COR: Record<EstadoReator, string> = {
  ocioso: "var(--reator)",
  ouvindo: "var(--reator-claro)",
  pensando: "var(--reator-claro)",
  planejando: "var(--reator-claro)",
  executando: "var(--ok)",
  aguardando_aprovacao: "var(--atencao)",
  falando: "var(--reator-claro)",
  erro: "var(--risco)",
  offline: "var(--tinta-fraca)",
};

export function JarvisReator({
  estado,
  amplitude = 0,
  progresso = null,
  tamanho = 260,
  compacto = false,
}: Props) {
  const cor = COR[estado];
  const ativo = estado !== "offline";

  // Segmentos radiais — densidade fixa, sem aleatoriedade entre renders.
  const segmentos = useMemo(
    () =>
      Array.from({ length: 48 }, (_, i) => {
        const ang = (i / 48) * Math.PI * 2;
        const grande = i % 6 === 0;
        const r0 = grande ? 86 : 90;
        const r1 = 96;
        return {
          x1: 100 + Math.cos(ang) * r0,
          y1: 100 + Math.sin(ang) * r0,
          x2: 100 + Math.cos(ang) * r1,
          y2: 100 + Math.sin(ang) * r1,
          forte: grande,
        };
      }),
    [],
  );

  // Órbitas — só aparecem em pesquisa/processamento.
  const orbitas = useMemo(
    () => [
      { r: 74, dur: 7, tam: 2.4, atraso: 0 },
      { r: 74, dur: 7, tam: 1.8, atraso: -2.3 },
      { r: 74, dur: 7, tam: 1.4, atraso: -4.6 },
      { r: 62, dur: 4.5, tam: 1.8, atraso: -1.1 },
      { r: 62, dur: 4.5, tam: 1.4, atraso: -3.3 },
    ],
    [],
  );

  // Ramos de planejamento — grafo que aparece só em PLANEJANDO.
  const ramos = useMemo(
    () =>
      [0, 55, 110, 175, 230, 300].map((g) => {
        const a = (g * Math.PI) / 180;
        return {
          x1: 100 + Math.cos(a) * 34,
          y1: 100 + Math.sin(a) * 34,
          x2: 100 + Math.cos(a) * 68,
          y2: 100 + Math.sin(a) * 68,
          cx: 100 + Math.cos(a) * 68,
          cy: 100 + Math.sin(a) * 68,
        };
      }),
    [],
  );

  const pensando = estado === "pensando";
  const planejando = estado === "planejando";
  const executando = estado === "executando";
  const vozAtiva = estado === "ouvindo" || estado === "falando";
  const escalaVoz = 1 + Math.min(amplitude, 1) * 0.16;

  const CIRC = 2 * Math.PI * 82;

  return (
    <div
      className={`reator est-${estado} flex flex-col items-center gap-3`}
      data-estado={estado}
    >
      <svg
        width={tamanho}
        height={tamanho}
        viewBox="0 0 200 200"
        role="img"
        aria-label={`Reator do Jarvis — ${ROTULO[estado]}`}
        style={{ overflow: "visible" }}
      >
        <defs>
          <radialGradient id="rg-nucleo">
            <stop offset="0%" stopColor={cor} stopOpacity="1" />
            <stop offset="40%" stopColor={cor} stopOpacity="0.5" />
            <stop offset="100%" stopColor={cor} stopOpacity="0" />
          </radialGradient>
          <radialGradient id="rg-halo">
            <stop offset="55%" stopColor={cor} stopOpacity="0" />
            <stop offset="85%" stopColor={cor} stopOpacity="0.14" />
            <stop offset="100%" stopColor={cor} stopOpacity="0" />
          </radialGradient>
          <linearGradient id="lg-varredura" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={cor} stopOpacity="0" />
            <stop offset="50%" stopColor={cor} stopOpacity="0.55" />
            <stop offset="100%" stopColor={cor} stopOpacity="0" />
          </linearGradient>
          <clipPath id="cp-nucleo">
            <circle cx="100" cy="100" r="42" />
          </clipPath>
        </defs>

        {/* halo externo */}
        <circle cx="100" cy="100" r="96" fill="url(#rg-halo)" opacity={ativo ? 1 : 0.3} />

        {/* marcas radiais — estrutura técnica, sempre presente */}
        <g opacity={ativo ? 0.5 : 0.18}>
          {segmentos.map((s, i) => (
            <line
              key={i}
              x1={s.x1}
              y1={s.y1}
              x2={s.x2}
              y2={s.y2}
              stroke={cor}
              strokeWidth={s.forte ? 1.1 : 0.5}
              opacity={s.forte ? 0.85 : 0.4}
            />
          ))}
        </g>

        {/* anel externo fixo */}
        <circle
          cx="100"
          cy="100"
          r="82"
          fill="none"
          stroke={cor}
          strokeWidth="0.6"
          opacity={ativo ? 0.32 : 0.12}
        />

        {/* anel analítico — gira só em processamento/planejamento */}
        {(pensando || planejando) && (
          <g className="anel-analitico" style={{ transformOrigin: "100px 100px" }}>
            <circle
              cx="100"
              cy="100"
              r="74"
              fill="none"
              stroke={cor}
              strokeWidth="1.4"
              strokeDasharray="58 14 22 14"
              opacity="0.8"
            />
          </g>
        )}

        {/* contra-rotação — segunda camada, sentido oposto */}
        {pensando && (
          <g className="anel-contra" style={{ transformOrigin: "100px 100px" }}>
            <circle
              cx="100"
              cy="100"
              r="64"
              fill="none"
              stroke={cor}
              strokeWidth="0.8"
              strokeDasharray="6 20"
              opacity="0.6"
            />
          </g>
        )}

        {/* órbitas — pesquisa em andamento */}
        {pensando &&
          orbitas.map((o, i) => (
            <g
              key={i}
              className="orbita"
              style={{
                transformOrigin: "100px 100px",
                animationDuration: `${o.dur}s`,
                animationDelay: `${o.atraso}s`,
              }}
            >
              <circle cx={100 + o.r} cy="100" r={o.tam} fill={cor} opacity="0.9" />
            </g>
          ))}

        {/* grafo de planejamento */}
        {planejando && (
          <g className="ramos">
            {ramos.map((r, i) => (
              <g key={i} style={{ animationDelay: `${i * 0.09}s` }} className="ramo">
                <line
                  x1={r.x1}
                  y1={r.y1}
                  x2={r.x2}
                  y2={r.y2}
                  stroke={cor}
                  strokeWidth="1"
                  opacity="0.75"
                />
                <circle cx={r.cx} cy={r.cy} r="2.6" fill={cor} opacity="0.95" />
              </g>
            ))}
          </g>
        )}

        {/* anel de progresso — só com progresso REAL */}
        {executando && progresso !== null && (
          <circle
            cx="100"
            cy="100"
            r="82"
            fill="none"
            stroke={cor}
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={CIRC * (1 - Math.min(Math.max(progresso, 0), 1))}
            transform="rotate(-90 100 100)"
            opacity="0.9"
            style={{ transition: "stroke-dashoffset .4s ease" }}
          />
        )}

        {/* execução sem progresso conhecido — arco pulsante, não barra falsa */}
        {executando && progresso === null && (
          <g className="anel-exec" style={{ transformOrigin: "100px 100px" }}>
            <circle
              cx="100"
              cy="100"
              r="82"
              fill="none"
              stroke={cor}
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeDasharray="90 425"
              opacity="0.9"
            />
          </g>
        )}

        {/* aprovação — arco âmbar estático, sem piscar */}
        {estado === "aguardando_aprovacao" && (
          <circle
            cx="100"
            cy="100"
            r="82"
            fill="none"
            stroke={cor}
            strokeWidth="2"
            strokeDasharray="4 8"
            opacity="0.85"
          />
        )}

        {/* erro — anel duplo contido, sem alarme */}
        {estado === "erro" && (
          <>
            <circle cx="100" cy="100" r="82" fill="none" stroke={cor} strokeWidth="1.6" opacity="0.7" />
            <circle cx="100" cy="100" r="88" fill="none" stroke={cor} strokeWidth="0.6" opacity="0.35" />
          </>
        )}

        {/* anel de energia interno */}
        <circle
          cx="100"
          cy="100"
          r="52"
          fill="none"
          stroke={cor}
          strokeWidth="0.8"
          opacity={ativo ? 0.45 : 0.15}
        />

        {/* núcleo */}
        <g
          className="nucleo"
          style={{
            transformOrigin: "100px 100px",
            transform: vozAtiva ? `scale(${escalaVoz})` : undefined,
            transition: vozAtiva ? "transform .08s linear" : undefined,
          }}
        >
          <circle cx="100" cy="100" r="46" fill="url(#rg-nucleo)" opacity={ativo ? 0.9 : 0.25} />
          <circle cx="100" cy="100" r="19" fill={cor} opacity={ativo ? 0.95 : 0.3} />
          <circle
            cx="100"
            cy="100"
            r="30"
            fill="none"
            stroke={cor}
            strokeWidth="1"
            opacity={ativo ? 0.7 : 0.2}
          />
        </g>

        {/* varredura interna — leitura em andamento */}
        {pensando && (
          <g clipPath="url(#cp-nucleo)">
            <rect className="varredura" x="58" y="58" width="84" height="16" fill="url(#lg-varredura)" />
          </g>
        )}

        {/* malha técnica no núcleo */}
        <g clipPath="url(#cp-nucleo)" opacity={ativo ? 0.22 : 0.08}>
          {[-30, -15, 0, 15, 30].map((d) => (
            <line key={`h${d}`} x1="58" y1={100 + d} x2="142" y2={100 + d} stroke={cor} strokeWidth="0.4" />
          ))}
          {[-30, -15, 0, 15, 30].map((d) => (
            <line key={`v${d}`} x1={100 + d} y1="58" x2={100 + d} y2="142" stroke={cor} strokeWidth="0.4" />
          ))}
        </g>

        {/* marcas de canto — decoração técnica com posição fixa */}
        <g opacity={ativo ? 0.4 : 0.15} stroke={cor} strokeWidth="0.8" fill="none">
          <path d="M18 34 L18 18 L34 18" />
          <path d="M166 18 L182 18 L182 34" />
          <path d="M182 166 L182 182 L166 182" />
          <path d="M34 182 L18 182 L18 166" />
        </g>
      </svg>

      {!compacto && (
        <div className="flex flex-col items-center gap-1">
          <span
            className="mono text-[10px] tracking-[0.28em]"
            style={{ color: cor }}
            aria-live="polite"
          >
            {ROTULO[estado]}
          </span>
          {estado === "executando" && progresso !== null && (
            <span className="mono text-[9px] tracking-[0.14em] text-[var(--tinta-fraca)]">
              {Math.round(progresso * 100)}%
            </span>
          )}
        </div>
      )}
    </div>
  );
}
