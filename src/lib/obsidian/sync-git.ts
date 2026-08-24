import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Ponte de sincronização do vault Obsidian (Fase 17) — problema real e novo
 * desde que o Jarvis passou a rodar num servidor remoto (Hostinger, ver
 * Fase 16): o vault mora em disco DO SERVIDOR agora, não mais alcançável
 * pelo Obsidian local do Windows do jeito que era quando tudo rodava na
 * mesma máquina.
 *
 * Solução: um repositório git PRIVADO dedicado só ao vault (nunca junto do
 * código do Jarvis — são conteúdos de natureza diferente, um é código
 * versionado publicamente auditável, o outro é conhecimento pessoal/
 * comercial). O servidor empurra (`push`) a cada sincronização; o Obsidian
 * local do Cacique só precisa de `git pull` (manual, ou um plugin de git
 * pro Obsidian, ex: "Obsidian Git" — free, open-source) pra puxar as
 * notas novas. Nenhum serviço pago introduzido — GitHub privado já é
 * gratuito, e o Jarvis já usa exatamente esse mecanismo pro próprio
 * código (ver deploy key da Fase 16).
 *
 * Opcional: sem OBSIDIAN_GIT_REMOTO configurado, esta função não faz nada
 * (retorna motivo honesto) — nunca falha o processo principal por causa
 * disso, e nunca finge estar sincronizando quando não está.
 */

const execFileAsync = promisify(execFile);
const RAIZ_VAULT = process.env.OBSIDIAN_VAULT_PATH ?? join(process.cwd(), "dados", "obsidian-vault");

export function obsidianGitConfigurado(): boolean {
  return Boolean(process.env.OBSIDIAN_GIT_REMOTO);
}

async function git(args: string[]): Promise<string> {
  const chaveSsh = process.env.OBSIDIAN_GIT_SSH_KEY;
  const { stdout } = await execFileAsync("git", args, {
    cwd: RAIZ_VAULT,
    timeout: 30_000,
    // Chave dedicada só pra esse repo (IdentitiesOnly evita o git tentar
    // outras chaves do agente por engano) — mesma disciplina da deploy
    // key do código (Fase 16), só que esta precisa de permissão de escrita.
    env: chaveSsh
      ? { ...process.env, GIT_SSH_COMMAND: `ssh -i ${chaveSsh} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new` }
      : process.env,
  });
  return stdout;
}

export type ResultadoSincronizacao = { ok: true; commitado: boolean } | { ok: false; motivo: string };

export async function sincronizarVaultGit(): Promise<ResultadoSincronizacao> {
  const remoto = process.env.OBSIDIAN_GIT_REMOTO;
  if (!remoto) return { ok: false, motivo: "OBSIDIAN_GIT_REMOTO não configurado — sincronização opcional, desativada" };
  if (!existsSync(RAIZ_VAULT)) return { ok: false, motivo: "vault ainda não existe (rode scripts/preparar-obsidian.mjs primeiro)" };

  try {
    if (!existsSync(join(RAIZ_VAULT, ".git"))) {
      await git(["init", "-b", "main"]);
      await git(["remote", "add", "origin", remoto]);
      await git(["config", "user.email", "jarvis@local"]);
      await git(["config", "user.name", "Jarvis"]);
    }

    const status = await git(["status", "--porcelain"]);
    if (!status.trim()) return { ok: true, commitado: false }; // nada mudou desde a última sincronização

    await git(["add", "-A"]);
    await git(["commit", "-m", `sync: ${new Date().toISOString()}`]);
    await git(["push", "-u", "origin", "main"]);
    return { ok: true, commitado: true };
  } catch (e) {
    return { ok: false, motivo: e instanceof Error ? e.message.slice(0, 300) : "erro desconhecido na sincronização" };
  }
}
