#!/usr/bin/env node
/**
 * Runner único da suite de testes — item B da Fase 22 (missão de agente):
 * até aqui, rodar tudo era manual (11 arquivos puros + 20 via servidor
 * HTTP, cada um invocado à mão). Isto formaliza o que já era feito na
 * prática, sem inventar um framework de teste novo — cada arquivo em
 * testes/*.mjs continua sendo seu próprio programa Node autocontido
 * (convenção já estabelecida desde a Fase 5/6), este script só decide a
 * ORDEM (puro primeiro, sem custo de servidor) e sobe/derruba o `next
 * dev` uma única vez para os que precisam de HTTP.
 *
 * Uso:
 *   node scripts/rodar-testes.mjs            — tudo
 *   node scripts/rodar-testes.mjs --puros     — só os que não precisam de servidor
 *   node scripts/rodar-testes.mjs contexto.mjs jobs.mjs   — só os arquivos citados
 *
 * Saída: resumo por arquivo + código de saída != 0 se algum falhar —
 * seguro para CI. Nunca mascara falha atrás de pipe (achado real da Fase
 * 21: um `git pull | tail` escondeu um pull que não aconteceu de verdade;
 * aqui cada `node arquivo.mjs` roda isolado, com o próprio código de
 * saída checado diretamente, nunca através de pipe).
 */
import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const RAIZ = process.cwd();
const DIR_TESTES = join(RAIZ, "testes");
const PORTA = process.env.JARVIS_TEST_PORT ?? "3789"; // porta dedicada — nunca colide com um `next dev` já rodando em 3000
const URL_BASE = `http://localhost:${PORTA}`;

function listarArquivosDeTeste() {
  return readdirSync(DIR_TESTES)
    .filter((f) => f.endsWith(".mjs"))
    .sort();
}

/** Convenção observada no repositório: todo teste que fala HTTP referencia localhost: ou lê JARVIS_URL. */
function ehHttp(caminho) {
  const conteudo = readFileSync(caminho, "utf8");
  return conteudo.includes("localhost:") || conteudo.includes("JARVIS_URL");
}

function rodarArquivo(nomeArquivo, envExtra = {}) {
  return new Promise((resolve) => {
    const inicio = Date.now();
    const proc = spawn(process.execPath, [join("testes", nomeArquivo)], {
      cwd: RAIZ,
      env: { ...process.env, ...envExtra },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let saida = "";
    proc.stdout.on("data", (d) => (saida += d));
    proc.stderr.on("data", (d) => (saida += d));
    proc.on("close", (codigo) => {
      const duracaoMs = Date.now() - inicio;
      const resumo = /PASSOU:\s*(\d+)\s*FALHOU:\s*(\d+)/.exec(saida);
      resolve({
        arquivo: nomeArquivo,
        ok: codigo === 0,
        codigo,
        duracaoMs,
        passou: resumo ? parseInt(resumo[1], 10) : null,
        falhou: resumo ? parseInt(resumo[2], 10) : null,
        saida,
      });
    });
  });
}

/** `spawn(...).kill()` com shell:true no Windows mata só o wrapper cmd.exe, não o `next dev` filho — órfão fica preso na porta. `taskkill /T` derruba a árvore inteira. */
function encerrarArvoreDeProcesso(proc) {
  if (process.platform === "win32" && proc.pid) {
    spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    proc.kill();
  }
}

async function aguardarServidorPronto(tentativasMax = 30) {
  for (let i = 0; i < tentativasMax; i++) {
    try {
      const r = await fetch(`${URL_BASE}/api/saude`);
      if (r.ok || r.status === 401) return true; // 401 = servidor de pé, só sem token — já serve
    } catch {
      // ainda subindo
    }
    await sleep(500);
  }
  return false;
}

async function main() {
  const args = process.argv.slice(2);
  const soPuros = args.includes("--puros");
  const arquivosPedidos = args.filter((a) => a.endsWith(".mjs"));

  const todos = listarArquivosDeTeste();
  const alvo = arquivosPedidos.length > 0 ? todos.filter((f) => arquivosPedidos.includes(f)) : todos;

  const puros = alvo.filter((f) => !ehHttp(join(DIR_TESTES, f)));
  const http = soPuros ? [] : alvo.filter((f) => ehHttp(join(DIR_TESTES, f)));

  const resultados = [];

  console.log(`\n═══ Testes puros (${puros.length}) — sem servidor ═══\n`);
  for (const f of puros) {
    process.stdout.write(`  ${f} ... `);
    const r = await rodarArquivo(f);
    resultados.push(r);
    console.log(r.ok ? `OK (${r.passou}/${(r.passou ?? 0) + (r.falhou ?? 0)}, ${r.duracaoMs}ms)` : `FALHOU (código ${r.codigo})`);
  }

  if (http.length > 0) {
    console.log(`\n═══ Testes HTTP (${http.length}) — subindo servidor dev na porta ${PORTA} ═══\n`);
    // .cmd no Windows exige shell:true (confirmado: EINVAL sem isso,
    // mesmo com o binário local direto). shell:true + array de args gera
    // o aviso de depreciação do Node sobre concatenação sem escape — a
    // recomendação oficial nesse caso é montar UMA string já montada
    // (nunca um array), o que também elimina o risco de injeção real:
    // aqui os valores são todos literais fixos, exceto PORTA, que já é
    // validado como inteiro antes de entrar na string.
    const porta = String(Number(PORTA));
    if (!/^\d+$/.test(porta)) throw new Error("JARVIS_TEST_PORT inválida");
    const comando = process.platform === "win32" ? `npx.cmd next dev -p ${porta}` : `npx next dev -p ${porta}`;
    const servidor = spawn(comando, { cwd: RAIZ, stdio: "ignore", shell: true });

    const pronto = await aguardarServidorPronto();
    if (!pronto) {
      console.error("Servidor de teste não respondeu a tempo — abortando testes HTTP.");
      encerrarArvoreDeProcesso(servidor);
    } else {
      for (const f of http) {
        process.stdout.write(`  ${f} ... `);
        const r = await rodarArquivo(f, { JARVIS_URL: URL_BASE });
        resultados.push(r);
        console.log(r.ok ? `OK (${r.passou}/${(r.passou ?? 0) + (r.falhou ?? 0)}, ${r.duracaoMs}ms)` : `FALHOU (código ${r.codigo})`);
      }
    }
    encerrarArvoreDeProcesso(servidor);
    // Turbopack sobe processo(s) filho — dá um instante pra derrubar limpo antes do script sair.
    await sleep(1000);
  }

  const falharam = resultados.filter((r) => !r.ok);
  console.log(`\n${"─".repeat(60)}`);
  console.log(`ARQUIVOS: ${resultados.length}   FALHARAM: ${falharam.length}`);
  if (falharam.length > 0) {
    console.log("\nArquivos com falha:");
    for (const r of falharam) {
      console.log(`  ✗ ${r.arquivo} (código ${r.codigo})`);
      console.log(r.saida.split("\n").slice(-6).join("\n"));
    }
    process.exit(1);
  }
  console.log("RESULTADO: TUDO PASSOU\n");
}

main();
