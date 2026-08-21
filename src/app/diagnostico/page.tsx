"use client";

import { useState } from "react";
import { JarvisReator } from "@/componentes/jarvis/JarvisReator";
import { JarvisWaveform } from "@/componentes/jarvis/JarvisWaveform";
import type { EstadoReator } from "@/lib/eventos";

/**
 * Página de inspeção visual dos componentes.
 *
 * Existe para conferir cada estado do reator lado a lado sem precisar provocar
 * a condição real. É uma ferramenta de desenvolvimento — está fora da interface
 * principal e rotulada como tal, justamente para que a tela de comando nunca
 * precise simular estado.
 */

const ESTADOS: EstadoReator[] = [
  "ocioso",
  "ouvindo",
  "pensando",
  "planejando",
  "executando",
  "aguardando_aprovacao",
  "falando",
  "erro",
  "offline",
];

const SIGNIFICADO: Record<EstadoReator, string> = {
  ocioso: "respiração lenta do núcleo — sistema vivo, nada rodando",
  ouvindo: "escala do núcleo segue a amplitude real do microfone",
  pensando: "anel analítico + contra-rotação + órbitas + varredura interna",
  planejando: "grafo radial ramificando a partir do núcleo",
  executando: "pulso forte + arco de progresso (ou arco pulsante sem progresso)",
  aguardando_aprovacao: "âmbar tracejado estático — atenção sem alarme",
  falando: "escala segue a amplitude do TTS",
  erro: "anel duplo vermelho contido — sem piscar",
  offline: "reator atenuado, sem animação",
};

export default function Diagnostico() {
  const [amp, setAmp] = useState(0.5);
  const [prog, setProg] = useState(0.62);

  const ondaFalsa = Array.from({ length: 56 }, (_, i) =>
    Math.abs(Math.sin(i / 4)) * amp,
  );

  return (
    <div className="min-h-dvh px-6 py-8">
      <header className="mx-auto mb-8 max-w-6xl">
        <p className="mono text-[11px] tracking-[0.34em]" style={{ color: "var(--reator)" }}>
          JARVIS · DIAGNÓSTICO VISUAL
        </p>
        <p className="mt-2 max-w-2xl text-sm text-[var(--color-tinta-media)]">
          Ferramenta de inspeção. Os estados abaixo são renderizados diretamente para
          conferência — a tela de comando nunca mostra um estado sem o evento real
          correspondente.
        </p>

        <div className="mt-4 flex flex-wrap gap-6">
          <label className="mono flex items-center gap-2 text-[10px] tracking-[0.12em] text-[var(--color-tinta-fraca)]">
            AMPLITUDE
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={amp}
              onChange={(e) => setAmp(Number(e.target.value))}
            />
            <span className="w-8">{amp.toFixed(2)}</span>
          </label>
          <label className="mono flex items-center gap-2 text-[10px] tracking-[0.12em] text-[var(--color-tinta-fraca)]">
            PROGRESSO
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={prog}
              onChange={(e) => setProg(Number(e.target.value))}
            />
            <span className="w-8">{Math.round(prog * 100)}%</span>
          </label>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {ESTADOS.map((e) => (
          <div key={e} className="painel canto flex flex-col items-center gap-3 p-5">
            <JarvisReator
              estado={e}
              amplitude={e === "ouvindo" || e === "falando" ? amp : 0}
              progresso={e === "executando" ? prog : null}
              tamanho={180}
            />
            {(e === "ouvindo" || e === "falando") && (
              <JarvisWaveform ativo amplitudes={ondaFalsa} largura={160} altura={28} />
            )}
            <p className="text-center text-[11.5px] leading-relaxed text-[var(--color-tinta-media)]">
              {SIGNIFICADO[e]}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
