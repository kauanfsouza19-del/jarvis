import "server-only";
import { db, id, agora, auditar } from "./db";
import { exigirSemSegredo } from "@/lib/seguranca/denylist";
import { normalizar, paraIntencao, type Intencao } from "@/lib/contexto/resolver";

/* ============================================================ PROJETOS */

export type Projeto = {
  id: string;
  nome: string;
  tipo: string;
  proposito: string;
  resumo: string;
  permissao: string;
  estado: string;
  saude: string;
  indexado_em: string | null;
  arquivos: number;
};

export function listarProjetos(): Projeto[] {
  return db().prepare(`SELECT * FROM projetos ORDER BY nome`).all() as Projeto[];
}

export function projetoPorNome(nome: string): Projeto | undefined {
  return db().prepare(`SELECT * FROM projetos WHERE nome = ?`).get(nome) as Projeto | undefined;
}

/* ============================================================ CONVERSAS */

export type Conversa = {
  id: string;
  titulo: string;
  projeto_id: string | null;
  modo: string;
  estado: string;
  criado_em: string;
  atualizado_em: string;
};

export type Mensagem = {
  id: string;
  conversa_id: string;
  papel: "user" | "assistant" | "system";
  conteudo: string;
  projeto_id: string | null;
  cliente_nome: string | null;
  intencao: string | null;
  confianca_contexto: string | null;
  modelo: string | null;
  tokens_entrada: number | null;
  tokens_saida: number | null;
  criado_em: string;
};

export function criarConversa(titulo?: string, projetoId?: string | null): Conversa {
  const c = id();
  db()
    .prepare(`INSERT INTO conversas (id, titulo, projeto_id) VALUES (?, ?, ?)`)
    .run(c, titulo?.trim() || "Nova conversa", projetoId ?? null);
  auditar({ acao: "conversa.criar", resultado: c, projeto_id: projetoId ?? null });
  return db().prepare(`SELECT * FROM conversas WHERE id = ?`).get(c) as Conversa;
}

export function listarConversas(incluirArquivadas = false): Conversa[] {
  const sql = incluirArquivadas
    ? `SELECT * FROM conversas ORDER BY atualizado_em DESC LIMIT 100`
    : `SELECT * FROM conversas WHERE estado = 'ativa' ORDER BY atualizado_em DESC LIMIT 100`;
  return db().prepare(sql).all() as Conversa[];
}

export function obterConversa(conversaId: string): Conversa | undefined {
  return db().prepare(`SELECT * FROM conversas WHERE id = ?`).get(conversaId) as
    | Conversa
    | undefined;
}

export function mensagensDa(conversaId: string): Mensagem[] {
  return db()
    .prepare(`SELECT * FROM mensagens WHERE conversa_id = ? ORDER BY criado_em, rowid`)
    .all(conversaId) as Mensagem[];
}

/**
 * Reconstrói a timeline de contexto de uma conversa a partir do que foi
 * PERSISTIDO em cada turno do Cacique — não de estado de componente React.
 * É isso que faz o contexto sobreviver a reload de página e a restart de
 * servidor: depois de qualquer um dos dois, a próxima mensagem ainda sabe
 * que a anterior era sobre a SS Aquecedores.
 */
export function timelineDaConversa(
  conversaId: string,
  limite = 12,
): Array<{
  projetoId: string | null;
  projetoNome: string | null;
  clienteId: string | null;
  clienteNome: string | null;
  intencao: Intencao;
}> {
  const linhas = db()
    .prepare(
      `SELECT m.projeto_id, m.cliente_nome, m.intencao, p.nome AS projeto_nome
         FROM mensagens m
         LEFT JOIN projetos p ON p.id = m.projeto_id
        WHERE m.conversa_id = ? AND m.papel = 'user'
          AND (m.projeto_id IS NOT NULL OR m.cliente_nome IS NOT NULL)
        ORDER BY m.criado_em, m.rowid
        LIMIT ?`,
    )
    .all(conversaId, limite) as Array<{
    projeto_id: string | null;
    cliente_nome: string | null;
    intencao: string | null;
    projeto_nome: string | null;
  }>;

  // Mesmo formato de id que o léxico gera — mantém consistência para quem
  // eventualmente comparar clienteId entre timeline e léxico.
  return linhas.map((l) => ({
    projetoId: l.projeto_id,
    projetoNome: l.projeto_nome,
    clienteId: l.cliente_nome ? `cliente:${normalizar(l.cliente_nome).replace(/\s+/g, "-")}` : null,
    clienteNome: l.cliente_nome,
    intencao: paraIntencao(l.intencao),
  }));
}

export function adicionarMensagem(entrada: {
  conversa_id: string;
  papel: "user" | "assistant" | "system";
  conteudo: string;
  projeto_id?: string | null;
  cliente_nome?: string | null;
  intencao?: string | null;
  confianca_contexto?: string | null;
  modo?: string | null;
  modelo?: string | null;
  esforco?: string | null;
  tokens_entrada?: number | null;
  tokens_saida?: number | null;
  cache_lido?: number | null;
  estado_exec?: string | null;
  fontes?: string[] | null;
  memorias_ref?: string[] | null;
}): Mensagem {
  const m = id();
  db()
    .prepare(
      `INSERT INTO mensagens
        (id, conversa_id, papel, conteudo, projeto_id, cliente_nome, intencao,
         confianca_contexto, modo, modelo, esforco,
         tokens_entrada, tokens_saida, cache_lido, estado_exec, fontes, memorias_ref)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      m,
      entrada.conversa_id,
      entrada.papel,
      entrada.conteudo,
      entrada.projeto_id ?? null,
      entrada.cliente_nome ?? null,
      entrada.intencao ?? null,
      entrada.confianca_contexto ?? null,
      entrada.modo ?? null,
      entrada.modelo ?? null,
      entrada.esforco ?? null,
      entrada.tokens_entrada ?? null,
      entrada.tokens_saida ?? null,
      entrada.cache_lido ?? null,
      entrada.estado_exec ?? null,
      entrada.fontes ? JSON.stringify(entrada.fontes) : null,
      entrada.memorias_ref ? JSON.stringify(entrada.memorias_ref) : null,
    );

  db()
    .prepare(`UPDATE conversas SET atualizado_em = ? WHERE id = ?`)
    .run(agora(), entrada.conversa_id);

  return db().prepare(`SELECT * FROM mensagens WHERE id = ?`).get(m) as Mensagem;
}

export function renomearConversa(conversaId: string, titulo: string) {
  db()
    .prepare(`UPDATE conversas SET titulo = ?, atualizado_em = ? WHERE id = ?`)
    .run(titulo.trim(), agora(), conversaId);
}

export function arquivarConversa(conversaId: string, arquivar = true) {
  db()
    .prepare(`UPDATE conversas SET estado = ?, atualizado_em = ? WHERE id = ?`)
    .run(arquivar ? "arquivada" : "ativa", agora(), conversaId);
  auditar({ acao: arquivar ? "conversa.arquivar" : "conversa.reabrir", resultado: conversaId });
}

/* ============================================================ MEMÓRIA */

export type Memoria = {
  id: string;
  tipo: string;
  camada: string;
  titulo: string;
  corpo: string;
  projeto_id: string | null;
  origem: string;
  confianca: number;
  importancia: number;
  estado: string;
  substituida_por: string | null;
  criado_em: string;
  atualizado_em: string;
  verificado_em: string | null;
};

export function criarMemoria(entrada: {
  tipo: Memoria["tipo"];
  titulo: string;
  corpo: string;
  camada?: string;
  projeto_id?: string | null;
  origem?: string;
  confianca?: number;
  importancia?: number;
}): Memoria {
  // Trava de segredo — antes do INSERT, sempre.
  exigirSemSegredo(`${entrada.titulo}\n${entrada.corpo}`, "memorias");

  // Deduplicação: memória ATIVA com o mesmo título e mesmo projeto é ATUALIZADA,
  // não duplicada. Repetir a mesma nota polui a recuperação semântica — a busca
  // devolve cinco cópias da mesma coisa e desperdiça o orçamento de contexto.
  const existente = db()
    .prepare(
      `SELECT id FROM memorias
        WHERE estado = 'ATIVA' AND lower(titulo) = lower(?)
          AND (projeto_id IS ? OR projeto_id = ?)
        LIMIT 1`,
    )
    .get(entrada.titulo, entrada.projeto_id ?? null, entrada.projeto_id ?? null) as
    | { id: string }
    | undefined;

  if (existente) {
    db()
      .prepare(
        `UPDATE memorias
            SET corpo = ?, confianca = ?, importancia = ?, atualizado_em = ?, verificado_em = ?
          WHERE id = ?`,
      )
      .run(
        entrada.corpo,
        entrada.confianca ?? 0.7,
        entrada.importancia ?? 3,
        agora(),
        agora(),
        existente.id,
      );
    auditar({ acao: "memoria.atualizar", resultado: existente.id, motivo: "titulo ja existia" });
    return db().prepare(`SELECT * FROM memorias WHERE id = ?`).get(existente.id) as Memoria;
  }

  const m = id();
  db()
    .prepare(
      `INSERT INTO memorias (id, tipo, camada, titulo, corpo, projeto_id, origem, confianca, importancia)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      m,
      entrada.tipo,
      entrada.camada ?? "recuperavel",
      entrada.titulo,
      entrada.corpo,
      entrada.projeto_id ?? null,
      entrada.origem ?? "conversa",
      entrada.confianca ?? 0.7,
      entrada.importancia ?? 3,
    );
  auditar({ acao: "memoria.criar", resultado: m, projeto_id: entrada.projeto_id ?? null });
  return db().prepare(`SELECT * FROM memorias WHERE id = ?`).get(m) as Memoria;
}

/**
 * Decisão nova que conflita com memória antiga.
 *
 * A antiga NÃO é apagada nem mesclada — vira DESATUALIZADA e aponta para a
 * substituta. O histórico continua rastreável; os dois estados nunca se fundem.
 */
export function substituirMemoria(antigaId: string, nova: Parameters<typeof criarMemoria>[0]) {
  const criada = criarMemoria(nova);
  db()
    .prepare(
      `UPDATE memorias SET estado = 'DESATUALIZADA', substituida_por = ?, atualizado_em = ? WHERE id = ?`,
    )
    .run(criada.id, agora(), antigaId);
  auditar({
    acao: "memoria.substituir",
    motivo: `${antigaId} -> ${criada.id}`,
    resultado: criada.id,
  });
  return criada;
}

export function listarMemorias(filtro?: {
  estado?: string;
  tipo?: string;
  projeto_id?: string;
}): Memoria[] {
  const cond: string[] = [];
  const args: unknown[] = [];
  if (filtro?.estado) {
    cond.push("estado = ?");
    args.push(filtro.estado);
  }
  if (filtro?.tipo) {
    cond.push("tipo = ?");
    args.push(filtro.tipo);
  }
  if (filtro?.projeto_id) {
    cond.push("projeto_id = ?");
    args.push(filtro.projeto_id);
  }
  const where = cond.length ? `WHERE ${cond.join(" AND ")}` : "";
  return db()
    .prepare(
      `SELECT * FROM memorias ${where} ORDER BY importancia DESC, atualizado_em DESC LIMIT 200`,
    )
    .all(...(args as never[])) as Memoria[];
}

export function esquecerMemoria(memoriaId: string) {
  const m = db().prepare(`SELECT titulo FROM memorias WHERE id = ?`).get(memoriaId) as
    | { titulo: string }
    | undefined;
  db().prepare(`DELETE FROM memorias WHERE id = ?`).run(memoriaId);
  // Registra que algo foi apagado — sem o conteúdo.
  auditar({ acao: "memoria.esquecer", resultado: memoriaId, motivo: m ? "a pedido" : "inexistente" });
}

/* ============================================================ CONHECIMENTO */

export type FonteConhecimento = {
  id: string;
  titulo: string;
  tipo: string;
  url: string | null;
  autor: string | null;
  categoria: string | null;
  estado: string;
  importado_em: string;
  observacao: string | null;
};

export function registrarFonte(entrada: {
  titulo: string;
  tipo: string;
  url?: string | null;
  autor?: string | null;
  categoria?: string | null;
  projeto_id?: string | null;
  estado?: string;
  observacao?: string | null;
}): FonteConhecimento {
  // Registrar a mesma fonte duas vezes tem que atualizar, não empilhar. Sem
  // isso a lista vira oito cópias da mesma linha e o painel passa a mentir
  // sobre quantas fontes existem — foi o que aconteceu com o registro das 37.
  const existente = db()
    .prepare(`SELECT id FROM fontes_conhecimento WHERE lower(titulo) = lower(?) LIMIT 1`)
    .get(entrada.titulo) as { id: string } | undefined;

  if (existente) {
    db()
      .prepare(
        `UPDATE fontes_conhecimento
            SET tipo=?, url=?, autor=?, categoria=?, projeto_id=?, estado=?, observacao=?
          WHERE id=?`,
      )
      .run(
        entrada.tipo,
        entrada.url ?? null,
        entrada.autor ?? null,
        entrada.categoria ?? null,
        entrada.projeto_id ?? null,
        entrada.estado ?? "AGUARDANDO_CONTEUDO",
        entrada.observacao ?? null,
        existente.id,
      );
    auditar({
      acao: "conhecimento.fonte.atualizar",
      resultado: existente.id,
      motivo: "titulo ja existia",
    });
    return db()
      .prepare(`SELECT * FROM fontes_conhecimento WHERE id = ?`)
      .get(existente.id) as FonteConhecimento;
  }

  const f = id();
  db()
    .prepare(
      `INSERT INTO fontes_conhecimento (id, titulo, tipo, url, autor, categoria, projeto_id, estado, observacao)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      f,
      entrada.titulo,
      entrada.tipo,
      entrada.url ?? null,
      entrada.autor ?? null,
      entrada.categoria ?? null,
      entrada.projeto_id ?? null,
      entrada.estado ?? "AGUARDANDO_CONTEUDO",
      entrada.observacao ?? null,
    );
  auditar({ acao: "conhecimento.fonte.registrar", resultado: f, motivo: entrada.titulo });
  return db().prepare(`SELECT * FROM fontes_conhecimento WHERE id = ?`).get(f) as FonteConhecimento;
}

export function listarFontes(): FonteConhecimento[] {
  return db()
    .prepare(`SELECT * FROM fontes_conhecimento ORDER BY importado_em DESC`)
    .all() as FonteConhecimento[];
}

export function criarDocumento(fonteId: string, titulo: string, modulo?: string, resumo = "") {
  const d = id();
  db()
    .prepare(
      `INSERT INTO documentos_conhecimento (id, fonte_id, modulo, titulo, resumo) VALUES (?,?,?,?,?)`,
    )
    .run(d, fonteId, modulo ?? null, titulo, resumo);
  return d;
}

export function adicionarTrecho(entrada: {
  documento_id: string;
  fonte_id: string;
  afirmacao: string;
  corpo: string;
  modulo?: string | null;
  evidencia?: "CONSENSO_FORTE" | "CONSENSO_PARCIAL" | "MENCAO_ISOLADA";
  natureza?: "FATO" | "HEURISTICA" | "HIPOTESE" | "REGRA_OPERACIONAL" | "OPINIAO";
  confianca?: number;
  ordem?: number;
}) {
  exigirSemSegredo(`${entrada.afirmacao}\n${entrada.corpo}`, "trechos_conhecimento");

  const t = id();
  db()
    .prepare(
      `INSERT INTO trechos_conhecimento
        (id, documento_id, fonte_id, ordem, afirmacao, corpo, modulo, evidencia, natureza, confianca)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      t,
      entrada.documento_id,
      entrada.fonte_id,
      entrada.ordem ?? 0,
      entrada.afirmacao,
      entrada.corpo,
      entrada.modulo ?? null,
      entrada.evidencia ?? "MENCAO_ISOLADA",
      entrada.natureza ?? "HEURISTICA",
      entrada.confianca ?? 0.5,
    );
  return t;
}

/* ============================================================ CONHECIMENTO DE PROJETO */

export function registrarConhecimentoProjeto(entrada: {
  projeto_id: string;
  titulo: string;
  corpo: string;
  caminho?: string | null;
  tipo?: string;
  confianca?: number;
}) {
  exigirSemSegredo(`${entrada.titulo}\n${entrada.corpo}`, "projeto_conhecimento");

  const p = id();
  db()
    .prepare(
      `INSERT INTO projeto_conhecimento (id, projeto_id, caminho, titulo, corpo, tipo, confianca)
       VALUES (?,?,?,?,?,?,?)`,
    )
    .run(
      p,
      entrada.projeto_id,
      entrada.caminho ?? null,
      entrada.titulo,
      entrada.corpo,
      entrada.tipo ?? "fato",
      entrada.confianca ?? 0.8,
    );
  return p;
}
