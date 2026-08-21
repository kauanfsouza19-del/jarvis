"use client";

import type { ReactNode } from "react";

/**
 * Cartão do sistema bento — bloco de contexto secundário.
 *
 * Linguagem visual deliberadamente diferente do HUD técnico de cantos retos:
 * canto levemente arredondado, sombra contida, borda sutil. É "interface de
 * comando avançada", não "painel administrativo de SaaS" — por isso nada de
 * glassmorphism pesado nem cor decorativa fora da paleta do Jarvis.
 *
 * Estado é sempre um destes cinco — nunca texto solto inventado por card:
 * CARREGANDO, VAZIO, DISPONIVEL, ERRO, AUTH_NECESSARIA.
 */

export type EstadoBento = "carregando" | "vazio" | "disponivel" | "erro" | "auth_necessaria";
export type PesoBento = "normal" | "importante" | "critico";

const COR_PESO: Record<PesoBento, string> = {
  normal: "var(--color-linha)",
  importante: "var(--reator)",
  critico: "var(--risco)",
};

export function JarvisBentoCard({
  titulo,
  peso = "normal",
  estado,
  mensagemVazia,
  destaque = false,
  acao,
  children,
}: {
  titulo: string;
  peso?: PesoBento;
  estado: EstadoBento;
  /** Só usado quando estado é VAZIO, ERRO ou AUTH_NECESSARIA. */
  mensagemVazia?: string;
  /** Quando true, o card ganha mais espaço no grid — contexto relevante agora. */
  destaque?: boolean;
  acao?: { rotulo: string; aoClicar: () => void };
  children?: ReactNode;
}) {
  return (
    <section
      className={`group relative flex flex-col gap-2 rounded-lg border bg-[var(--color-superficie)]/70 p-3.5 backdrop-blur-sm transition-[transform,box-shadow,border-color] duration-200 ${
        destaque ? "xl:col-span-2" : ""
      }`}
      style={{
        borderColor: peso === "normal" ? "var(--color-linha)" : COR_PESO[peso],
        boxShadow: peso === "critico" ? "0 0 0 1px color-mix(in srgb, var(--risco) 25%, transparent)" : "none",
      }}
    >
      <header className="flex items-center gap-2">
        <p className="rotulo min-w-0 flex-1 truncate">{titulo}</p>
        {peso !== "normal" && (
          <span
            className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: COR_PESO[peso] }}
            aria-label={peso === "critico" ? "prioridade crítica" : "prioridade importante"}
          />
        )}
      </header>

      {estado === "carregando" && (
        <p className="mono text-[11px] text-[var(--color-tinta-fraca)]">carregando…</p>
      )}

      {(estado === "vazio" || estado === "erro" || estado === "auth_necessaria") && (
        <p
          className="text-[12.5px] leading-relaxed"
          style={{
            color: estado === "erro" ? "var(--risco)" : "var(--color-tinta-fraca)",
          }}
        >
          {mensagemVazia ?? "Sem dados suficientes."}
        </p>
      )}

      {estado === "disponivel" && children}

      {/* Ação sempre presente e clicável — nunca só-hover, senão o toque perde
          o controle inteiro. O realce em hover é só polimento em cima disso. */}
      {acao && estado === "disponivel" && (
        <button
          onClick={acao.aoClicar}
          className="mono mt-auto flex min-h-9 w-fit items-center gap-1 self-start text-[9.5px] tracking-[0.12em] opacity-80 transition-all duration-200 group-hover:translate-x-0.5 group-hover:opacity-100"
          style={{ color: "var(--reator-claro)" }}
        >
          {acao.rotulo} <span aria-hidden="true">→</span>
        </button>
      )}
    </section>
  );
}
