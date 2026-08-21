/**
 * Backup local do Jarvis (Fase 15 — produção). Gratuito, simples,
 * dependência zero: `VACUUM INTO` do próprio SQLite garante uma cópia
 * consistente do banco mesmo com o servidor rodando (nunca copia o
 * arquivo .db bruto enquanto está sendo escrito — isso pode corromper).
 * O vault do Obsidian é só markdown, cópia de arquivo direta já é segura.
 *
 * Isto NÃO é backup fora do host — só protege contra "apaguei sem querer"
 * ou "banco corrompeu", não contra "o servidor inteiro sumiu". Copiar o
 * conteúdo de `dados/backups/` pra outro lugar (S3, outro disco, etc.)
 * fica documentado no relatório da fase como ação externa — decisão de
 * PARA ONDE não é algo que o Jarvis possa escolher sozinho.
 *
 * Fase 16 — o destino mudou de `backups/` (raiz do projeto) pra
 * `dados/backups/`: em produção (Railway) só `dados/` fica montado num
 * volume persistente; deixar o backup FORA dele significava que ele
 * mesmo desaparecia a cada redeploy — o oposto do que um backup existe
 * pra fazer.
 *
 *   node scripts/backup.mjs
 */
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, cpSync, readdirSync, statSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";

const RAIZ = process.cwd();
const CAMINHO_DB = process.env.JARVIS_DB ?? join(RAIZ, "dados", "jarvis.db");
const RAIZ_VAULT = process.env.OBSIDIAN_VAULT_PATH ?? join(RAIZ, "dados", "obsidian-vault");
// Segue pra dentro de onde o banco realmente está (JARVIS_DB pode apontar
// pra outro lugar) — nunca hardcoded fora disso, senão sai do volume junto.
const PASTA_BACKUPS = process.env.BACKUPS_PATH ?? join(dirname(CAMINHO_DB), "backups");
const MANTER_ULTIMOS = 7; // 1 por dia rodando via cron diário — não deixa crescer sem limite

const carimbo = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const destino = join(PASTA_BACKUPS, carimbo);
mkdirSync(destino, { recursive: true });

if (existsSync(CAMINHO_DB)) {
  const d = new DatabaseSync(CAMINHO_DB, { readOnly: true });
  const destinoDb = join(destino, "jarvis.db").replace(/\\/g, "/");
  d.exec(`VACUUM INTO '${destinoDb}'`);
  d.close();
  console.log(`  banco: ${destinoDb}`);
} else {
  console.log("  banco não encontrado, pulado (servidor nunca rodou neste ambiente ainda)");
}

if (existsSync(RAIZ_VAULT)) {
  const destinoVault = join(destino, "obsidian-vault");
  cpSync(RAIZ_VAULT, destinoVault, { recursive: true });
  console.log(`  vault: ${destinoVault}`);
}

// Retenção — mantém só os N mais recentes, gratuito e simples (sem serviço externo).
const entradas = readdirSync(PASTA_BACKUPS)
  .map((nome) => ({ nome, caminho: join(PASTA_BACKUPS, nome), mtime: statSync(join(PASTA_BACKUPS, nome)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime);
for (const antigo of entradas.slice(MANTER_ULTIMOS)) {
  rmSync(antigo.caminho, { recursive: true, force: true });
  console.log(`  removido (retenção de ${MANTER_ULTIMOS}): ${antigo.nome}`);
}

console.log(`\nBackup concluído em: ${destino}`);
