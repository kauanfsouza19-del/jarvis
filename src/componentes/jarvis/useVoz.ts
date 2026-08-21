"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Voz — reconhecimento, síntese e o sinal real que anima o overlay.
 *
 * Duas fontes de amplitude, as duas reais:
 * - OUVINDO: AnalyserNode sobre o microfone de verdade (frequência real).
 * - FALANDO: `SpeechSynthesisUtterance.onboundary`, que dispara por palavra
 *   com o índice real de caractere que o motor de TTS está lendo. Não é
 *   amplitude de áudio — a Web Speech API não expõe isso para a saída de
 *   síntese — mas é um evento real do motor, não um número inventado. Cada
 *   pulso do waveform em FALANDO corresponde a uma palavra que o TTS de fato
 *   emitiu naquele instante.
 *
 * Interrupção: se o Cacique fala enquanto o Jarvis fala, a amplitude do
 * microfone (que continua sendo lida em paralelo) passa do limiar e corta o
 * TTS na hora.
 */

export type EstadoVoz = "ocioso" | "ouvindo" | "pensando" | "falando" | "erro";

const LIMIAR_INTERRUPCAO = 0.35;

export function useVoz() {
  const [estado, setEstado] = useState<EstadoVoz>("ocioso");
  const [transcricao, setTranscricao] = useState("");
  const [amostras, setAmostras] = useState<number[]>(new Array(56).fill(0));
  const [erro, setErro] = useState<string | null>(null);

  const recRef = useRef<unknown>(null);
  const audioRef = useRef<{ ctx: AudioContext; stream: MediaStream } | null>(null);
  const rafRef = useRef<number | null>(null);
  const estadoRef = useRef<EstadoVoz>("ocioso");
  estadoRef.current = estado;

  const disponivel =
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);
  const ttsDisponivel = typeof window !== "undefined" && "speechSynthesis" in window;

  const pararAudio = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    audioRef.current?.stream.getTracks().forEach((t) => t.stop());
    void audioRef.current?.ctx.close().catch(() => {});
    audioRef.current = null;
  }, []);

  const abrirMicrofone = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      const fonte = ctx.createMediaStreamSource(stream);
      const analisador = ctx.createAnalyser();
      analisador.fftSize = 128;
      fonte.connect(analisador);
      audioRef.current = { ctx, stream };

      const buf = new Uint8Array(analisador.frequencyBinCount);
      const ler = () => {
        if (!audioRef.current) return;
        analisador.getByteFrequencyData(buf);
        const vals = Array.from(buf.slice(0, 56)).map((v) => v / 255);
        const media = vals.reduce((a, b) => a + b, 0) / vals.length;

        // Interrupção: mic real passa do limiar enquanto o Jarvis fala.
        if (estadoRef.current === "falando" && media > LIMIAR_INTERRUPCAO) {
          window.speechSynthesis.cancel();
          setEstado("ouvindo");
        }
        if (estadoRef.current === "ouvindo") setAmostras(vals);

        rafRef.current = requestAnimationFrame(ler);
      };
      ler();
    } catch {
      // Sem permissão de microfone: overlay segue, mas sem forma de onda nem
      // interrupção por voz — o botão PARAR continua funcionando.
    }
  }, []);

  const parar = useCallback(() => {
    (recRef.current as { stop?: () => void } | null)?.stop?.();
    if (ttsDisponivel) window.speechSynthesis.cancel();
    pararAudio();
    setEstado("ocioso");
    setAmostras(new Array(56).fill(0));
  }, [pararAudio, ttsDisponivel]);

  const iniciar = useCallback(() => {
    setErro(null);
    setTranscricao("");

    const Rec =
      (window as unknown as { SpeechRecognition?: new () => unknown }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => unknown })
        .webkitSpeechRecognition;
    if (!Rec) {
      setErro("Reconhecimento de voz não disponível neste navegador.");
      setEstado("erro");
      return;
    }

    void abrirMicrofone();

    const rec = new Rec() as {
      lang: string;
      continuous: boolean;
      interimResults: boolean;
      onresult: (e: unknown) => void;
      onend: () => void;
      onerror: (e: unknown) => void;
      start: () => void;
      stop: () => void;
    };
    rec.lang = "pt-BR";
    rec.continuous = false;
    rec.interimResults = true;

    rec.onresult = (e: unknown) => {
      const ev = e as { results: ArrayLike<ArrayLike<{ transcript: string }>> };
      let texto = "";
      for (let i = 0; i < ev.results.length; i++) texto += ev.results[i][0].transcript;
      setTranscricao(texto);
    };
    rec.onend = () => {
      pararAudio();
      setEstado((e) => (e === "ouvindo" ? "ocioso" : e));
    };
    rec.onerror = (e: unknown) => {
      const ev = e as { error?: string };
      if (ev.error === "no-speech" || ev.error === "aborted") {
        setEstado("ocioso");
      } else {
        setErro(`Erro de reconhecimento: ${ev.error ?? "desconhecido"}`);
        setEstado("erro");
      }
      pararAudio();
    };

    recRef.current = rec;
    rec.start();
    setEstado("ouvindo");
  }, [abrirMicrofone, pararAudio]);

  /** Fala o texto em voz alta. Waveform pulsa por evento real de palavra. */
  const falar = useCallback(
    (texto: string, aoTerminar?: () => void) => {
      if (!ttsDisponivel || !texto.trim()) {
        aoTerminar?.();
        return;
      }
      const u = new SpeechSynthesisUtterance(texto);
      u.lang = "pt-BR";
      u.rate = 1.02;

      u.onboundary = () => {
        // Pulso real de palavra — decai rápido, sem interpolação inventada.
        const pulso = new Array(56).fill(0).map((_, i) => Math.max(0, 1 - Math.abs(i - 28) / 28));
        setAmostras(pulso);
        setTimeout(() => setAmostras(new Array(56).fill(0)), 90);
      };
      u.onend = () => {
        setEstado((e) => (e === "falando" ? "ocioso" : e));
        setAmostras(new Array(56).fill(0));
        aoTerminar?.();
      };
      u.onerror = () => {
        setEstado("ocioso");
        aoTerminar?.();
      };

      setEstado("falando");
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    },
    [ttsDisponivel],
  );

  const pensando = useCallback(() => setEstado("pensando"), []);

  useEffect(() => () => {
    pararAudio();
    if (ttsDisponivel) window.speechSynthesis.cancel();
    (recRef.current as { stop?: () => void } | null)?.stop?.();
  }, [pararAudio, ttsDisponivel]);

  return {
    estado,
    transcricao,
    amostras,
    erro,
    disponivel,
    ttsDisponivel,
    iniciar,
    parar,
    falar,
    pensando,
  };
}
