/**
 * Teste de interação real — prova o motor de contexto ATRAVÉS do endpoint
 * HTTP de verdade, na mesma conversa, na ordem exata que o Cacique descreveu:
 *
 *   "Sobre o Locatta..." → "Agora a SS Aquecedores" → "Voltando ao Locatta..."
 *
 * Sem chave Anthropic configurada, /api/conversar responde 503 (sem_chave) ou,
 * quando a confiança é BAIXA, resolve localmente sem tocar o modelo — os dois
 * casos ainda carregam o contexto resolvido, que é o que este teste verifica.
 *
 *   node testes/contexto-e2e.mjs
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

async function json(caminho, opcoes) {
  const r = await fetch(`${BASE}${caminho}`, opcoes);
  return { status: r.status, corpo: await r.json().catch(() => ({})) };
}

/** Fala com o Jarvis e devolve o contexto resolvido, venha ele de onde vier. */
async function falar(conversaId, mensagem) {
  const r = await fetch(`${BASE}/api/conversar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversa_id: conversaId, mensagem }),
  });

  if (r.status === 503) {
    const corpo = await r.json();
    return { via: "sem_chave", contexto: corpo.contexto, texto: null };
  }

  if (!r.ok || !r.body) {
    return { via: "erro_http", contexto: null, texto: null, status: r.status };
  }

  const leitor = r.body.getReader();
  const dec = new TextDecoder();
  let buffer = "";
  let contexto = null;
  let texto = "";
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    buffer += dec.decode(value, { stream: true });
    const linhas = buffer.split("\n");
    buffer = linhas.pop() ?? "";
    for (const linha of linhas) {
      if (!linha.trim()) continue;
      const ev = JSON.parse(linha);
      if (ev.tipo === "inicio") contexto = ev.contexto;
      if (ev.tipo === "texto") texto += ev.texto;
    }
  }
  return { via: "stream_local", contexto, texto };
}

console.log("TESTE DE INTERAÇÃO REAL — CONTEXTO ATRAVÉS DO HTTP");

secao("1. Uma conversa, contexto mudando por linguagem natural");

const nova = await json("/api/conversas", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ titulo: "teste e2e de contexto" }),
});
const convId = nova.corpo.conversa?.id;
ok("conversa criada sem exigir projeto", Boolean(convId));

const r1 = await falar(convId, "Sobre o Locatta, quero revisar o onboarding.");
ok(
  "passo 1 resolve projeto = LOCATTA via HTTP",
  r1.contexto?.projetoNome === "LOCATTA",
  `${r1.via} · ${r1.contexto?.projetoNome}`,
);

const r2 = await falar(convId, "Agora quero analisar a SS Aquecedores.");
ok(
  "passo 2 muda para cliente SS Aquecedores via HTTP",
  r2.contexto?.clienteNome === "SS Aquecedores",
  `${r2.via} · ${r2.contexto?.clienteNome}`,
);

const r3 = await falar(convId, "Voltando ao Locatta, e o cadastro?");
ok(
  "passo 3 volta para LOCATTA via HTTP",
  r3.contexto?.projetoNome === "LOCATTA",
  `${r3.via} · ${r3.contexto?.projetoNome}`,
);

secao("2. Persistência — a timeline sobrevive a uma nova leitura da conversa");

const relida = await json(`/api/conversas/${convId}`);
const usuarios = (relida.corpo.mensagens ?? []).filter((m) => m.papel === "user");
ok("3 mensagens do Cacique persistidas", usuarios.length === 3, `${usuarios.length}`);

secao("3. Confiança BAIXA responde sem gastar modelo");

const conv2 = await json("/api/conversas", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ titulo: "teste e2e confianca baixa" }),
});
const r4 = await falar(conv2.corpo.conversa.id, "Preciso revisar isso.");
ok(
  "confiança BAIXA resolve local, sem 'sem_chave'",
  r4.via === "stream_local",
  r4.via,
);
ok("pergunta concisa devolvida", (r4.texto ?? "").length > 0 && (r4.texto ?? "").length < 80, r4.texto ?? "");

secao("4. Limpeza");

const { DatabaseSync } = await import("node:sqlite");
const dbTeste = new DatabaseSync("dados/jarvis.db");
dbTeste.exec("PRAGMA foreign_keys = ON");
const del = dbTeste.prepare("DELETE FROM conversas WHERE id = ?");
del.run(convId);
del.run(conv2.corpo.conversa.id);
const sobrou = dbTeste
  .prepare("SELECT COUNT(*) n FROM conversas WHERE id IN (?, ?)")
  .get(convId, conv2.corpo.conversa.id).n;
dbTeste.close();
ok("conversas de teste removidas", sobrou === 0);

console.log(`\n${"─".repeat(56)}`);
console.log(`PASSOU: ${passou}   FALHOU: ${falhou}`);
if (falhou > 0) {
  console.log("RESULTADO: FALHOU");
  process.exit(1);
}
console.log("RESULTADO: TUDO PASSOU");
