"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * Resultado como objeto de primeira classe — nunca cem linhas despejadas no
 * chat. Card compacto com totais reais + ações que apontam para arquivo de
 * verdade gerado em disco (ver /api/arquivos/:id), nunca um botão morto.
 */

type Prospect = {
  id: string;
  negocio: string;
  vertical: string;
  cidade: string | null;
  website: string | null;
  whatsapp_publico: string | null;
  instagram: string | null;
  score: number | null;
  motivo_score: string | null;
};

type Arquivo = { id: string; tipo: "csv" | "xlsx"; nome: string };

type DadosResultado = {
  resultado: { id: string; resumo: string };
  prospects: Prospect[];
  arquivos: Arquivo[];
};

export function JarvisResultadoCard({ resultadoId }: { resultadoId: string }) {
  const [dados, setDados] = useState<DadosResultado | null>(null);
  const [tabelaAberta, setTabelaAberta] = useState(false);

  useEffect(() => {
    void fetch(`/api/resultados/${resultadoId}`)
      .then((r) => r.json())
      .then((d) => (d.erro ? null : setDados(d)));
  }, [resultadoId]);

  if (!dados) return <p className="mono text-[10px] text-[var(--color-tinta-fraca)]">carregando resultado…</p>;

  const resumo = JSON.parse(dados.resultado.resumo) as {
    total: number;
    altaOportunidade: number;
    mediaOportunidade: number;
    semDiagnostico: number;
    motivoDescobertaBloqueada?: string | null;
  };

  return (
    <div className="entra canto painel max-w-md p-4">
      <p className="rotulo mb-2" style={{ color: "var(--reator)" }}>
        PROSPECÇÃO CONCLUÍDA
      </p>

      <div className="mb-3 grid grid-cols-3 gap-2">
        <MiniMedida rotulo="TOTAL" valor={resumo.total} />
        <MiniMedida rotulo="ALTA OPORT." valor={resumo.altaOportunidade} cor="var(--ok)" />
        <MiniMedida rotulo="SEM DADO" valor={resumo.semDiagnostico} />
      </div>

      {resumo.motivoDescobertaBloqueada && (
        <p className="mb-3 border-l-2 border-[var(--atencao)] pl-2 text-[11.5px] leading-relaxed text-[var(--color-tinta-fraca)]">
          {resumo.motivoDescobertaBloqueada}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setTabelaAberta(true)}
          className="mono min-h-9 border border-[var(--color-linha)] px-3 text-[9.5px] tracking-[0.12em] text-[var(--color-tinta-media)] transition hover:border-[var(--reator)] hover:text-[var(--reator-claro)]"
        >
          VER LISTA
        </button>
        {dados.arquivos.map((a) => (
          <a
            key={a.id}
            href={`/api/arquivos/${a.id}`}
            className="mono flex min-h-9 items-center border border-[var(--reator)] px-3 text-[9.5px] tracking-[0.12em] text-[var(--reator-claro)] transition hover:bg-[var(--reator)]/10"
          >
            BAIXAR {a.tipo.toUpperCase()}
          </a>
        ))}
      </div>

      {tabelaAberta && <TabelaProspects prospects={dados.prospects} onFechar={() => setTabelaAberta(false)} />}
    </div>
  );
}

function MiniMedida({ rotulo, valor, cor }: { rotulo: string; valor: number; cor?: string }) {
  return (
    <div>
      <p className="mono text-[8.5px] tracking-[0.1em] text-[var(--color-tinta-fraca)]">{rotulo}</p>
      <p className="mono text-lg" style={{ color: cor ?? "var(--color-tinta)" }}>
        {valor}
      </p>
    </div>
  );
}

function TabelaProspects({ prospects, onFechar }: { prospects: Prospect[]; onFechar: () => void }) {
  const [busca, setBusca] = useState("");
  const filtrados = prospects.filter((p) => p.negocio.toLowerCase().includes(busca.toLowerCase()));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col border border-[var(--color-linha)] bg-[var(--color-fundo-2)]">
        <header className="flex items-center gap-2 border-b border-[var(--color-linha)] p-3">
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome…"
            className="min-h-11 flex-1 border border-[var(--color-linha)] bg-[var(--color-superficie)] px-2.5 text-[13px] outline-none focus:border-[var(--reator)]"
          />
          <button
            onClick={onFechar}
            aria-label="Fechar"
            className="mono flex h-11 min-w-11 items-center justify-center text-[13px] text-[var(--color-tinta-fraca)] hover:text-[var(--reator-claro)]"
          >
            ✕
          </button>
        </header>
        <div className="rolagem min-h-0 flex-1 overflow-auto">
          <table className="w-full text-[12.5px]">
            <thead className="sticky top-0 bg-[var(--color-fundo-2)]">
              <tr className="border-b border-[var(--color-linha)] text-left">
                <Th>Empresa</Th>
                <Th>Cidade</Th>
                <Th>WhatsApp</Th>
                <Th>Score</Th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((p) => (
                <tr key={p.id} className="border-b border-[var(--color-linha-fraca)]">
                  <td className="p-2 text-[var(--color-tinta)]">
                    {p.website ? (
                      <a href={p.website} target="_blank" rel="noreferrer" className="hover:text-[var(--reator-claro)]">
                        {p.negocio}
                      </a>
                    ) : (
                      p.negocio
                    )}
                  </td>
                  <td className="p-2 text-[var(--color-tinta-fraca)]">{p.cidade ?? "—"}</td>
                  <td className="p-2 text-[var(--color-tinta-fraca)]">{p.whatsapp_publico ?? "—"}</td>
                  <td className="p-2 mono" style={{ color: (p.score ?? 0) >= 50 ? "var(--ok)" : "var(--color-tinta-media)" }}>
                    {p.score ?? "—"}
                  </td>
                </tr>
              ))}
              {filtrados.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-4 text-center text-[var(--color-tinta-fraca)]">
                    Nada encontrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Th({ children }: { children: ReactNode }) {
  return (
    <th className="mono p-2 text-[9px] tracking-[0.1em] text-[var(--color-tinta-fraca)]">{children}</th>
  );
}
