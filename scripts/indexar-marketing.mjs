/**
 * Indexador de marketing — extração determinística, custo zero de modelo.
 *
 *   node scripts/indexar-marketing.mjs MARKETING
 *   node scripts/indexar-marketing.mjs CLIENTES
 *
 * Trata o diretório alvo como SOMENTE LEITURA.
 *
 * Duas regras que valem mais que o volume indexado:
 *   1. Material de concorrente é marcado REFERENCIA_EXTERNA, nunca como
 *      criativo nosso.
 *   2. LP/criativo antigo é marcado HISTORICO. Posicionamento velho virando
 *      "estratégia atual" é o erro mais caro que um índice de marketing pode
 *      cometer.
 */

import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, extname, basename, sep } from "node:path";
import { createHash } from "node:crypto";
import { negado, redigir, redigirPessoais } from "./lib/seguranca.mjs";

const EXT_TEXTO = new Set([".md", ".html", ".txt", ".json", ".js", ".ts", ".css", ".xml"]);
const EXT_BINARIO_UTIL = new Set([".png", ".jpg", ".jpeg", ".webp", ".mp4", ".pdf", ".pptx", ".docx"]);
const LIMITE = 500 * 1024;

/* ══════════════════════ classificação ══════════════════════ */

/**
 * Marca de referência externa — material de concorrente ou de terceiro.
 *
 * Só TÍTULO e CAMINHO decidem. Menção no corpo não decide: "O mercado começa
 * em R$ 199" é criativo nosso que cita preço de concorrente, e rotulá-lo de
 * externo erra tanto quanto deixar anúncio de concorrente passar por nosso.
 * Quem declara a propriedade do bloco é o cabeçalho, não uma citação dentro
 * dele.
 */
const SINAIS_EXTERNOS = [
  /biblioteca de an[úu]ncios/i,
  /concorrent/i,
  /an[áa]lise de concorr/i,
  /refer[êe]ncia externa/i,
  /benchmark/i,
  /pesquisa de mercado/i,
  /o que .{0,24}(est[ãa]o rodando|rodam)/i,
  /mesmo playbook/i,
];

/** Pasta de pesquisa guarda material sobre terceiros — o arquivo inteiro é externo. */
const CAMINHOS_EXTERNOS = [
  /(^|\/)research(\/|$)/i,
  /(^|\/)pesquisa(s)?(\/|$)/i,
  /(^|\/)concorrent[^/]*(\/|$)/i,
  /(^|\/)benchmark[^/]*(\/|$)/i,
];

const caminhoExterno = (rel) =>
  CAMINHOS_EXTERNOS.some((r) => r.test(rel.split("\\").join("/")));

/**
 * Cabeçalho de tabela com coluna "Concorrente" / "Player" / "Competidor".
 * Isso é declaração estrutural — a seção existe para comparar terceiros —, e
 * não a mesma coisa que citar um concorrente no meio de um texto de anúncio.
 */
const TABELA_COMPARATIVA = /^\s*\|[^\n]*\b(concorrente|competidor|player)s?\b[^\n]*\|/im;

/** Categoria por caminho e conteúdo. */
function categorizar(rel, conteudo, ext) {
  const p = rel.toLowerCase();
  if (/vsl|roteiro.*vsl|roteiro_vsl/.test(p)) return "VSL";
  if (/^roteiros\//.test(p) || /roteiro/.test(p)) return "ROTEIRO";
  if (/^lp-|landing|^index.*\.html$/.test(basename(p))) return "LP";
  if (/instagram_post|^instagram\//.test(p)) return "SOCIAL";
  if (/criativo|^creative\/|imagens insta/.test(p)) return "CRIATIVO";
  if (/^youtube\//.test(p)) return "YOUTUBE";
  if (/^estrategia\/|plano_lancamento|melhores_praticas|analise_funil/.test(p)) return "ESTRATEGIA";
  if (/contrato|proposta|lgpd/.test(p)) return "COMERCIAL";
  if (/prompt_|prompts_/.test(p)) return "PROMPT";
  if (/^site\//.test(p)) return "SITE";
  if (ext === ".md") return "DOCUMENTACAO";
  return "MATERIAL";
}

/**
 * CURRENT vs HISTORICAL.
 *
 * Critério declarado: dentro de uma família de arquivos com o mesmo prefixo
 * (ex.: lp-locatta-dor*), o mais recentemente modificado é o corrente; os
 * demais são históricos. Isso é um critério de DATA, não uma afirmação de que
 * o arquivo reflete o posicionamento atual do negócio — o código não estabelece
 * isso, e o índice não vai fingir que estabelece.
 */
function familia(rel) {
  const nome = basename(rel).toLowerCase().replace(/\.(html|md|txt)$/, "");
  return nome
    .replace(/-(premium|custom|old|final|v\d+|novo|antigo|copy|\d+)$/g, "")
    .replace(/-(premium|custom|old)-/g, "-");
}

/* ══════════════════════ extração ══════════════════════ */

const semTags = (h) =>
  h
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

function extrairLP(rel, html) {
  const fatos = [];
  const title = /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim();
  const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => semTags(m[1]));
  const h2s = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) => semTags(m[1]));
  const ctas = [
    ...new Set(
      [...html.matchAll(/<(?:a|button)[^>]*>([\s\S]{2,60}?)<\/(?:a|button)>/gi)]
        .map((m) => semTags(m[1]))
        .filter((t) => t.length > 3 && t.length < 60 && /[a-záéíóúãõç]/i.test(t)),
    ),
  ];
  const precos = [...new Set([...html.matchAll(/R\$\s?[\d.,]+/g)].map((m) => m[0]))];

  if (title || h1s.length) {
    fatos.push({
      titulo: `LP · ${basename(rel)}`,
      corpo:
        `Título: ${title ?? "UNKNOWN"}. ` +
        `Headline: ${h1s[0] ?? "UNKNOWN"}. ` +
        (h1s.length > 1 ? `Outras H1: ${h1s.slice(1, 3).join(" | ")}. ` : "") +
        `Arquivo: ${rel}`,
      categoria: "LP",
      natureza: "FATO",
    });
  }
  if (h2s.length) {
    fatos.push({
      titulo: `Seções da LP · ${basename(rel)}`,
      corpo: `${h2s.length} seção(ões): ${h2s.slice(0, 12).join(" | ")}. Arquivo: ${rel}`,
      categoria: "LP",
      natureza: "FATO",
    });
  }
  if (ctas.length) {
    fatos.push({
      titulo: `CTAs da LP · ${basename(rel)}`,
      corpo: `Chamadas encontradas: ${ctas.slice(0, 10).join(" | ")}. Arquivo: ${rel}`,
      categoria: "LP",
      natureza: "FATO",
    });
  }
  if (precos.length) {
    fatos.push({
      titulo: `Preço exibido na LP · ${basename(rel)}`,
      corpo: `Valores no HTML: ${[...precos].slice(0, 8).join(", ")}. Arquivo: ${rel}`,
      categoria: "LP",
      natureza: "FATO",
    });
  }
  return fatos;
}

function extrairMarkdown(rel, md, categoria) {
  const fatos = [];
  const secoes = md.split(/\n(?=#{1,3}\s)/);

  // Marcação de externo HERDA pela hierarquia de títulos. Sem isso, um bloco
  // "## O que os concorrentes estão rodando" marca só a si mesmo e os "###"
  // aninhados abaixo dele (Imobia, Devolus, Si9) entram como criativo NOSSO —
  // que é exatamente o erro de atribuir material de concorrente à casa.
  // A herança cai quando aparece um título de nível igual ou mais raso.
  const arquivoExterno = caminhoExterno(rel);
  let nivelExterno = 0;

  for (const s of secoes.slice(0, 60)) {
    const cab = /^(#{1,3})\s+(.+)/.exec(s);
    if (!cab) continue;
    const nivel = cab[1].length;
    const tituloBruto = cab[2].trim();

    // remove emoji do título sem quebrar acentos
    const titulo = tituloBruto.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "").trim();
    const corpo = s.replace(/^#{1,3}\s+.+\n/, "").trim();

    if (nivelExterno && nivel <= nivelExterno) nivelExterno = 0;

    // H1 é título do documento, não declaração de bloco: um arquivo chamado
    // "pesquisa de concorrentes + proposta" tem as duas coisas dentro, e deixar
    // o H1 propagar marcaria a proposta inteira — nossa — como de terceiro.
    // Só H2+ abre bloco herdado.
    const proprio =
      SINAIS_EXTERNOS.some((r) => r.test(titulo)) || TABELA_COMPARATIVA.test(corpo);
    if (proprio && !nivelExterno && nivel > 1) nivelExterno = nivel;

    const externo = arquivoExterno || proprio || nivelExterno > 0;

    if (corpo.length < 60) continue;

    fatos.push({
      titulo: `${titulo} — ${basename(rel)}`,
      corpo: corpo.slice(0, 1100),
      categoria: externo ? "REFERENCIA_EXTERNA" : categoria,
      natureza: externo ? "REFERENCIA_EXTERNA" : "DOCUMENTADO",
    });
  }
  return fatos;
}

/** Métrica só é registrada quando aparece com número no texto. */
function extrairMetricas(rel, texto) {
  const fatos = [];
  const achados = [];
  const padroes = [
    [/\bCTR\b[^.\n]{0,30}?(\d+[.,]?\d*)\s*%/gi, "CTR"],
    [/\bCPC\b[^.\n]{0,30}?R\$\s?([\d.,]+)/gi, "CPC"],
    [/\bCPM\b[^.\n]{0,30}?R\$\s?([\d.,]+)/gi, "CPM"],
    [/\bCPA\b[^.\n]{0,30}?R\$\s?([\d.,]+)/gi, "CPA"],
    [/\bCPL\b[^.\n]{0,30}?R\$\s?([\d.,]+)/gi, "CPL"],
    [/\bROAS\b[^.\n]{0,30}?(\d+[.,]?\d*)/gi, "ROAS"],
  ];
  for (const [re, nome] of padroes) {
    for (const m of texto.matchAll(re)) achados.push(`${nome}=${m[1]}`);
  }
  if (achados.length) {
    fatos.push({
      titulo: `Métricas citadas em ${basename(rel)}`,
      corpo: `${[...new Set(achados)].join(", ")}. Origem: ${rel}. Sem data na fonte — não confundir com dado de conta.`,
      categoria: "METRICA",
      natureza: "DOCUMENTADO",
    });
  }
  return fatos;
}

/** Ativos binários — registra existência e metadado, nunca conteúdo. */
function fatoDeAtivo(rel, tam, ext) {
  const tipo =
    ext === ".mp4" ? "vídeo" : ext === ".pdf" ? "PDF" : ext === ".pptx" ? "apresentação" : ext === ".docx" ? "documento" : "imagem";
  return {
    titulo: `Ativo · ${basename(rel)}`,
    corpo: `${tipo} de ${Math.round(tam / 1024)} KB em ${rel}. Conteúdo binário não indexado — apenas a existência do ativo.`,
    categoria: "ATIVO",
    natureza: "FATO",
  };
}

/* ══════════════════════ varredura ══════════════════════ */

function varrer(raiz, excluir = []) {
  const arquivos = [];
  const pulados = [];

  (function desce(dir) {
    let entradas;
    try {
      entradas = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entradas) {
      const abs = join(dir, e.name);
      const rel = relative(raiz, abs).split(sep).join("/");

      if (excluir.some((x) => rel === x || rel.startsWith(x + "/"))) {
        pulados.push({ rel, motivo: "excluido_explicitamente" });
        continue;
      }
      const motivo = negado(rel);
      if (motivo) {
        pulados.push({ rel, motivo });
        continue;
      }
      if (e.isDirectory()) {
        desce(abs);
        continue;
      }
      if (!e.isFile()) continue;

      const ext = extname(e.name).toLowerCase();
      let tam = 0;
      let mtime = 0;
      try {
        const st = statSync(abs);
        tam = st.size;
        mtime = st.mtimeMs;
      } catch {
        continue;
      }

      if (EXT_BINARIO_UTIL.has(ext)) {
        arquivos.push({ abs, rel, tam, mtime, ext, binario: true });
        continue;
      }
      if (!EXT_TEXTO.has(ext)) {
        pulados.push({ rel, motivo: "tipo_nao_suportado" });
        continue;
      }
      if (tam > LIMITE) {
        pulados.push({ rel, motivo: "grande_demais" });
        continue;
      }
      arquivos.push({ abs, rel, tam, mtime, ext, binario: false });
    }
  })(raiz);

  return { arquivos, pulados };
}

/* ══════════════════════ principal ══════════════════════ */

const args = process.argv.slice(2);
// Hash é do CONTEÚDO do arquivo. Quando o extrator muda e os arquivos não,
// o incremental pula tudo e o índice fica preso na regra antiga — daí --forcar.
const forcar = args.includes("--forcar");
const posicionais = args.filter((a) => !a.startsWith("--"));

const nomeProjeto = posicionais[0];
if (!nomeProjeto) {
  console.error("uso: node scripts/indexar-marketing.mjs MARKETING [raiz] [--forcar]");
  process.exit(1);
}

const cfg = JSON.parse(readFileSync(join(process.cwd(), "scripts", "projetos.local.json"), "utf8"));
const raiz = posicionais[1] ?? cfg[nomeProjeto];
if (!raiz || !existsSync(raiz)) {
  console.error(`caminho não configurado para ${nomeProjeto}`);
  process.exit(1);
}

// locatta-saas já é o projeto LOCATTA — não duplicar aqui
const EXCLUIR = nomeProjeto === "MARKETING" ? ["locatta-saas"] : [];

const inicio = Date.now();
const d = new DatabaseSync(join(process.cwd(), "dados", "jarvis.db"));
d.exec("PRAGMA foreign_keys = ON");

const projeto = d.prepare("SELECT id, nome, permissao FROM projetos WHERE nome = ?").get(nomeProjeto);
if (!projeto) {
  console.error(`projeto ${nomeProjeto} não registrado`);
  process.exit(1);
}

console.log(`INDEXANDO ${projeto.nome} (${projeto.permissao})`);
console.log(`raiz: ${raiz}`);
console.log("modo: SOMENTE LEITURA\n");

const { arquivos, pulados } = varrer(raiz, EXCLUIR);

// famílias, para decidir corrente vs histórico por data
const porFamilia = new Map();
for (const a of arquivos.filter((x) => !x.binario)) {
  const f = familia(a.rel);
  const atual = porFamilia.get(f);
  if (!atual || a.mtime > atual.mtime) porFamilia.set(f, a);
}
const correntes = new Set([...porFamilia.values()].map((a) => a.rel));

const hashesAntigos = new Map(
  d
    .prepare(
      `SELECT caminho, MAX(tipo) AS hash FROM projeto_conhecimento
        WHERE projeto_id = ? AND caminho IS NOT NULL GROUP BY caminho`,
    )
    .all(projeto.id)
    .map((r) => [r.caminho, r.hash]),
);

const insere = d.prepare(
  `INSERT INTO projeto_conhecimento (id, projeto_id, caminho, titulo, corpo, tipo, confianca)
   VALUES (?,?,?,?,?,?,?)`,
);
const apaga = d.prepare(`DELETE FROM projeto_conhecimento WHERE projeto_id = ? AND caminho = ?`);

let indexados = 0,
  inalterados = 0,
  fatosGravados = 0,
  redigidos = 0;
const deteccoes = new Map();
const porCategoria = new Map();
const porEstado = new Map();
const erros = [];

for (const a of arquivos) {
  const hash =
    "sha256:" +
    createHash("sha256")
      .update(a.binario ? `${a.rel}:${a.tam}:${a.mtime}` : readFileSync(a.abs))
      .digest("hex")
      .slice(0, 16);

  if (!forcar && hashesAntigos.get(a.rel) === hash) {
    inalterados++;
    continue;
  }

  let fatos = [];
  try {
    if (a.binario) {
      fatos = [fatoDeAtivo(a.rel, a.tam, a.ext)];
    } else {
      const bruto = readFileSync(a.abs, "utf8");
      const r1 = redigir(bruto);
      const r2 = redigirPessoais(r1.texto);
      const texto = r2.texto;
      const achados = [...r1.achados, ...r2.achados];

      if (achados.length) {
        redigidos++;
        for (const n of achados) deteccoes.set(n, (deteccoes.get(n) ?? 0) + 1);
      }

      const categoria = categorizar(a.rel, texto, a.ext);
      if (a.ext === ".html") {
        fatos = [...extrairLP(a.rel, texto), ...extrairMetricas(a.rel, semTags(texto))];
      } else if (a.ext === ".md" || a.ext === ".txt") {
        fatos = [...extrairMarkdown(a.rel, texto, categoria), ...extrairMetricas(a.rel, texto)];
      }
    }
  } catch (e) {
    erros.push(`${a.rel}: ${e.message}`);
    continue;
  }

  if (!fatos.length) continue;

  const estado = a.binario
    ? "ATIVO"
    : correntes.has(a.rel)
      ? "CORRENTE"
      : "HISTORICO";

  apaga.run(projeto.id, a.rel);
  for (const f of fatos) {
    const limpo = redigir(f.corpo).texto;
    const marcado =
      f.categoria === "REFERENCIA_EXTERNA"
        ? `[REFERENCIA_EXTERNA] ${limpo}`
        : estado === "HISTORICO"
          ? `[HISTORICO] ${limpo}`
          : limpo;

    insere.run(
      crypto.randomUUID(),
      projeto.id,
      a.rel,
      `[${f.categoria}] ${f.titulo}`,
      marcado,
      hash,
      f.categoria === "REFERENCIA_EXTERNA" ? 0.6 : estado === "HISTORICO" ? 0.5 : 0.85,
    );
    fatosGravados++;
    porCategoria.set(f.categoria, (porCategoria.get(f.categoria) ?? 0) + 1);
    porEstado.set(estado, (porEstado.get(estado) ?? 0) + 1);
  }
  indexados++;
}

d.prepare(
  `UPDATE projetos SET indexado_em = datetime('now'), arquivos = ?, atualizado_em = datetime('now') WHERE id = ?`,
).run(arquivos.length, projeto.id);

d.prepare(`INSERT INTO auditoria (id, projeto_id, acao, resultado, impacto) VALUES (?,?,?,?,?)`).run(
  crypto.randomUUID(),
  projeto.id,
  "marketing.indexar",
  `${fatosGravados} fatos de ${indexados} arquivo(s)`,
  `${pulados.length} pulados, ${redigidos} redigidos`,
);

const dur = ((Date.now() - inicio) / 1000).toFixed(1);

console.log("─── SAÚDE DO ÍNDICE ───");
console.log(`descobertos     : ${arquivos.length}`);
console.log(`indexados       : ${indexados}`);
console.log(`inalterados     : ${inalterados}`);
console.log(`ignorados       : ${pulados.length}`);
console.log(`redigidos       : ${redigidos}`);
console.log(`fatos gravados  : ${fatosGravados}`);
console.log(`duração         : ${dur}s`);
console.log(`erros           : ${erros.length}`);

console.log(
  deteccoes.size
    ? `\ndetecções redigidas: ${[...deteccoes].map(([n, q]) => `${n}×${q}`).join(", ")}`
    : "\nnenhum padrão de segredo nos arquivos permitidos",
);

console.log("\npor categoria:");
for (const [c, q] of [...porCategoria].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${c.padEnd(20)} ${q}`);
}

console.log("\npor estado:");
for (const [e, q] of [...porEstado].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${e.padEnd(20)} ${q}`);
}

const motivos = new Map();
for (const p of pulados) motivos.set(p.motivo, (motivos.get(p.motivo) ?? 0) + 1);
console.log("\nmotivos de exclusão:");
for (const [m, q] of [...motivos].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${m.padEnd(24)} ${q}`);
}

if (erros.length) {
  console.log("\nerros:");
  for (const e of erros.slice(0, 8)) console.log(`  ${e}`);
}

d.close();
