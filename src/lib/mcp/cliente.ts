import "server-only";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

/**
 * Cliente MCP real (Fase 26) — transporte stdio, JSON-RPC 2.0
 * newline-delimited, handshake `initialize`/`notifications/initialized`
 * (o formato amplamente implantado hoje — pesquisado contra
 * modelcontextprotocol.io/specification/latest/basic/transports em
 * 25/08/2026: stdio é "newline-delimited JSON-RPC", e a mesma página
 * documenta que a revisão mais nova do protocolo introduziu um esquema de
 * descoberta diferente (`server/discover`) mas mantém compatibilidade
 * retroativa com o handshake `initialize` clássico — que é o que todo
 * servidor de referência publicado até agora realmente fala. Implementar
 * só o esquema novo deixaria este cliente incompatível com o ecossistema
 * real hoje; implementar o clássico é a escolha que funciona contra
 * servidor de verdade agora).
 *
 * Testado de ponta a ponta nesta fase contra um servidor de referência
 * REAL (@modelcontextprotocol/server-everything, mantido pela própria
 * Anthropic) — não é código nunca executado.
 *
 * Fronteira de segurança: só spawna o comando/args que o CHAMADOR
 * configurou explicitamente (nunca aceita comando vindo de texto de
 * usuário/modelo sem passar por um registro), timeout em toda operação,
 * processo sempre encerrado no `finally`, stderr do servidor nunca vira
 * parte da resposta (só log, nunca dado).
 */

/**
 * Aspas só quando o argumento realmente precisa (tem espaço/caractere
 * especial) — achado real testando contra um servidor de verdade: aspar
 * TODO argumento incondicionalmente (incluindo o próprio nome do
 * comando, "npx") confunde o parser de aspas do cmd.exe/PowerShell o
 * bastante pra devolver MODULE_NOT_FOUND em vez de rodar o comando.
 * Nunca concatenação crua mesmo assim — aspas + escape sempre que
 * aplicadas.
 */
function escaparArgumentoWindows(arg: string): string {
  if (/^[A-Za-z0-9_.\-@/:]+$/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '\\"')}"`;
}

export type FerramentaMcp = {
  nome: string;
  descricao: string | null;
  schemaEntrada: unknown;
};

export type ConfigServidorMcp = {
  comando: string;
  args: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
};

type MensagemJsonRpc = {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
};

/** Uma conexão descartável por chamada — nunca sessão persistente nesta fase (mesma disciplina de pesquisa/navegador.ts: correção antes de performance de alto volume). */
class ConexaoMcp {
  private processo: ChildProcessWithoutNullStreams;
  private buffer = "";
  private proximoId = 1;
  private pendentes = new Map<number, { resolve: (v: MensagemJsonRpc) => void; reject: (e: Error) => void }>();
  private encerrada = false;
  private ultimoStderr = "";

  constructor(config: ConfigServidorMcp) {
    // Achado real (Fase 26, testando contra um servidor de verdade):
    // `npx` no Windows é `npx.cmd`/`npx.ps1` — spawn() sem shell:true nunca
    // resolve esses binários (ENOENT), mesmo problema já resolvido em
    // scripts/rodar-testes.mjs. No Windows, monta UMA string com cada
    // argumento individualmente escapado (aspas duplas, nunca concatenação
    // crua) — nunca passa array de args junto com shell:true (é
    // exatamente essa combinação que o próprio Node avisa como risco de
    // injeção). Em Linux (produção, container) spawn direto sempre
    // funcionou sem shell.
    if (process.platform === "win32") {
      const comandoEscapado = [config.comando, ...config.args].map(escaparArgumentoWindows).join(" ");
      this.processo = spawn(comandoEscapado, {
        env: { ...process.env, ...config.env },
        stdio: ["pipe", "pipe", "pipe"],
        shell: true,
      });
    } else {
      this.processo = spawn(config.comando, config.args, {
        env: { ...process.env, ...config.env },
        stdio: ["pipe", "pipe", "pipe"],
      });
    }

    this.processo.stdout.on("data", (chunk: Buffer) => this.processarChunk(chunk));
    this.processo.on("error", (e) => this.rejeitarTodosPendentes(e));
    this.processo.on("exit", (codigo, sinal) => {
      if (!this.encerrada) {
        this.rejeitarTodosPendentes(new Error(`processo do servidor MCP encerrou inesperadamente (código ${codigo}, sinal ${sinal}). stderr: ${this.ultimoStderr.slice(-500)}`));
      }
    });
    // stderr do servidor é log — guardado só pra diagnóstico de erro (nunca vira parte de uma resposta bem-sucedida).
    this.processo.stderr.on("data", (chunk: Buffer) => {
      this.ultimoStderr += chunk.toString("utf8");
    });
  }

  private processarChunk(chunk: Buffer): void {
    this.buffer += chunk.toString("utf8");
    let quebra: number;
    while ((quebra = this.buffer.indexOf("\n")) !== -1) {
      const linha = this.buffer.slice(0, quebra).trim();
      this.buffer = this.buffer.slice(quebra + 1);
      if (!linha) continue;
      let msg: MensagemJsonRpc;
      try {
        msg = JSON.parse(linha);
      } catch {
        continue; // linha não-JSON (alguns servidores emitem ruído em stdout por engano) — ignora, nunca lança
      }
      if (typeof msg.id === "number" && this.pendentes.has(msg.id)) {
        this.pendentes.get(msg.id)!.resolve(msg);
        this.pendentes.delete(msg.id);
      }
      // notificações (sem id) são ignoradas nesta fase — sem assinatura de subscriptions/listen ainda
    }
  }

  private rejeitarTodosPendentes(e: Error): void {
    for (const { reject } of this.pendentes.values()) reject(e);
    this.pendentes.clear();
  }

  async chamar(method: string, params: unknown, timeoutMs: number): Promise<MensagemJsonRpc> {
    const id = this.proximoId++;
    const mensagem: MensagemJsonRpc = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolve, reject) => {
      const temporizador = setTimeout(() => {
        this.pendentes.delete(id);
        reject(new Error(`timeout esperando resposta de "${method}" (${timeoutMs}ms)`));
      }, timeoutMs);
      this.pendentes.set(id, {
        resolve: (v) => {
          clearTimeout(temporizador);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(temporizador);
          reject(e);
        },
      });
      this.processo.stdin.write(JSON.stringify(mensagem) + "\n");
    });
  }

  notificar(method: string, params?: unknown): void {
    this.processo.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  encerrar(): void {
    this.encerrada = true;
    this.rejeitarTodosPendentes(new Error("conexão encerrada"));
    this.processo.kill();
  }
}

export type ResultadoMcp<T> = { ok: true; dados: T } | { ok: false; erro: string };

/** Handshake completo + tools/list — uma chamada, uma conexão, sempre fechada. */
export async function listarFerramentasMcp(config: ConfigServidorMcp): Promise<ResultadoMcp<{ nomeServidor: string; versaoServidor: string; ferramentas: FerramentaMcp[] }>> {
  const timeoutMs = config.timeoutMs ?? 15_000;
  const conexao = new ConexaoMcp(config);
  try {
    const init = await conexao.chamar(
      "initialize",
      {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "jarvis", version: "1.0.0" },
      },
      timeoutMs,
    );
    if (init.error) return { ok: false, erro: `initialize falhou: ${init.error.message}` };
    const resultadoInit = init.result as { serverInfo?: { name?: string; version?: string } } | undefined;

    conexao.notificar("notifications/initialized");

    const lista = await conexao.chamar("tools/list", {}, timeoutMs);
    if (lista.error) return { ok: false, erro: `tools/list falhou: ${lista.error.message}` };
    const resultadoLista = lista.result as { tools?: Array<{ name: string; description?: string; inputSchema?: unknown }> } | undefined;

    return {
      ok: true,
      dados: {
        nomeServidor: resultadoInit?.serverInfo?.name ?? config.comando,
        versaoServidor: resultadoInit?.serverInfo?.version ?? "desconhecida",
        ferramentas: (resultadoLista?.tools ?? []).map((t) => ({
          nome: t.name,
          descricao: t.description ?? null,
          schemaEntrada: t.inputSchema ?? null,
        })),
      },
    };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : "erro desconhecido" };
  } finally {
    conexao.encerrar();
  }
}

/** Handshake completo + tools/call — mesma disciplina de conexão descartável. */
export async function chamarFerramentaMcp(config: ConfigServidorMcp, nomeFerramenta: string, argumentos: unknown): Promise<ResultadoMcp<unknown>> {
  const timeoutMs = config.timeoutMs ?? 20_000;
  const conexao = new ConexaoMcp(config);
  try {
    const init = await conexao.chamar(
      "initialize",
      { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "jarvis", version: "1.0.0" } },
      timeoutMs,
    );
    if (init.error) return { ok: false, erro: `initialize falhou: ${init.error.message}` };
    conexao.notificar("notifications/initialized");

    const chamada = await conexao.chamar("tools/call", { name: nomeFerramenta, arguments: argumentos }, timeoutMs);
    if (chamada.error) return { ok: false, erro: `tools/call falhou: ${chamada.error.message}` };
    return { ok: true, dados: chamada.result };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : "erro desconhecido" };
  } finally {
    conexao.encerrar();
  }
}
