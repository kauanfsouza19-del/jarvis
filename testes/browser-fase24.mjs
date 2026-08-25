/**
 * Smoke test de navegador de verdade (Fase 24) — a fundação de Browser
 * Agent que a missão pede começa aqui: prova que Playwright (já
 * dependência real desde antes, binário do Chromium já instalado neste
 * ambiente) consegue abrir a aplicação real, esperar o boot terminar,
 * encontrar elementos reais da UI e capturar evidência visual —
 * "Playwright no package.json" e "automação de navegador funciona" NUNCA
 * são a mesma alegação até este teste rodar (achado explícito da própria
 * missão, seção 8/28).
 *
 * Escopo desta fase: smoke test local (servidor de dev, modo aberto —
 * sem JARVIS_TOKEN, então a página principal carrega direto). Não é
 * ainda um "Browser Agent" completo (sem permissões, sem Tool
 * registrada, sem sandboxing formal) — é a prova de que a peça técnica
 * funciona de verdade contra a aplicação real, primeiro passo antes de
 * qualquer Tool.
 *
 *   node testes/browser-fase24.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.JARVIS_URL ?? "http://localhost:3000";
const DIR_EVIDENCIA = join(process.cwd(), "testes", "_evidencia-browser");

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

console.log("SMOKE TEST DE NAVEGADOR (FASE 24) — contra", BASE);
mkdirSync(DIR_EVIDENCIA, { recursive: true });

const navegador = await chromium.launch({ headless: true });
const pagina = await navegador.newPage({ viewport: { width: 1280, height: 800 } });

const errosConsole = [];
pagina.on("pageerror", (e) => errosConsole.push(e.message));

try {
  secao("1. Tela principal — boot real, elementos reais");
  const resposta = await pagina.goto(BASE, { waitUntil: "domcontentloaded", timeout: 15000 });
  ok("GET / responde 200", resposta?.status() === 200, String(resposta?.status()));

  // O boot (JarvisBoot) roda uma sequência real antes de mostrar o Command
  // Center — espera terminar em vez de checar um elemento que só existe
  // depois, sem prazo.
  await pagina.waitForTimeout(3500);

  const tituloJarvis = pagina.getByText("JARVIS", { exact: false }).first();
  ok("título 'JARVIS' visível na tela", await tituloJarvis.isVisible().catch(() => false));

  const campoMensagem = pagina.locator('textarea, input[type="text"]').first();
  const campoVisivel = await campoMensagem.isVisible().catch(() => false);
  ok("campo de mensagem do Command Console está visível e pronto", campoVisivel);

  await pagina.screenshot({ path: join(DIR_EVIDENCIA, "01-principal.png"), fullPage: false });
  ok("screenshot de evidência salvo", true, "testes/_evidencia-browser/01-principal.png");

  secao("2. Interação real — digitar no campo de comando");
  if (campoVisivel) {
    await campoMensagem.click();
    await campoMensagem.fill("teste de navegador real — fase 24");
    const valorDigitado = await campoMensagem.inputValue().catch(async () => await campoMensagem.textContent());
    ok("texto digitado aparece de volta no campo (interação real, não simulada)", (valorDigitado ?? "").includes("fase 24"), valorDigitado ?? "");
    await campoMensagem.fill(""); // limpa — nunca envia de propósito (custaria uma chamada de modelo real)
  }

  secao("3. Página de login — rota real, sem autenticação");
  await pagina.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 15000 });
  await pagina.waitForTimeout(500);
  const corpoLogin = await pagina.textContent("body");
  ok("página /login carrega com conteúdo real (não em branco)", Boolean(corpoLogin && corpoLogin.trim().length > 0));

  secao("4. Erros de JavaScript reais no console durante toda a navegação");
  ok("nenhum erro de JS não tratado (pageerror) durante o smoke test", errosConsole.length === 0, errosConsole.slice(0, 2).join(" | "));
} finally {
  await navegador.close();
}

console.log(`\n${"─".repeat(60)}`);
console.log(`PASSOU: ${passou}   FALHOU: ${falhou}`);
console.log(falhou === 0 ? "RESULTADO: TUDO PASSOU" : "RESULTADO: FALHOU");
process.exit(falhou === 0 ? 0 : 1);
