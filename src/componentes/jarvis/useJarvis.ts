"use client";

import { useCallback, useRef, useState } from "react";
import {
  estadoDoEvento,
  type Evento,
  type EstadoReator,
  type TipoEvento,
} from "@/lib/eventos";

/**
 * Estado vivo do Jarvis.
 *
 * O reator lê `estado` daqui, e `estado` só muda quando um evento real chega.
 * Não há setter público de estado — se não houve evento, o reator não se mexe.
 */
export function useJarvis() {
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [estado, setEstado] = useState<EstadoReator>("ocioso");
  const [amplitude, setAmplitude] = useState(0);
  const contador = useRef(0);
  const inicioTool = useRef<Map<string, number>>(new Map());

  const emitir = useCallback(
    (tipo: TipoEvento, rotulo: string, extra?: Partial<Evento>) => {
      const ev: Evento = {
        id: `ev${++contador.current}`,
        tipo,
        em: Date.now(),
        rotulo,
        ...extra,
      };

      // duração real de tool: medida entre início e fim, não estimada
      if (tipo === "TOOL_INICIOU" && extra?.tool) {
        inicioTool.current.set(extra.tool, ev.em);
      }
      if ((tipo === "TOOL_CONCLUIU" || tipo === "TOOL_FALHOU") && extra?.tool) {
        const t0 = inicioTool.current.get(extra.tool);
        if (t0) {
          ev.duracaoMs = ev.em - t0;
          inicioTool.current.delete(extra.tool);
        }
      }

      setEventos((e) => [...e.slice(-60), ev]);

      const novo = estadoDoEvento(tipo);
      if (novo) setEstado(novo);
      return ev;
    },
    [],
  );

  /** Só para voz: escuta e fala são estados de dispositivo, não de evento. */
  const definirEstadoDeVoz = useCallback((e: "ouvindo" | "falando" | null) => {
    setEstado((atual) => {
      if (e) return e;
      return atual === "ouvindo" || atual === "falando" ? "ocioso" : atual;
    });
  }, []);

  const limpar = useCallback(() => {
    setEventos([]);
    setEstado("ocioso");
    setAmplitude(0);
  }, []);

  const toolsAtivas = eventos.reduce<string[]>((acc, ev) => {
    if (ev.tipo === "TOOL_INICIOU" && ev.tool) return [...acc, ev.tool];
    if ((ev.tipo === "TOOL_CONCLUIU" || ev.tipo === "TOOL_FALHOU") && ev.tool) {
      return acc.filter((t) => t !== ev.tool);
    }
    return acc;
  }, []);

  return {
    eventos,
    estado,
    amplitude,
    setAmplitude,
    toolsAtivas,
    emitir,
    definirEstadoDeVoz,
    limpar,
  };
}
