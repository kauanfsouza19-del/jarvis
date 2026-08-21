"use client";

import { useEffect, useRef } from "react";
import { JarvisReator } from "./JarvisReator";
import { JarvisWaveform } from "./JarvisWaveform";
import type { EstadoVoz } from "./useVoz";

const ROTULO: Record<EstadoVoz, string> = {
  ocioso: "PRONTO",
  ouvindo: "OUVINDO",
  pensando: "PENSANDO",
  falando: "FALANDO",
  erro: "ERRO",
};

const REATOR_DE: Record<EstadoVoz, "ouvindo" | "pensando" | "falando" | "erro" | "ocioso"> = {
  ocioso: "ocioso",
  ouvindo: "ouvindo",
  pensando: "pensando",
  falando: "falando",
  erro: "erro",
};

/**
 * Overlay de voz — tela cheia, um único foco: o Jarvis ouvindo ou falando.
 *
 * Fecha com Escape, com o botão FECHAR, ou automaticamente alguns segundos
 * depois de terminar de falar (cancelável ao mover o mouse/tocar).
 */
export function JarvisVozOverlay({
  aberto,
  estado,
  transcricao,
  amostras,
  erroTexto,
  respostaParcial,
  onFechar,
  onParar,
}: {
  aberto: boolean;
  estado: EstadoVoz;
  transcricao: string;
  amostras: number[];
  erroTexto: string | null;
  respostaParcial: string;
  onFechar: () => void;
  onParar: () => void;
}) {
  const fecharRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!aberto) return;
    fecharRef.current?.focus();
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFechar();
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [aberto, onFechar]);

  if (!aberto) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Overlay de voz do Jarvis"
      className="aparece fixed inset-0 z-50 flex flex-col bg-[var(--color-fundo)]/97 backdrop-blur-sm"
    >
      <div aria-live="polite" className="sr-only">
        Jarvis está {ROTULO[estado].toLowerCase()}
      </div>

      <header className="flex shrink-0 items-center justify-between px-5 py-4 sm:px-8">
        <span
          className="mono text-[11px] tracking-[0.3em]"
          style={{ color: "var(--reator)" }}
        >
          JARVIS · VOZ
        </span>
        <button
          ref={fecharRef}
          onClick={onFechar}
          aria-label="Fechar overlay de voz"
          className="mono flex h-11 min-w-11 items-center justify-center border border-[var(--color-linha)] px-3 text-[10px] tracking-[0.14em] text-[var(--color-tinta-media)] transition hover:border-[var(--reator)] hover:text-[var(--reator-claro)]"
        >
          FECHAR ✕
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-8 px-6 text-center">
        <JarvisReator estado={REATOR_DE[estado]} amplitude={amostras.reduce((a, b) => a + b, 0) / amostras.length} tamanho={180} progresso={null} />

        <p
          className="mono text-[11px] tracking-[0.3em]"
          style={{
            color:
              estado === "erro"
                ? "var(--risco)"
                : estado === "falando"
                  ? "var(--reator-claro)"
                  : "var(--color-tinta-media)",
          }}
        >
          {ROTULO[estado]}
        </p>

        {(estado === "ouvindo" || estado === "falando") && (
          <JarvisWaveform ativo amplitudes={amostras} largura={280} altura={54} />
        )}

        <div className="min-h-[88px] w-full max-w-lg px-2">
          {estado === "erro" && erroTexto && (
            <p className="text-[14px] leading-relaxed text-[var(--risco)]">{erroTexto}</p>
          )}
          {estado === "ouvindo" && (
            <p className="text-[16px] leading-relaxed text-[var(--color-tinta)]">
              {transcricao || (
                <span className="text-[var(--color-tinta-fraca)]">Pode falar, Cacique.</span>
              )}
            </p>
          )}
          {estado === "pensando" && (
            <p className="mono text-[11px] tracking-[0.14em] text-[var(--color-tinta-fraca)]">
              RESOLVENDO CONTEXTO E RESPONDENDO…
            </p>
          )}
          {estado === "falando" && (
            <p className="text-[14.5px] leading-relaxed text-[var(--color-tinta-media)]">
              {respostaParcial}
            </p>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-center gap-3 px-6 pb-8 sm:pb-10">
        <button
          onClick={onParar}
          aria-label="Parar"
          className="mono flex min-h-12 min-w-32 items-center justify-center gap-2 border border-[var(--color-linha)] px-5 text-[11px] tracking-[0.16em] text-[var(--color-tinta-media)] transition hover:border-[var(--risco)] hover:text-[var(--risco)]"
        >
          ■ PARAR
        </button>
      </div>
    </div>
  );
}
