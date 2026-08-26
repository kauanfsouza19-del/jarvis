"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * Resultado como objeto de primeira classe — nunca cem linhas despejadas no
 * chat. Card compacto com totais reais + ações que apontam para arquivo de
 * verdade gerado em disco (ver /api/arquivos/:id), nunca um botão morto.
 *
 * Achado real (Fase 27f, print do Cacique): este arquivo era UM componente
 * só, escrito só pra resultado de prospecção ("PROSPECÇÃO CONCLUÍDA" fixo
 * no header) — mas era montado incondicionalmente pra QUALQUER resultadoId
 * (ver JarvisComando.tsx), então uma pergunta sobre Meta Ads mostrava esse
 * card errado, com campos de prospecção vazios/undefined. Correção: busca
 * o resultado UMA vez aqui no topo, decide pelo FORMATO REAL dos dados
 * (tem prospects? é resultado de prospecção — nunca por string de `tipo`,
 * que varia por handler: descoberta/enriquecimento/repontuação... todos
 * têm prospects de verdade, então checar o array é o sinal robusto), e só
 * então monta o card certo.
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
  resultado: { id: string; tipo: string; resumo: string };
  prospects: Prospect[];
  arquivos: Arquivo[];
};

export function JarvisResultadoCard({ resultadoId }: { resultadoId: string }) {
  const [dados, setDados] = useState<DadosResultado | null>(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    void fetch(`/api/resultados/${resultadoId}`)
      .then((r) => r.json())
      .then((d) => (d.erro ? setErro(true) : setDados(d)));
  }, [resultadoId]);

  if (erro) return <p className="mono text-[10px] text-[var(--color-tinta-fraca)]">resultado não encontrado.</p>;
  if (!dados) return <p className="mono text-[10px] text-[var(--color-tinta-fraca)]">carregando resultado…</p>;

  if (dados.prospects.length > 0) return <CardProspeccao dados={dados} />;
  return <CardGenerico dados={dados} />;
}

/* ═══════════════════════ card de prospecção (comportamento original) ═══════════════════════ */

function CardProspeccao({ dados }: { dados: DadosResultado }) {
  const [tabelaAberta, setTabelaAberta] = useState(false);
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

/* ═══════════════════════ card genérico (Fase 27f) — Meta Ads, código, MCP, qualquer Tool/Plano ═══════════════════════ */

type PassoPlano = { descricao: string; capacidade: string; status: string; saida?: unknown; erro?: string | null };
type ResumoPlanoGenerico = { totalPassos: number; concluidos: number; falharam: number; passos: PassoPlano[] };
type ResumoFerramentaUnica = { ferramenta: string; saida: unknown };

function ehResumoPlano(r: unknown): r is ResumoPlanoGenerico {
  return typeof r === "object" && r !== null && Array.isArray((r as { passos?: unknown }).passos);
}
function ehResumoFerramenta(r: unknown): r is ResumoFerramentaUnica {
  return typeof r === "object" && r !== null && typeof (r as { ferramenta?: unknown }).ferramenta === "string";
}

function CardGenerico({ dados }: { dados: DadosResultado }) {
  const [detalheAberto, setDetalheAberto] = useState<number | null>(null);
  let resumo: unknown;
  try {
    resumo = JSON.parse(dados.resultado.resumo);
  } catch {
    resumo = null;
  }

  const rotulo = ehResumoPlano(resumo) ? "PLANO CONCLUÍDO" : ehResumoFerramenta(resumo) ? "FERRAMENTA EXECUTADA" : "RESULTADO";

  return (
    <div className="entra canto painel max-w-md p-4">
      <p className="rotulo mb-2" style={{ color: "var(--reator)" }}>
        {rotulo}
      </p>

      {ehResumoPlano(resumo) && (
        <>
          <div className="mb-3 grid grid-cols-3 gap-2">
            <MiniMedida rotulo="PASSOS" valor={resumo.totalPassos} />
            <MiniMedida rotulo="OK" valor={resumo.concluidos} cor="var(--ok)" />
            <MiniMedida rotulo="FALHOU" valor={resumo.falharam} cor={resumo.falharam > 0 ? "var(--risco)" : undefined} />
          </div>
          <div className="flex flex-col gap-1.5">
            {resumo.passos.map((p, i) => (
              <div key={i} className="border border-[var(--color-linha)]">
                <button
                  onClick={() => setDetalheAberto(detalheAberto === i ? null : i)}
                  className="flex w-full items-center justify-between gap-2 p-2 text-left"
                >
                  <span className="text-[11.5px] text-[var(--color-tinta)]">{p.descricao}</span>
                  <Pill status={p.status} />
                </button>
                {detalheAberto === i && (
                  <div className="border-t border-[var(--color-linha-fraca)] p-2">
                    {p.erro ? (
                      <p className="text-[11px] text-[var(--risco)]">{p.erro}</p>
                    ) : (
                      <SaidaPreview saida={p.saida} />
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {ehResumoFerramenta(resumo) && (
        <>
          <p className="mono mb-2 text-[10px] text-[var(--color-tinta-fraca)]">{resumo.ferramenta}</p>
          <SaidaPreview saida={resumo.saida} />
        </>
      )}

      {!ehResumoPlano(resumo) && !ehResumoFerramenta(resumo) && <SaidaPreview saida={resumo} />}
    </div>
  );
}

function Pill({ status }: { status: string }) {
  const cor = status === "CONCLUIDO" ? "var(--ok)" : status === "FALHOU" ? "var(--risco)" : "var(--color-tinta-fraca)";
  return (
    <span className="mono shrink-0 text-[9px] tracking-[0.1em]" style={{ color: cor }}>
      {status}
    </span>
  );
}

/** Prévia legível do `saida` de uma Tool — lista de objetos vira tabela compacta (nome/campo principal + contagem); qualquer outra coisa cai no JSON formatado, sempre dentro de uma caixa com rolagem (nunca estoura a largura do card). */
function SaidaPreview({ saida }: { saida: unknown }) {
  if (saida === undefined || saida === null) {
    return <p className="text-[11px] text-[var(--color-tinta-fraca)]">sem dado de retorno.</p>;
  }

  if (Array.isArray(saida)) {
    if (saida.length === 0) return <p className="text-[11px] text-[var(--color-tinta-fraca)]">lista vazia.</p>;
    const primeiroItem = saida[0];
    const campoNome = typeof primeiroItem === "object" && primeiroItem !== null ? Object.keys(primeiroItem).find((k) => /nome|name/i.test(k)) : null;

    return (
      <div className="rolagem max-h-56 overflow-auto">
        <p className="mono mb-1 text-[9px] tracking-[0.1em] text-[var(--color-tinta-fraca)]">{saida.length} ITEM(NS)</p>
        <ul className="flex flex-col gap-0.5">
          {saida.slice(0, 25).map((item, i) => (
            <li key={i} className="text-[11px] text-[var(--color-tinta)]">
              {campoNome && typeof item === "object" && item !== null ? String((item as Record<string, unknown>)[campoNome]) : JSON.stringify(item).slice(0, 120)}
            </li>
          ))}
          {saida.length > 25 && <li className="text-[10px] text-[var(--color-tinta-fraca)]">+ {saida.length - 25} outros…</li>}
        </ul>
      </div>
    );
  }

  return (
    <pre className="rolagem mono max-h-56 overflow-auto whitespace-pre-wrap break-words text-[10.5px] text-[var(--color-tinta-media)]">
      {JSON.stringify(saida, null, 2).slice(0, 4000)}
    </pre>
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
