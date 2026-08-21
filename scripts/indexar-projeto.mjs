/**
 * Indexador de projeto — extração determinística, custo zero de modelo.
 *
 *   node scripts/indexar-projeto.mjs LOCATTA "C:\\caminho\\do\\projeto"
 *
 * O caminho vem da linha de comando ou de scripts/projetos.local.json — nunca
 * do banco. Caminho de máquina não é dado de aplicação.
 *
 * O projeto alvo é tratado como SOMENTE LEITURA. Este script nunca escreve,
 * move, renomeia ou apaga nada fora do banco do Jarvis.
 */

import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, extname, basename, sep } from "node:path";
import { createHash } from "node:crypto";

// ─────────────────────────────────────────── denylist

const CAMINHOS_NEGADOS = [
  /(^|\/)\.env($|\.|[^/]*$)/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /(^|\/)id_rsa/i,
  /(^|\/)id_ed25519/i,
  /(^|\/)credentials?/i,
  /(^|\/)secrets?/i,
  /(^|\/)service-account/i,
  /(^|\/)\.git(\/|$)/i,
  /(^|\/)\.npmrc$/i,
  /(^|\/)\.netrc$/i,
  /(^|\/)\.ssh\//i,
  /(^|\/)\.aws\//i,
  /(^|\/)node_modules(\/|$)/i,
  /(^|\/)\.next(\/|$)/i,
  /(^|\/)\.vercel(\/|$)/i,
  /(^|\/)\.netlify(\/|$)/i,
  /(^|\/)dist(\/|$)/i,
  /(^|\/)build(\/|$)/i,
  /(^|\/)coverage(\/|$)/i,
  /\.log$/i,
  /\.lock$/i,
  /package-lock\.json$/i,
  /tsconfig\.tsbuildinfo$/i,
];

// "token" e "secret" no nome do arquivo — conservador, como pedido.
const NOME_SUSPEITO = /(^|[-_.])(token|secret|senha|password|apikey|api-key)([-_.]|$)/i;

const EXT_TEXTO = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".sql", ".md", ".json", ".css", ".html", ".yml", ".yaml", ".toml",
]);

const LIMITE_BYTES = 400 * 1024;

// ─────────────────────────────────────────── redação de segredo

const PADROES = [
  [/sk-ant-[A-Za-z0-9_-]{20,}/g, "chave_anthropic"],
  [/\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, "token_github"],
  [/\bgithub_pat_[A-Za-z0-9_]{30,}/g, "token_github"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "chave_aws"],
  [/\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{20,}/g, "chave_stripe"],
  [/\bwhsec_[A-Za-z0-9]{20,}/g, "segredo_webhook"],
  [/\$aact_[A-Za-z0-9_=+/-]{40,}/g, "chave_asaas"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "jwt"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "chave_privada"],
  [/\b[a-z][a-z0-9+.-]*:\/\/[^\s/@]+:[^\s/@]{4,}@/gi, "senha_em_url"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, "token_slack"],
];

function redigir(texto) {
  let saida = texto;
  const achados = [];
  for (const [re, nome] of PADROES) {
    if (re.test(saida)) {
      achados.push(nome);
      saida = saida.replace(re, "[REDACTED]");
    }
    re.lastIndex = 0;
  }
  return { texto: saida, achados };
}

// ─────────────────────────────────────────── varredura

function negado(rel) {
  const p = rel.split(sep).join("/");
  if (CAMINHOS_NEGADOS.some((r) => r.test(p))) return "denylist";
  if (NOME_SUSPEITO.test(basename(p))) return "nome_suspeito";
  return null;
}

function varrer(raiz) {
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
      const rel = relative(raiz, abs);
      const motivo = negado(rel);
      if (motivo) {
        pulados.push({ rel, motivo });
        continue;
      }
      if (e.isDirectory()) {
        desce(abs);
      } else if (e.isFile()) {
        const ext = extname(e.name).toLowerCase();
        if (!EXT_TEXTO.has(ext)) {
          pulados.push({ rel, motivo: "binario_ou_nao_texto" });
          continue;
        }
        let tam = 0;
        try {
          tam = statSync(abs).size;
        } catch {
          continue;
        }
        if (tam > LIMITE_BYTES) {
          pulados.push({ rel, motivo: "grande_demais" });
          continue;
        }
        arquivos.push({ abs, rel: rel.split(sep).join("/"), tam });
      }
    }
  })(raiz);

  return { arquivos, pulados };
}

// ─────────────────────────────────────────── extração de fatos

/** Categoria a partir do caminho e do conteúdo — determinística. */
function categorizar(rel, conteudo) {
  const p = rel.toLowerCase();
  if (/^supabase\/.*\.sql$/.test(p) || /create table|alter table/i.test(conteudo)) return "DATABASE";
  if (/\/api\/webhook\//.test(p)) return "INTEGRACOES";
  if (/\/api\/cron\//.test(p)) return "SCHEDULER";
  if (/^src\/app\/api\//.test(p)) return "API";
  if (/auth|sessao|session|login|entrar/.test(p)) return "AUTENTICACAO";
  if (/cripto|seguranca|security/.test(p)) return "SEGURANCA";
  if (/asaas|stripe|cakto|gateway|pagamento|cobranca/.test(p)) return "PAGAMENTOS";
  if (/whatsapp|evolution/.test(p)) return "WHATSAPP";
  if (/resend|email|comunicac/.test(p)) return "EMAIL";
  if (/storage|upload|arquivo/.test(p)) return "STORAGE";
  if (/^testes\//.test(p) || /\.test\.[tj]sx?$/.test(p)) return "TESTES";
  if (/vercel\.json|netlify\.toml|deploy|publicar/.test(p)) return "DEPLOYMENT";
  if (/^site\/|lp-|landing|instagram_post|criativo/.test(p)) return "MARKETING";
  if (/\.md$/.test(p)) return "DOCUMENTACAO";
  if (/^src\/componentes\//.test(p) || /\.tsx$/.test(p)) return "FRONTEND";
  if (/^src\/lib\//.test(p)) return "BACKEND";
  return "ARQUITETURA";
}

/** Fatos verificáveis extraídos do conteúdo real — nunca do nome do arquivo. */
function extrairFatos(rel, conteudo, categoria) {
  const fatos = [];
  const add = (titulo, corpo, confianca = 0.9) =>
    fatos.push({ titulo, corpo, confianca, categoria, caminho: rel });

  // Rotas do App Router — a estrutura de pastas É a rota, mas confirmo que o
  // arquivo exporta um handler antes de afirmar que a rota existe.
  const m = rel.match(/^src\/app\/(.+)\/(route|page)\.tsx?$/);
  if (m) {
    const [, caminhoRota, tipo] = m;
    const metodos = [...conteudo.matchAll(/export\s+async\s+function\s+(GET|POST|PATCH|PUT|DELETE)/g)].map(
      (x) => x[1],
    );
    const rota = "/" + caminhoRota.replace(/\/\(([^)]+)\)/g, "").replace(/^\(([^)]+)\)\//, "");
    if (tipo === "route" && metodos.length) {
      add(
        `Rota de API ${rota}`,
        `O Locatta expõe ${rota} aceitando ${metodos.join(", ")}. Arquivo: ${rel}`,
      );
    } else if (tipo === "page") {
      add(`Tela ${rota}`, `Página do painel em ${rota}. Arquivo: ${rel}`, 0.85);
    }
  }

  // Tabelas e políticas RLS — do SQL real
  if (categoria === "DATABASE") {
    const tabelas = [...conteudo.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_.]+)/gi)].map(
      (x) => x[1].replace(/^public\./, ""),
    );
    if (tabelas.length) {
      add(
        `Tabelas em ${basename(rel)}`,
        `A migração ${rel} cria: ${[...new Set(tabelas)].join(", ")}.`,
      );
    }
    const policies = [...conteudo.matchAll(/create\s+policy\s+"?([a-z0-9_ ]+)"?\s+on\s+([a-z_.]+)/gi)];
    if (policies.length) {
      add(
        `Políticas RLS em ${basename(rel)}`,
        `${policies.length} política(s) RLS definida(s) em ${rel}, sobre: ${[
          ...new Set(policies.map((p) => p[2])),
        ].join(", ")}.`,
      );
    }
    const funcoes = [...conteudo.matchAll(/create\s+(?:or\s+replace\s+)?function\s+([a-z_.]+)/gi)].map(
      (x) => x[1],
    );
    if (funcoes.length) {
      add(
        `Funções de banco em ${basename(rel)}`,
        `Funções definidas: ${[...new Set(funcoes)].join(", ")}. Arquivo: ${rel}`,
      );
    }
    if (/security\s+definer/i.test(conteudo)) {
      add(
        `SECURITY DEFINER em ${basename(rel)}`,
        `${rel} usa funções SECURITY DEFINER — operações sistêmicas que rodam com privilégio elevado.`,
      );
    }
  }

  // Integrações — pelo uso real de variável de ambiente e URL, não pelo nome
  const envs = [...new Set([...conteudo.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((x) => x[1]))];
  if (envs.length) {
    add(
      `Variáveis de ambiente usadas em ${basename(rel)}`,
      `${rel} lê: ${envs.join(", ")}. (Nomes das variáveis — os valores nunca são indexados.)`,
      0.95,
    );
  }

  const hosts = [
    ...new Set(
      [...conteudo.matchAll(/https:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)]
        .map((x) => x[1].toLowerCase())
        .filter((h) => !/^(www\.)?(github|npmjs|nextjs|react|tailwind|w3|schema)\.(com|org|dev|io)$/.test(h)),
    ),
  ];
  if (hosts.length) {
    add(
      `Serviços externos chamados por ${basename(rel)}`,
      `${rel} faz requisição para: ${hosts.slice(0, 8).join(", ")}.`,
      0.9,
    );
  }

  // Dependências reais — o package.json é a fonte de verdade do stack
  if (/(^|\/)package\.json$/.test(rel)) {
    try {
      const pkg = JSON.parse(conteudo);
      const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
      if (deps.length) {
        add(
          `Dependências de ${rel}`,
          `O projeto declara: ${deps.join(", ")}. Versões em ${rel}.`,
          0.95,
        );
      }
      if (pkg.scripts) {
        add(
          `Scripts de ${rel}`,
          `Comandos disponíveis: ${Object.entries(pkg.scripts)
            .map(([k, v]) => `${k} (${v})`)
            .join("; ")}.`,
          0.95,
        );
      }
    } catch {
      /* package.json malformado — ignora em silêncio */
    }
  }

  // Cron declarado
  if (/vercel\.json$/.test(rel) && /"crons"/.test(conteudo)) {
    const crons = [...conteudo.matchAll(/"path"\s*:\s*"([^"]+)"[\s\S]{0,80}?"schedule"\s*:\s*"([^"]+)"/g)];
    for (const [, caminho, agenda] of crons) {
      add(`Job agendado ${caminho}`, `Cron em ${caminho} com agenda "${agenda}". Declarado em ${rel}.`);
    }
  }

  return fatos;
}

/** Extrai um trecho relevante de documentação para citação. */
function fatosDeDoc(rel, conteudo) {
  const fatos = [];
  const secoes = conteudo.split(/\n(?=#{1,3}\s)/);
  for (const s of secoes.slice(0, 40)) {
    const titulo = s.match(/^#{1,3}\s+(.+)/)?.[1]?.trim();
    if (!titulo) continue;
    const corpo = s.replace(/^#{1,3}\s+.+\n/, "").trim().slice(0, 900);
    if (corpo.length < 80) continue;
    fatos.push({
      titulo: `${titulo} — ${basename(rel)}`,
      corpo,
      confianca: 0.75, // documentado, não verificado em código
      categoria: "DOCUMENTACAO",
      caminho: rel,
    });
  }
  return fatos;
}

// ─────────────────────────────────────────── principal

const [, , nomeProjeto, caminhoArg] = process.argv;

if (!nomeProjeto) {
  console.error('uso: node scripts/indexar-projeto.mjs LOCATTA "C:\\\\caminho"');
  process.exit(1);
}

let raiz = caminhoArg;
if (!raiz) {
  const cfg = join(process.cwd(), "scripts", "projetos.local.json");
  if (existsSync(cfg)) raiz = JSON.parse(readFileSync(cfg, "utf8"))[nomeProjeto];
}
if (!raiz || !existsSync(raiz)) {
  console.error(`caminho não encontrado para ${nomeProjeto}: ${raiz ?? "(não informado)"}`);
  process.exit(1);
}

const inicio = Date.now();
const d = new DatabaseSync(join(process.cwd(), "dados", "jarvis.db"));
d.exec("PRAGMA foreign_keys = ON");

const projeto = d.prepare("SELECT id, nome, permissao FROM projetos WHERE nome = ?").get(nomeProjeto);
if (!projeto) {
  console.error(`projeto ${nomeProjeto} não está no registro. Rode a app uma vez para semear.`);
  process.exit(1);
}

console.log(`INDEXANDO ${projeto.nome} (${projeto.permissao})`);
console.log(`raiz: ${raiz}`);
console.log("modo: SOMENTE LEITURA — nada é escrito fora do banco do Jarvis\n");

const { arquivos, pulados } = varrer(raiz);
console.log(`descobertos: ${arquivos.length} arquivo(s) · pulados: ${pulados.length}`);

// hash do que já está indexado, para pular arquivo inalterado
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
const apagaDoArquivo = d.prepare(
  `DELETE FROM projeto_conhecimento WHERE projeto_id = ? AND caminho = ?`,
);

let indexados = 0;
let inalterados = 0;
let fatosGravados = 0;
let arquivosRedigidos = 0;
const deteccoes = new Map();
const porCategoria = new Map();
const erros = [];

for (const a of arquivos) {
  let bruto;
  try {
    bruto = readFileSync(a.abs, "utf8");
  } catch (e) {
    erros.push(`${a.rel}: ${e.message}`);
    continue;
  }

  const hash = "sha256:" + createHash("sha256").update(bruto).digest("hex").slice(0, 16);
  if (hashesAntigos.get(a.rel) === hash) {
    inalterados++;
    continue;
  }

  const { texto, achados } = redigir(bruto);
  if (achados.length) {
    arquivosRedigidos++;
    for (const n of achados) deteccoes.set(n, (deteccoes.get(n) ?? 0) + 1);
  }

  const categoria = categorizar(a.rel, texto);
  const fatos = a.rel.endsWith(".md")
    ? [...extrairFatos(a.rel, texto, categoria), ...fatosDeDoc(a.rel, texto)]
    : extrairFatos(a.rel, texto, categoria);

  if (!fatos.length) continue;

  apagaDoArquivo.run(projeto.id, a.rel);
  for (const f of fatos) {
    // segunda trava: nada com [REDACTED] indevido ou padrão residual entra
    const { texto: corpoLimpo, achados: residual } = redigir(f.corpo);
    if (residual.length) for (const n of residual) deteccoes.set(n, (deteccoes.get(n) ?? 0) + 1);

    insere.run(
      crypto.randomUUID(),
      projeto.id,
      a.rel,
      f.titulo,
      corpoLimpo,
      hash, // o campo `tipo` carrega o hash do arquivo — usado na detecção de mudança
      f.confianca,
    );
    fatosGravados++;
    porCategoria.set(f.categoria, (porCategoria.get(f.categoria) ?? 0) + 1);
  }
  indexados++;
}

d.prepare(
  `UPDATE projetos SET indexado_em = datetime('now'), arquivos = ?, atualizado_em = datetime('now') WHERE id = ?`,
).run(arquivos.length, projeto.id);

d.prepare(
  `INSERT INTO auditoria (id, projeto_id, acao, resultado, impacto) VALUES (?,?,?,?,?)`,
).run(
  crypto.randomUUID(),
  projeto.id,
  "projeto.indexar",
  `${fatosGravados} fatos de ${indexados} arquivo(s)`,
  `${pulados.length} pulados, ${arquivosRedigidos} redigidos`,
);

const duracao = ((Date.now() - inicio) / 1000).toFixed(1);

console.log("\n─── SAÚDE DO ÍNDICE ───");
console.log(`arquivos descobertos : ${arquivos.length}`);
console.log(`arquivos indexados   : ${indexados}`);
console.log(`inalterados (pulados): ${inalterados}`);
console.log(`negados/ignorados    : ${pulados.length}`);
console.log(`arquivos redigidos   : ${arquivosRedigidos}`);
console.log(`fatos gravados       : ${fatosGravados}`);
console.log(`duração              : ${duracao}s`);
console.log(`erros                : ${erros.length}`);

if (deteccoes.size) {
  console.log("\ndetecções de segredo (redigidas antes de persistir):");
  for (const [n, q] of deteccoes) console.log(`  ${n}: ${q}`);
} else {
  console.log("\nnenhum padrão de segredo encontrado nos arquivos permitidos");
}

console.log("\npor categoria:");
for (const [c, q] of [...porCategoria].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${c.padEnd(16)} ${q}`);
}

const motivos = new Map();
for (const p of pulados) motivos.set(p.motivo, (motivos.get(p.motivo) ?? 0) + 1);
console.log("\nmotivos de exclusão:");
for (const [m, q] of [...motivos].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${m.padEnd(22)} ${q}`);
}

if (erros.length) {
  console.log("\nerros:");
  for (const e of erros.slice(0, 10)) console.log(`  ${e}`);
}

d.close();
