import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, readdir, stat, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, resolve, sep, dirname } from "node:path";
import { arquivoBloqueado, exigirSemSegredo } from "../seguranca/denylist";

/**
 * Tools de código (Fase 20 — missão de agente) — a fronteira que faz o
 * Jarvis capaz de INSPECIONAR e VERIFICAR o próprio repositório sem
 * expor execução arbitrária ao modelo. Mesma disciplina de segurança já
 * estabelecida em obsidian/sync-git.ts: `execFile` com array de
 * argumentos, nunca string de shell interpolada — comando e argumento
 * nunca se misturam, então não existe injeção possível via texto que o
 * modelo decida colocar num parâmetro.
 *
 * Escopo original (Fase 20) era só-leitura/só-verificação. Fase 22
 * acrescenta UMA Tool de escrita (`escreverArquivoProjeto`) — nunca
 * exposta direto ao modelo sem aprovação: é registrada em
 * ferramentas/registro.ts com `exigeAprovacaoExplicita: true`, então o
 * executor de Plano (jobs/handlers/plano-orquestrado.ts) sempre para em
 * AGUARDANDO_APROVACAO antes de rodar, e só prossegue depois de
 * aprovação explícita do Cacique via /api/aprovacoes (ver motor.ts,
 * responderAprovacao — o passo específico é retomado por
 * plano_passo_id, nunca "toda Tool desse nome fica aprovada"). Escreve
 * o arquivo INTEIRO (substituição completa, não patch parcial) — mais
 * simples de raciocinar sobre correção que aplicar um diff arbitrário, e
 * o `git diff` real depois de escrever já é a evidência do que mudou.
 *
 * RAIZ (achado real, Fase 20): em dev, `process.cwd()` já É o checkout
 * completo do repositório (código + .git + testes). Em produção, o
 * container roda a imagem MÍNIMA (Dockerfile, Fase 15/16 — só
 * node_modules podado + .next compilado, de propósito, pra não copiar
 * `dados/` real pro artefato) — sem `src/`, sem `testes/`, sem `.git`.
 * `JARVIS_REPO_PATH` aponta pro bind-mount somente-leitura do checkout
 * real do host (/root/jarvis, o mesmo usado pelo deploy) quando definido;
 * sem a variável, cai em `process.cwd()` (dev local, comportamento
 * inalterado). Nunca cria/edita nada nesse mount — só leitura/inspeção.
 */

const execFileAsync = promisify(execFile);
const RAIZ = process.env.JARVIS_REPO_PATH ?? process.cwd();

/** Fronteira de path — nunca deixa sair da raiz do repositório, mesmo com "../../../etc/passwd". */
function resolverDentroDoRepo(caminhoRelativo: string): string {
  const alvo = resolve(RAIZ, caminhoRelativo);
  if (alvo !== RAIZ && !alvo.startsWith(RAIZ + sep)) {
    throw new Error("caminho fora da raiz do repositório");
  }
  return alvo;
}

const DIRETORIOS_IGNORADOS = new Set(["node_modules", ".git", ".next", "dados", ".vscode"]);

/** Nunca deixa segredo/credencial/binário de banco ser lido, mesmo que o pedido pareça inocente. */
const PADROES_BLOQUEADOS = [/^\.env/i, /\.key$/i, /\.pem$/i, /\.secret$/i, /\.db$/i, /\.sqlite$/i, /^dados[/\\]/i];

function caminhoBloqueado(caminhoRelativo: string): boolean {
  const normalizado = caminhoRelativo.replace(/^[/\\]+/, "");
  return PADROES_BLOQUEADOS.some((p) => p.test(normalizado));
}

export type ArquivoListado = { caminho: string; tipo: "arquivo" | "pasta" };

/** Lista arquivos/pastas de um diretório do projeto — não recursivo por padrão (o modelo pede de novo pra descer, nunca despeja a árvore inteira num prompt). */
export async function listarArquivosProjeto(pastaRelativa = "."): Promise<ArquivoListado[]> {
  const alvo = resolverDentroDoRepo(pastaRelativa);
  const entradas = await readdir(alvo, { withFileTypes: true });
  return entradas
    .filter((e) => !DIRETORIOS_IGNORADOS.has(e.name) && !e.name.startsWith("."))
    .map((e) => ({
      caminho: join(pastaRelativa === "." ? "" : pastaRelativa, e.name).replace(/\\/g, "/"),
      tipo: e.isDirectory() ? ("pasta" as const) : ("arquivo" as const),
    }))
    .sort((a, b) => (a.tipo === b.tipo ? a.caminho.localeCompare(b.caminho) : a.tipo === "pasta" ? -1 : 1));
}

const LIMITE_BYTES_ARQUIVO = 60_000;

/** Lê um arquivo de texto do projeto — nunca segredo/binário de banco, sempre truncado a um teto (o modelo pede um trecho maior, nunca recebe megabyte cru sem pedir). */
export async function lerArquivoProjeto(caminhoRelativo: string): Promise<{ conteudo: string; truncado: boolean; tamanhoBytes: number }> {
  if (caminhoBloqueado(caminhoRelativo)) throw new Error("leitura bloqueada — arquivo de segredo/dado, nunca exposto a Tool");
  const alvo = resolverDentroDoRepo(caminhoRelativo);
  const info = await stat(alvo);
  if (!info.isFile()) throw new Error("caminho não é um arquivo");
  const bruto = await readFile(alvo, "utf8");
  const truncado = bruto.length > LIMITE_BYTES_ARQUIVO;
  return { conteudo: truncado ? bruto.slice(0, LIMITE_BYTES_ARQUIVO) : bruto, truncado, tamanhoBytes: info.size };
}

const EXTENSOES_EDITAVEIS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".json", ".md", ".mdx", ".css", ".yml", ".yaml", ".txt"]);
const LIMITE_BYTES_ESCRITA = 200_000;

export type ResultadoEscrita = {
  caminho: string;
  criouArquivoNovo: boolean;
  bytesAntes: number | null;
  bytesDepois: number;
  conteudoAnterior: string | null; // null só quando é arquivo novo — evidência pra quem revisa antes de aprovar
};

/**
 * Escreve o conteúdo INTEIRO de um arquivo de texto do repositório —
 * substituição completa, nunca patch parcial (ver nota no topo do
 * arquivo). Sempre chamada só DEPOIS de aprovação explícita (a Tool que
 * a expõe tem `exigeAprovacaoExplicita: true`; ninguém deveria chamar
 * esta função diretamente fora desse caminho). Três fronteiras
 * independentes, todas obrigatórias:
 *
 * 1. path — nunca sai da raiz (resolverDentroDoRepo), nunca em cima de
 *    segredo/credencial/banco (caminhoBloqueado local + arquivoBloqueado
 *    compartilhado com o indexador, mais abrangente — as duas rodam,
 *    nenhuma sozinha é suficiente).
 * 2. extensão — só tipos de texto/código conhecidos (EXTENSOES_EDITAVEIS);
 *    nunca binário, nunca lockfile, nunca dentro de node_modules/.git.
 * 3. conteúdo — nunca escreve um valor que pareça segredo real
 *    (exigirSemSegredo, o mesmo filtro que já protege a memória do
 *    Jarvis desde a Fase 9) — proteção mesmo que o modelo, por engano,
 *    tente colar uma chave de API dentro de um arquivo de código.
 */
export async function escreverArquivoProjeto(caminhoRelativo: string, conteudo: string): Promise<ResultadoEscrita> {
  if (caminhoBloqueado(caminhoRelativo) || arquivoBloqueado(caminhoRelativo)) {
    throw new Error("escrita bloqueada — caminho de segredo/dado/dependência, nunca escrito por Tool");
  }
  const ext = caminhoRelativo.slice(caminhoRelativo.lastIndexOf(".")).toLowerCase();
  if (!EXTENSOES_EDITAVEIS.has(ext)) {
    throw new Error(`escrita bloqueada — extensão "${ext}" fora da allowlist de tipos editáveis`);
  }
  if (conteudo.length > LIMITE_BYTES_ESCRITA) {
    throw new Error(`conteúdo excede o limite de ${LIMITE_BYTES_ESCRITA} bytes por escrita`);
  }
  exigirSemSegredo(conteudo, `escreverArquivoProjeto:${caminhoRelativo}`);

  const alvo = resolverDentroDoRepo(caminhoRelativo);
  const jaExistia = existsSync(alvo);
  let conteudoAnterior: string | null = null;
  let bytesAntes: number | null = null;
  if (jaExistia) {
    const info = await stat(alvo);
    if (!info.isFile()) throw new Error("caminho existe mas não é um arquivo");
    conteudoAnterior = await readFile(alvo, "utf8");
    bytesAntes = info.size;
  } else {
    await mkdir(dirname(alvo), { recursive: true });
  }

  await writeFile(alvo, conteudo, "utf8");
  const infoDepois = await stat(alvo);

  return {
    caminho: caminhoRelativo,
    criouArquivoNovo: !jaExistia,
    bytesAntes,
    bytesDepois: infoDepois.size,
    conteudoAnterior,
  };
}

/** Allowlist deliberada — só os testes puros (sem servidor HTTP, sem rede, sem escrita concorrente no mesmo banco) rodam via Tool autônoma. Suite completa/testes de rede continuam manuais (ver relatório final). */
const TESTES_PERMITIDOS = new Set([
  "contexto.mjs",
  "ferramentas-tipos.mjs",
  "modelo-validacao.mjs",
  "modelo-registro.mjs",
  "roteador.mjs",
]);

export type ResultadoComando = { sucesso: boolean; saida: string; codigoSaida: number | null };

async function rodar(comando: string, args: string[], timeoutMs: number): Promise<ResultadoComando> {
  try {
    const { stdout, stderr } = await execFileAsync(comando, args, { cwd: RAIZ, timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 });
    return { sucesso: true, saida: (stdout + stderr).slice(-8000), codigoSaida: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; code?: number };
    const saida = `${err.stdout ?? ""}${err.stderr ?? ""}`.slice(-8000);
    return { sucesso: false, saida: saida || (e instanceof Error ? e.message : "erro desconhecido"), codigoSaida: err.code ?? null };
  }
}

export async function rodarTestesJarvis(arquivo: string): Promise<ResultadoComando> {
  if (!TESTES_PERMITIDOS.has(arquivo)) {
    throw new Error(`teste "${arquivo}" fora da allowlist — permitidos: ${[...TESTES_PERMITIDOS].join(", ")}`);
  }
  return rodar(process.execPath, [join("testes", arquivo)], 60_000);
}

export async function rodarTypecheckJarvis(): Promise<ResultadoComando> {
  const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
  return rodar(npxCmd, ["tsc", "--noEmit"], 120_000);
}

export async function rodarBuildJarvis(): Promise<ResultadoComando> {
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  return rodar(npmCmd, ["run", "build"], 240_000);
}

// Achado real (Fase 20): em produção, RAIZ é um bind mount do checkout do
// HOST (dono root) visto por dentro do container como usuário não-root
// `jarvis` — o git recusa por padrão ("dubious ownership") qualquer repo
// cujo dono não bate com o usuário atual, proteção contra repositório
// malicioso compartilhado. `-c safe.directory=RAIZ` é a exceção
// oficial do próprio git pra isso, passada por chamada (nunca escrita em
// config persistente — sobrevive a recriação do container sem estado
// extra pra manter).
function argsGitSeguro(...resto: string[]): string[] {
  return ["-c", `safe.directory=${RAIZ}`, ...resto];
}

export async function gitStatusJarvis(): Promise<ResultadoComando> {
  return rodar("git", argsGitSeguro("status", "--short"), 15_000);
}

export async function gitDiffJarvis(caminhoRelativo?: string): Promise<ResultadoComando> {
  const args = argsGitSeguro("diff", "--stat");
  if (caminhoRelativo) {
    if (caminhoBloqueado(caminhoRelativo)) throw new Error("diff bloqueado — caminho de segredo/dado");
    resolverDentroDoRepo(caminhoRelativo); // valida a fronteira antes de montar o comando
    args.push("--", caminhoRelativo);
  }
  return rodar("git", args, 15_000);
}

/** Só pra Tool/validação — nunca usado pra decidir path fora deste arquivo. */
export function caminhoRelativoValido(caminho: string): boolean {
  try {
    const alvo = resolverDentroDoRepo(caminho);
    return relative(RAIZ, alvo).length >= 0; // resolverDentroDoRepo já lança se inválido
  } catch {
    return false;
  }
}
