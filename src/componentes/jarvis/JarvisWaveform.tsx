"use client";

import { useEffect, useRef } from "react";

/**
 * Forma de onda.
 *
 * Só existe quando há áudio de verdade — microfone aberto ou TTS falando. Sem
 * áudio, o componente não é renderizado; nunca fica animando à toa.
 *
 * Canvas em vez de SVG: são ~64 barras redesenhadas a 60fps, e o custo por
 * frame no SVG seria mutação de DOM.
 */

export function JarvisWaveform({
  ativo,
  amplitudes,
  largura = 220,
  altura = 40,
  cor = "var(--reator-claro)",
}: {
  ativo: boolean;
  /** Amostras reais 0–1. Vazio = sem sinal. */
  amplitudes: number[];
  largura?: number;
  altura?: number;
  cor?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !ativo) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = largura * dpr;
    canvas.height = altura * dpr;
    ctx.scale(dpr, dpr);

    const corReal = getComputedStyle(canvas).getPropertyValue("color") || "#6fd3f5";

    ctx.clearRect(0, 0, largura, altura);

    const barras = 56;
    const w = largura / barras;
    const meio = altura / 2;

    for (let i = 0; i < barras; i++) {
      const a = amplitudes[i] ?? 0;
      // atenua nas pontas — a onda não termina em corte seco
      const janela = Math.sin((i / (barras - 1)) * Math.PI);
      const h = Math.max(1.5, a * janela * (altura - 6));
      ctx.fillStyle = corReal;
      ctx.globalAlpha = 0.35 + a * 0.65;
      ctx.fillRect(i * w + w * 0.25, meio - h / 2, w * 0.5, h);
    }
  }, [ativo, amplitudes, largura, altura]);

  if (!ativo) return null;

  return (
    <canvas
      ref={ref}
      style={{ width: largura, height: altura, color: cor }}
      aria-hidden="true"
      className="aparece"
    />
  );
}
