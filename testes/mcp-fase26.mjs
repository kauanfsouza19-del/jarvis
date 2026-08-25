/**
 * Cliente MCP real (Fase 26) — via /api/execucoes (mesmo caminho público
 * já usado pra Tool única), contra o servidor de referência oficial do
 * protocolo (@modelcontextprotocol/server-everything, mantido pelos
 * mantenedores do MCP). Depende de rede real (npx baixa o pacote na
 * primeira vez) — mesma categoria de dependência externa já documentada
 * pra outros testes desta suite (ver pesquisa-web.mjs, prospeccao-
 * derivada.mjs); se a rede estiver fora, este teste falha por motivo de
 * ambiente, não de regressão de código.
 *
 *   node testes/mcp-fase26.mjs
 */
const BASE = process.env.JARVIS_URL ?? "http://localhost:3000";

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

async function criarJob(ferramenta, entrada) {
  const r = await fetch(`${BASE}/api/execucoes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tipo: "ferramenta", ferramenta, entrada }),
  });
  const corpo = await r.json();
  return corpo.execucaoId;
}
async function esperar(ms) {
  await new Promise((r) => setTimeout(r, ms));
}
async function obterJob(id) {
  const r = await fetch(`${BASE}/api/execucoes/${id}`);
  return (await r.json()).execucao;
}
async function obterResultado(id) {
  const r = await fetch(`${BASE}/api/resultados/${id}`);
  return (await r.json()).resultado;
}

console.log("CLIENTE MCP REAL (FASE 26)");

secao("1. Allowlist — servidor não registrado é recusado, nunca tenta spawnar comando arbitrário");
const idInexistente = await criarJob("mcp.listar_ferramentas", { servidorId: "servidor-que-nao-existe" });
await esperar(1500);
const jInexistente = await obterJob(idInexistente);
ok("servidor fora do registro: job termina FALHOU", jInexistente.status === "FALHOU", jInexistente.status);

secao("2. Conexão real contra o servidor de referência oficial do MCP");
const idLista = await criarJob("mcp.listar_ferramentas", { servidorId: "everything-referencia" });
await esperar(20_000); // primeira conexão pode precisar baixar o pacote via npx
const jLista = await obterJob(idLista);
ok("listar ferramentas: job termina CONCLUIDO", jLista.status === "CONCLUIDO", jLista.status);

if (jLista.status === "CONCLUIDO") {
  const resultado = await obterResultado(jLista.resultado_id);
  const saida = JSON.parse(resultado.resumo).saida;
  ok("servidor real identificado (não é resposta inventada)", saida.servidor === "mcp-servers/everything", saida.servidor);
  ok("lista real de ferramentas não está vazia", Array.isArray(saida.ferramentas) && saida.ferramentas.length > 0, saida.ferramentas?.length);
  ok("ferramenta real 'echo' está na lista", saida.ferramentas.some((f) => f.nome === "echo"));

  secao("3. Execução real de uma ferramenta do servidor");
  const idChamada = await criarJob("mcp.chamar_ferramenta", {
    servidorId: "everything-referencia",
    ferramenta: "echo",
    argumentos: { message: "verificação automatizada — fase 26" },
  });
  await esperar(15_000);
  const jChamada = await obterJob(idChamada);
  ok("chamar ferramenta 'echo': job termina CONCLUIDO", jChamada.status === "CONCLUIDO", jChamada.status);

  if (jChamada.status === "CONCLUIDO") {
    const resultadoChamada = await obterResultado(jChamada.resultado_id);
    const saidaChamada = JSON.parse(resultadoChamada.resumo).saida;
    const texto = saidaChamada?.content?.[0]?.text ?? "";
    ok("resposta real do servidor contém a mensagem enviada (não simulada)", texto.includes("verificação automatizada — fase 26"), texto);
  }
} else {
  console.log("  (pulado: servidor de referência não respondeu — provável falta de rede pro npm registry)");
}

console.log(`\n${"─".repeat(60)}`);
console.log(`PASSOU: ${passou}   FALHOU: ${falhou}`);
console.log(falhou === 0 ? "RESULTADO: TUDO PASSOU" : "RESULTADO: FALHOU");
process.exit(falhou === 0 ? 0 : 1);
