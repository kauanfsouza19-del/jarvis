import "server-only";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { db } from "../dados/db";

/**
 * Sessão de login do navegador (Fase 15) — cookie HttpOnly guarda só um id
 * opaco de 36 caracteres (UUID), nunca o JARVIS_TOKEN em si. A tabela
 * (sessoes_login, ver dados/db.ts) é a fonte de verdade: revogar é deletar
 * a linha, "logout em todos os dispositivos" é possível (nunca implementado
 * ainda, mas o modelo já suporta sem mudança de schema).
 */

const DURACAO_SESSAO_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias, deslizante (ver renovar() abaixo)
export const NOME_COOKIE_SESSAO = "jarvis_sessao";

function paraSql(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19);
}

/** Comparação em tempo constante — evita side-channel de timing revelando quantos caracteres da senha bateram. */
export function senhaConfere(recebida: string, esperada: string): boolean {
  const a = Buffer.from(recebida);
  const b = Buffer.from(esperada);
  if (a.length !== b.length) return false; // tamanhos diferentes já vazam length, mas isso é inevitável e barato de adivinhar
  return timingSafeEqual(a, b);
}

export function criarSessao(ip: string | null): string {
  const id = randomUUID();
  db()
    .prepare(`INSERT INTO sessoes_login (id, expira_em, ip_criacao) VALUES (?, ?, ?)`)
    .run(id, paraSql(Date.now() + DURACAO_SESSAO_MS), ip);
  return id;
}

/** true se a sessão existe e não expirou — também desliza a expiração (uso ativo mantém a sessão viva, ociosa por 30 dias expira). */
export function sessaoValida(idSessao: string | null | undefined): boolean {
  if (!idSessao) return false;
  const linha = db().prepare(`SELECT expira_em FROM sessoes_login WHERE id = ?`).get(idSessao) as { expira_em: string } | undefined;
  if (!linha) return false;
  const expirou = new Date(linha.expira_em.replace(" ", "T") + "Z").getTime() < Date.now();
  if (expirou) {
    db().prepare(`DELETE FROM sessoes_login WHERE id = ?`).run(idSessao);
    return false;
  }
  db()
    .prepare(`UPDATE sessoes_login SET ultimo_uso_em = datetime('now'), expira_em = ? WHERE id = ?`)
    .run(paraSql(Date.now() + DURACAO_SESSAO_MS), idSessao);
  return true;
}

export function encerrarSessao(idSessao: string | null | undefined): void {
  if (!idSessao) return;
  db().prepare(`DELETE FROM sessoes_login WHERE id = ?`).run(idSessao);
}

/** Limpeza oportunista — chamada no boot (instrumentation.ts), não em todo request. */
export function limparSessoesExpiradas(): number {
  const r = db().prepare(`DELETE FROM sessoes_login WHERE expira_em < datetime('now')`).run();
  return Number(r.changes ?? 0);
}
