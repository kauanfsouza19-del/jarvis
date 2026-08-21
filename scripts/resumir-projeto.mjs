/**
 * Gera o resumo canônico de um projeto a partir do índice — determinístico,
 * sem chamada de modelo.
 *
 *   node scripts/resumir-projeto.mjs LOCATTA
 *
 * O resumo entra em projetos.resumo e é o que vai no prompt quando o projeto
 * está ativo. Alvo: 400–600 tokens. O repositório inteiro nunca entra.
 */

import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

const nome = process.argv[2];
if (!nome) {
  console.error("uso: node scripts/resumir-projeto.mjs LOCATTA");
  process.exit(1);
}

const d = new DatabaseSync(join(process.cwd(), "dados", "jarvis.db"));
const p = d.prepare("SELECT * FROM projetos WHERE nome = ?").get(nome);
if (!p) {
  console.error(`projeto ${nome} não registrado`);
  process.exit(1);
}

const fatos = d
  .prepare("SELECT caminho, titulo, corpo FROM projeto_conhecimento WHERE projeto_id = ?")
  .all(p.id);

if (!fatos.length) {
  console.error(`nenhum fato indexado para ${nome}. Rode o indexador antes.`);
  process.exit(1);
}

const texto = fatos.map((f) => `${f.titulo}\n${f.corpo}`).join("\n");
const caminhos = [...new Set(fatos.map((f) => f.caminho))];

/** Só afirma o que aparece no índice. O que não aparece vira NÃO VERIFICADO. */
const achou = (re) => re.test(texto);
const contar = (re) => (texto.match(re) ?? []).length;

// stack — lido das dependências declaradas, que é a fonte de verdade
const linhaDeps = fatos.find((f) => f.titulo.startsWith("Dependências de"))?.corpo ?? "";
const stack = [];
if (/\bnext\b/.test(linhaDeps)) {
  stack.push(caminhos.some((c) => c.startsWith("src/app/")) ? "Next.js (App Router)" : "Next.js");
}
if (/\breact\b/.test(linhaDeps)) stack.push("React");
if (/typescript/.test(linhaDeps) || caminhos.some((c) => c.endsWith(".tsx"))) stack.push("TypeScript");
if (/@supabase/.test(linhaDeps) || achou(/supabase/i)) stack.push("Supabase (Postgres)");
if (/tailwind/.test(linhaDeps)) stack.push("Tailwind");

// integrações — só as que aparecem em uso real
const integracoes = [];
const marcas = [
  [/asaas/i, "Asaas (gateway de pagamento)"],
  [/\bcakto\b/i, "Cakto (assinatura do próprio produto)"],
  [/\bstripe\b/i, "Stripe (gateway alternativo)"],
  [/\bresend\b/i, "Resend (e-mail transacional)"],
  [/evolution/i, "Evolution API (WhatsApp por QR)"],
  [/graph\.facebook|meta cloud|whatsapp.*cloud/i, "Meta Cloud API (WhatsApp oficial)"],
  [/\bvercel\b/i, "Vercel (hospedagem)"],
  [/turnstile/i, "Cloudflare Turnstile"],
];
for (const [re, rotulo] of marcas) if (achou(re)) integracoes.push(rotulo);

// rotas de API
const rotasApi = fatos
  .filter((f) => f.titulo.startsWith("Rota de API"))
  .map((f) => f.titulo.replace("Rota de API ", ""));

// telas
const telas = fatos.filter((f) => f.titulo.startsWith("Tela ")).map((f) => f.titulo.slice(5));

// tabelas
const tabelas = new Set();
for (const f of fatos.filter((x) => x.titulo.startsWith("Tabelas em"))) {
  for (const bruto of f.corpo.replace(/^.*cria:\s*/, "").replace(/\.$/, "").split(/,\s*/)) {
    // Nome de tabela é identificador SQL. Conectivos de lista ("e", "and") e
    // fragmentos de frase não são — filtrar por forma, não por comprimento.
    const t = bruto.trim();
    if (/^[a-z][a-z0-9_]{2,38}$/.test(t) && !["and", "que", "com", "para"].includes(t)) {
      tabelas.add(t);
    }
  }
}

// jobs
const jobs = fatos.filter((f) => f.titulo.startsWith("Job agendado")).map((f) => f.corpo);

// segurança
const seguranca = [];
if (achou(/security\s+definer/i)) seguranca.push("funções SECURITY DEFINER para operações sistêmicas");
if (achou(/create\s+policy|política.*rls|politicas rls/i)) seguranca.push("RLS em tabelas de negócio");
if (achou(/aes-256-gcm|cripto/i)) seguranca.push("cifragem de credencial de terceiro (AES-256-GCM)");
if (achou(/cron_secret/i)) seguranca.push("cron protegido por CRON_SECRET");

const linhas = [];
linhas.push(`# ${p.nome} — resumo canônico`);
linhas.push("");
linhas.push(
  `Gerado do índice em ${new Date().toISOString().slice(0, 10)} a partir de ${fatos.length} fatos ` +
    `extraídos de ${caminhos.length} arquivos. Tudo abaixo é verificável no código; o que não ` +
    `aparece no índice está marcado como NÃO VERIFICADO.`,
);
linhas.push("");

linhas.push("## Stack");
linhas.push(stack.length ? stack.join(" · ") : "NÃO VERIFICADO");
linhas.push("");

linhas.push("## Integrações em uso");
linhas.push(integracoes.length ? integracoes.map((i) => `- ${i}`).join("\n") : "NÃO VERIFICADO");
linhas.push("");

linhas.push("## Superfície de API");
if (rotasApi.length) {
  const webhooks = rotasApi.filter((r) => r.includes("/webhook/"));
  const crons = rotasApi.filter((r) => r.includes("/cron/"));
  const outras = rotasApi.filter((r) => !r.includes("/webhook/") && !r.includes("/cron/"));
  linhas.push(`${rotasApi.length} rota(s):`);
  if (webhooks.length) linhas.push(`- webhooks: ${webhooks.join(", ")}`);
  if (crons.length) linhas.push(`- cron: ${crons.join(", ")}`);
  if (outras.length) linhas.push(`- demais: ${outras.slice(0, 8).join(", ")}`);
} else {
  linhas.push("NÃO VERIFICADO");
}
linhas.push("");

linhas.push("## Módulos do painel");
linhas.push(
  telas.length
    ? `${telas.length} tela(s). Principais: ${[
        ...new Set(telas.map((t) => t.split("/").slice(0, 3).join("/"))),
      ]
        .slice(0, 14)
        .join(", ")}`
    : "NÃO VERIFICADO",
);
linhas.push("");

linhas.push("## Banco");
linhas.push(
  tabelas.size
    ? `${tabelas.size} tabelas indexadas. Principais: ${[...tabelas].slice(0, 20).join(", ")}`
    : "NÃO VERIFICADO",
);
linhas.push("");

linhas.push("## Jobs agendados");
linhas.push(jobs.length ? jobs.map((j) => `- ${j}`).join("\n") : "NÃO VERIFICADO");
linhas.push("");

linhas.push("## Padrões de segurança");
linhas.push(seguranca.length ? seguranca.map((s) => `- ${s}`).join("\n") : "NÃO VERIFICADO");
linhas.push("");

linhas.push("## Modelo de negócio");
linhas.push(
  achou(/assinatura|recorren/i)
    ? "Assinatura recorrente do produto (Cakto), com gateway do cliente (Asaas/Stripe) por conta — DOCUMENTADO no repositório."
    : "NÃO VERIFICADO",
);
linhas.push("");

linhas.push("## Não verificado neste índice");
const faltando = [];
if (!achou(/preço|preco|R\$\s*\d/i)) faltando.push("preço da assinatura");
if (!achou(/cliente pagante|clientes ativos|mrr/i)) faltando.push("número de clientes pagantes e MRR");
if (!achou(/roadmap|backlog/i)) faltando.push("backlog e roadmap comercial atual");
faltando.push("estágio comercial atual (não é derivável de código)");
linhas.push(faltando.map((f) => `- ${f}`).join("\n"));

const resumo = linhas.join("\n");

d.prepare("UPDATE projetos SET resumo = ?, atualizado_em = datetime('now') WHERE id = ?").run(
  resumo,
  p.id,
);

const tokensAprox = Math.round(resumo.length / 3.6);
console.log(resumo);
console.log(`\n─── ${resumo.length} caracteres ≈ ${tokensAprox} tokens ───`);
if (tokensAprox > 700) console.log("AVISO: acima do alvo de 400–600 tokens.");

d.close();
