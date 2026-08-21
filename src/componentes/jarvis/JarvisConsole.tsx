"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Console de comando.
 *
 * Ctrl+J foca de qualquer lugar. Enter envia, Shift+Enter quebra linha.
 * O botão de microfone só aparece quando o navegador realmente expõe a API —
 * botão que não funciona é pior que botão ausente.
 */

export function JarvisCommandConsole({
  valor,
  onChange,
  onEnviar,
  onVoz,
  onAnexo,
  ocupado,
  ouvindo,
  vozDisponivel,
}: {
  valor: string;
  onChange: (v: string) => void;
  onEnviar: () => void;
  onVoz?: () => void;
  onAnexo?: () => void;
  ocupado: boolean;
  ouvindo: boolean;
  vozDisponivel: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [foco, setFoco] = useState(false);

  useEffect(() => {
    const atalho = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", atalho);
    return () => window.removeEventListener("keydown", atalho);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [valor]);

  return (
    <div
      className="canto painel flex items-end gap-2 px-3 py-2 transition-colors"
      style={{ borderColor: foco ? "var(--reator)" : undefined }}
    >
      <span
        className="mono shrink-0 pb-2.5 text-[11px] tracking-[0.1em]"
        style={{ color: foco ? "var(--reator-claro)" : "var(--tinta-fraca)" }}
        aria-hidden="true"
      >
        &gt;
      </span>

      <textarea
        ref={ref}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFoco(true)}
        onBlur={() => setFoco(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onEnviar();
          }
        }}
        rows={1}
        disabled={ocupado}
        aria-label="Comando para o Jarvis"
        placeholder={ouvindo ? "Ouvindo…" : "Fale com o Jarvis…"}
        className="max-h-42 min-h-11 sm:min-h-[38px] flex-1 resize-none bg-transparent py-2 text-[14.5px] leading-relaxed outline-none placeholder:text-[var(--color-tinta-fraca)] disabled:opacity-50"
      />

      {onAnexo && (
        <button
          onClick={onAnexo}
          aria-label="Anexar arquivo"
          className="mono mb-0.5 flex h-11 w-11 shrink-0 items-center justify-center border border-[var(--color-linha)] text-[13px] text-[var(--color-tinta-fraca)] transition hover:border-[var(--reator)] hover:text-[var(--reator-claro)] sm:h-9 sm:w-9"
        >
          <span aria-hidden="true">📎</span>
        </button>
      )}

      {vozDisponivel && onVoz && (
        <button
          onClick={onVoz}
          aria-label={ouvindo ? "Parar de ouvir" : "Ativar microfone"}
          aria-pressed={ouvindo}
          className="mono mb-0.5 flex h-11 w-11 shrink-0 items-center justify-center border text-[11px] transition sm:h-9 sm:w-auto sm:px-2.5 sm:text-[9px] sm:tracking-[0.12em]"
          style={{
            color: ouvindo ? "var(--reator-claro)" : "var(--tinta-fraca)",
            borderColor: ouvindo ? "var(--reator-claro)" : "var(--color-linha)",
          }}
        >
          <span className="sm:hidden">{ouvindo ? "■" : "●"}</span>
          <span className="hidden sm:inline">{ouvindo ? "■ PARAR" : "● VOZ"}</span>
        </button>
      )}

      <button
        onClick={onEnviar}
        disabled={!valor.trim() || ocupado}
        aria-label="Enviar comando"
        className="mono mb-0.5 flex h-11 w-11 shrink-0 items-center justify-center border border-[var(--color-reator)] text-[13px] text-[var(--color-reator)] transition hover:bg-[var(--color-reator)]/10 disabled:cursor-not-allowed disabled:border-[var(--color-linha)] disabled:text-[var(--color-tinta-fraca)] sm:h-9 sm:w-auto sm:px-3 sm:text-[9px] sm:tracking-[0.14em]"
      >
        <span className="sm:hidden" aria-hidden="true">↵</span>
        <span className="hidden sm:inline">ENVIAR</span>
      </button>
    </div>
  );
}
