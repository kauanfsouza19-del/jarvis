"use client";

import { useCallback, useEffect, useState } from "react";

type Fonte = {
  id: string;
  titulo: string;
  tipo: string;
  categoria: string | null;
  estado: string;
  importado_em: string;
  observacao: string | null;
};

type Trecho = {
  id: string;
  afirmacao: string;
  corpo: string;
  modulo: string | null;
  evidencia: string;
  natureza: string;
  confianca: number;
  fonte_titulo: string;
};

const COR_EVIDENCIA: Record<string, string> = {
  CONSENSO_FORTE: "var(--color-ok)",
  CONSENSO_PARCIAL: "var(--color-reator)",
  MENCAO_ISOLADA: "var(--color-atencao)",
};

const COR_ESTADO: Record<string, string> = {
  INGERIDA: "var(--color-ok)",
  AGUARDANDO_CONTEUDO: "var(--color-atencao)",
  FALHOU: "var(--color-risco)",
  ARQUIVADA: "var(--color-tinta-fraca)",
};

type Fato = {
  id: string;
  titulo: string;
  corpo: string;
  caminho: string | null;
  confianca: number;
  projeto_nome: string;
};

type ProjetoIndexado = { id: string; nome: string; arquivos: number };

/** Marca que o extrator gravou no corpo do fato, quando gravou. */
function marca(corpo: string): { rotulo: string; cor: string } | null {
  if (corpo.includes("[REFERENCIA_EXTERNA]"))
    return { rotulo: "REFERÊNCIA EXTERNA", cor: "var(--color-atencao)" };
  if (corpo.includes("[HISTORICO]")) return { rotulo: "HISTÓRICO", cor: "var(--color-tinta-fraca)" };
  return null;
}

export function Conhecimento() {
  const [fontes, setFontes] = useState<Fonte[]>([]);
  const [trechos, setTrechos] = useState<Trecho[]>([]);
  const [fatos, setFatos] = useState<Fato[]>([]);
  const [projetos, setProjetos] = useState<ProjetoIndexado[]>([]);
  const [projetoId, setProjetoId] = useState("");
  const [busca, setBusca] = useState("");

  const carregar = useCallback(async () => {
    if (busca.trim()) {
      const p = projetoId ? `&projeto_id=${projetoId}` : "";
      const r = await fetch(`/api/conhecimento?busca=${encodeURIComponent(busca)}${p}`).then((x) =>
        x.json(),
      );
      setTrechos(r.trechos ?? []);
      setFatos(r.fatos ?? []);
    } else {
      const r = await fetch("/api/conhecimento").then((x) => x.json());
      setFontes(r.fontes ?? []);
      setProjetos(r.projetos ?? []);
      setTrechos([]);
      setFatos([]);
    }
  }, [busca, projetoId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  return (
    <div className="rolagem h-full overflow-y-auto px-6 py-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-5 flex flex-col gap-2 sm:flex-row">
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar — ex: quais LPs existem, hooks de VSL, criativos de dor"
            className="min-h-11 w-full rounded-sm border border-[var(--color-linha)] bg-[var(--color-superficie)] px-3 py-2 text-sm outline-none placeholder:text-[var(--color-tinta-fraca)] focus:border-[var(--color-reator)]"
          />
          <select
            value={projetoId}
            onChange={(e) => setProjetoId(e.target.value)}
            aria-label="Filtrar por projeto"
            className="mono min-h-11 shrink-0 rounded-sm border border-[var(--color-linha)] bg-[var(--color-superficie)] px-2 text-[10px] tracking-[0.12em] outline-none focus:border-[var(--color-reator)]"
          >
            <option value="">TODOS OS PROJETOS</option>
            {projetos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
        </div>

        {busca.trim() ? (
          <>
            {fatos.length > 0 && (
              <section className="mb-6">
                <p className="mono mb-3 text-[10px] tracking-[0.14em] text-[var(--color-tinta-fraca)]">
                  {fatos.length} FATO(S) DE PROJETO · CADA UM APONTA PARA O ARQUIVO
                </p>
                <div className="flex flex-col gap-2">
                  {fatos.map((f) => {
                    const m = marca(f.corpo);
                    return (
                      <div
                        key={f.id}
                        className="rounded-sm border border-[var(--color-linha)] bg-[var(--color-superficie)] p-3.5"
                      >
                        <div className="mb-1.5 flex flex-wrap items-center gap-2">
                          <span className="mono text-[9px] tracking-[0.12em] text-[var(--color-reator)]">
                            {f.projeto_nome}
                          </span>
                          {m && (
                            <span
                              className="mono rounded-sm px-1.5 py-0.5 text-[9px] tracking-[0.1em]"
                              style={{ color: m.cor, border: `1px solid ${m.cor}` }}
                            >
                              {m.rotulo}
                            </span>
                          )}
                          <span className="mono ml-auto text-[9px] text-[var(--color-tinta-fraca)]">
                            conf {f.confianca.toFixed(2)}
                          </span>
                        </div>
                        <p className="mb-1 text-sm font-semibold">{f.titulo}</p>
                        <p className="mb-2 line-clamp-4 text-sm leading-relaxed text-[var(--color-tinta-media)]">
                          {f.corpo}
                        </p>
                        {f.caminho && (
                          <p className="mono break-all text-[9px] text-[var(--color-tinta-fraca)]">
                            arquivo · {f.caminho}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            <p className="mono mb-3 text-[10px] tracking-[0.14em] text-[var(--color-tinta-fraca)]">
              {trechos.length} TRECHO(S) DE ESTUDO
            </p>
            <div className="flex flex-col gap-2">
              {trechos.map((t) => (
                <div
                  key={t.id}
                  className="rounded-sm border border-[var(--color-linha)] bg-[var(--color-superficie)] p-3.5"
                >
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <span
                      className="mono rounded-sm px-1.5 py-0.5 text-[9px] tracking-[0.1em]"
                      style={{
                        color: COR_EVIDENCIA[t.evidencia],
                        border: `1px solid ${COR_EVIDENCIA[t.evidencia]}`,
                      }}
                    >
                      {t.evidencia.replace("_", " ")}
                    </span>
                    <span className="mono text-[9px] tracking-[0.1em] text-[var(--color-tinta-media)]">
                      {t.natureza}
                    </span>
                    {t.modulo && (
                      <span className="mono text-[9px] text-[var(--color-tinta-fraca)]">
                        {t.modulo}
                      </span>
                    )}
                    <span className="mono ml-auto text-[9px] text-[var(--color-tinta-fraca)]">
                      conf {t.confianca.toFixed(2)}
                    </span>
                  </div>
                  <p className="mb-1 text-sm font-semibold">{t.afirmacao}</p>
                  <p className="mb-2 text-sm leading-relaxed text-[var(--color-tinta-media)]">
                    {t.corpo}
                  </p>
                  <p className="mono text-[9px] text-[var(--color-tinta-fraca)]">
                    fonte · {t.fonte_titulo}
                  </p>
                </div>
              ))}
              {trechos.length === 0 && (
                <p className="text-sm text-[var(--color-tinta-fraca)]">
                  {fatos.length > 0
                    ? "Nenhum trecho de estudo — os resultados acima vêm dos arquivos dos projetos."
                    : "Nada encontrado nos dois acervos."}
                </p>
              )}
            </div>
          </>
        ) : (
          <>
            {projetos.length > 0 && (
              <section className="mb-6">
                <p className="mono mb-2 text-[10px] tracking-[0.14em] text-[var(--color-tinta-fraca)]">
                  PROJETOS INDEXADOS · BUSQUE ACIMA PARA CONSULTAR
                </p>
                <div className="flex flex-wrap gap-2">
                  {projetos.map((p) => (
                    <span
                      key={p.id}
                      className="mono rounded-sm border border-[var(--color-linha)] px-2 py-1 text-[9px] tracking-[0.1em] text-[var(--color-tinta-media)]"
                    >
                      {p.nome} · {p.arquivos} arquivo(s)
                    </span>
                  ))}
                </div>
              </section>
            )}

            <p className="mono mb-3 text-[10px] tracking-[0.14em] text-[var(--color-tinta-fraca)]">
              {fontes.length} FONTE(S) DE ESTUDO
            </p>
            <div className="flex flex-col gap-2">
              {fontes.map((f) => (
                <div
                  key={f.id}
                  className="rounded-sm border border-[var(--color-linha)] bg-[var(--color-superficie)] p-3.5"
                >
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <span
                      className="mono text-[9px] tracking-[0.1em]"
                      style={{ color: COR_ESTADO[f.estado] ?? "var(--color-tinta-fraca)" }}
                    >
                      {f.estado.replace(/_/g, " ")}
                    </span>
                    <span className="mono text-[9px] text-[var(--color-tinta-fraca)]">
                      {f.tipo}
                      {f.categoria ? ` · ${f.categoria}` : ""}
                    </span>
                  </div>
                  <p className="text-sm font-semibold">{f.titulo}</p>
                  {f.observacao && (
                    <p className="mt-1 text-sm text-[var(--color-tinta-media)]">{f.observacao}</p>
                  )}
                </div>
              ))}
              {fontes.length === 0 && (
                <p className="text-sm text-[var(--color-tinta-fraca)]">
                  Nenhuma fonte registrada ainda.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
