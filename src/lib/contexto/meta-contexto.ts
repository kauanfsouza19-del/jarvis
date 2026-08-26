import "server-only";
import { db, id as gerarId } from "../dados/db";

/**
 * Contexto operacional de conta Meta por conversa (Fase 27f) — "Abre a
 * conta da Klein" / "Analisa ela" / "Cria uma campanha de WhatsApp" (sem
 * repetir qual conta) só funciona se ALGUÉM lembrar qual conta está
 * selecionada NESTA conversa entre um turno e o próximo. Vive na própria
 * linha de `conversas` (1:1, nunca histórico — ver dados/db.ts).
 */

export type ContextoMetaConversa = { contaMetaId: string; clienteNome: string | null };

export function obterContextoMetaDaConversa(conversaId: string): ContextoMetaConversa | null {
  const row = db()
    .prepare(`SELECT conta_meta_selecionada, cliente_meta_selecionado_nome FROM conversas WHERE id = ?`)
    .get(conversaId) as { conta_meta_selecionada: string | null; cliente_meta_selecionado_nome: string | null } | undefined;
  if (!row?.conta_meta_selecionada) return null;
  return { contaMetaId: row.conta_meta_selecionada, clienteNome: row.cliente_meta_selecionado_nome };
}

export function definirContextoMetaDaConversa(conversaId: string, contaMetaId: string, clienteNome: string | null = null): void {
  db()
    .prepare(`UPDATE conversas SET conta_meta_selecionada = ?, cliente_meta_selecionado_nome = ?, atualizado_em = datetime('now') WHERE id = ?`)
    .run(contaMetaId, clienteNome, conversaId);
}

export function limparContextoMetaDaConversa(conversaId: string): void {
  db()
    .prepare(`UPDATE conversas SET conta_meta_selecionada = NULL, cliente_meta_selecionado_nome = NULL, atualizado_em = datetime('now') WHERE id = ?`)
    .run(conversaId);
}

// ── Registro Cliente -> Conta Meta ──

export type ClienteConta = { id: string; cliente: string; conta_meta_id: string; criado_em: string };

export function registrarClienteConta(cliente: string, contaMetaId: string): ClienteConta {
  const novoId = gerarId();
  db().prepare(`INSERT INTO clientes_meta_contas (id, cliente, conta_meta_id) VALUES (?,?,?)`).run(novoId, cliente, contaMetaId);
  return db().prepare(`SELECT * FROM clientes_meta_contas WHERE id = ?`).get(novoId) as ClienteConta;
}

export function listarClientesContas(): ClienteConta[] {
  return db().prepare(`SELECT * FROM clientes_meta_contas ORDER BY cliente`).all() as ClienteConta[];
}

/**
 * Resolve nome livre ("klein", "a Klein", "conta da Klein") pra uma conta
 * registrada — busca por substring normalizada, nunca match exato rígido
 * (o Cacique fala de forma natural, não digita o nome inteiro cadastrado).
 * Nunca escolhe "o mais parecido" quando há mais de um — devolve null e
 * quem chama pede pra desambiguar, mesma disciplina de nunca inventar.
 */
export function resolverClienteParaConta(nomeLivre: string): { conta: ClienteConta } | { ambiguo: ClienteConta[] } | null {
  const alvo = nomeLivre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
  if (!alvo) return null;

  const todas = listarClientesContas();
  const bateram = todas.filter((c) => {
    const nomeNorm = c.cliente
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase();
    return nomeNorm.includes(alvo) || alvo.includes(nomeNorm);
  });

  if (bateram.length === 0) return null;
  if (bateram.length === 1) return { conta: bateram[0] };
  return { ambiguo: bateram };
}
