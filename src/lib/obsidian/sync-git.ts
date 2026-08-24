import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "../dados/db";

/**
 * Ponte de sincronização do vault Obsidian (Fase 17, reforçada na Fase 18)
 * — problema real desde que o Jarvis passou a rodar num servidor remoto
 * (Hostinger): o vault mora em disco DO SERVIDOR agora, não mais
 * alcançável pelo Obsidian local do jeito que era quando tudo rodava na
 * mesma máquina.
 *
 * Solução: repositório git PRIVADO dedicado só ao vault (nunca junto do
 * código — naturezas de conteúdo diferentes). O servidor empurra (push) a
 * cada sincronização; o Obsidian local só precisa puxar (git pull manual,
 * ou plugin "Obsidian Git" — gratuito, open-source). Nenhum serviço pago
 * introduzido.
 *
 * Opcional: sem OBSIDIAN_GIT_REMOTO configurado, esta função não faz nada
 * (retorna motivo honesto) — nunca falha o processo principal, nunca
 * finge estar sincronizando quando não está.
 *
 * Confiabilidade (Fase 18): estado persistido em `obsidian_sync_estado`
 * (sobrevive a restart — diferente de estado em memória), nunca trava o
 * boot nem o restante do Jarvis se o GitHub estiver fora do ar, nunca
 * força push por cima de mudança remota (conflito vira erro reportado,
 * nunca destruição silenciosa de conteúdo).
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
    // key do código, só que esta precisa de permissão de escrita.
    env: chaveSsh
      ? { ...process.env, GIT_SSH_COMMAND: `ssh -i ${chaveSsh} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new` }
      : process.env,
  });
  return stdout;
}

/** Defesa em profundidade (Fase 18) — o vault já nunca escreve segredo (ver
 * obsidian/notas.ts, contemSegredo antes de qualquer writeFileSync), mas
 * um .gitignore próprio garante que nada com essa forma suba mesmo que
 * apareça por outro caminho no futuro. Nunca sobrescreve se já existir —
 * pode ter sido customizado. */
function garantirGitignoreDoVault(): void {
  const caminho = join(RAIZ_VAULT, ".gitignore");
  if (existsSync(caminho)) return;
  writeFileSync(
    caminho,
    `# Defesa em profundidade — o Jarvis já nunca escreve segredo aqui
# (ver obsidian/notas.ts), isto é só uma segunda camada.
.env
.env.*
*.key
*.pem
*.secret
*.db
*.sqlite
`,
    "utf8",
  );
}

type LinhaEstado = {
  ultimo_sucesso_em: string | null;
  ultimo_commit_em: string | null;
  ultimo_erro: string | null;
  ultimo_erro_em: string | null;
  tentativas_consecutivas: number;
};

function lerEstado(): LinhaEstado {
  const linha = db().prepare(`SELECT * FROM obsidian_sync_estado WHERE id = 1`).get() as LinhaEstado | undefined;
  return linha ?? { ultimo_sucesso_em: null, ultimo_commit_em: null, ultimo_erro: null, ultimo_erro_em: null, tentativas_consecutivas: 0 };
}

function gravarSucesso(commitado: boolean): void {
  db()
    .prepare(
      `INSERT INTO obsidian_sync_estado (id, ultimo_sucesso_em, ultimo_commit_em, ultimo_erro, ultimo_erro_em, tentativas_consecutivas)
       VALUES (1, datetime('now'), CASE WHEN ? THEN datetime('now') ELSE (SELECT ultimo_commit_em FROM obsidian_sync_estado WHERE id=1) END, NULL, NULL, 0)
       ON CONFLICT(id) DO UPDATE SET
         ultimo_sucesso_em = datetime('now'),
         ultimo_commit_em = CASE WHEN ? THEN datetime('now') ELSE ultimo_commit_em END,
         ultimo_erro = NULL, ultimo_erro_em = NULL, tentativas_consecutivas = 0`,
    )
    .run(commitado ? 1 : 0, commitado ? 1 : 0);
}

function gravarFalha(motivo: string): void {
  db()
    .prepare(
      `INSERT INTO obsidian_sync_estado (id, ultimo_erro, ultimo_erro_em, tentativas_consecutivas)
       VALUES (1, ?, datetime('now'), 1)
       ON CONFLICT(id) DO UPDATE SET ultimo_erro = ?, ultimo_erro_em = datetime('now'), tentativas_consecutivas = tentativas_consecutivas + 1`,
    )
    .run(motivo.slice(0, 300), motivo.slice(0, 300));
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
    garantirGitignoreDoVault();

    const status = await git(["status", "--porcelain"]);
    let commitouAgora = false;
    if (status.trim()) {
      await git(["add", "-A"]);
      await git(["commit", "-m", `sync: ${new Date().toISOString()}`]);
      commitouAgora = true;
    }

    // Achado real (Fase 18): mesmo sem mudança NOVA no working tree, pode
    // existir commit local de uma tentativa anterior que commitou mas
    // falhou só no push (ex: rede caiu, chave ainda não cadastrada no
    // GitHub naquele momento) — nunca fica esse commit preso pra sempre
    // só porque "nada mudou desta vez". `rev-list` conta commits que
    // existem aqui e ainda não existem no remoto; se a branch remota nem
    // existe ainda (primeiro push), a comparação falha e tratamos como
    // "tem o que enviar" também.
    let temAlgoPraEnviar = commitouAgora;
    if (!temAlgoPraEnviar) {
      try {
        await git(["fetch", "origin", "main"]);
        const naFrente = await git(["rev-list", "--count", "origin/main..HEAD"]);
        temAlgoPraEnviar = parseInt(naFrente.trim(), 10) > 0;
      } catch {
        temAlgoPraEnviar = true; // remoto sem a branch main ainda (primeiro push) — tenta enviar
      }
    }

    if (!temAlgoPraEnviar) {
      gravarSucesso(false);
      return { ok: true, commitado: false }; // nada novo e nada pendente de envio
    }

    try {
      await git(["push", "-u", "origin", "main"]);
    } catch (erroPush) {
      // Push rejeitado geralmente significa que o remoto tem commit que
      // não temos aqui (ex: o Cacique editou uma nota e deu push do lado
      // do Obsidian local via plugin) — nunca força por cima disso.
      // Tenta reconciliar com rebase; se der conflito de verdade, aborta
      // limpo e reporta, preservando as duas versões intactas pra
      // resolução manual (Fase 18, seção 8 — "não destruir inteligência
      // local silenciosamente").
      try {
        await git(["pull", "--rebase", "origin", "main"]);
        await git(["push", "-u", "origin", "main"]);
      } catch (erroReconciliacao) {
        try {
          await git(["rebase", "--abort"]);
        } catch {
          // sem rebase em andamento — ok, nada a abortar
        }
        const motivo = `conflito real com o remoto — mudanças locais preservadas, não sincronizadas: ${
          erroReconciliacao instanceof Error ? erroReconciliacao.message.slice(0, 200) : "erro desconhecido"
        }`;
        gravarFalha(motivo);
        return { ok: false, motivo };
      }
    }

    gravarSucesso(true);
    return { ok: true, commitado: true };
  } catch (e) {
    const motivo = e instanceof Error ? e.message.slice(0, 300) : "erro desconhecido na sincronização";
    gravarFalha(motivo);
    return { ok: false, motivo };
  }
}

export type StatusSincronizacao = {
  configurado: boolean;
  ultimoSucessoEm: string | null;
  ultimoCommitEm: string | null;
  ultimoErro: string | null;
  ultimoErroEm: string | null;
  tentativasConsecutivas: number;
};

/** Pra expor em /api/integracoes e num futuro health check — nunca lança, sempre reflete o estado real gravado. */
export function obterStatusSincronizacao(): StatusSincronizacao {
  const e = lerEstado();
  return {
    configurado: obsidianGitConfigurado(),
    ultimoSucessoEm: e.ultimo_sucesso_em,
    ultimoCommitEm: e.ultimo_commit_em,
    ultimoErro: e.ultimo_erro,
    ultimoErroEm: e.ultimo_erro_em,
    tentativasConsecutivas: e.tentativas_consecutivas,
  };
}
