"use client";

import { useCallback, useEffect, useState } from "react";

type Acao = {
  id: string;
  titulo: string;
  detalhe: string;
  projeto: string | null;
  impacto: number;
  urgencia: number;
  esforcoMin: number | null;
  prazo: string | null;
  score: number;
};

type Dados = {
  proximaAcao: Acao | null;
  acoes: Acao[];
  projetos: Array<{
    nome: string;
    saude: string;
    permissao: string;
    indexado_em: string | null;
    fatos: number;
  }>;
  destaques: Array<{ id: string; titulo: string; corpo: string }>;
  decisoesParaRevisar: Array<{ id: string; titulo: string; revisar_em: string }>;
  lacunas: string[];
};

const COR_SAUDE: Record<string, string> = {
  verde: "var(--ok)",
  amarelo: "var(--atencao)",
  vermelho: "var(--risco)",
};

function Medida({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <p className="rotulo mb-0.5">{rotulo}</p>
      <p className="mono text-[13px] text-[var(--color-tinta)]">{valor}</p>
    </div>
  );
}

export function JarvisWarRoom({ onExecutar }: { onExecutar?: (a: Acao) => void }) {
  const [d, setD] = useState<Dados | null>(null);

  const carregar = useCallback(async () => {
    const r = await fetch("/api/warroom").then((x) => x.json());
    setD(r);
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (!d) return <p className="rotulo p-6">CARREGANDO…</p>;

  const pa = d.proximaAcao;

  return (
    <div className="rolagem h-full overflow-y-auto px-4 py-5 sm:px-6">
      <div className="mx-auto flex max-w-4xl flex-col gap-5">
        {/* ─── PRÓXIMA MELHOR AÇÃO ─── */}
        <section className="canto painel entra p-5">
          <p className="rotulo mb-3" style={{ color: "var(--reator)" }}>
            PRÓXIMA MELHOR AÇÃO
          </p>

          {pa ? (
            <>
              <h2 className="mb-1 text-xl leading-snug text-[var(--color-tinta)]">{pa.titulo}</h2>
              {pa.detalhe && (
                <p className="mb-4 max-w-2xl text-sm leading-relaxed text-[var(--color-tinta-media)]">
                  {pa.detalhe}
                </p>
              )}
              <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-5">
                <Medida rotulo="IMPACTO" valor={`${pa.impacto}/5`} />
                <Medida rotulo="URGÊNCIA" valor={`${pa.urgencia}/5`} />
                <Medida
                  rotulo="ESFORÇO"
                  valor={pa.esforcoMin ? `${pa.esforcoMin} min` : "—"}
                />
                <Medida rotulo="PRAZO" valor={pa.prazo ?? "sem prazo"} />
                <Medida rotulo="PROJETO" valor={pa.projeto ?? "—"} />
              </div>
              <button
                onClick={() => onExecutar?.(pa)}
                className="mono border border-[var(--color-ok)] px-4 py-2 text-[10px] tracking-[0.18em] text-[var(--color-ok)] transition hover:bg-[var(--color-ok)]/10"
              >
                EXECUTAR
              </button>
            </>
          ) : (
            <div>
              <p className="mb-2 text-[15px] text-[var(--color-tinta-media)]">
                Nada para ranquear ainda.
              </p>
              <p className="max-w-xl text-sm leading-relaxed text-[var(--color-tinta-fraca)]">
                Não vou inventar uma prioridade. Cadastre tarefas — ou me diga sua
                receita, clientes e metas — e o ranking passa a valer alguma coisa.
              </p>
            </div>
          )}
        </section>

        {/* ─── LACUNAS ─── */}
        {d.lacunas.length > 0 && (
          <section className="border-l-2 border-[var(--color-atencao)] bg-[var(--color-atencao)]/[0.07] px-4 py-3">
            <p className="rotulo mb-1.5" style={{ color: "var(--atencao)" }}>
              O QUE FALTA PARA ESTE RANKING VALER
            </p>
            <ul className="flex flex-col gap-1">
              {d.lacunas.map((l, i) => (
                <li key={i} className="text-[13px] leading-relaxed text-[var(--color-tinta-media)]">
                  {l}
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="grid gap-5 lg:grid-cols-2">
          {/* ─── FILA ─── */}
          <section className="painel p-4">
            <p className="rotulo mb-3">FILA · {d.acoes.length}</p>
            {d.acoes.length === 0 ? (
              <p className="text-sm text-[var(--color-tinta-fraca)]">Sem tarefas abertas.</p>
            ) : (
              <ol className="flex flex-col gap-2">
                {d.acoes.map((a, i) => (
                  <li
                    key={a.id}
                    className="flex items-baseline gap-3 border-b border-[var(--color-linha-fraca)] pb-2 last:border-0"
                  >
                    <span className="mono w-5 shrink-0 text-[10px] text-[var(--color-tinta-fraca)]">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13.5px]">{a.titulo}</span>
                    <span
                      className="mono shrink-0 text-[10px]"
                      style={{ color: "var(--reator)" }}
                    >
                      {a.score}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {/* ─── PROJETOS ─── */}
          <section className="painel p-4">
            <p className="rotulo mb-3">PROJETOS</p>
            <ul className="flex flex-col gap-2">
              {d.projetos.map((p) => (
                <li key={p.nome} className="flex items-baseline gap-3">
                  <span
                    className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: COR_SAUDE[p.saude] ?? "var(--tinta-fraca)" }}
                    aria-label={`saúde ${p.saude}`}
                  />
                  <span className="mono min-w-0 flex-1 truncate text-[11px] tracking-[0.1em]">
                    {p.nome}
                  </span>
                  <span className="mono shrink-0 text-[9px] text-[var(--color-tinta-fraca)]">
                    {p.fatos > 0 ? `${p.fatos} fatos` : "não indexado"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        {/* ─── DESTAQUES ─── */}
        {d.destaques.length > 0 && (
          <section className="painel p-4">
            <p className="rotulo mb-3">DECISÕES E OPORTUNIDADES ATIVAS</p>
            <ul className="flex flex-col gap-2.5">
              {d.destaques.map((r) => (
                <li key={r.id} className="border-l border-[var(--color-reator)]/40 pl-3">
                  <p className="mb-0.5 text-[13.5px] text-[var(--color-tinta)]">{r.titulo}</p>
                  <p className="text-[12.5px] leading-relaxed text-[var(--color-tinta-media)]">
                    {r.corpo}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ─── REVISÕES VENCIDAS ─── */}
        {d.decisoesParaRevisar.length > 0 && (
          <section className="painel border-l-2 border-[var(--color-atencao)] p-4">
            <p className="rotulo mb-2" style={{ color: "var(--atencao)" }}>
              DECISÕES A REVISAR
            </p>
            <ul className="flex flex-col gap-1">
              {d.decisoesParaRevisar.map((x) => (
                <li key={x.id} className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span>{x.titulo}</span>
                  <span className="mono shrink-0 text-[10px] text-[var(--color-tinta-fraca)]">
                    {x.revisar_em}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
