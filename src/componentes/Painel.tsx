"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { JarvisComando } from "./jarvis/JarvisComando";
import { JarvisWarRoom } from "./jarvis/JarvisWarRoom";
import { JarvisBoot } from "./jarvis/JarvisBoot";
import { Memoria } from "./Memoria";
import { Conhecimento } from "./Conhecimento";
import { construirRegistroSkills, type Skill } from "@/lib/skills";

/**
 * A tela é o Jarvis Command Center — uma única experiência principal.
 *
 * Não existe navegação obrigatória por abas para trabalhar: COMANDO é a tela
 * inteira. Memória, Conhecimento, Projetos, War Room completo e integrações
 * vivem atrás do botão SISTEMA, como páginas de apoio — nunca como espaços de
 * trabalho paralelos que tiram o Cacique da conversa.
 */

type AbaSistema =
  | "warroom"
  | "jobs"
  | "memoria"
  | "conhecimento"
  | "projetos"
  | "integracoes"
  | "skills"
  | "prospeccao"
  | "social"
  | "instagram"
  | "whatsapp"
  | "intelligence"
  | "custo";

const ABAS_SISTEMA: Array<[AbaSistema, string]> = [
  ["warroom", "WAR ROOM"],
  ["jobs", "JOBS"],
  ["prospeccao", "PROSPECÇÃO"],
  ["social", "SOCIAL"],
  ["instagram", "INSTAGRAM"],
  ["whatsapp", "WHATSAPP"],
  ["intelligence", "INTELLIGENCE"],
  ["memoria", "MEMÓRIA"],
  ["conhecimento", "CONHECIMENTO"],
  ["projetos", "PROJETOS"],
  ["integracoes", "INTEGRAÇÕES"],
  ["custo", "CUSTO"],
  ["skills", "SKILLS"],
];

export function Painel() {
  const [booted, setBooted] = useState(false);
  const [sistemaAberto, setSistemaAberto] = useState(false);
  const [abaSistema, setAbaSistema] = useState<AbaSistema>("warroom");
  const [saudeOk, setSaudeOk] = useState<boolean | null>(null);

  const terminarBoot = useCallback(() => setBooted(true), []);

  const abrirSistema = useCallback((aba?: string) => {
    if (aba && ABAS_SISTEMA.some(([id]) => id === aba)) setAbaSistema(aba as AbaSistema);
    setSistemaAberto(true);
  }, []);

  useEffect(() => {
    if (!booted) return;
    void fetch("/api/saude")
      .then((r) => r.json())
      .then((s) => setSaudeOk(Boolean(s.banco)))
      .catch(() => setSaudeOk(false));
  }, [booted]);

  useEffect(() => {
    if (!sistemaAberto) return;
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSistemaAberto(false);
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [sistemaAberto]);

  if (!booted) return <JarvisBoot aoTerminar={terminarBoot} />;

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-[var(--color-linha)] px-4 py-2.5 sm:gap-4 sm:px-5">
        <span
          className="mono shrink-0 text-[12px] tracking-[0.34em]"
          style={{ color: "var(--reator)" }}
        >
          JARVIS
        </span>

        <span
          className="mono hidden shrink-0 items-center gap-1.5 text-[9px] tracking-[0.14em] text-[var(--color-tinta-fraca)] sm:flex"
          aria-hidden="true"
        >
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{
              background:
                saudeOk === null ? "var(--tinta-fraca)" : saudeOk ? "var(--ok)" : "var(--risco)",
            }}
          />
          LOCAL
        </span>

        <div className="flex-1" />

        <SinoNotificacoes onAbrirJobs={() => abrirSistema("jobs")} />

        <button
          onClick={() => abrirSistema()}
          className="mono flex min-h-11 shrink-0 items-center gap-1.5 border border-[var(--color-linha)] px-3 text-[9.5px] tracking-[0.16em] text-[var(--color-tinta-media)] transition hover:border-[var(--reator)] hover:text-[var(--reator-claro)] sm:min-h-8"
        >
          SISTEMA
        </button>
      </header>

      <div className="min-h-0 flex-1">
        <JarvisComando onAbrirSistema={abrirSistema} />
      </div>

      {sistemaAberto && (
        <PainelSistema
          aba={abaSistema}
          onAba={setAbaSistema}
          onFechar={() => setSistemaAberto(false)}
        />
      )}
    </div>
  );
}

/* ─────────────────────────── sino de notificação ─────────────────────────── */

type NotificacaoResumo = { id: string; titulo: string; mensagem: string; job_id: string | null; criado_em: string };

/**
 * Só o que precisa da atenção do Cacique — job concluído, job falhou,
 * aprovação necessária. Polling de baixo custo (10s); clicar abre direto o
 * painel JOBS, onde a ação de verdade acontece.
 */
function SinoNotificacoes({ onAbrirJobs }: { onAbrirJobs: () => void }) {
  const [naoLidas, setNaoLidas] = useState<NotificacaoResumo[]>([]);
  const [aberto, setAberto] = useState(false);

  const carregar = useCallback(() => {
    void fetch("/api/notificacoes?nao_lidas=1")
      .then((r) => r.json())
      .then((d) => setNaoLidas(d.notificacoes ?? []));
  }, []);

  useEffect(() => {
    carregar();
    const intervalo = setInterval(carregar, 10000);
    return () => clearInterval(intervalo);
  }, [carregar]);

  const marcarLida = useCallback(
    async (id: string) => {
      await fetch("/api/notificacoes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      carregar();
    },
    [carregar],
  );

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setAberto((v) => !v)}
        aria-label={`Notificações — ${naoLidas.length} não lida(s)`}
        className="mono relative flex min-h-11 min-w-11 items-center justify-center border border-[var(--color-linha)] text-[13px] text-[var(--color-tinta-media)] transition hover:border-[var(--reator)] hover:text-[var(--reator-claro)] sm:min-h-8 sm:min-w-8"
      >
        🔔
        {naoLidas.length > 0 && (
          <span
            className="mono absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[8.5px]"
            style={{ background: "var(--atencao)", color: "var(--color-fundo)" }}
          >
            {naoLidas.length > 9 ? "9+" : naoLidas.length}
          </span>
        )}
      </button>

      {aberto && (
        <div className="fixed inset-0 z-40" onClick={() => setAberto(false)}>
          <div
            className="entra-lado absolute right-4 top-14 w-80 max-w-[90vw] border border-[var(--color-linha)] bg-[var(--color-fundo-2)] p-2 sm:right-5"
            onClick={(e) => e.stopPropagation()}
          >
            {naoLidas.length === 0 && (
              <p className="p-3 text-[12.5px] text-[var(--color-tinta-fraca)]">Nada pendente.</p>
            )}
            {naoLidas.map((n) => (
              <div key={n.id} className="border-b border-[var(--color-linha-fraca)] p-2.5 last:border-0">
                <p className="mb-0.5 text-[12.5px] text-[var(--color-tinta)]">{n.titulo}</p>
                <p className="mb-1.5 text-[11.5px] leading-relaxed text-[var(--color-tinta-fraca)]">{n.mensagem}</p>
                <div className="flex gap-2">
                  {n.job_id && (
                    <button
                      onClick={() => {
                        setAberto(false);
                        onAbrirJobs();
                      }}
                      className="mono text-[9px] tracking-[0.1em] text-[var(--reator-claro)]"
                    >
                      VER JOB
                    </button>
                  )}
                  <button
                    onClick={() => void marcarLida(n.id)}
                    className="mono text-[9px] tracking-[0.1em] text-[var(--color-tinta-fraca)] hover:text-[var(--color-tinta-media)]"
                  >
                    MARCAR COMO LIDA
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════ painel de sistema (secundário) ═══════════════════════ */

function PainelSistema({
  aba,
  onAba,
  onFechar,
}: {
  aba: AbaSistema;
  onAba: (a: AbaSistema) => void;
  onFechar: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button className="absolute inset-0 bg-black/60" onClick={onFechar} aria-label="Fechar sistema" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Painel de sistema"
        className="entra-lado relative flex h-full w-full flex-col bg-[var(--color-fundo-2)] sm:w-[560px] sm:border-l sm:border-[var(--color-linha)]"
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-[var(--color-linha)] px-4 py-2.5">
          <nav className="rolagem flex min-w-0 flex-1 gap-0.5 overflow-x-auto" aria-label="Seções do sistema">
            {ABAS_SISTEMA.map(([id, rotulo]) => (
              <button
                key={id}
                onClick={() => onAba(id)}
                aria-current={aba === id ? "page" : undefined}
                className="mono flex min-h-11 shrink-0 items-center px-2.5 text-[9px] tracking-[0.14em] transition sm:min-h-8"
                style={{
                  color: aba === id ? "var(--reator-claro)" : "var(--tinta-fraca)",
                  borderBottom: `1px solid ${aba === id ? "var(--reator)" : "transparent"}`,
                }}
              >
                {rotulo}
              </button>
            ))}
          </nav>
          <button
            onClick={onFechar}
            aria-label="Fechar sistema"
            className="mono flex h-11 min-w-11 shrink-0 items-center justify-center px-2 text-[13px] text-[var(--color-tinta-fraca)] hover:text-[var(--reator-claro)] sm:h-8 sm:min-w-8"
          >
            ✕
          </button>
        </header>

        <div className="min-h-0 flex-1">
          {aba === "warroom" && <JarvisWarRoom />}
          {aba === "jobs" && <Jobs />}
          {aba === "prospeccao" && <Prospeccao />}
          {aba === "social" && <Social />}
          {aba === "instagram" && <Instagram />}
          {aba === "intelligence" && <Intelligence />}
          {aba === "memoria" && <Memoria />}
          {aba === "conhecimento" && <Conhecimento />}
          {aba === "projetos" && <Projetos />}
          {aba === "integracoes" && <Integracoes />}
          {aba === "whatsapp" && <Whatsapp />}
          {aba === "custo" && <Custo />}
          {aba === "skills" && <Skills />}
        </div>
      </aside>
    </div>
  );
}

/* ─────────────────────────── projetos ─────────────────────────── */

type Projeto = {
  id: string;
  nome: string;
  tipo: string;
  proposito: string;
  resumo: string;
  permissao: string;
  saude: string;
  indexado_em: string | null;
  arquivos: number;
};

const COR_PERM: Record<string, string> = {
  leitura: "var(--color-tinta-media)",
  leitura_escrita: "var(--reator)",
  leitura_escrita_deploy: "var(--ok)",
};

function Projetos() {
  const [projetos, setProjetos] = useState<Projeto[]>([]);
  const [aberto, setAberto] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/projetos")
      .then((r) => r.json())
      .then((d) => setProjetos(d.projetos ?? []));
  }, []);

  return (
    <div className="rolagem h-full overflow-y-auto px-4 py-5 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <p className="rotulo mb-4">
          {projetos.length} PROJETO(S) · CAMINHO DE MÁQUINA NÃO FICA NO BANCO
        </p>
        <div className="flex flex-col gap-2">
          {projetos.map((p) => (
            <div key={p.id} className="painel canto p-3.5">
              <button
                className="flex w-full flex-wrap items-center gap-2 text-left"
                onClick={() => setAberto(aberto === p.id ? null : p.id)}
                aria-expanded={aberto === p.id}
              >
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{
                    background:
                      p.saude === "verde"
                        ? "var(--ok)"
                        : p.saude === "amarelo"
                          ? "var(--atencao)"
                          : "var(--risco)",
                  }}
                />
                <span className="mono text-[11px] tracking-[0.14em]">{p.nome}</span>
                <span
                  className="mono text-[9px] tracking-[0.1em]"
                  style={{ color: COR_PERM[p.permissao] }}
                >
                  {p.permissao.replace(/_/g, " ")}
                </span>
                <span className="mono ml-auto text-[9px] text-[var(--color-tinta-fraca)]">
                  {p.indexado_em ? `${p.arquivos} arquivo(s)` : "não indexado"}
                </span>
              </button>

              <p className="mt-1.5 text-[13px] text-[var(--color-tinta-media)]">{p.proposito}</p>

              {aberto === p.id && p.resumo && (
                <pre className="entra rolagem mt-3 max-h-96 overflow-auto whitespace-pre-wrap border-l border-[var(--color-reator)]/40 pl-3 text-[12px] leading-relaxed text-[var(--color-tinta-media)]">
                  {p.resumo}
                </pre>
              )}
              {aberto === p.id && !p.resumo && (
                <p className="mt-3 text-[12px] text-[var(--color-tinta-fraca)]">
                  Sem resumo. Rode: node scripts/resumir-projeto.mjs {p.nome}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── integrações ─────────────────────────── */

/**
 * Estado real de cada integração — nunca "em breve" fingindo ser toggle.
 * Vem de /api/integracoes: cada linha é uma condição verificável (variável de
 * ambiente presente, linha do banco), nunca uma promessa. Quando bloqueada,
 * mostra o passo exato de credencial — serviço, por quê, onde criar, quais
 * permissões, onde colocar, como testar.
 */
type ItemIntegracao = {
  id: string;
  nome: string;
  estado: "CONECTADO" | "AUTH_NECESSARIA" | "DEGRADADO" | "LIMITE_TAXA" | "ERRO" | "NAO_CONFIGURADO";
  identidade: string | null;
  ultimaSincronizacao: string | null;
  ultimoErro: string | null;
  onboarding?: {
    servico: string;
    porque: string;
    ondeCriar: string;
    permissoes: string[];
    ondeColocar: string;
    comoTestar: string;
  };
};

const COR_ESTADO_INTEGRACAO: Record<ItemIntegracao["estado"], string> = {
  CONECTADO: "var(--ok)",
  AUTH_NECESSARIA: "var(--atencao)",
  DEGRADADO: "var(--atencao)",
  LIMITE_TAXA: "var(--atencao)",
  ERRO: "var(--risco)",
  NAO_CONFIGURADO: "var(--color-tinta-fraca)",
};

const ROTULO_ESTADO_INTEGRACAO: Record<ItemIntegracao["estado"], string> = {
  CONECTADO: "conectado",
  AUTH_NECESSARIA: "autenticação necessária",
  DEGRADADO: "degradado",
  LIMITE_TAXA: "limite de taxa",
  ERRO: "erro",
  NAO_CONFIGURADO: "não configurado",
};

function Integracoes() {
  const [itens, setItens] = useState<ItemIntegracao[] | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/integracoes")
      .then((r) => r.json())
      .then((d) => setItens(d.integracoes ?? []));
  }, []);

  return (
    <div className="rolagem h-full overflow-y-auto px-4 py-5 sm:px-6">
      <div className="mx-auto flex max-w-2xl flex-col gap-2">
        <p className="rotulo mb-2">
          {itens ? `${itens.filter((i) => i.estado === "CONECTADO").length}/${itens.length} CONECTADAS` : "CARREGANDO…"}
        </p>
        {itens?.map((l) => (
          <div key={l.id} className="painel canto p-3.5">
            <button
              className="flex w-full flex-wrap items-start gap-3 text-left"
              onClick={() => setAberto(aberto === l.id ? null : l.id)}
              aria-expanded={aberto === l.id}
            >
              <span
                className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: COR_ESTADO_INTEGRACAO[l.estado] }}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-[13.5px] text-[var(--color-tinta)]">{l.nome}</span>
                  <span
                    className="mono text-[9px] tracking-[0.1em]"
                    style={{ color: COR_ESTADO_INTEGRACAO[l.estado] }}
                  >
                    {ROTULO_ESTADO_INTEGRACAO[l.estado]}
                  </span>
                  {l.identidade && (
                    <span className="mono text-[9px] text-[var(--color-tinta-fraca)]">{l.identidade}</span>
                  )}
                </div>
                {l.ultimoErro && (
                  <p className="mt-0.5 text-[12px] text-[var(--risco)]">{l.ultimoErro}</p>
                )}
              </div>
            </button>

            {aberto === l.id && l.onboarding && (
              <div className="entra mt-3 flex flex-col gap-1.5 border-l border-[var(--color-linha)] pl-3">
                <Linha rotulo="SERVIÇO" valor={l.onboarding.servico} />
                <Linha rotulo="POR QUÊ" valor={l.onboarding.porque} />
                <Linha rotulo="ONDE CRIAR" valor={l.onboarding.ondeCriar} />
                <Linha rotulo="PERMISSÕES" valor={l.onboarding.permissoes.join(", ")} />
                <Linha rotulo="ONDE COLOCAR" valor={l.onboarding.ondeColocar} />
                <Linha rotulo="COMO TESTAR" valor={l.onboarding.comoTestar} />
              </div>
            )}
            {aberto === l.id && !l.onboarding && (
              <p className="mt-2 text-[12px] text-[var(--color-tinta-fraca)]">Já conectado — nada a configurar.</p>
            )}
          </div>
        ))}
        <Link
          href="/diagnostico"
          className="mono mt-2 inline-flex min-h-11 w-fit items-center border border-[var(--color-linha)] px-3 text-[9.5px] tracking-[0.14em] text-[var(--color-tinta-media)] transition hover:border-[var(--reator)] hover:text-[var(--reator-claro)]"
        >
          DIAGNÓSTICO VISUAL DO REATOR ↗
        </Link>
      </div>
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
      <span className="mono shrink-0 text-[9px] tracking-[0.1em] text-[var(--color-tinta-fraca)]">{rotulo}</span>
      <span className="text-[12px] text-[var(--color-tinta-media)]">{valor}</span>
    </div>
  );
}

/* ─────────────────────────── skills ─────────────────────────── */

function Skills() {
  const [skills, setSkills] = useState<Skill[] | null>(null);

  useEffect(() => {
    void fetch("/api/saude")
      .then((r) => r.json())
      .then((s) =>
        setSkills(
          construirRegistroSkills({
            modelo: Boolean(s.modelo),
            conhecimentoProjeto: s.conhecimentoProjeto ?? 0,
          }),
        ),
      );
  }, []);

  return (
    <div className="rolagem h-full overflow-y-auto px-4 py-5 sm:px-6">
      <div className="mx-auto flex max-w-2xl flex-col gap-2">
        <p className="rotulo mb-2">
          {skills ? `${skills.filter((s) => s.conectado).length}/${skills.length} CONECTADAS` : "CARREGANDO…"}
        </p>
        {skills?.map((s) => (
          <div key={s.id} className="painel canto p-3.5">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="text-[13.5px] text-[var(--color-tinta)]">{s.nome}</span>
              <span
                className="mono text-[9px] tracking-[0.1em]"
                style={{ color: s.conectado ? "var(--ok)" : "var(--color-tinta-fraca)" }}
              >
                {s.conectado ? "conectada" : "não conectada"}
              </span>
            </div>
            <p className="text-[12.5px] leading-relaxed text-[var(--color-tinta-media)]">
              {s.descricao}
            </p>
            {!s.conectado && s.motivoDesconectado && (
              <p className="mt-1 text-[11.5px] text-[var(--color-tinta-fraca)]">
                {s.motivoDesconectado}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────── prospecção ─────────────────────────── */

type Prospect = {
  id: string;
  negocio: string;
  vertical: string;
  cidade: string | null;
  website: string | null;
  whatsapp_publico: string | null;
  instagram: string | null;
  cnpj: string | null;
  estado: string;
  score: number | null;
  motivo_score: string | null;
  oportunidades: string | null;
};

const VERTICAIS_PROSPECCAO = [
  ["delivery_pizzaria", "Pizzaria"],
  ["delivery_hamburgueria", "Hamburgueria"],
  ["delivery_acaiteria", "Açaiteria"],
  ["delivery_esfiharia", "Esfiharia"],
  ["delivery_lanchonete", "Lanchonete"],
  ["delivery_restaurante", "Restaurante"],
  ["ecommerce", "E-commerce"],
  ["locatta_corretor", "Corretor/Imobiliária"],
] as const;

function Prospeccao() {
  const [prospects, setProspects] = useState<Prospect[] | null>(null);
  const [diagnosticando, setDiagnosticando] = useState<string | null>(null);
  const [form, setForm] = useState({ negocio: "", vertical: "delivery_pizzaria", cidade: "", website: "" });
  const [enviando, setEnviando] = useState(false);

  const carregar = useCallback(() => {
    void fetch("/api/prospeccao")
      .then((r) => r.json())
      .then((d) => setProspects(d.prospects ?? []));
  }, []);

  useEffect(() => carregar(), [carregar]);

  const criar = useCallback(async () => {
    if (!form.negocio.trim()) return;
    setEnviando(true);
    await fetch("/api/prospeccao", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        acao: "criar",
        negocio: form.negocio,
        vertical: form.vertical,
        cidade: form.cidade || null,
        website: form.website || null,
        fonte: "manual",
      }),
    });
    setForm({ negocio: "", vertical: form.vertical, cidade: "", website: "" });
    setEnviando(false);
    carregar();
  }, [form, carregar]);

  const diagnosticar = useCallback(
    async (id: string) => {
      setDiagnosticando(id);
      await fetch("/api/prospeccao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao: "diagnosticar", id }),
      });
      setDiagnosticando(null);
      carregar();
    },
    [carregar],
  );

  return (
    <div className="rolagem h-full overflow-y-auto px-4 py-5 sm:px-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        <div>
          <p className="rotulo mb-2">MOTOR DE DINHEIRO PRIMÁRIO</p>
          <p className="mb-3 text-[12.5px] leading-relaxed text-[var(--color-tinta-fraca)]">
            Descoberta automática por vertical/cidade precisa de{" "}
            <code className="mono">GOOGLE_PLACES_API_KEY</code> — ver INTEGRAÇÕES. Sem isso, cadastro é
            manual e o diagnóstico de site (Playwright real) já funciona hoje.
          </p>
        </div>

        <div className="painel canto flex flex-col gap-2 p-3.5">
          <p className="rotulo mb-1">NOVO PROSPECT (MANUAL)</p>
          <input
            value={form.negocio}
            onChange={(e) => setForm((f) => ({ ...f, negocio: e.target.value }))}
            placeholder="Nome do negócio"
            className="min-h-11 border border-[var(--color-linha)] bg-[var(--color-superficie)] px-2.5 text-[13px] outline-none focus:border-[var(--reator)]"
          />
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              value={form.vertical}
              onChange={(e) => setForm((f) => ({ ...f, vertical: e.target.value }))}
              className="mono min-h-11 flex-1 border border-[var(--color-linha)] bg-[var(--color-superficie)] px-2 text-[11px] outline-none"
            >
              {VERTICAIS_PROSPECCAO.map(([id, nome]) => (
                <option key={id} value={id}>
                  {nome}
                </option>
              ))}
            </select>
            <input
              value={form.cidade}
              onChange={(e) => setForm((f) => ({ ...f, cidade: e.target.value }))}
              placeholder="Cidade"
              className="min-h-11 flex-1 border border-[var(--color-linha)] bg-[var(--color-superficie)] px-2.5 text-[13px] outline-none focus:border-[var(--reator)]"
            />
          </div>
          <input
            value={form.website}
            onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
            placeholder="Site (para diagnóstico real)"
            className="min-h-11 border border-[var(--color-linha)] bg-[var(--color-superficie)] px-2.5 text-[13px] outline-none focus:border-[var(--reator)]"
          />
          <button
            onClick={() => void criar()}
            disabled={!form.negocio.trim() || enviando}
            className="mono min-h-11 self-start border border-[var(--color-reator)] px-4 text-[10px] tracking-[0.14em] text-[var(--reator-claro)] transition hover:bg-[var(--reator)]/10 disabled:opacity-40"
          >
            {enviando ? "SALVANDO…" : "ADICIONAR"}
          </button>
        </div>

        <div>
          <p className="rotulo mb-2">{prospects ? `${prospects.length} PROSPECT(S)` : "CARREGANDO…"}</p>
          {prospects?.length === 0 && (
            <p className="text-[13px] text-[var(--color-tinta-fraca)]">Nenhum prospect cadastrado ainda.</p>
          )}
          <div className="flex flex-col gap-2">
            {prospects?.map((p) => (
              <div key={p.id} className="painel canto p-3.5">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="text-[13.5px] text-[var(--color-tinta)]">{p.negocio}</span>
                  <span className="mono text-[9px] tracking-[0.1em] text-[var(--color-tinta-fraca)]">
                    {VERTICAIS_PROSPECCAO.find(([id]) => id === p.vertical)?.[1] ?? p.vertical}
                  </span>
                  {p.cidade && (
                    <span className="mono text-[9px] text-[var(--color-tinta-fraca)]">{p.cidade}</span>
                  )}
                  {p.score !== null && (
                    <span
                      className="mono ml-auto text-[11px]"
                      style={{ color: p.score >= 50 ? "var(--ok)" : "var(--color-tinta-media)" }}
                    >
                      SCORE {p.score}
                    </span>
                  )}
                </div>
                {p.motivo_score && (
                  <p className="mb-2 text-[12px] leading-relaxed text-[var(--color-tinta-fraca)]">
                    {p.motivo_score}
                  </p>
                )}
                {p.website && (
                  <button
                    onClick={() => void diagnosticar(p.id)}
                    disabled={diagnosticando === p.id}
                    className="mono min-h-9 border border-[var(--color-linha)] px-3 text-[9.5px] tracking-[0.12em] text-[var(--color-tinta-media)] transition hover:border-[var(--reator)] hover:text-[var(--reator-claro)] disabled:opacity-40"
                  >
                    {diagnosticando === p.id ? "VISITANDO O SITE…" : "DIAGNOSTICAR SITE (PLAYWRIGHT REAL)"}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── social (fila de conteúdo) ─────────────────────────── */

type StatusConteudoPainel =
  | "IDEIA" | "BRIEFING" | "RASCUNHO" | "REVISAO" | "AGUARDANDO_APROVACAO"
  | "APROVADO" | "REJEITADO" | "AGENDADO" | "PUBLICADO" | "FALHOU" | "MONITORAMENTO" | "ANALISADO";
type PrioridadeConteudoPainel = "URGENT" | "HIGH" | "MEDIUM" | "LOW";

type ConteudoPainel = {
  id: string;
  titulo: string;
  conceito: string;
  tipo_conteudo: string;
  plataforma: string;
  legenda: string;
  cta: string | null;
  hashtags: string | null;
  status: StatusConteudoPainel;
  prioridade: PrioridadeConteudoPainel;
  agendado_para: string | null;
  criado_por: string;
  motivo_rejeicao: string | null;
  criado_em: string;
};

const ROTULO_STATUS_CONTEUDO: Record<StatusConteudoPainel, string> = {
  IDEIA: "IDEIA", BRIEFING: "BRIEFING", RASCUNHO: "RASCUNHO", REVISAO: "EM REVISÃO",
  AGUARDANDO_APROVACAO: "AGUARDANDO APROVAÇÃO", APROVADO: "APROVADO", REJEITADO: "REJEITADO",
  AGENDADO: "AGENDADO", PUBLICADO: "PUBLICADO", FALHOU: "FALHOU", MONITORAMENTO: "MONITORANDO", ANALISADO: "ANALISADO",
};
const COR_STATUS_CONTEUDO: Record<StatusConteudoPainel, string> = {
  IDEIA: "var(--color-tinta-fraca)", BRIEFING: "var(--color-tinta-fraca)", RASCUNHO: "var(--reator-claro)",
  REVISAO: "var(--reator-claro)", AGUARDANDO_APROVACAO: "var(--atencao)", APROVADO: "var(--ok)",
  REJEITADO: "var(--risco)", AGENDADO: "var(--ok)", PUBLICADO: "var(--ok)", FALHOU: "var(--risco)",
  MONITORAMENTO: "var(--reator-claro)", ANALISADO: "var(--color-tinta-fraca)",
};
const PRIORIDADES_CONTEUDO: PrioridadeConteudoPainel[] = ["URGENT", "HIGH", "MEDIUM", "LOW"];
const ROTULO_PRIORIDADE_CONTEUDO: Record<PrioridadeConteudoPainel, string> = { URGENT: "URGENTE", HIGH: "ALTA", MEDIUM: "MÉDIA", LOW: "BAIXA" };
const COR_PRIORIDADE_CONTEUDO: Record<PrioridadeConteudoPainel, string> = {
  URGENT: "var(--risco)", HIGH: "var(--atencao)", MEDIUM: "var(--color-tinta-media)", LOW: "var(--color-tinta-fraca)",
};

const GRUPOS_CONTEUDO: Array<[string, StatusConteudoPainel[]]> = [
  ["AGUARDANDO SUA APROVAÇÃO", ["AGUARDANDO_APROVACAO"]],
  ["EM PRODUÇÃO", ["IDEIA", "BRIEFING", "RASCUNHO", "REVISAO"]],
  ["APROVADOS E AGENDADOS", ["APROVADO", "AGENDADO"]],
  ["PUBLICADOS", ["PUBLICADO", "MONITORAMENTO", "ANALISADO"]],
  ["REJEITADOS/FALHARAM", ["REJEITADO", "FALHOU"]],
];

function Social() {
  return <FilaDeConteudo />;
}

/** Componente reutilizado pela aba SOCIAL (todas as plataformas) e pela aba INSTAGRAM (filtrada). */
function FilaDeConteudo({ plataforma }: { plataforma?: string } = {}) {
  const [conteudos, setConteudos] = useState<ConteudoPainel[] | null>(null);
  const [porStatus, setPorStatus] = useState<Record<string, number>>({});
  const [processando, setProcessando] = useState<string | null>(null);
  const [novoTitulo, setNovoTitulo] = useState("");
  const [novoTema, setNovoTema] = useState("");

  const carregar = useCallback(() => {
    const qs = plataforma ? `?plataforma=${plataforma}` : "";
    void fetch(`/api/social/conteudos${qs}`)
      .then((r) => r.json())
      .then((d) => {
        setConteudos(d.conteudos ?? []);
        setPorStatus(d.porStatus ?? {});
      });
  }, [plataforma]);

  useEffect(() => {
    carregar();
    const intervalo = setInterval(carregar, 5000);
    return () => clearInterval(intervalo);
  }, [carregar]);

  const mudarStatus = useCallback(
    async (id: string, status: string, motivoRejeicao?: string) => {
      setProcessando(id);
      await fetch(`/api/social/conteudos/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, motivoRejeicao }),
      });
      setProcessando(null);
      carregar();
    },
    [carregar],
  );

  const mudarPrioridade = useCallback(
    async (id: string, prioridade: string) => {
      setProcessando(id);
      await fetch(`/api/social/conteudos/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prioridade }),
      });
      setProcessando(null);
      carregar();
    },
    [carregar],
  );

  const agendar = useCallback(
    async (id: string) => {
      const data = window.prompt("Agendar para quando? (AAAA-MM-DD HH:MM)");
      if (!data) return;
      const iso = new Date(data.replace(" ", "T")).toISOString();
      if (Number.isNaN(Date.parse(iso))) return;
      setProcessando(id);
      await fetch(`/api/social/conteudos/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agendadoPara: iso }),
      });
      setProcessando(null);
      carregar();
    },
    [carregar],
  );

  const criarManual = useCallback(async () => {
    if (!novoTitulo.trim()) return;
    await fetch("/api/social/conteudos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ titulo: novoTitulo, conceito: novoTema, legenda: novoTema, plataforma: plataforma ?? "instagram" }),
    });
    setNovoTitulo("");
    setNovoTema("");
    carregar();
  }, [novoTitulo, novoTema, plataforma, carregar]);

  if (!conteudos) return <p className="rotulo p-6">CARREGANDO…</p>;

  return (
    <div className="rolagem h-full overflow-y-auto px-4 py-5 sm:px-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div>
          <p className="rotulo mb-1">PIPELINE DE CONTEÚDO — IDEIA → RASCUNHO → APROVAÇÃO → AGENDADO → PUBLICADO</p>
          <p className="text-[12px] leading-relaxed text-[var(--color-tinta-fraca)]">
            Peça no chat: &quot;prepare 3 posts de Instagram sobre [tema]&quot; — vira Job de verdade, cada
            rascunho entra aqui. Publicação real ainda não está conectada (ver INTEGRAÇÕES → Instagram).
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {Object.entries(porStatus).map(([s, n]) => (
            <span key={s} className="mono border border-[var(--color-linha)] px-2 py-1 text-[9px] tracking-[0.1em]" style={{ color: COR_STATUS_CONTEUDO[s as StatusConteudoPainel] ?? "var(--color-tinta-fraca)" }}>
              {ROTULO_STATUS_CONTEUDO[s as StatusConteudoPainel] ?? s} {n}
            </span>
          ))}
        </div>

        <div className="painel canto p-3.5">
          <p className="rotulo mb-2">CRIAR CONTEÚDO MANUALMENTE</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={novoTitulo}
              onChange={(e) => setNovoTitulo(e.target.value)}
              placeholder="Título / tema"
              className="min-h-11 flex-1 border border-[var(--color-linha)] bg-[var(--color-superficie)] px-2.5 text-[13px] outline-none focus:border-[var(--reator)]"
            />
            <input
              value={novoTema}
              onChange={(e) => setNovoTema(e.target.value)}
              placeholder="Legenda/conceito (opcional)"
              className="min-h-11 flex-1 border border-[var(--color-linha)] bg-[var(--color-superficie)] px-2.5 text-[13px] outline-none focus:border-[var(--reator)]"
            />
            <button
              onClick={() => void criarManual()}
              className="mono min-h-11 border border-[var(--reator)] px-4 text-[9.5px] tracking-[0.12em] text-[var(--reator-claro)] transition hover:bg-[var(--reator)]/10"
            >
              CRIAR
            </button>
          </div>
        </div>

        {conteudos.length === 0 && <p className="text-[13px] text-[var(--color-tinta-fraca)]">Nenhum conteúdo ainda.</p>}

        {GRUPOS_CONTEUDO.map(([rotuloGrupo, statusList]) => {
          const doGrupo = conteudos.filter((c) => statusList.includes(c.status));
          if (doGrupo.length === 0) return null;
          return (
            <div key={rotuloGrupo}>
              <p className="rotulo mb-2">{rotuloGrupo} ({doGrupo.length})</p>
              <div className="flex flex-col gap-2">
                {doGrupo.map((c) => (
                  <CartaoConteudo
                    key={c.id}
                    conteudo={c}
                    processando={processando === c.id}
                    onStatus={mudarStatus}
                    onPrioridade={mudarPrioridade}
                    onAgendar={agendar}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CartaoConteudo({
  conteudo: c,
  processando,
  onStatus,
  onPrioridade,
  onAgendar,
}: {
  conteudo: ConteudoPainel;
  processando: boolean;
  onStatus: (id: string, status: string, motivoRejeicao?: string) => void;
  onPrioridade: (id: string, prioridade: string) => void;
  onAgendar: (id: string) => void;
}) {
  const [editandoPrioridade, setEditandoPrioridade] = useState(false);
  const editavel = !["PUBLICADO", "AGENDADO", "MONITORAMENTO", "ANALISADO"].includes(c.status);

  return (
    <div className="painel canto p-3.5">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: COR_STATUS_CONTEUDO[c.status] }} />
        <span className="mono text-[9px] tracking-[0.12em]" style={{ color: COR_STATUS_CONTEUDO[c.status] }}>{ROTULO_STATUS_CONTEUDO[c.status]}</span>
        <span className="mono text-[9px] text-[var(--color-tinta-fraca)]">{c.plataforma} · {c.tipo_conteudo}</span>
        {c.criado_por === "jarvis" && <span className="mono text-[9px] text-[var(--reator-claro)]">GERADO POR JARVIS</span>}

        {editavel ? (
          <div className="relative">
            <button
              onClick={() => setEditandoPrioridade((v) => !v)}
              disabled={processando}
              className="mono flex min-h-7 items-center gap-1 border border-[var(--color-linha)] px-1.5 text-[9px] tracking-[0.1em] transition hover:border-current disabled:opacity-40"
              style={{ color: COR_PRIORIDADE_CONTEUDO[c.prioridade] }}
            >
              {ROTULO_PRIORIDADE_CONTEUDO[c.prioridade]} ▾
            </button>
            {editandoPrioridade && (
              <div className="absolute left-0 top-full z-10 mt-1 flex flex-col border border-[var(--color-linha)] bg-[var(--color-fundo-2)]">
                {PRIORIDADES_CONTEUDO.map((p) => (
                  <button
                    key={p}
                    onClick={() => { setEditandoPrioridade(false); if (p !== c.prioridade) onPrioridade(c.id, p); }}
                    className="mono min-h-9 whitespace-nowrap px-3 text-left text-[9px] tracking-[0.1em] transition hover:bg-[var(--color-linha)]"
                    style={{ color: COR_PRIORIDADE_CONTEUDO[p], fontWeight: p === c.prioridade ? 700 : 400 }}
                  >
                    {ROTULO_PRIORIDADE_CONTEUDO[p]}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <span className="mono text-[9px] tracking-[0.1em]" style={{ color: COR_PRIORIDADE_CONTEUDO[c.prioridade] }}>{ROTULO_PRIORIDADE_CONTEUDO[c.prioridade]}</span>
        )}

        <span className="mono ml-auto text-[9px] text-[var(--color-tinta-fraca)]">{c.criado_em}</span>
      </div>

      <p className="mb-1 text-[13.5px] text-[var(--color-tinta)]">{c.titulo}</p>
      {c.legenda && <p className="mb-2 whitespace-pre-wrap text-[12.5px] leading-relaxed text-[var(--color-tinta-media)]">{c.legenda}</p>}
      {c.hashtags && JSON.parse(c.hashtags).length > 0 && (
        <p className="mb-2 text-[11.5px] text-[var(--reator-claro)]">{JSON.parse(c.hashtags).join(" ")}</p>
      )}
      {c.agendado_para && <p className="mb-2 text-[12px] text-[var(--ok)]">Agendado para {c.agendado_para}</p>}
      {c.motivo_rejeicao && <p className="mb-2 text-[12px] text-[var(--risco)]">Rejeitado: {c.motivo_rejeicao}</p>}

      <div className="flex flex-wrap gap-2">
        {(c.status === "RASCUNHO" || c.status === "REVISAO") && (
          <button onClick={() => onStatus(c.id, "AGUARDANDO_APROVACAO")} disabled={processando} className="mono min-h-9 border border-[var(--reator)] px-2.5 text-[9px] tracking-[0.1em] text-[var(--reator-claro)] transition hover:bg-[var(--reator)]/10 disabled:opacity-40">
            ENVIAR PRA APROVAÇÃO
          </button>
        )}
        {c.status === "AGUARDANDO_APROVACAO" && (
          <>
            <button onClick={() => onStatus(c.id, "APROVADO")} disabled={processando} className="mono min-h-9 border border-[var(--ok)] px-2.5 text-[9px] tracking-[0.1em] text-[var(--ok)] transition hover:bg-[var(--ok)]/10 disabled:opacity-40">
              APROVAR
            </button>
            <button
              onClick={() => { const motivo = window.prompt("Motivo da rejeição (opcional):") ?? undefined; onStatus(c.id, "REJEITADO", motivo); }}
              disabled={processando}
              className="mono min-h-9 border border-[var(--color-linha)] px-2.5 text-[9px] tracking-[0.1em] text-[var(--color-tinta-media)] transition hover:border-[var(--risco)] hover:text-[var(--risco)] disabled:opacity-40"
            >
              REJEITAR
            </button>
          </>
        )}
        {c.status === "APROVADO" && (
          <button onClick={() => onAgendar(c.id)} disabled={processando} className="mono min-h-9 border border-[var(--ok)] px-2.5 text-[9px] tracking-[0.1em] text-[var(--ok)] transition hover:bg-[var(--ok)]/10 disabled:opacity-40">
            AGENDAR
          </button>
        )}
        {c.status === "REJEITADO" && (
          <button onClick={() => onStatus(c.id, "RASCUNHO")} disabled={processando} className="mono min-h-9 border border-[var(--color-linha)] px-2.5 text-[9px] tracking-[0.1em] text-[var(--color-tinta-media)] transition hover:border-[var(--reator)] hover:text-[var(--reator-claro)] disabled:opacity-40">
            RETRABALHAR
          </button>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────── instagram ─────────────────────────── */

function Instagram() {
  const [item, setItem] = useState<ItemIntegracao | null>(null);

  useEffect(() => {
    void fetch("/api/integracoes")
      .then((r) => r.json())
      .then((d) => setItem((d.integracoes ?? []).find((i: ItemIntegracao) => i.id === "instagram") ?? null));
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--color-linha)] px-4 py-3 sm:px-6">
        {item && (
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: COR_ESTADO_INTEGRACAO[item.estado] }} />
            <span className="mono text-[11px] tracking-[0.12em]">{ROTULO_ESTADO_INTEGRACAO[item.estado]}</span>
            {item.identidade && <span className="mono text-[11px] text-[var(--color-tinta-fraca)]">{item.identidade}</span>}
          </div>
        )}
        {item?.estado === "NAO_CONFIGURADO" && (
          <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--color-tinta-fraca)]">
            Conta própria não conectada — pesquisa de perfil público de terceiros (usada na prospecção)
            funciona sem isto. Ver INTEGRAÇÕES para o passo exato de conectar.
          </p>
        )}
      </div>
      <div className="min-h-0 flex-1">
        <FilaDeConteudo plataforma="instagram" />
      </div>
    </div>
  );
}

/* ─────────────────────────── intelligence (Fase 12/13) ─────────────────────────── */

type FonteInteligenciaPainel = {
  id: string; nome: string; tipo: string; url: string; categoria: string; ativa: number; custo: string;
  ultima_verificacao: string | null; ultimo_sucesso: string | null; ultimo_erro: string | null;
};
type ItemInteligenciaPainel = {
  id: string; titulo: string; resumo: string; url: string; publicado_em: string | null; descoberto_em: string;
  categoria: string; relevancia: number; prioridade: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  status: string; analisado_por_modelo: number; analise: string | null;
};

const COR_PRIORIDADE_ITEM: Record<string, string> = {
  CRITICAL: "var(--risco)", HIGH: "var(--atencao)", MEDIUM: "var(--reator-claro)", LOW: "var(--color-tinta-fraca)",
};

function Intelligence() {
  const [fontes, setFontes] = useState<FonteInteligenciaPainel[] | null>(null);
  const [itens, setItens] = useState<ItemInteligenciaPainel[] | null>(null);
  const [porPrioridade, setPorPrioridade] = useState<Record<string, number>>({});
  const [coletando, setColetando] = useState(false);
  const [novoNome, setNovoNome] = useState("");
  const [novoTipo, setNovoTipo] = useState<"YOUTUBE_RSS" | "RSS">("YOUTUBE_RSS");
  const [novoValor, setNovoValor] = useState(""); // canalId ou URL, dependendo do tipo

  const carregarFontes = useCallback(() => {
    void fetch("/api/inteligencia/fontes").then((r) => r.json()).then((d) => setFontes(d.fontes ?? []));
  }, []);
  const carregarItens = useCallback(() => {
    void fetch("/api/inteligencia/itens?limite=30").then((r) => r.json()).then((d) => {
      setItens(d.itens ?? []);
      setPorPrioridade(d.porPrioridade ?? {});
    });
  }, []);

  useEffect(() => { carregarFontes(); carregarItens(); }, [carregarFontes, carregarItens]);

  const coletarAgora = useCallback(async () => {
    setColetando(true);
    const r = await fetch("/api/inteligencia/coletar", { method: "POST" });
    const j = await r.json();
    if (j.execucaoId) {
      for (let i = 0; i < 30; i++) {
        const st = await fetch(`/api/execucoes/${j.execucaoId}`).then((x) => x.json());
        if (["CONCLUIDO", "FALHOU", "BLOQUEADO"].includes(st.execucao?.status)) break;
        await new Promise((res) => setTimeout(res, 1000));
      }
    }
    setColetando(false);
    carregarFontes();
    carregarItens();
  }, [carregarFontes, carregarItens]);

  const adicionarFonte = useCallback(async () => {
    if (!novoNome.trim() || !novoValor.trim()) return;
    const corpo = novoTipo === "YOUTUBE_RSS" ? { nome: novoNome, tipo: novoTipo, canalId: novoValor } : { nome: novoNome, tipo: novoTipo, url: novoValor };
    await fetch("/api/inteligencia/fontes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
    setNovoNome("");
    setNovoValor("");
    carregarFontes();
  }, [novoNome, novoTipo, novoValor, carregarFontes]);

  const alternarFonte = useCallback(async (id: string, ativa: boolean) => {
    await fetch(`/api/inteligencia/fontes/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ativa }) });
    carregarFontes();
  }, [carregarFontes]);

  const removerFonteUi = useCallback(async (id: string) => {
    await fetch(`/api/inteligencia/fontes/${id}`, { method: "DELETE" });
    carregarFontes();
  }, [carregarFontes]);

  return (
    <div className="rolagem h-full overflow-y-auto px-4 py-5 sm:px-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        <div>
          <p className="rotulo mb-1">INTELIGÊNCIA — CONTEXTO DE MERCADO REAL, NUNCA NOTÍCIA FABRICADA</p>
          <p className="text-[12px] leading-relaxed text-[var(--color-tinta-fraca)]">
            YouTube via RSS público (zero custo, zero credencial) já funciona de verdade. Pontuação de
            relevância é determinística (palavra-chave + recência + confiabilidade da fonte) — modelo só
            analisa item de prioridade alta, nunca todo item.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => void coletarAgora()}
            disabled={coletando}
            className="mono min-h-10 border border-[var(--reator)] px-4 text-[10px] tracking-[0.14em] text-[var(--reator-claro)] transition hover:bg-[var(--reator)]/10 disabled:opacity-40"
          >
            {coletando ? "COLETANDO…" : "COLETAR AGORA"}
          </button>
          {Object.entries(porPrioridade).map(([p, n]) => (
            <span key={p} className="mono border border-[var(--color-linha)] px-2 py-1 text-[9px] tracking-[0.1em]" style={{ color: COR_PRIORIDADE_ITEM[p] }}>
              {p} {n}
            </span>
          ))}
        </div>

        <div className="painel canto p-3.5">
          <p className="rotulo mb-2">FONTES ({fontes?.length ?? 0})</p>
          <div className="mb-3 flex flex-col gap-1.5">
            {fontes?.map((f) => (
              <div key={f.id} className="flex flex-wrap items-center gap-2 border-b border-[var(--color-linha-fraca)] py-1.5 last:border-0">
                <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: f.ativa ? "var(--ok)" : "var(--color-tinta-fraca)" }} />
                <span className="text-[12.5px] text-[var(--color-tinta)]">{f.nome}</span>
                <span className="mono text-[9px] text-[var(--color-tinta-fraca)]">{f.tipo} · {f.custo}</span>
                {f.ultimo_erro && <span className="mono text-[9px] text-[var(--risco)]">{f.ultimo_erro.slice(0, 60)}</span>}
                <button onClick={() => void alternarFonte(f.id, !f.ativa)} className="mono ml-auto text-[9px] text-[var(--color-tinta-fraca)] hover:text-[var(--reator-claro)]">
                  {f.ativa ? "DESATIVAR" : "ATIVAR"}
                </button>
                <button onClick={() => void removerFonteUi(f.id)} className="mono text-[9px] text-[var(--color-tinta-fraca)] hover:text-[var(--risco)]">REMOVER</button>
              </div>
            ))}
            {fontes?.length === 0 && <p className="text-[12px] text-[var(--color-tinta-fraca)]">Nenhuma fonte cadastrada ainda.</p>}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select value={novoTipo} onChange={(e) => setNovoTipo(e.target.value as "YOUTUBE_RSS" | "RSS")} className="min-h-9 border border-[var(--color-linha)] bg-[var(--color-superficie)] px-2 text-[12px]">
              <option value="YOUTUBE_RSS">YouTube (canal)</option>
              <option value="RSS">RSS genérico</option>
            </select>
            <input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} placeholder="Nome" className="min-h-9 w-32 border border-[var(--color-linha)] bg-[var(--color-superficie)] px-2 text-[12px] outline-none focus:border-[var(--reator)]" />
            <input
              value={novoValor}
              onChange={(e) => setNovoValor(e.target.value)}
              placeholder={novoTipo === "YOUTUBE_RSS" ? "ID do canal (UC...)" : "URL do feed RSS"}
              className="min-h-9 flex-1 border border-[var(--color-linha)] bg-[var(--color-superficie)] px-2 text-[12px] outline-none focus:border-[var(--reator)]"
            />
            <button onClick={() => void adicionarFonte()} className="mono min-h-9 border border-[var(--color-linha)] px-3 text-[9.5px] tracking-[0.12em] text-[var(--color-tinta-media)] hover:border-[var(--reator)]">
              ADICIONAR
            </button>
          </div>
        </div>

        <div>
          <p className="rotulo mb-2">ÚLTIMOS ITENS</p>
          {itens?.length === 0 && <p className="text-[12px] text-[var(--color-tinta-fraca)]">Nenhum item coletado ainda — adicione uma fonte e clique em COLETAR AGORA.</p>}
          <div className="flex flex-col gap-2">
            {itens?.map((i) => (
              <a key={i.id} href={i.url} target="_blank" rel="noopener noreferrer" className="painel canto block p-3 transition hover:border-[var(--reator)]">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="mono text-[9px] tracking-[0.1em]" style={{ color: COR_PRIORIDADE_ITEM[i.prioridade] }}>{i.prioridade}</span>
                  <span className="mono text-[9px] text-[var(--color-tinta-fraca)]">{i.categoria}</span>
                  {i.analisado_por_modelo === 1 && <span className="mono text-[9px] text-[var(--reator-claro)]">ANALISADO</span>}
                  <span className="mono ml-auto text-[9px] text-[var(--color-tinta-fraca)]">{(i.publicado_em ?? i.descoberto_em).slice(0, 10)}</span>
                </div>
                <p className="text-[13px] text-[var(--color-tinta)]">{i.titulo}</p>
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── whatsapp ─────────────────────────── */

type StatusWhatsapp = {
  configurado: boolean;
  estado: string;
  numero: string | null;
  numeroDono: string | null;
  qrBase64: string | null;
  ultimoErro: string | null;
};

function Whatsapp() {
  const [status, setStatus] = useState<StatusWhatsapp | null>(null);
  const [numeroInput, setNumeroInput] = useState("");
  const [carregandoQr, setCarregandoQr] = useState(false);

  const carregar = useCallback(() => {
    void fetch("/api/whatsapp")
      .then((r) => r.json())
      .then(setStatus);
  }, []);

  useEffect(() => carregar(), [carregar]);

  const pedirQr = useCallback(async () => {
    setCarregandoQr(true);
    await fetch("/api/whatsapp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acao: "qr" }),
    });
    setCarregandoQr(false);
    carregar();
  }, [carregar]);

  const definirDono = useCallback(async () => {
    if (!numeroInput.trim()) return;
    await fetch("/api/whatsapp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acao: "definir_dono", numero: numeroInput }),
    });
    setNumeroInput("");
    carregar();
  }, [numeroInput, carregar]);

  if (!status) return <p className="rotulo p-6">CARREGANDO…</p>;

  return (
    <div className="rolagem h-full overflow-y-auto px-4 py-5 sm:px-6">
      <div className="mx-auto flex max-w-2xl flex-col gap-5">
        <div>
          <p className="rotulo mb-1">CANAL, MESMO CÉREBRO</p>
          <p className="text-[12.5px] leading-relaxed text-[var(--color-tinta-fraca)]">
            Mensagem que chega pelo WhatsApp entra na mesma /api/conversar que a web usa — mesma
            memória, mesmas conversas, mesmo contexto.
          </p>
        </div>

        <div className="painel canto p-4">
          <div className="mb-2 flex items-center gap-2">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{
                background:
                  status.estado === "CONECTADO"
                    ? "var(--ok)"
                    : status.estado === "NAO_CONFIGURADO"
                      ? "var(--color-tinta-fraca)"
                      : "var(--atencao)",
              }}
            />
            <span className="mono text-[11px] tracking-[0.14em]">{status.estado.replace(/_/g, " ")}</span>
          </div>

          {!status.configurado && (
            <p className="text-[12.5px] leading-relaxed text-[var(--color-tinta-fraca)]">
              EVOLUTION_API_URL e EVOLUTION_API_KEY não configuradas — ver INTEGRAÇÕES para o passo
              exato. Sem Docker disponível neste ambiente, a conexão real ainda não foi testada
              contra um servidor Evolution ao vivo.
            </p>
          )}

          {status.configurado && status.estado !== "CONECTADO" && (
            <>
              <button
                onClick={() => void pedirQr()}
                disabled={carregandoQr}
                className="mono mb-3 min-h-11 border border-[var(--reator)] px-4 text-[10px] tracking-[0.14em] text-[var(--reator-claro)] transition hover:bg-[var(--reator)]/10 disabled:opacity-40"
              >
                {carregandoQr ? "GERANDO…" : "GERAR QR"}
              </button>
              {status.qrBase64 && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={status.qrBase64} alt="QR Code do WhatsApp" className="w-56" />
              )}
              <p className="mt-2 text-[11.5px] text-[var(--color-tinta-fraca)]">
                Abra o WhatsApp no celular → Dispositivos conectados → Conectar dispositivo.
              </p>
            </>
          )}

          {status.ultimoErro && (
            <p className="mt-2 text-[12px] text-[var(--risco)]">{status.ultimoErro}</p>
          )}
        </div>

        <div className="painel canto p-4">
          <p className="rotulo mb-2">NÚMERO AUTORIZADO — SÓ ELE ACIONA O SISTEMA</p>
          <p className="mb-2 text-[12px] text-[var(--color-tinta-media)]">
            Atual: {status.numeroDono ?? "nenhum definido"}
          </p>
          <div className="flex gap-2">
            <input
              value={numeroInput}
              onChange={(e) => setNumeroInput(e.target.value)}
              placeholder="+55 11 9XXXX-XXXX"
              className="min-h-11 flex-1 border border-[var(--color-linha)] bg-[var(--color-superficie)] px-2.5 text-[13px] outline-none focus:border-[var(--reator)]"
            />
            <button
              onClick={() => void definirDono()}
              className="mono min-h-11 border border-[var(--color-linha)] px-3 text-[9.5px] tracking-[0.12em] text-[var(--color-tinta-media)] hover:border-[var(--reator)]"
            >
              DEFINIR
            </button>
          </div>
        </div>

        <CentroDeConversasWhatsapp />
      </div>
    </div>
  );
}

/* ─────────────────────────── whatsapp: centro de conversas (Rule 8) ─────────────────────────── */

type ConversaWhatsappPainel = {
  numeroRemoto: string;
  conversaId: string | null;
  autorizado: boolean;
  totalMensagens: number;
  ultimaMensagem: string | null;
  ultimaDirecao: "entrada" | "saida" | null;
  ultimaEm: string;
  pendente: boolean;
};

type MensagemWhatsappPainel = {
  id: string;
  direcao: "entrada" | "saida";
  conteudo_texto: string | null;
  tipo: string;
  criado_em: string;
  estado_processamento: string;
};

/**
 * Centro de comunicação — nunca uma engine de chat nova: cada conversa aqui
 * É uma linha de `conversas` já criada pelo webhook (ver whatsapp/webhook/
 * route.ts). Isto só dá uma VISÃO operacional (lista + busca + filtro +
 * tarefas relacionadas) sobre o que já existe.
 */
function CentroDeConversasWhatsapp() {
  const [conversas, setConversas] = useState<ConversaWhatsappPainel[] | null>(null);
  const [busca, setBusca] = useState("");
  const [soPendentes, setSoPendentes] = useState(false);
  const [ativa, setAtiva] = useState<string | null>(null);
  const [mensagens, setMensagens] = useState<MensagemWhatsappPainel[] | null>(null);
  const [tarefas, setTarefas] = useState<Array<{ id: string; tipo: string; status: string }>>([]);

  const carregarLista = useCallback(() => {
    const qs = new URLSearchParams();
    if (busca) qs.set("busca", busca);
    if (soPendentes) qs.set("pendentes", "1");
    void fetch(`/api/whatsapp/conversas?${qs}`)
      .then((r) => r.json())
      .then((d) => setConversas(d.conversas ?? []));
  }, [busca, soPendentes]);

  useEffect(() => {
    carregarLista();
    const intervalo = setInterval(carregarLista, 8000);
    return () => clearInterval(intervalo);
  }, [carregarLista]);

  const abrirConversa = useCallback((numero: string) => {
    setAtiva(numero);
    void fetch(`/api/whatsapp/conversas/${encodeURIComponent(numero)}`)
      .then((r) => r.json())
      .then((d) => {
        setMensagens(d.mensagens ?? []);
        setTarefas((d.jobs ?? []).map((j: { id: string; tipo: string; status: string }) => ({ id: j.id, tipo: j.tipo, status: j.status })));
      });
  }, []);

  if (!conversas) return <p className="rotulo p-3">CARREGANDO CONVERSAS…</p>;

  return (
    <div className="painel canto p-4">
      <p className="rotulo mb-2">CONVERSAS ({conversas.length})</p>

      <div className="mb-3 flex flex-wrap gap-2">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar número ou texto…"
          className="min-h-9 flex-1 border border-[var(--color-linha)] bg-[var(--color-superficie)] px-2.5 text-[12.5px] outline-none focus:border-[var(--reator)]"
        />
        <button
          onClick={() => setSoPendentes((v) => !v)}
          className="mono min-h-9 border px-2.5 text-[9px] tracking-[0.1em] transition"
          style={{ borderColor: soPendentes ? "var(--reator)" : "var(--color-linha)", color: soPendentes ? "var(--reator-claro)" : "var(--color-tinta-fraca)" }}
        >
          SÓ PENDENTES
        </button>
      </div>

      {conversas.length === 0 && <p className="text-[12.5px] text-[var(--color-tinta-fraca)]">Nenhuma conversa ainda — mensagem chega pelo webhook do Evolution API.</p>}

      <div className="flex flex-col gap-1">
        {conversas.map((c) => (
          <button
            key={c.numeroRemoto}
            onClick={() => abrirConversa(c.numeroRemoto)}
            className="flex flex-col items-start gap-0.5 border-b border-[var(--color-linha-fraca)] px-1 py-2 text-left transition hover:bg-[var(--color-linha)]/30"
          >
            <div className="flex w-full items-center gap-2">
              {c.pendente && <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "var(--atencao)" }} />}
              <span className="mono text-[12px] text-[var(--color-tinta)]">{c.numeroRemoto}</span>
              {!c.autorizado && <span className="mono text-[9px] text-[var(--color-tinta-fraca)]">NÃO AUTORIZADO</span>}
              <span className="mono ml-auto text-[9px] text-[var(--color-tinta-fraca)]">{c.ultimaEm}</span>
            </div>
            {c.ultimaMensagem && (
              <p className="w-full truncate text-[11.5px] text-[var(--color-tinta-fraca)]">
                {c.ultimaDirecao === "saida" ? "Jarvis: " : ""}{c.ultimaMensagem}
              </p>
            )}
          </button>
        ))}
      </div>

      {ativa && (
        <div className="entra mt-3 border-t border-[var(--color-linha)] pt-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="mono text-[11px] tracking-[0.1em] text-[var(--color-tinta)]">{ativa}</p>
            <button onClick={() => setAtiva(null)} className="mono text-[9px] text-[var(--color-tinta-fraca)] hover:text-[var(--reator-claro)]">FECHAR</button>
          </div>

          {tarefas.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {tarefas.map((t) => (
                <span key={t.id} className="mono border border-[var(--color-linha)] px-1.5 py-0.5 text-[9px] text-[var(--color-tinta-fraca)]">
                  {t.tipo} · {t.status}
                </span>
              ))}
            </div>
          )}

          <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto rolagem">
            {mensagens?.map((m) => (
              <div key={m.id} className="text-[12px]">
                <span className="mono mr-1.5 text-[9px] text-[var(--color-tinta-fraca)]">{m.direcao === "entrada" ? "←" : "→"}</span>
                <span className={m.direcao === "saida" ? "text-[var(--reator-claro)]" : "text-[var(--color-tinta-media)]"}>{m.conteudo_texto ?? `[${m.tipo}]`}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── custo ─────────────────────────── */

type CustoResumo = {
  chamadasDeModeloTotal: number;
  tokensEntradaTotal: number;
  tokensSaidaTotal: number;
  tokensCacheLidoTotal: number;
  custoTotalUsd: number;
  porModelo: Record<string, { chamadas: number; custoUsd: number }>;
  observacao: string | null;
  modoOrcamento?: "ECONOMY" | "BALANCED" | "QUALITY" | "MAX_QUALITY";
  orcamentoGlobal?: { nivel: string; gastoUsd: number; limiteUsd: number | null; percentualUsado: number | null };
  chamadasRecentes?: Array<{ provedor: string; modelo: string; operacao: string; sucesso: boolean; motivoRoteamento: string | null; motivoFallback: string | null; criadoEm: string }>;
};

const MODOS_ORCAMENTO = ["ECONOMY", "BALANCED", "QUALITY", "MAX_QUALITY"] as const;
const ROTULO_MODO_ORCAMENTO: Record<(typeof MODOS_ORCAMENTO)[number], string> = {
  ECONOMY: "ECONOMIA",
  BALANCED: "BALANCEADO",
  QUALITY: "QUALIDADE",
  MAX_QUALITY: "QUALIDADE MÁXIMA",
};

function Custo() {
  const [c, setC] = useState<CustoResumo | null>(null);
  const [salvandoModo, setSalvandoModo] = useState(false);

  const carregar = useCallback(() => {
    void fetch("/api/custo")
      .then((r) => r.json())
      .then(setC);
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const mudarModo = useCallback(
    async (modo: string) => {
      setSalvandoModo(true);
      await fetch("/api/autonomia", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modoOrcamento: modo }),
      });
      setSalvandoModo(false);
      carregar();
    },
    [carregar],
  );

  if (!c) return <p className="rotulo p-6">CARREGANDO…</p>;

  return (
    <div className="rolagem h-full overflow-y-auto px-4 py-5 sm:px-6">
      <div className="mx-auto flex max-w-2xl flex-col gap-5">
        <div className="painel canto p-4">
          <p className="rotulo mb-2">CUSTO REAL — AGREGADO DO QUE JÁ FOI MEDIDO</p>
          <p className="mono text-3xl text-[var(--color-tinta)]">${c.custoTotalUsd.toFixed(4)}</p>
          {c.observacao && (
            <p className="mt-1 text-[12.5px] text-[var(--color-tinta-fraca)]">{c.observacao}</p>
          )}
          {c.orcamentoGlobal && c.orcamentoGlobal.nivel !== "sem_limite" && (
            <p className="mt-1.5 text-[12px]" style={{ color: c.orcamentoGlobal.nivel === "excedido" ? "var(--risco)" : c.orcamentoGlobal.nivel === "critico" || c.orcamentoGlobal.nivel === "aviso" ? "var(--atencao)" : "var(--color-tinta-fraca)" }}>
              Orçamento: {c.orcamentoGlobal.nivel.toUpperCase()}
              {c.orcamentoGlobal.limiteUsd != null && ` — $${c.orcamentoGlobal.gastoUsd.toFixed(2)}/$${c.orcamentoGlobal.limiteUsd.toFixed(2)}`}
            </p>
          )}
        </div>

        {c.modoOrcamento && (
          <div className="painel canto p-4">
            <p className="rotulo mb-2">MODO DE ORÇAMENTO — decide o tier que o Router prefere, nunca contorna credencial</p>
            <div className="flex flex-wrap gap-2">
              {MODOS_ORCAMENTO.map((m) => (
                <button
                  key={m}
                  onClick={() => void mudarModo(m)}
                  disabled={salvandoModo || m === c.modoOrcamento}
                  className="mono min-h-9 border px-3 text-[9.5px] tracking-[0.12em] transition disabled:opacity-100"
                  style={{
                    borderColor: m === c.modoOrcamento ? "var(--reator)" : "var(--color-linha)",
                    color: m === c.modoOrcamento ? "var(--reator-claro)" : "var(--color-tinta-fraca)",
                    background: m === c.modoOrcamento ? "var(--reator)/10" : "transparent",
                  }}
                >
                  {ROTULO_MODO_ORCAMENTO[m]}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Medida rotulo="CHAMADAS DE MODELO" valor={String(c.chamadasDeModeloTotal)} />
          <Medida rotulo="TOKENS ENTRADA" valor={c.tokensEntradaTotal.toLocaleString("pt-BR")} />
          <Medida rotulo="TOKENS SAÍDA" valor={c.tokensSaidaTotal.toLocaleString("pt-BR")} />
          <Medida rotulo="CACHE LIDO" valor={c.tokensCacheLidoTotal.toLocaleString("pt-BR")} />
        </div>

        {c.chamadasRecentes && c.chamadasRecentes.length > 0 && (
          <div className="painel canto p-4">
            <p className="rotulo mb-2">ROTEAMENTO — ÚLTIMAS CHAMADAS REAIS</p>
            <div className="flex flex-col gap-1.5">
              {c.chamadasRecentes.slice(0, 8).map((ch, i) => (
                <div key={i} className="text-[11.5px]">
                  <div className="flex items-baseline gap-2">
                    <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: ch.sucesso ? "var(--ok)" : "var(--risco)" }} />
                    <span className="mono text-[var(--color-tinta-media)]">{ch.provedor}/{ch.modelo}</span>
                    <span className="mono text-[var(--color-tinta-fraca)]">{ch.operacao}</span>
                    {ch.motivoFallback && <span className="mono text-[9px] text-[var(--atencao)]">FALLBACK</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {Object.keys(c.porModelo).length > 0 && (
          <div className="painel canto p-4">
            <p className="rotulo mb-2">POR MODELO</p>
            {Object.entries(c.porModelo).map(([modelo, v]) => (
              <div key={modelo} className="flex items-baseline justify-between text-[12.5px]">
                <span className="mono text-[var(--color-tinta-media)]">{modelo}</span>
                <span className="mono text-[var(--color-tinta-fraca)]">
                  {v.chamadas} chamada(s) · ${v.custoUsd.toFixed(4)}
                </span>
              </div>
            ))}
          </div>
        )}

        <p className="text-[11.5px] leading-relaxed text-[var(--color-tinta-fraca)]">
          Escalada de custo: código determinístico → cache → memória/conhecimento existente → modelo
          barato → modelo balanceado → modelo forte. CRUD, UI, testes e indexação nunca chamam
          modelo — ver testes/*.mjs, todos rodando a R$0.
        </p>
      </div>
    </div>
  );
}

function Medida({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="painel canto p-3">
      <p className="rotulo mb-1">{rotulo}</p>
      <p className="mono text-lg text-[var(--color-tinta)]">{valor}</p>
    </div>
  );
}

/* ─────────────────────────── jobs ─────────────────────────── */

type StatusJobPainel = "FILA" | "EXECUTANDO" | "AGUARDANDO_APROVACAO" | "CONCLUIDO" | "FALHOU" | "BLOQUEADO" | "CANCELADO";

type PrioridadeJobPainel = "CRITICAL" | "HIGH" | "NORMAL" | "LOW";

type JobPainel = {
  id: string;
  tipo: string;
  status: StatusJobPainel;
  progresso_atual: number;
  progresso_total: number;
  etapa: string | null;
  erro: string | null;
  tentativas: number;
  criado_em: string;
  iniciado_em: string | null;
  concluido_em: string | null;
  /** Fase 10 — Command Center expõe o que o motor de jobs já grava desde a Fase 7. */
  prioridade: PrioridadeJobPainel;
  custo_usd: number;
  agente_id: string | null;
  pausado: number;
  pausa_solicitada: number;
};

type AprovacaoPainel = {
  id: string;
  job_id: string | null;
  ferramenta: string | null;
  nivel_permissao: string | null;
  titulo: string;
  descricao: string;
  risco: string | null;
  estado: string;
  criado_em: string;
};

const ROTULO_STATUS_JOB: Record<StatusJobPainel, string> = {
  FILA: "AGUARDANDO EXECUÇÃO",
  EXECUTANDO: "EXECUTANDO",
  AGUARDANDO_APROVACAO: "AGUARDANDO APROVAÇÃO",
  CONCLUIDO: "CONCLUÍDO",
  FALHOU: "FALHOU",
  BLOQUEADO: "BLOQUEADO",
  CANCELADO: "CANCELADO",
};

const COR_STATUS_JOB: Record<StatusJobPainel, string> = {
  FILA: "var(--reator-claro)",
  EXECUTANDO: "var(--reator-claro)",
  AGUARDANDO_APROVACAO: "var(--atencao)",
  CONCLUIDO: "var(--ok)",
  FALHOU: "var(--risco)",
  BLOQUEADO: "var(--atencao)",
  CANCELADO: "var(--color-tinta-fraca)",
};

const GRUPOS_JOB: Array<[string, StatusJobPainel[]]> = [
  ["AGUARDANDO SUA APROVAÇÃO", ["AGUARDANDO_APROVACAO"]],
  ["ATIVOS", ["FILA", "EXECUTANDO"]],
  ["PRECISAM DE ATENÇÃO", ["FALHOU", "BLOQUEADO"]],
  ["CONCLUÍDOS", ["CONCLUIDO"]],
  ["CANCELADOS", ["CANCELADO"]],
];

const PRIORIDADES_JOB: PrioridadeJobPainel[] = ["CRITICAL", "HIGH", "NORMAL", "LOW"];
const ROTULO_PRIORIDADE: Record<PrioridadeJobPainel, string> = { CRITICAL: "URGENTE", HIGH: "ALTA", NORMAL: "NORMAL", LOW: "BAIXA" };
const COR_PRIORIDADE: Record<PrioridadeJobPainel, string> = {
  CRITICAL: "var(--risco)",
  HIGH: "var(--atencao)",
  NORMAL: "var(--color-tinta-media)",
  LOW: "var(--color-tinta-fraca)",
};

function Jobs() {
  const [jobs, setJobs] = useState<JobPainel[] | null>(null);
  const [aprovacoes, setAprovacoes] = useState<AprovacaoPainel[]>([]);
  const [processando, setProcessando] = useState<string | null>(null);

  const carregar = useCallback(() => {
    void Promise.all([
      fetch("/api/execucoes").then((r) => r.json()),
      fetch("/api/aprovacoes?pendentes=1").then((r) => r.json()),
    ]).then(([j, a]) => {
      setJobs(j.execucoes ?? []);
      setAprovacoes(a.aprovacoes ?? []);
    });
  }, []);

  useEffect(() => {
    carregar();
    const intervalo = setInterval(carregar, 3000);
    return () => clearInterval(intervalo);
  }, [carregar]);

  const agir = useCallback(
    async (jobId: string, acao: "cancelar" | "retentar" | "pausar" | "retomar") => {
      setProcessando(jobId);
      await fetch(`/api/execucoes/${jobId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao }),
      });
      setProcessando(null);
      carregar();
    },
    [carregar],
  );

  const mudarPrioridade = useCallback(
    async (jobId: string, prioridade: PrioridadeJobPainel) => {
      setProcessando(jobId);
      await fetch(`/api/execucoes/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prioridade }),
      });
      setProcessando(null);
      carregar();
    },
    [carregar],
  );

  const responderAprovacao = useCallback(
    async (id: string, aprovar: boolean) => {
      setProcessando(id);
      await fetch("/api/aprovacoes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, aprovar }),
      });
      setProcessando(null);
      carregar();
    },
    [carregar],
  );

  if (!jobs) return <p className="rotulo p-6">CARREGANDO…</p>;

  return (
    <div className="rolagem h-full overflow-y-auto px-4 py-5 sm:px-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div>
          <p className="rotulo mb-1">TODA TAREFA EM BACKGROUND, NUM SÓ LUGAR</p>
          <p className="text-[12px] leading-relaxed text-[var(--color-tinta-fraca)]">
            Sobrevive a fechar a aba. Não sobrevive a reiniciar o servidor sem avisar — job
            interrompido assim vira FALHOU com o motivo dito, ou retoma sozinho quando o tipo
            permite.
          </p>
        </div>

        {aprovacoes.length > 0 && (
          <div>
            <p className="rotulo mb-2" style={{ color: "var(--atencao)" }}>
              {aprovacoes.length} APROVAÇÃO(ÕES) PENDENTE(S)
            </p>
            <div className="flex flex-col gap-2">
              {aprovacoes.map((a) => (
                <div key={a.id} className="painel canto p-3.5" style={{ borderColor: "var(--atencao)" }}>
                  <p className="mb-1 text-[13.5px] text-[var(--color-tinta)]">{a.titulo}</p>
                  <p className="mb-1 text-[12.5px] leading-relaxed text-[var(--color-tinta-media)]">{a.descricao}</p>
                  {a.nivel_permissao && (
                    <p className="mono mb-2 text-[9px] tracking-[0.1em] text-[var(--atencao)]">
                      PERMISSÃO: {a.nivel_permissao}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={() => void responderAprovacao(a.id, true)}
                      disabled={processando === a.id}
                      className="mono min-h-9 border border-[var(--ok)] px-3 text-[9.5px] tracking-[0.12em] text-[var(--ok)] transition hover:bg-[var(--ok)]/10 disabled:opacity-40"
                    >
                      APROVAR
                    </button>
                    <button
                      onClick={() => void responderAprovacao(a.id, false)}
                      disabled={processando === a.id}
                      className="mono min-h-9 border border-[var(--color-linha)] px-3 text-[9.5px] tracking-[0.12em] text-[var(--color-tinta-media)] transition hover:border-[var(--risco)] hover:text-[var(--risco)] disabled:opacity-40"
                    >
                      REJEITAR
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {jobs.length === 0 && aprovacoes.length === 0 && (
          <p className="text-[13px] text-[var(--color-tinta-fraca)]">Nenhum job rodou ainda.</p>
        )}

        {GRUPOS_JOB.map(([rotuloGrupo, statusList]) => {
          const doGrupo = jobs.filter((j) => statusList.includes(j.status) && j.status !== "AGUARDANDO_APROVACAO");
          if (doGrupo.length === 0) return null;
          return (
            <div key={rotuloGrupo}>
              <p className="rotulo mb-2">
                {rotuloGrupo} ({doGrupo.length})
              </p>
              <div className="flex flex-col gap-2">
                {doGrupo.map((j) => (
                  <LinhaJob key={j.id} job={j} processando={processando === j.id} onAgir={agir} onPrioridade={mudarPrioridade} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LinhaJob({
  job,
  processando,
  onAgir,
  onPrioridade,
}: {
  job: JobPainel;
  processando: boolean;
  onAgir: (id: string, acao: "cancelar" | "retentar" | "pausar" | "retomar") => void;
  onPrioridade: (id: string, prioridade: PrioridadeJobPainel) => void;
}) {
  const pct = job.progresso_total > 0 ? Math.round((job.progresso_atual / job.progresso_total) * 100) : 0;
  const podeMudarPrioridade = job.status === "FILA" || job.status === "EXECUTANDO";
  const [editandoPrioridade, setEditandoPrioridade] = useState(false);
  return (
    <div className="painel canto p-3.5">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: COR_STATUS_JOB[job.status] }} />
        <span className="mono text-[9px] tracking-[0.12em]" style={{ color: COR_STATUS_JOB[job.status] }}>
          {ROTULO_STATUS_JOB[job.status]}
        </span>
        <span className="mono text-[9px] text-[var(--color-tinta-fraca)]">{job.tipo}</span>
        {job.pausado === 1 && (
          <span className="mono text-[9px] tracking-[0.1em]" style={{ color: "var(--atencao)" }}>
            PAUSADO
          </span>
        )}
        {job.tentativas > 0 && (
          <span className="mono text-[9px] text-[var(--color-tinta-fraca)]">tentativa #{job.tentativas + 1}</span>
        )}

        {/* Prioridade — interativa enquanto o job ainda pode ser reordenado (FILA/EXECUTANDO); rótulo fixo depois disso. */}
        {podeMudarPrioridade ? (
          <div className="relative">
            <button
              onClick={() => setEditandoPrioridade((v) => !v)}
              disabled={processando}
              className="mono flex min-h-7 items-center gap-1 border border-[var(--color-linha)] px-1.5 text-[9px] tracking-[0.1em] transition hover:border-current disabled:opacity-40"
              style={{ color: COR_PRIORIDADE[job.prioridade] }}
              aria-haspopup="listbox"
              aria-expanded={editandoPrioridade}
            >
              {ROTULO_PRIORIDADE[job.prioridade]} ▾
            </button>
            {editandoPrioridade && (
              <div className="absolute left-0 top-full z-10 mt-1 flex flex-col border border-[var(--color-linha)] bg-[var(--color-fundo-2)]">
                {PRIORIDADES_JOB.map((p) => (
                  <button
                    key={p}
                    onClick={() => {
                      setEditandoPrioridade(false);
                      if (p !== job.prioridade) onPrioridade(job.id, p);
                    }}
                    className="mono min-h-9 whitespace-nowrap px-3 text-left text-[9px] tracking-[0.1em] transition hover:bg-[var(--color-linha)]"
                    style={{ color: COR_PRIORIDADE[p], fontWeight: p === job.prioridade ? 700 : 400 }}
                  >
                    {ROTULO_PRIORIDADE[p]}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <span className="mono text-[9px] tracking-[0.1em]" style={{ color: COR_PRIORIDADE[job.prioridade] }}>
            {ROTULO_PRIORIDADE[job.prioridade]}
          </span>
        )}

        <span className="mono ml-auto text-[9px] text-[var(--color-tinta-fraca)]">{job.criado_em}</span>
      </div>

      {job.etapa && (job.status === "EXECUTANDO" || job.status === "FILA") && (
        <p className="mb-1.5 text-[12.5px] text-[var(--color-tinta-media)]">{job.etapa}</p>
      )}
      {job.progresso_total > 0 && (job.status === "EXECUTANDO" || job.status === "FILA") && (
        <div className="mb-2 h-1 w-full max-w-xs overflow-hidden bg-[var(--color-linha)]">
          <div className="h-full transition-[width] duration-300" style={{ width: `${pct}%`, background: "var(--reator)" }} />
        </div>
      )}
      {job.erro && <p className="mb-2 text-[12px] leading-relaxed text-[var(--risco)]">{job.erro}</p>}

      <div className="mb-2 flex flex-wrap items-center gap-3">
        {job.custo_usd > 0 && (
          <span className="mono text-[9px] text-[var(--color-tinta-fraca)]">${job.custo_usd.toFixed(4)}</span>
        )}
      </div>

      <div className="flex gap-2">
        {job.status === "EXECUTANDO" && (
          <button
            onClick={() => onAgir(job.id, "pausar")}
            disabled={processando}
            className="mono min-h-9 border border-[var(--color-linha)] px-2.5 text-[9px] tracking-[0.1em] text-[var(--color-tinta-fraca)] transition hover:border-[var(--atencao)] hover:text-[var(--atencao)] disabled:opacity-40"
          >
            PAUSAR
          </button>
        )}
        {job.status === "FILA" && job.pausado === 1 && (
          <button
            onClick={() => onAgir(job.id, "retomar")}
            disabled={processando}
            className="mono min-h-9 border border-[var(--color-linha)] px-2.5 text-[9px] tracking-[0.1em] text-[var(--color-tinta-media)] transition hover:border-[var(--ok)] hover:text-[var(--ok)] disabled:opacity-40"
          >
            RETOMAR
          </button>
        )}
        {(job.status === "EXECUTANDO" || job.status === "FILA") && (
          <button
            onClick={() => onAgir(job.id, "cancelar")}
            disabled={processando}
            className="mono min-h-9 border border-[var(--color-linha)] px-2.5 text-[9px] tracking-[0.1em] text-[var(--color-tinta-fraca)] transition hover:border-[var(--risco)] hover:text-[var(--risco)] disabled:opacity-40"
          >
            CANCELAR
          </button>
        )}
        {job.status === "FALHOU" && (
          <button
            onClick={() => onAgir(job.id, "retentar")}
            disabled={processando}
            className="mono min-h-9 border border-[var(--color-linha)] px-2.5 text-[9px] tracking-[0.1em] text-[var(--color-tinta-media)] transition hover:border-[var(--reator)] hover:text-[var(--reator-claro)] disabled:opacity-40"
          >
            RETENTAR
          </button>
        )}
      </div>
    </div>
  );
}
