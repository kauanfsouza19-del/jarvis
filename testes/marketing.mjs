/**
 * Verifica o índice de marketing: recuperação real, separação de domínios e
 * segurança.
 *
 *   node testes/marketing.mjs
 */

import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

const d = new DatabaseSync(join(process.cwd(), "dados", "jarvis.db"));

let passou = 0,
  falhou = 0;
const ok = (n, c, det = "") => {
  if (c) {
    passou++;
    console.log(`  ok   ${n}${det ? ` — ${det}` : ""}`);
  } else {
    falhou++;
    console.log(`  FALHOU  ${n}${det ? ` — ${det}` : ""}`);
  }
};
const secao = (t) => console.log(`\n${t}`);

const id = (nome) => d.prepare("SELECT id FROM projetos WHERE nome=?").get(nome)?.id;
const MKT = id("MARKETING");
const CLI = id("CLIENTES");
const LOC = id("LOCATTA");

console.log("VERIFICAÇÃO DO ÍNDICE DE MARKETING");

/* ─────────────── 1. volume ─────────────── */

secao("1. Índice");
const n = (p) =>
  d.prepare("SELECT COUNT(*) n FROM projeto_conhecimento WHERE projeto_id=?").get(p).n;
ok("MARKETING indexado", n(MKT) > 400, `${n(MKT)} fatos`);
ok("CLIENTES indexado", n(CLI) > 150, `${n(CLI)} fatos`);
ok("LOCATTA preservado", n(LOC) > 300, `${n(LOC)} fatos`);
ok(
  "domínios não se misturaram",
  n(MKT) !== n(LOC) && n(CLI) !== n(LOC),
  "contagens distintas por projeto",
);

/* ─────────────── 2. segurança ─────────────── */

secao("2. Segurança — varredura do que foi persistido");
const tudo = d
  .prepare("SELECT titulo, corpo FROM projeto_conhecimento")
  .all()
  .map((r) => `${r.titulo}\n${r.corpo}`)
  .join("\n");

const segredos = [
  ["chave Anthropic", /sk-ant-[A-Za-z0-9_-]{20,}/],
  ["token GitHub", /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/],
  ["chave Resend", /\bre_[A-Za-z0-9_]{20,}/],
  ["Bearer real", /\bBearer\s+[A-Za-z0-9._-]{24,}/],
  ["chave AWS", /\bAKIA[0-9A-Z]{16}\b/],
  ["Stripe live", /\b(sk|rk)_live_[A-Za-z0-9]{20,}/],
  ["JWT completo", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ["chave privada", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["senha em URL", /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@]+:[^\s/@]{6,}@/i],
  ["CPF", /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/],
  ["CNPJ", /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/],
];
for (const [nome, re] of segredos) {
  const m = tudo.match(re);
  ok(`nenhum ${nome} no índice`, !m, m ? `ACHADO: ${m[0].slice(0, 20)}…` : "");
}
ok(
  "redações aplicadas e visíveis",
  (tudo.match(/\[REDACTED\]/g) ?? []).length > 0,
  `${(tudo.match(/\[REDACTED\]/g) ?? []).length} marcações`,
);

/* ─────────────── 3. classificação ─────────────── */

secao("3. Classificação — histórico, corrente e referência externa");
const cont = (like, p = null) =>
  d
    .prepare(
      `SELECT COUNT(*) n FROM projeto_conhecimento WHERE corpo LIKE ?${p ? " AND projeto_id=?" : ""}`,
    )
    .get(...(p ? [like, p] : [like])).n;

ok("itens marcados HISTORICO", cont("%[HISTORICO]%") > 0, `${cont("%[HISTORICO]%")}`);
ok(
  "material de concorrente marcado REFERENCIA_EXTERNA",
  cont("%[REFERENCIA_EXTERNA]%") > 0,
  `${cont("%[REFERENCIA_EXTERNA]%")}`,
);

const externo = d
  .prepare(
    `SELECT titulo, corpo FROM projeto_conhecimento
      WHERE corpo LIKE '%[REFERENCIA_EXTERNA]%' AND corpo LIKE '%Aluguel.AI%' LIMIT 1`,
  )
  .get();
ok(
  "concorrente Aluguel.AI não virou criativo nosso",
  !!externo,
  externo ? "marcado como externo" : "não encontrado",
);

// Atribuição de propriedade, caso a caso. Foi aqui que o índice errou:
// "Imobia", "Devolus" e "Si9" ficam sob o título "O QUE OS CONCORRENTES ESTÃO
// RODANDO" e entraram como criativo NOSSO porque a marcação não herdava.
const rotulo = (arquivo, frag) => {
  const r = d
    .prepare(
      "SELECT titulo FROM projeto_conhecimento WHERE caminho=? AND titulo LIKE ? LIMIT 1",
    )
    .get(arquivo, `%${frag}%`);
  return r ? (/^\[([A-Z_]+)\]/.exec(r.titulo)?.[1] ?? "SEM") : null;
};

const CASOS = [
  ["CRIATIVOS_META_ADS.md", "Aluguel.AI", "REFERENCIA_EXTERNA"],
  ["CRIATIVOS_META_ADS.md", "Imobia", "REFERENCIA_EXTERNA"],
  ["CRIATIVOS_META_ADS.md", "Devolus", "REFERENCIA_EXTERNA"],
  ["CRIATIVOS_META_ADS.md", "Si9 Sistemas", "REFERENCIA_EXTERNA"],
  ["CRIATIVOS_META_ADS.md", "Oficina Integrada", "REFERENCIA_EXTERNA"],
  ["CRIATIVOS_META_ADS.md", "REC-01", "CRIATIVO"],
  ["CRIATIVOS_META_ADS.md", "VEN-01", "CRIATIVO"], // cita preço de concorrente, mas é nosso
  ["CRIATIVOS_META_ADS.md", "VEN-05", "CRIATIVO"],
  ["CRIATIVOS_META_ADS.md", "Estrutura de campanha", "CRIATIVO"],
  ["PROPOSTA_EVOLUCAO_SISTEMA.md", "Quem eu analisei", "REFERENCIA_EXTERNA"], // tabela comparativa
  ["PROPOSTA_EVOLUCAO_SISTEMA.md", "O que foi implementado", "COMERCIAL"], // H1 não propaga
  ["PROPOSTA_EVOLUCAO_SISTEMA.md", "Minha recomendação", "COMERCIAL"],
];
let atribOk = 0;
for (const [arq, frag, quer] of CASOS) {
  const obtido = rotulo(arq, frag);
  if (obtido === quer) atribOk++;
  else console.log(`       ! ${frag}: esperado ${quer}, obtido ${obtido}`);
}
ok("atribuição de propriedade correta seção a seção", atribOk === CASOS.length, `${atribOk}/${CASOS.length}`);

const confHist = d
  .prepare("SELECT AVG(confianca) c FROM projeto_conhecimento WHERE corpo LIKE '%[HISTORICO]%'")
  .get().c;
const confCorr = d
  .prepare(
    `SELECT AVG(confianca) c FROM projeto_conhecimento
      WHERE projeto_id=? AND corpo NOT LIKE '%[HISTORICO]%' AND corpo NOT LIKE '%[REFERENCIA%'`,
  )
  .get(MKT).c;
ok(
  "histórico tem confiança menor que corrente",
  confHist < confCorr,
  `${confHist?.toFixed(2)} < ${confCorr?.toFixed(2)}`,
);

/* ─────────────── 4. recuperação ─────────────── */

secao("4. Recuperação — perguntas reais");

function perguntar(pergunta, fts, espera, projeto = null) {
  const cond = projeto ? "AND p.projeto_id = ?" : "";
  const args = projeto ? [fts, projeto] : [fts];
  const linhas = d
    .prepare(
      `SELECT p.titulo, p.corpo, p.caminho, bm25(projeto_conhecimento_fts) bm
         FROM projeto_conhecimento_fts
         JOIN projeto_conhecimento p ON p.rowid = projeto_conhecimento_fts.rowid
        WHERE projeto_conhecimento_fts MATCH ? ${cond}
        ORDER BY bm LIMIT 4`,
    )
    .all(...args);

  const junto = linhas.map((l) => `${l.titulo} ${l.corpo}`).toString().toLowerCase();
  const bate = espera.some((e) => junto.includes(e.toLowerCase()));
  ok(`"${pergunta}"`, linhas.length > 0 && bate, linhas[0]?.caminho ?? "sem resultado");
  if (linhas[0]) console.log(`       → ${linhas[0].titulo.slice(0, 74)}`);
  return linhas;
}

perguntar("Quais LPs existem?", '"lp"* OR "locatta"* OR "headline"*', ["lp", "headline"]);
perguntar("Quais VSLs existem?", '"vsl"* OR "roteiro"*', ["vsl", "roteiro"]);
perguntar("Quais criativos de dor foram feitos?", '"dor"* OR "renovacoes"* OR "renovações"*', [
  "dor",
  "renova",
]);
perguntar("Quais hooks já testamos?", '"hook"* OR "gancho"* OR "abertura"*', ["hook", "gancho", "abertura"]);
perguntar("O que os concorrentes rodam?", '"concorrente"* OR "aluguel"* OR "imobia"*', [
  "concorrente",
  "aluguel",
]);
perguntar("Que material pertence a clientes?", '"aquecedor"* OR "estofado"* OR "cliente"*', [
  "aquecedor",
  "estofado",
  "cliente",
], CLI);
perguntar("Qual a estratégia de lançamento?", '"lancamento"* OR "lançamento"* OR "funil"*', [
  "lanç",
  "lanc",
  "funil",
]);
perguntar("Quais posts de Instagram existem?", '"instagram"* OR "post"*', ["instagram", "post"]);

/* ─────────────── 5. separação de domínios ─────────────── */

secao("5. Separação — conhecimento de projeto ≠ memória pessoal");
ok(
  "nenhuma preferência pessoal no índice de marketing",
  d
    .prepare(
      `SELECT COUNT(*) n FROM projeto_conhecimento
        WHERE projeto_id=? AND (corpo LIKE '%Cacique prefere%' OR corpo LIKE '%eu prefiro%')`,
    )
    .get(MKT).n === 0,
);
ok(
  "cada fato aponta para um arquivo",
  d
    .prepare("SELECT COUNT(*) n FROM projeto_conhecimento WHERE caminho IS NULL OR caminho=''")
    .get().n === 0,
);
// LOCATTA fica DENTRO da pasta de MARKETING no disco, e cada projeto guarda
// caminho relativo à própria raiz. Comparar as strings acusaria "README.md"
// como colisão sendo dois arquivos distintos — a propriedade real é que o
// indexador de MARKETING pulou a subárvore do LOCATTA.
const vazou = d
  .prepare(
    `SELECT COUNT(*) n FROM projeto_conhecimento
      WHERE projeto_id=? AND (caminho LIKE 'locatta-saas/%' OR caminho LIKE 'locatta-saas\\%')`,
  )
  .get(MKT).n;
ok("MARKETING não reindexou a subárvore do LOCATTA", vazou === 0, `${vazou} vazamentos`);

const colisao = d
  .prepare(
    `SELECT COUNT(*) n FROM (
       SELECT a.caminho FROM projeto_conhecimento a
         JOIN projeto_conhecimento b ON a.caminho = b.caminho AND a.corpo = b.corpo
        WHERE a.projeto_id=? AND b.projeto_id=?)`,
  )
  .get(LOC, MKT).n;
ok("nenhum fato duplicado entre LOCATTA e MARKETING", colisao === 0, `${colisao} idênticos`);

/* ─────────────── 6. incremental ─────────────── */

secao("6. Incremental");
const hashes = d
  .prepare("SELECT COUNT(DISTINCT tipo) n FROM projeto_conhecimento WHERE projeto_id=?")
  .get(MKT).n;
ok("hashes por arquivo gravados", hashes > 100, `${hashes} distintos`);
ok(
  "formato de hash correto",
  /^sha256:[0-9a-f]{16}$/.test(
    d.prepare("SELECT tipo FROM projeto_conhecimento WHERE projeto_id=? LIMIT 1").get(MKT).tipo,
  ),
);

console.log(`\n${"─".repeat(56)}`);
console.log(`PASSOU: ${passou}   FALHOU: ${falhou}`);
d.close();
if (falhou > 0) {
  console.log("RESULTADO: FALHOU");
  process.exit(1);
}
console.log("RESULTADO: TUDO PASSOU");
