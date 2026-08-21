import "server-only";
import { db, id as gerarId } from "../dados/db";

export type Plano = {
  id: string;
  job_id: string | null;
  objetivo: string;
  resumo_raciocinio: string;
  origem: "deterministico" | "modelo";
  agente_id: string | null;
  capacidades_necessarias: string;
  nivel_risco: "baixo" | "medio" | "alto";
  exige_aprovacao: number;
  estado: "RASCUNHO" | "APROVADO" | "EXECUTANDO" | "CONCLUIDO" | "FALHOU" | "ADAPTADO";
  criado_em: string;
};

export type StatusPlanoPasso =
  | "PENDENTE"
  | "EXECUTANDO"
  | "CONCLUIDO"
  | "FALHOU"
  | "PULADO"
  | "AGUARDANDO_APROVACAO"
  | "AGUARDANDO_FINALIZACAO";

export type PlanoPasso = {
  id: string;
  plano_id: string;
  ordem: number;
  descricao: string;
  capacidade: string;
  entrada: string;
  depende_de: string; // JSON array de plano_passos.id
  nivel_permissao: string | null;
  status: StatusPlanoPasso;
  saida: string | null;
  erro: string | null;
  tentativas: number;
  max_tentativas: number;
  iniciado_em: string | null;
  concluido_em: string | null;
};

export type PassoParaCriar = {
  descricao: string;
  capacidade: string;
  entrada: unknown;
  dependeDe: number[]; // índice no array de entrada, resolvido para id real na criação
  nivelPermissao?: string | null;
  maxTentativas?: number;
};

export function criarPlano(entrada: {
  jobId: string | null;
  objetivo: string;
  resumoRaciocinio: string;
  origem: "deterministico" | "modelo";
  agenteId?: string | null;
  capacidadesNecessarias: string[];
  nivelRisco: "baixo" | "medio" | "alto";
  exigeAprovacao: boolean;
  passos: PassoParaCriar[];
}): { plano: Plano; passos: PlanoPasso[] } {
  const planoId = gerarId();
  db()
    .prepare(
      `INSERT INTO planos (id, job_id, objetivo, resumo_raciocinio, origem, agente_id, capacidades_necessarias, nivel_risco, exige_aprovacao)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      planoId,
      entrada.jobId,
      entrada.objetivo,
      entrada.resumoRaciocinio,
      entrada.origem,
      entrada.agenteId ?? null,
      JSON.stringify(entrada.capacidadesNecessarias),
      entrada.nivelRisco,
      entrada.exigeAprovacao ? 1 : 0,
    );

  const idsPorIndice: string[] = [];
  const inserir = db().prepare(
    `INSERT INTO plano_passos (id, plano_id, ordem, descricao, capacidade, entrada, depende_de, nivel_permissao, max_tentativas)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  );

  entrada.passos.forEach((p, i) => {
    const passoId = gerarId();
    idsPorIndice[i] = passoId;
    const dependeDeIds = p.dependeDe.map((idx) => idsPorIndice[idx]).filter(Boolean);
    inserir.run(
      passoId,
      planoId,
      i,
      p.descricao,
      p.capacidade,
      JSON.stringify(p.entrada),
      JSON.stringify(dependeDeIds),
      p.nivelPermissao ?? null,
      p.maxTentativas ?? 1,
    );
  });

  return { plano: obterPlano(planoId)!, passos: passosDoPlano(planoId) };
}

export function obterPlano(id: string): Plano | undefined {
  return db().prepare(`SELECT * FROM planos WHERE id = ?`).get(id) as Plano | undefined;
}

export function planoDoJob(jobId: string): Plano | undefined {
  return db().prepare(`SELECT * FROM planos WHERE job_id = ? ORDER BY criado_em DESC LIMIT 1`).get(jobId) as Plano | undefined;
}

export function passosDoPlano(planoId: string): PlanoPasso[] {
  return db().prepare(`SELECT * FROM plano_passos WHERE plano_id = ? ORDER BY ordem`).all(planoId) as PlanoPasso[];
}

export function atualizarPlano(id: string, campos: Partial<Record<keyof Plano, unknown>>) {
  const chaves = Object.keys(campos);
  if (chaves.length === 0) return;
  db()
    .prepare(`UPDATE planos SET ${chaves.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`)
    .run(...([...chaves.map((k) => campos[k as keyof Plano]), id] as never[]));
}

export function atualizarPasso(id: string, campos: Partial<Record<keyof PlanoPasso, unknown>>) {
  const chaves = Object.keys(campos);
  if (chaves.length === 0) return;
  db()
    .prepare(`UPDATE plano_passos SET ${chaves.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`)
    .run(...([...chaves.map((k) => campos[k as keyof PlanoPasso]), id] as never[]));
}

export type PassoParaCriarDinamico = {
  descricao: string;
  capacidade: string;
  entrada: unknown;
  /** IDs reais de plano_passos (não índice) — o passo já existe quando este é inserido, diferente de PassoParaCriar. */
  dependeDeIds?: string[];
  nivelPermissao?: string | null;
  maxTentativas?: number;
};

/**
 * Insere passos NOVOS num plano que já está em execução — o mecanismo que
 * transforma o DAG de estático (tudo decidido na criação) em dinâmico:
 * um passo concluído pode gerar trabalho que só existe DEPOIS de rodar
 * (ex: descoberta de negócio -> um diagnóstico por negócio achado, sem
 * saber quantos nem quais antes de a descoberta terminar). Nunca reordena
 * nem apaga o que já existe — só acrescenta, com `ordem` continuando de
 * onde o plano parou.
 */
export function inserirPassosDinamicos(planoId: string, passos: PassoParaCriarDinamico[]): PlanoPasso[] {
  if (passos.length === 0) return [];
  const ordemAtual = db().prepare(`SELECT COALESCE(MAX(ordem), -1) AS max FROM plano_passos WHERE plano_id = ?`).get(planoId) as { max: number };
  let proximaOrdem = ordemAtual.max + 1;

  const inserir = db().prepare(
    `INSERT INTO plano_passos (id, plano_id, ordem, descricao, capacidade, entrada, depende_de, nivel_permissao, max_tentativas)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  );
  const idsNovos: string[] = [];
  for (const p of passos) {
    const passoId = gerarId();
    idsNovos.push(passoId);
    inserir.run(
      passoId,
      planoId,
      proximaOrdem++,
      p.descricao,
      p.capacidade,
      JSON.stringify(p.entrada),
      JSON.stringify(p.dependeDeIds ?? []),
      p.nivelPermissao ?? null,
      p.maxTentativas ?? 1,
    );
  }
  return db()
    .prepare(`SELECT * FROM plano_passos WHERE id IN (${idsNovos.map(() => "?").join(",")})`)
    .all(...idsNovos) as PlanoPasso[];
}

/**
 * Amarra um passo já existente (tipicamente o de finalização) a também
 * depender de passos recém-inseridos — sem isso a finalização rodaria
 * antes do trabalho dinâmico terminar. Idempotente (Set), nunca duplica
 * dependência se chamado duas vezes com o mesmo id.
 */
export function adicionarDependencias(passoId: string, novasDependenciasIds: string[]): void {
  if (novasDependenciasIds.length === 0) return;
  const passo = db().prepare(`SELECT depende_de FROM plano_passos WHERE id = ?`).get(passoId) as { depende_de: string } | undefined;
  if (!passo) return;
  const atuais = new Set(JSON.parse(passo.depende_de) as string[]);
  for (const id of novasDependenciasIds) atuais.add(id);
  db().prepare(`UPDATE plano_passos SET depende_de = ? WHERE id = ?`).run(JSON.stringify([...atuais]), passoId);
}

/** Passos cujas dependências já estão todas CONCLUIDO (ou PULADO) — prontos para rodar agora, em paralelo. */
export function passosProntos(planoId: string): PlanoPasso[] {
  const todos = passosDoPlano(planoId);
  const estadoPorId = new Map(todos.map((p) => [p.id, p.status]));
  return todos.filter((p) => {
    if (p.status !== "PENDENTE") return false;
    const deps = JSON.parse(p.depende_de) as string[];
    return deps.every((depId) => {
      const s = estadoPorId.get(depId);
      return s === "CONCLUIDO" || s === "PULADO";
    });
  });
}
