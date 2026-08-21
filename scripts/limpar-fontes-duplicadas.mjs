/**
 * Remove duplicatas de fontes_conhecimento criadas antes da deduplicação por
 * título existir. Mantém a linha mais antiga de cada título — é a que tem os
 * trechos vinculados, se houver.
 *
 *   node scripts/limpar-fontes-duplicadas.mjs [--aplicar]
 */

import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

const aplicar = process.argv.includes("--aplicar");
const d = new DatabaseSync(join(process.cwd(), "dados", "jarvis.db"));
d.exec("PRAGMA foreign_keys = ON");

const grupos = d
  .prepare(
    `SELECT lower(titulo) t, COUNT(*) n FROM fontes_conhecimento
      GROUP BY lower(titulo) HAVING n > 1`,
  )
  .all();

if (!grupos.length) {
  console.log("nenhuma fonte duplicada.");
  process.exit(0);
}

let removeriam = 0;
for (const g of grupos) {
  const linhas = d
    .prepare(
      `SELECT id, titulo, importado_em,
              (SELECT COUNT(*) FROM trechos_conhecimento WHERE fonte_id = f.id) trechos
         FROM fontes_conhecimento f WHERE lower(titulo) = ?
        ORDER BY trechos DESC, importado_em ASC`,
    )
    .all(g.t);

  const manter = linhas[0];
  const apagar = linhas.slice(1);
  removeriam += apagar.length;

  console.log(`\n"${manter.titulo}" — ${linhas.length} cópias`);
  console.log(`  manter : ${manter.id} (${manter.trechos} trecho(s), ${manter.importado_em})`);
  for (const a of apagar) console.log(`  apagar : ${a.id} (${a.trechos} trecho(s))`);

  if (aplicar) {
    const del = d.prepare("DELETE FROM fontes_conhecimento WHERE id = ?");
    for (const a of apagar) del.run(a.id);
  }
}

console.log(
  `\n${aplicar ? "removidas" : "seriam removidas"}: ${removeriam} linha(s). ` +
    `${aplicar ? "" : "Rode com --aplicar para efetivar."}`,
);
d.close();
