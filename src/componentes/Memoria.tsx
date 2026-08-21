"use client";

import { useCallback, useEffect, useState } from "react";

type Mem = {
  id: string;
  tipo: string;
  camada: string;
  titulo: string;
  corpo: string;
  confianca: number;
  importancia: number;
  estado: string;
  atualizado_em: string;
};

const TIPOS = [
  "FATO", "PREFERENCIA", "META", "PROJETO", "DECISAO", "TAREFA",
  "ROTINA", "OPORTUNIDADE", "CONTEXTO_TEMP", "SKILL", "LICAO", "EXPERIMENTO",
];

const COR_ESTADO: Record<string, string> = {
  ATIVA: "var(--color-ok)",
  DESATUALIZADA: "var(--color-atencao)",
  REVOGADA: "var(--color-risco)",
  ARQUIVADA: "var(--color-tinta-fraca)",
};

export function Memoria() {
  const [itens, setItens] = useState<Mem[]>([]);
  const [busca, setBusca] = useState("");
  const [modoLista, setModoLista] = useState<"lista" | "busca">("lista");
  const [inativas, setInativas] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const [tipo, setTipo] = useState("FATO");
  const [titulo, setTitulo] = useState("");
  const [corpo, setCorpo] = useState("");
  const [abrindo, setAbrindo] = useState(false);

  const carregar = useCallback(async () => {
    const url = busca.trim()
      ? `/api/memorias?busca=${encodeURIComponent(busca)}${inativas ? "&inativas=1" : ""}`
      : `/api/memorias${inativas ? "" : "&estado=ATIVA"}`.replace("&", "?");
    const r = await fetch(url).then((x) => x.json());
    setItens(r.memorias ?? []);
    setModoLista(r.modo ?? "lista");
  }, [busca, inativas]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const salvar = useCallback(async () => {
    if (!titulo.trim() || !corpo.trim()) return;
    setAviso(null);
    const r = await fetch("/api/memorias", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipo, titulo, corpo }),
    });
    const d = await r.json();
    if (!r.ok) {
      setAviso(d.detalhe ?? "Recusada.");
      return;
    }
    setTitulo("");
    setCorpo("");
    setAbrindo(false);
    void carregar();
  }, [tipo, titulo, corpo, carregar]);

  const esquecer = useCallback(
    async (id: string) => {
      await fetch(`/api/memorias?id=${id}`, { method: "DELETE" });
      void carregar();
    },
    [carregar],
  );

  return (
    <div className="rolagem h-full overflow-y-auto px-6 py-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Quando eu decidi isso? Qual o posicionamento do Locatta?"
            className="min-w-64 flex-1 rounded-sm border border-[var(--color-linha)] bg-[var(--color-superficie)] px-3 py-2 text-sm outline-none placeholder:text-[var(--color-tinta-fraca)] focus:border-[var(--color-reator)]"
          />
          <label className="mono flex items-center gap-1.5 text-[10px] text-[var(--color-tinta-media)]">
            <input
              type="checkbox"
              checked={inativas}
              onChange={(e) => setInativas(e.target.checked)}
            />
            INCLUIR HISTÓRICO
          </label>
          <button
            onClick={() => setAbrindo((a) => !a)}
            className="mono rounded-sm border border-[var(--color-reator)] px-3 py-2 text-[10px] tracking-[0.14em] text-[var(--color-reator)] hover:bg-[var(--color-reator)]/10"
          >
            + MEMÓRIA
          </button>
        </div>

        {abrindo && (
          <div className="mb-6 rounded-sm border border-[var(--color-linha)] bg-[var(--color-superficie)] p-4">
            <div className="mb-3 flex gap-3">
              <select
                value={tipo}
                onChange={(e) => setTipo(e.target.value)}
                className="mono rounded-sm border border-[var(--color-linha)] bg-[var(--color-superficie-2)] px-2 py-1.5 text-[11px]"
              >
                {TIPOS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <input
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                placeholder="Título curto"
                className="flex-1 rounded-sm border border-[var(--color-linha)] bg-[var(--color-superficie-2)] px-3 py-1.5 text-sm outline-none focus:border-[var(--color-reator)]"
              />
            </div>
            <textarea
              value={corpo}
              onChange={(e) => setCorpo(e.target.value)}
              rows={3}
              placeholder="O que deve ser lembrado, e por quê."
              className="mb-3 w-full resize-none rounded-sm border border-[var(--color-linha)] bg-[var(--color-superficie-2)] px-3 py-2 text-sm outline-none focus:border-[var(--color-reator)]"
            />
            {aviso && (
              <p className="mb-3 border-l-2 border-[var(--color-risco)] bg-[var(--color-risco)]/10 px-3 py-2 text-xs text-[var(--color-tinta-media)]">
                {aviso}
              </p>
            )}
            <button
              onClick={() => void salvar()}
              className="mono rounded-sm border border-[var(--color-reator)] px-4 py-1.5 text-[10px] tracking-[0.14em] text-[var(--color-reator)] hover:bg-[var(--color-reator)]/10"
            >
              SALVAR
            </button>
          </div>
        )}

        <p className="mono mb-3 text-[10px] tracking-[0.14em] text-[var(--color-tinta-fraca)]">
          {itens.length} REGISTRO(S) · {modoLista === "busca" ? "BUSCA" : "LISTA"}
        </p>

        <div className="flex flex-col gap-2">
          {itens.map((m) => (
            <div
              key={m.id}
              className="rounded-sm border border-[var(--color-linha)] bg-[var(--color-superficie)] p-3.5"
            >
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <span className="mono rounded-sm border border-[var(--color-linha)] px-1.5 py-0.5 text-[9px] tracking-[0.1em] text-[var(--color-reator)]">
                  {m.tipo}
                </span>
                <span
                  className="mono text-[9px] tracking-[0.1em]"
                  style={{ color: COR_ESTADO[m.estado] ?? "var(--color-tinta-fraca)" }}
                >
                  {m.estado}
                </span>
                <span className="mono text-[9px] text-[var(--color-tinta-fraca)]">
                  conf {m.confianca?.toFixed(2)} · imp {m.importancia}
                </span>
                <button
                  onClick={() => void esquecer(m.id)}
                  className="mono ml-auto text-[9px] tracking-[0.1em] text-[var(--color-tinta-fraca)] hover:text-[var(--color-risco)]"
                >
                  ESQUECER
                </button>
              </div>
              <p className="mb-1 text-sm font-semibold">{m.titulo}</p>
              <p className="text-sm leading-relaxed text-[var(--color-tinta-media)]">{m.corpo}</p>
            </div>
          ))}
          {itens.length === 0 && (
            <p className="text-sm text-[var(--color-tinta-fraca)]">
              {busca ? "Nada encontrado." : "Nenhuma memória ainda."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
