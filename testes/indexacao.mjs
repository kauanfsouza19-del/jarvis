/**
 * Verifica o índice do Locatta: segurança, incremental e recuperação real.
 *
 *   node testes/indexacao.mjs
 */

import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

const d = new DatabaseSync(join(process.cwd(), "dados", "jarvis.db"));

let passou = 0;
let falhou = 0;
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

const proj = d.prepare("SELECT id, nome, arquivos, indexado_em FROM projetos WHERE nome='LOCATTA'").get();

console.log("VERIFICAÇÃO DO ÍNDICE — LOCATTA");

// ─────────────────────────────── 1. o índice existe

secao("1. Índice");
const total = d
  .prepare("SELECT COUNT(*) n FROM projeto_conhecimento WHERE projeto_id=?")
  .get(proj.id).n;
ok("fatos indexados", total > 200, `${total}`);
ok("projeto marcado como indexado", !!proj.indexado_em, proj.indexado_em);

const caminhos = d
  .prepare("SELECT COUNT(DISTINCT caminho) n FROM projeto_conhecimento WHERE projeto_id=?")
  .get(proj.id).n;
ok("fatos vêm de vários arquivos", caminhos > 50, `${caminhos} arquivo(s)`);

// ─────────────────────────────── 2. SEGURANÇA — o teste que mais importa

secao("2. Segurança — nada de segredo entrou");

const negados = [
  ".env.local", ".env", ".env.local.exemplo",
];
for (const n of negados) {
  const achou = d
    .prepare("SELECT COUNT(*) n FROM projeto_conhecimento WHERE projeto_id=? AND caminho LIKE ?")
    .get(proj.id, `%${n}%`).n;
  ok(`${n} NÃO foi indexado`, achou === 0, achou ? `${achou} registros!` : "");
}

/**
 * O discriminador entre segredo e exemplo de documentação é o COMPRIMENTO, não
 * a presença do prefixo. `$aact_hmlg_...` num passo a passo é instrução ao
 * usuário; `$aact_` seguido de 150 caracteres é a chave de verdade. Casar só a
 * substring alarma no primeiro caso e treina a ignorar o alarme.
 */
const todos = d
  .prepare("SELECT caminho, titulo, corpo FROM projeto_conhecimento WHERE projeto_id=?")
  .all(proj.id);
const textoTodo = todos.map((r) => `${r.titulo}\n${r.corpo}`).join("\n");

const segredosReais = [
  ["chave Anthropic", /sk-ant-[A-Za-z0-9_-]{20,}/],
  ["token GitHub", /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/],
  ["chave AWS", /\bAKIA[0-9A-Z]{16}\b/],
  ["Stripe live", /\b(sk|rk)_live_[A-Za-z0-9]{20,}/],
  ["webhook Stripe", /\bwhsec_[A-Za-z0-9]{20,}/],
  ["chave Asaas", /\$aact_[A-Za-z0-9_=+/-]{40,}/],
  ["JWT completo", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ["chave privada", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["senha em URL", /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@]+:[^\s/@]{6,}@/i],
];

for (const [nome, re] of segredosReais) {
  const m = textoTodo.match(re);
  ok(`nenhum ${nome} no índice`, !m, m ? `ACHADO: ${m[0].slice(0, 24)}…` : "");
}

// Prefixos de documentação PODEM aparecer — isso é útil, não vazamento.
const prefixos = (textoTodo.match(/\$aact_(hmlg|prod)_/g) ?? []).length;
ok(
  "prefixo de exemplo em doc é preservado (é instrução, não segredo)",
  prefixos > 0,
  `${prefixos} ocorrência(s) de $aact_hmlg_ / $aact_prod_`,
);

// nome de variável PODE aparecer — é o comportamento correto
const nomesVar = d
  .prepare("SELECT COUNT(*) n FROM projeto_conhecimento WHERE projeto_id=? AND corpo LIKE '%ASAAS_API_KEY%'")
  .get(proj.id).n;
ok(
  "nome da variável ASAAS_API_KEY aparece (sem o valor)",
  nomesVar > 0,
  `${nomesVar} — o Jarvis sabe que a integração existe`,
);

// ─────────────────────────────── 3. incremental

secao("3. Mudança incremental (hash de conteúdo)");
const hashes = d
  .prepare("SELECT COUNT(DISTINCT tipo) n FROM projeto_conhecimento WHERE projeto_id=?")
  .get(proj.id).n;
ok("hashes distintos gravados", hashes > 50, `${hashes}`);
ok(
  "formato de hash correto",
  /^sha256:[0-9a-f]{16}$/.test(
    d.prepare("SELECT tipo FROM projeto_conhecimento WHERE projeto_id=? LIMIT 1").get(proj.id).tipo,
  ),
);

// ─────────────────────────────── 4. RECUPERAÇÃO — as perguntas do Cacique

secao("4. Recuperação — perguntas reais, resposta vinda do índice");

function perguntar(pergunta, termosFts, esperado) {
  const linhas = d
    .prepare(
      `SELECT p.titulo, p.corpo, p.caminho, bm25(projeto_conhecimento_fts) bm
         FROM projeto_conhecimento_fts
         JOIN projeto_conhecimento p ON p.rowid = projeto_conhecimento_fts.rowid
        WHERE projeto_conhecimento_fts MATCH ? AND p.projeto_id = ?
        ORDER BY bm LIMIT 4`,
    )
    .all(termosFts, proj.id);

  const juntou = linhas.map((l) => `${l.titulo} ${l.corpo}`).join(" ").toLowerCase();
  const bate = esperado.some((e) => juntou.includes(e.toLowerCase()));

  ok(`"${pergunta}"`, linhas.length > 0 && bate, linhas[0]?.caminho ?? "sem resultado");
  if (linhas.length) {
    console.log(`       → ${linhas[0].titulo}`);
    console.log(`       → fonte: ${linhas[0].caminho}`);
  }
  return linhas;
}

perguntar(
  "Qual API cuida do WhatsApp?",
  '"whatsapp"* OR "evolution"*',
  ["whatsapp", "evolution"],
);
perguntar(
  "Qual é o gateway de pagamento?",
  '"asaas"* OR "gateway"* OR "cakto"*',
  ["asaas", "cakto", "gateway"],
);
perguntar(
  "Qual banco de dados o Locatta usa?",
  '"supabase"* OR "postgres"* OR "rls"*',
  ["supabase", "rls", "postgres", "policy"],
);
perguntar(
  "Como funciona a autenticação?",
  '"sessao"* OR "auth"* OR "entrar"*',
  ["auth", "sessao", "entrar", "login"],
);
perguntar(
  "Quais decisões de segurança existem?",
  '"cripto"* OR "security"* OR "definer"*',
  ["cripto", "security", "definer", "rls"],
);
perguntar(
  "Como funciona a cobrança?",
  '"cobranca"* OR "cobrança"* OR "repasse"*',
  ["cobranca", "cobrança", "repasse", "financeiro"],
);
perguntar(
  "Existe job agendado?",
  '"cron"* OR "alertas"*',
  ["cron", "alerta"],
);
perguntar(
  "Qual serviço manda e-mail?",
  '"resend"* OR "email"*',
  ["resend", "email"],
);

// ─────────────────────────────── 5. separação

secao("5. Separação — conhecimento de projeto ≠ memória pessoal");

const memoriasComEvolution = d
  .prepare("SELECT COUNT(*) n FROM memorias WHERE corpo LIKE '%Evolution API%'")
  .get().n;
ok("fato de repositório NÃO virou memória pessoal", memoriasComEvolution === 0);

// Procurar a palavra "prefiro" no corpo não serve: documento de marketing é
// prosa e o Cacique escreve "prefiro X a Y" dentro dos próprios prompts. Isso
// é fato SOBRE o arquivo, com caminho, e o lugar dele é aqui mesmo. A
// invariante real é que nada saiu de memorias e entrou em conhecimento.
const memoriaCopiada = d
  .prepare(
    `SELECT COUNT(*) n FROM projeto_conhecimento c
       JOIN memorias m ON lower(trim(c.corpo)) = lower(trim(m.corpo))`,
  )
  .get().n;
ok("nenhuma memória foi copiada para conhecimento de repositório", memoriaCopiada === 0);

const semOrigem = d
  .prepare("SELECT COUNT(*) n FROM projeto_conhecimento WHERE caminho IS NULL OR trim(caminho)=''")
  .get().n;
ok("todo conhecimento de repositório tem arquivo de origem", semOrigem === 0);

// ─────────────────────────────── 6. auditoria

secao("6. Auditoria");
const aud = d
  .prepare("SELECT * FROM auditoria WHERE acao='projeto.indexar' ORDER BY quando DESC LIMIT 1")
  .get();
ok("indexação registrada na auditoria", !!aud, aud?.resultado);

console.log(`\n${"─".repeat(56)}`);
console.log(`PASSOU: ${passou}   FALHOU: ${falhou}`);
d.close();
if (falhou > 0) {
  console.log("RESULTADO: FALHOU");
  process.exit(1);
}
console.log("RESULTADO: TUDO PASSOU");
