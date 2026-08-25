/**
 * Tool de escrita de código (Fase 22) — via /api/execucoes (tipo
 * executar_ferramenta, o caminho público real que já existia pra Tool
 * única). Cobre as fronteiras de segurança da própria Tool
 * (codigo.escrever_arquivo) e o ciclo real de aprovação: pausa, rejeita
 * sem escrever, aprova e escreve de verdade.
 *
 * NÃO cobre aqui (verificado manualmente nesta fase, sem cobertura
 * automatizada ainda — não existe caminho público seguro pra criar um
 * Plano de DAG arbitrário fora do Planejador real, de propósito): a
 * correção de responderAprovacao/executarPasso pra retomar por
 * plano_passo_id específico dentro de um Plano de múltiplos passos (ver
 * jobs/motor.ts e jobs/handlers/plano-orquestrado.ts, comentários "Fase
 * 22"). Verificado manualmente contra o servidor real: passo pausa,
 * aprovação por passo específico faz SÓ aquele passo rodar (não os
 * outros com a mesma capacidade), rejeição marca FALHOU sem cancelar o
 * plano inteiro.
 *
 *   node testes/escrita-fase22.mjs
 */
import { unlinkSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.JARVIS_URL ?? "http://localhost:3000";
const RAIZ = process.cwd();

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

async function criarJobEscrita(entrada) {
  const r = await fetch(`${BASE}/api/execucoes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tipo: "ferramenta", ferramenta: "codigo.escrever_arquivo", entrada }),
  });
  const corpo = await r.json();
  return { status: r.status, id: corpo.execucaoId };
}

async function esperar(ms) {
  await new Promise((res) => setTimeout(res, ms));
}

async function obterJob(id) {
  const r = await fetch(`${BASE}/api/execucoes/${id}`);
  return (await r.json()).execucao;
}

async function listarAprovacoesPendentes() {
  const r = await fetch(`${BASE}/api/aprovacoes`);
  return (await r.json()).aprovacoes ?? [];
}

async function responder(id, aprovar) {
  const r = await fetch(`${BASE}/api/aprovacoes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, aprovar }),
  });
  return await r.json();
}

/** A Tool de escrita SEMPRE exige aprovação antes de tentar — mesmo pra um pedido que vai falhar depois por dentro. Aprova primeiro, só então o erro real de dentro da Tool aparece. */
async function aprovarJob(jobId) {
  const pendentes = await listarAprovacoesPendentes();
  const aprovacao = pendentes.find((a) => a.job_id === jobId);
  if (!aprovacao) return false;
  await responder(aprovacao.id, true);
  return true;
}

console.log("TOOL DE ESCRITA DE CÓDIGO (FASE 22)");

/* ── 1. fronteiras de segurança — mesmo aprovado, a Tool recusa e nunca escreve ── */

secao("1. Fronteiras de segurança da Tool");

// A Tool sempre pausa pra aprovação primeiro (achado real: mesmo um
// pedido destinado a falhar por dentro passa pela fila de aprovação —
// correto, é a mesma régua de qualquer WRITE explícito). Aprova antes de
// checar o erro real, senão o teste só veria AGUARDANDO_APROVACAO.
const caminhoEnv = join(RAIZ, ".env.teste_nao_deveria_existir");
const r1 = await criarJobEscrita({ caminho: ".env.teste_nao_deveria_existir", conteudo: "X=1" });
ok("job de escrita em .env aceito (falha DEPOIS, dentro da Tool)", r1.status === 200 || r1.status === 201, r1.status);
await esperar(1200);
await aprovarJob(r1.id);
await esperar(1500);
const j1 = await obterJob(r1.id);
ok(".env: job termina FALHOU (bloqueado pela Tool)", j1.status === "FALHOU", j1.status);
ok(".env: nenhum arquivo criado", !existsSync(caminhoEnv));

const r2 = await criarJobEscrita({ caminho: "docs/_teste_extensao_invalida.exe", conteudo: "binario" });
await esperar(1200);
await aprovarJob(r2.id);
await esperar(1500);
const j2 = await obterJob(r2.id);
ok("extensão fora da allowlist: job termina FALHOU", j2.status === "FALHOU", j2.status);

const r3 = await criarJobEscrita({ caminho: "../fora_do_repo.md", conteudo: "teste" });
await esperar(1200);
await aprovarJob(r3.id);
await esperar(1500);
const j3 = await obterJob(r3.id);
ok("path traversal (../): job termina FALHOU", j3.status === "FALHOU", j3.status);

const r4 = await criarJobEscrita({
  caminho: "docs/_teste_segredo.md",
  conteudo: "chave de teste: sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOP",
});
await esperar(1200);
await aprovarJob(r4.id);
await esperar(1500);
const j4 = await obterJob(r4.id);
ok("conteúdo com padrão de segredo real: job termina FALHOU (exigirSemSegredo)", j4.status === "FALHOU", j4.status);
ok("nenhum arquivo com segredo foi criado", !existsSync(join(RAIZ, "docs", "_teste_segredo.md")));

/* ── 2. ciclo de aprovação — rejeitar nunca escreve, aprovar escreve de verdade ── */

secao("2. Ciclo de aprovação real");

const caminhoTeste = "docs/_teste_escrita_fase22_temp.md";
const alvoTeste = join(RAIZ, "docs", "_teste_escrita_fase22_temp.md");
if (existsSync(alvoTeste)) unlinkSync(alvoTeste); // limpeza defensiva de uma rodada anterior interrompida

const rRej = await criarJobEscrita({ caminho: caminhoTeste, conteudo: "# nunca deveria existir\n" });
await esperar(1500);
const pendentesRej = await listarAprovacoesPendentes();
const aprovRej = pendentesRej.find((a) => a.job_id === rRej.id);
ok("pedido de escrita pausa esperando aprovação", Boolean(aprovRej), aprovRej?.id ?? "nenhuma encontrada");

if (aprovRej) {
  await responder(aprovRej.id, false);
  await esperar(1000);
  const jRej = await obterJob(rRej.id);
  ok("rejeitada: job termina CANCELADO", jRej.status === "CANCELADO", jRej.status);
  ok("rejeitada: nenhum arquivo foi escrito", !existsSync(alvoTeste));
}

const conteudoReal = "# Teste Fase 22\n\nEscrito de verdade depois de aprovação explícita.\n";
const rApr = await criarJobEscrita({ caminho: caminhoTeste, conteudo: conteudoReal });
await esperar(1500);
const pendentesApr = await listarAprovacoesPendentes();
const aprovApr = pendentesApr.find((a) => a.job_id === rApr.id);
ok("segundo pedido também pausa esperando aprovação", Boolean(aprovApr), aprovApr?.id ?? "nenhuma encontrada");

if (aprovApr) {
  await responder(aprovApr.id, true);
  await esperar(1500);
  const jApr = await obterJob(rApr.id);
  ok("aprovada: job termina CONCLUIDO", jApr.status === "CONCLUIDO", jApr.status);
  ok("aprovada: arquivo foi escrito de verdade", existsSync(alvoTeste));
  if (existsSync(alvoTeste)) {
    const conteudoNoDisco = readFileSync(alvoTeste, "utf8");
    ok("conteúdo no disco bate com o que foi aprovado", conteudoNoDisco === conteudoReal);
    unlinkSync(alvoTeste); // limpeza — nunca deixa arquivo de teste no repositório
  }
}

console.log(`\n${"─".repeat(60)}`);
console.log(`PASSOU: ${passou}   FALHOU: ${falhou}`);
console.log(falhou === 0 ? "RESULTADO: TUDO PASSOU" : "RESULTADO: FALHOU");
process.exit(falhou === 0 ? 0 : 1);
