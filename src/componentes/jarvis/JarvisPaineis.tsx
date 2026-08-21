"use client";

import { useEffect, useState } from "react";
import { JarvisBentoCard, type PesoBento } from "./JarvisBentoCard";

/**
 * Painéis do sistema bento — Próxima Melhor Ação, Inbox, Agenda, Oportunidades,
 * Decisões vencidas, Tarefa Ativa, Memória Recente.
 *
 * Regra que os sete seguem: estado vazio é um ESTADO, não um placeholder. Sem
 * conta de e-mail conectada, o painel diz isso e para — nunca mostra e-mail
 * de exemplo para "parecer pronto". Peso (normal/importante/crítico) sempre
 * deriva de uma condição real — nunca decoração de prioridade.
 */

/* ─────────────────────── dados compartilhados ─────────────────────── */

type Acao = {
  titulo: string;
  projeto: string | null;
  impacto: number;
  urgencia: number;
  prazo: string | null;
};

type Memo = { id: string; titulo: string; corpo: string; atualizado_em: string };
type TarefaAtiva = { titulo: string; detalhe: string; projeto: string | null } | null;
type DecisaoVencida = { id: string; titulo: string; revisar_em: string };

type ConteudoAgendadoResumo = { id: string; titulo: string; plataforma: string; agendadoPara: string };

type WarRoomResumo = {
  proximaAcao: Acao | null;
  lacunas: string[];
  oportunidades: Memo[];
  decisoesParaRevisar: DecisaoVencida[];
  tarefaAtiva: TarefaAtiva;
  conteudoAgendado: ConteudoAgendadoResumo[];
};

/** Um fetch só — as sete cartas nascem dele em vez de bater a API sete vezes. */
export function useWarRoomResumo() {
  const [dados, setDados] = useState<WarRoomResumo | null | "erro">(null);

  useEffect(() => {
    void fetch("/api/warroom")
      .then((r) => r.json())
      .then((d) =>
        setDados({
          proximaAcao: d.proximaAcao ?? null,
          lacunas: d.lacunas ?? [],
          oportunidades: d.oportunidades ?? [],
          decisoesParaRevisar: d.decisoesParaRevisar ?? [],
          tarefaAtiva: d.tarefaAtiva ?? null,
          conteudoAgendado: d.conteudoAgendado ?? [],
        }),
      )
      .catch(() => setDados("erro"));
  }, []);

  return dados;
}

export function useMemoriasRecentes(limite = 3) {
  const [memorias, setMemorias] = useState<Memo[] | null | "erro">(null);

  useEffect(() => {
    void fetch("/api/memorias?estado=ATIVA")
      .then((r) => r.json())
      .then((d) => setMemorias((d.memorias ?? []).slice(0, limite)))
      .catch(() => setMemorias("erro"));
  }, [limite]);

  return memorias;
}

type ConteudoAprovacao = { id: string; titulo: string; plataforma: string };

/** Fase 11 — conteúdo social aguardando aprovação, mesmo dado real que a aba SOCIAL usa. */
export function useConteudosAguardandoAprovacao() {
  const [conteudos, setConteudos] = useState<ConteudoAprovacao[] | null | "erro">(null);

  useEffect(() => {
    void fetch("/api/social/conteudos?status=AGUARDANDO_APROVACAO")
      .then((r) => r.json())
      .then((d) => setConteudos(d.conteudos ?? []))
      .catch(() => setConteudos("erro"));
  }, []);

  return conteudos;
}

type ItemInteligenciaResumo = { id: string; titulo: string; prioridade: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"; url: string };

/** Fase 13 — últimos itens de alta prioridade, mesmo dado real que a aba INTELLIGENCE usa. */
export function useInteligenciaImportante() {
  const [itens, setItens] = useState<ItemInteligenciaResumo[] | null | "erro">(null);

  useEffect(() => {
    // Sem filtro de prioridade — a API já ordena por prioridade (CRITICAL primeiro), então os 3 primeiros já são os mais importantes.
    void fetch("/api/inteligencia/itens?status=NEW&limite=3")
      .then((r) => r.json())
      .then((d) => setItens(d.itens ?? []))
      .catch(() => setItens("erro"));
  }, []);

  return itens;
}

/**
 * O texto recente decide, de forma simples e real, qual painel merece mais
 * espaço agora — sem inventar uma categoria de intenção nova só pra isso.
 */
export function destaquePorTexto(texto: string | null | undefined) {
  const t = (texto ?? "").toLowerCase();
  return {
    inbox: /\be-?mail|inbox|caixa de entrada\b/.test(t),
    agenda: /\bagenda|reuni[aã]o|calend[aá]rio|compromisso\b/.test(t),
  };
}

/* ─────────────────────── próxima melhor ação ─────────────────────── */

export function PainelProximaAcao({
  dados,
  onAbrirWarRoom,
}: {
  dados: WarRoomResumo | null | "erro";
  onAbrirWarRoom: () => void;
}) {
  if (dados === "erro") {
    return (
      <JarvisBentoCard titulo="PRÓXIMA MELHOR AÇÃO" estado="erro" mensagemVazia="Falha ao carregar.">
        {null}
      </JarvisBentoCard>
    );
  }
  if (dados === null) {
    return <JarvisBentoCard titulo="PRÓXIMA MELHOR AÇÃO" estado="carregando" />;
  }

  const pa = dados.proximaAcao;
  const vencida = pa?.prazo ? new Date(pa.prazo).getTime() < Date.now() : false;
  const peso: PesoBento = pa ? (vencida ? "critico" : "importante") : "normal";

  return (
    <JarvisBentoCard
      titulo="PRÓXIMA MELHOR AÇÃO"
      peso={peso}
      estado={pa ? "disponivel" : "vazio"}
      mensagemVazia={pa ? undefined : "Nada para ranquear ainda. " + (dados.lacunas[0] ?? "Sem dados suficientes.")}
      acao={{ rotulo: "WAR ROOM", aoClicar: onAbrirWarRoom }}
    >
      <p className="text-[14px] leading-snug text-[var(--color-tinta)]">{pa?.titulo}</p>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        <span className="mono text-[9px] text-[var(--color-tinta-fraca)]">IMPACTO {pa?.impacto}/5</span>
        <span className="mono text-[9px] text-[var(--color-tinta-fraca)]">URGÊNCIA {pa?.urgencia}/5</span>
        {pa?.projeto && (
          <span className="mono text-[9px]" style={{ color: "var(--reator)" }}>
            {pa.projeto}
          </span>
        )}
        {pa?.prazo && (
          <span className="mono text-[9px]" style={{ color: vencida ? "var(--risco)" : "var(--atencao)" }}>
            {pa.prazo}
          </span>
        )}
      </div>
    </JarvisBentoCard>
  );
}

/* ─────────────────────── inbox intelligence ─────────────────────── */

const CATEGORIAS_EMAIL = [
  "CRÍTICO / SEGURANÇA",
  "CLIENTE",
  "FINANCEIRO",
  "AÇÃO NECESSÁRIA",
  "IMPORTANTE",
  "INFORMAÇÃO",
  "SPAM / RUÍDO",
] as const;

export function PainelInbox({
  onAbrirIntegracoes,
  destaque = false,
}: {
  onAbrirIntegracoes: () => void;
  destaque?: boolean;
}) {
  return (
    <JarvisBentoCard
      titulo="INBOX INTELLIGENCE"
      estado="auth_necessaria"
      mensagemVazia="Sem contas de e-mail conectadas."
      destaque={destaque}
      acao={{ rotulo: "CONECTAR", aoClicar: onAbrirIntegracoes }}
    >
      <ul className="flex flex-col gap-1">
        {CATEGORIAS_EMAIL.map((c) => (
          <li key={c} className="flex items-center justify-between text-[11px]">
            <span className="text-[var(--color-tinta-media)]">{c}</span>
            <span className="mono text-[var(--color-tinta-fraca)]">0</span>
          </li>
        ))}
      </ul>
    </JarvisBentoCard>
  );
}

/* ─────────────────────── agenda / hoje ─────────────────────── */

export function PainelAgenda({
  dados,
  onAbrirIntegracoes,
  destaque = false,
}: {
  dados: WarRoomResumo | null | "erro";
  onAbrirIntegracoes: () => void;
  destaque?: boolean;
}) {
  // Fase 11 — sem Google Calendar conectado, ainda existe agenda REAL:
  // conteúdo social já AGENDADO. Nunca inventa evento de calendário — só
  // mostra o que o próprio Jarvis agendou.
  const agendado = dados && dados !== "erro" ? dados.conteudoAgendado : [];

  if (agendado.length === 0) {
    return (
      <JarvisBentoCard
        titulo="HOJE"
        estado="auth_necessaria"
        mensagemVazia="Sem calendário conectado. Nenhum conteúdo agendado ainda."
        destaque={destaque}
        acao={{ rotulo: "CONECTAR", aoClicar: onAbrirIntegracoes }}
      />
    );
  }

  return (
    <JarvisBentoCard titulo="HOJE" peso="normal" estado="disponivel" destaque={destaque}>
      <ul className="flex flex-col gap-1.5">
        {agendado.slice(0, 3).map((c) => (
          <li key={c.id} className="flex items-baseline justify-between gap-2 text-[12px]">
            <span className="min-w-0 truncate text-[var(--color-tinta-media)]">{c.titulo}</span>
            <span className="mono shrink-0 text-[9px] text-[var(--color-tinta-fraca)]">{c.agendadoPara.slice(0, 10)}</span>
          </li>
        ))}
      </ul>
      <p className="mono text-[9px] text-[var(--color-tinta-fraca)]">Conteúdo agendado — sem Google Calendar conectado ainda.</p>
    </JarvisBentoCard>
  );
}

/* ─────────────────────── oportunidades ─────────────────────── */

export function PainelOportunidades({ dados }: { dados: WarRoomResumo | null | "erro" }) {
  if (dados === "erro" || dados === null) {
    return <JarvisBentoCard titulo="OPORTUNIDADES" estado={dados === null ? "carregando" : "erro"} />;
  }
  const lista = dados.oportunidades;
  return (
    <JarvisBentoCard
      titulo="OPORTUNIDADES"
      peso={lista.length > 0 ? "importante" : "normal"}
      estado={lista.length > 0 ? "disponivel" : "vazio"}
      mensagemVazia="Nenhuma oportunidade registrada."
    >
      <ul className="flex flex-col gap-1.5">
        {lista.slice(0, 3).map((o) => (
          <li key={o.id} className="text-[12px] leading-snug text-[var(--color-tinta-media)]">
            {o.titulo}
          </li>
        ))}
      </ul>
    </JarvisBentoCard>
  );
}

/* ─────────────────────── conteúdo social aguardando aprovação (Fase 11) ─────────────────────── */

export function PainelConteudoSocial({
  conteudos,
  onAbrirSocial,
}: {
  conteudos: ConteudoAprovacao[] | null | "erro";
  onAbrirSocial: () => void;
}) {
  if (conteudos === "erro" || conteudos === null) {
    return <JarvisBentoCard titulo="CONTEÚDO SOCIAL" estado={conteudos === null ? "carregando" : "erro"} />;
  }
  return (
    <JarvisBentoCard
      titulo="CONTEÚDO SOCIAL"
      peso={conteudos.length > 0 ? "importante" : "normal"}
      estado={conteudos.length > 0 ? "disponivel" : "vazio"}
      mensagemVazia="Nada aguardando aprovação."
      acao={{ rotulo: "FILA", aoClicar: onAbrirSocial }}
    >
      <ul className="flex flex-col gap-1.5">
        {conteudos.slice(0, 3).map((c) => (
          <li key={c.id} className="flex items-baseline justify-between gap-2 text-[12px]">
            <span className="min-w-0 truncate text-[var(--color-tinta-media)]">{c.titulo}</span>
            <span className="mono shrink-0 text-[9px] text-[var(--color-tinta-fraca)]">{c.plataforma}</span>
          </li>
        ))}
      </ul>
      {conteudos.length > 3 && (
        <p className="mono text-[9px] text-[var(--color-tinta-fraca)]">+{conteudos.length - 3} aguardando</p>
      )}
    </JarvisBentoCard>
  );
}

/* ─────────────────────── inteligência recente (Fase 13) ─────────────────────── */

export function PainelInteligencia({
  itens,
  onAbrirInteligencia,
}: {
  itens: ItemInteligenciaResumo[] | null | "erro";
  onAbrirInteligencia: () => void;
}) {
  if (itens === "erro" || itens === null) {
    return <JarvisBentoCard titulo="INTELIGÊNCIA" estado={itens === null ? "carregando" : "erro"} />;
  }
  return (
    <JarvisBentoCard
      titulo="INTELIGÊNCIA"
      peso={itens.some((i) => i.prioridade === "CRITICAL") ? "importante" : "normal"}
      estado={itens.length > 0 ? "disponivel" : "vazio"}
      mensagemVazia="Nenhuma fonte coletada ainda."
      acao={{ rotulo: "VER", aoClicar: onAbrirInteligencia }}
    >
      <ul className="flex flex-col gap-1.5">
        {itens.slice(0, 3).map((i) => (
          <li key={i.id} className="flex items-baseline justify-between gap-2 text-[12px]">
            <span className="min-w-0 truncate text-[var(--color-tinta-media)]">{i.titulo}</span>
            <span className="mono shrink-0 text-[9px]" style={{ color: i.prioridade === "CRITICAL" ? "var(--risco)" : "var(--color-tinta-fraca)" }}>
              {i.prioridade}
            </span>
          </li>
        ))}
      </ul>
    </JarvisBentoCard>
  );
}

/* ─────────────────────── decisões vencidas (risco) ─────────────────────── */

export function PainelRiscos({ dados }: { dados: WarRoomResumo | null | "erro" }) {
  if (dados === "erro" || dados === null) {
    return <JarvisBentoCard titulo="DECISÕES A REVISAR" estado={dados === null ? "carregando" : "erro"} />;
  }
  const lista = dados.decisoesParaRevisar;
  return (
    <JarvisBentoCard
      titulo="DECISÕES A REVISAR"
      peso={lista.length > 0 ? "critico" : "normal"}
      estado={lista.length > 0 ? "disponivel" : "vazio"}
      mensagemVazia="Nenhuma decisão vencida para revisão."
    >
      <ul className="flex flex-col gap-1.5">
        {lista.slice(0, 3).map((d) => (
          <li key={d.id} className="flex items-baseline justify-between gap-2 text-[12px]">
            <span className="min-w-0 truncate text-[var(--color-tinta-media)]">{d.titulo}</span>
            <span className="mono shrink-0 text-[9px]" style={{ color: "var(--risco)" }}>
              {d.revisar_em}
            </span>
          </li>
        ))}
      </ul>
    </JarvisBentoCard>
  );
}

/* ─────────────────────── tarefa ativa ─────────────────────── */

export function PainelTarefaAtiva({ dados }: { dados: WarRoomResumo | null | "erro" }) {
  if (dados === "erro" || dados === null) {
    return <JarvisBentoCard titulo="TAREFA ATIVA" estado={dados === null ? "carregando" : "erro"} />;
  }
  const t = dados.tarefaAtiva;
  return (
    <JarvisBentoCard
      titulo="TAREFA ATIVA"
      peso={t ? "importante" : "normal"}
      estado={t ? "disponivel" : "vazio"}
      mensagemVazia="Nenhuma tarefa em andamento."
    >
      <p className="text-[13px] leading-snug text-[var(--color-tinta)]">{t?.titulo}</p>
      {t?.projeto && (
        <span className="mono text-[9px]" style={{ color: "var(--reator)" }}>
          {t.projeto}
        </span>
      )}
    </JarvisBentoCard>
  );
}

/* ─────────────────────── memória recente ─────────────────────── */

export function PainelMemoriaRecente({ memorias }: { memorias: Memo[] | null | "erro" }) {
  if (memorias === "erro" || memorias === null) {
    return <JarvisBentoCard titulo="MEMÓRIA RECENTE" estado={memorias === null ? "carregando" : "erro"} />;
  }
  return (
    <JarvisBentoCard
      titulo="MEMÓRIA RECENTE"
      estado={memorias.length > 0 ? "disponivel" : "vazio"}
      mensagemVazia="Nenhuma memória registrada ainda."
    >
      <ul className="flex flex-col gap-1.5">
        {memorias.map((m) => (
          <li key={m.id} className="text-[12px] leading-snug text-[var(--color-tinta-media)]">
            {m.titulo}
          </li>
        ))}
      </ul>
    </JarvisBentoCard>
  );
}
