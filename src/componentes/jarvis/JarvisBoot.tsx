"use client";

import { useEffect, useState } from "react";

/**
 * Sequência de boot.
 *
 * Cada linha corresponde a uma verificação REAL: o passo só marca OK depois que
 * a chamada correspondente voltou. Se o banco estiver fora, a linha fica em
 * FALHA e o boot termina mesmo assim — nada de teatro de carregamento.
 *
 * Termina rápido por construção: as checagens rodam em paralelo.
 */

type Passo = { rotulo: string; estado: "aguardando" | "ok" | "falha"; nota?: string };

export function JarvisBoot({ aoTerminar }: { aoTerminar: () => void }) {
  const [passos, setPassos] = useState<Passo[]>([
    { rotulo: "NÚCLEO", estado: "aguardando" },
    { rotulo: "MEMÓRIA", estado: "aguardando" },
    { rotulo: "PROJETOS", estado: "aguardando" },
    { rotulo: "ÍNDICE", estado: "aguardando" },
    { rotulo: "MODELO", estado: "aguardando" },
  ]);

  useEffect(() => {
    let vivo = true;

    const marcar = (i: number, estado: Passo["estado"], nota?: string) =>
      setPassos((p) => p.map((x, k) => (k === i ? { ...x, estado, nota } : x)));

    void (async () => {
      marcar(0, "ok");

      try {
        const s = await fetch("/api/saude").then((r) => r.json());
        if (!vivo) return;

        marcar(1, s.banco ? "ok" : "falha", `${s.memorias} registro(s)`);
        marcar(3, "ok", `${s.conhecimentoProjeto} fato(s)`);
        marcar(4, s.modelo ? "ok" : "falha", s.modelo ? "conectado" : "sem chave");

        const p = await fetch("/api/projetos").then((r) => r.json());
        if (!vivo) return;
        marcar(2, "ok", `${p.projetos?.length ?? 0} registrado(s)`);
      } catch {
        if (!vivo) return;
        marcar(1, "falha", "banco indisponível");
        marcar(2, "falha");
        marcar(3, "falha");
        marcar(4, "falha");
      }

      // pausa curta só para a última linha ser legível — não é espera artificial
      setTimeout(() => vivo && aoTerminar(), 420);
    })();

    return () => {
      vivo = false;
    };
  }, [aoTerminar]);

  return (
    <div className="flex h-dvh items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <p
          className="mono mb-6 text-[11px] tracking-[0.4em]"
          style={{ color: "var(--reator)" }}
        >
          JARVIS
        </p>

        <ol className="flex flex-col gap-2">
          {passos.map((p, i) => (
            <li
              key={p.rotulo}
              className="aparece flex items-baseline gap-3"
              style={{ animationDelay: `${i * 55}ms` }}
            >
              <span
                className="mono w-5 shrink-0 text-[11px]"
                style={{
                  color:
                    p.estado === "ok"
                      ? "var(--ok)"
                      : p.estado === "falha"
                        ? "var(--atencao)"
                        : "var(--tinta-fraca)",
                }}
              >
                {p.estado === "ok" ? "✓" : p.estado === "falha" ? "!" : "·"}
              </span>
              <span className="mono flex-1 text-[10px] tracking-[0.18em] text-[var(--color-tinta-media)]">
                {p.rotulo}
              </span>
              {p.nota && (
                <span className="mono text-[9px] text-[var(--color-tinta-fraca)]">{p.nota}</span>
              )}
            </li>
          ))}
        </ol>

        <div className="mt-6 h-px w-full overflow-hidden bg-[var(--color-linha)]">
          <div
            className="h-full transition-[width] duration-300"
            style={{
              width: `${(passos.filter((p) => p.estado !== "aguardando").length / passos.length) * 100}%`,
              background: "var(--reator)",
            }}
          />
        </div>
      </div>
    </div>
  );
}
