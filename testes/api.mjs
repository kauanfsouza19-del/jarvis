/**
 * Teste end-to-end contra a aplicação rodando.
 *
 * Prova o ciclo real: criar conversa pela API → mandar mensagem → derrubar a
 * suposição de que sobreviveu → reler pela API → conferir que voltou igual.
 *
 *   node testes/api.mjs
 */

const BASE = process.env.JARVIS_URL ?? "http://localhost:3000";

let passou = 0;
let falhou = 0;

const ok = (nome, cond, det = "") => {
  if (cond) {
    passou++;
    console.log(`  ok   ${nome}${det ? ` — ${det}` : ""}`);
  } else {
    falhou++;
    console.log(`  FALHOU  ${nome}${det ? ` — ${det}` : ""}`);
  }
};
const secao = (t) => console.log(`\n${t}`);

async function json(caminho, opcoes) {
  const r = await fetch(BASE + caminho, opcoes);
  const corpo = await r.json().catch(() => ({}));
  return { status: r.status, corpo };
}

console.log("TESTE END-TO-END — API DO JARVIS");
console.log(`alvo: ${BASE}`);

// ─────────────────────────────── 1. projetos semeados

secao("1. Registro de projetos (via API)");

const proj = await json("/api/projetos");
ok("GET /api/projetos responde 200", proj.status === 200);
const projetos = proj.corpo.projetos ?? [];
ok("7 projetos semeados", projetos.length === 7, String(projetos.length));

const locatta = projetos.find((p) => p.nome === "LOCATTA");
const jarvis = projetos.find((p) => p.nome === "JARVIS");
ok("LOCATTA existe", !!locatta);
ok("LOCATTA é somente leitura", locatta?.permissao === "leitura", locatta?.permissao);
ok("JARVIS tem escrita+deploy", jarvis?.permissao === "leitura_escrita_deploy");
ok(
  "nenhum caminho de máquina exposto",
  !JSON.stringify(projetos).match(/[A-Za-z]:\\\\|\/Users\/|\/home\//),
);

// ─────────────────────────────── 2. conversa

secao("2. Conversa persistida via API");

const criada = await json("/api/conversas", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ titulo: "Negativação SS Aquecedores", projeto_id: locatta.id }),
});
ok("POST /api/conversas cria (201)", criada.status === 201, String(criada.status));
const convId = criada.corpo.conversa?.id;
ok("conversa recebeu id", !!convId);

// manda uma mensagem — sem chave, deve gravar a pergunta e devolver 503
const conversar = await json("/api/conversar", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ conversa_id: convId, mensagem: "Quais termos devo negativar?" }),
});
ok(
  "sem chave: 503 com aviso claro",
  conversar.status === 503 && conversar.corpo.erro === "sem_chave",
  String(conversar.status),
);
ok(
  "pergunta foi salva mesmo sem chave",
  typeof conversar.corpo.contexto_recuperado === "string",
  conversar.corpo.contexto_recuperado,
);

const lida = await json(`/api/conversas/${convId}`);
ok("GET conversa retorna 200", lida.status === 200);
ok("mensagem do Cacique persistiu", lida.corpo.mensagens?.length === 1, String(lida.corpo.mensagens?.length));
ok(
  "conteúdo exato preservado",
  lida.corpo.mensagens?.[0]?.conteudo === "Quais termos devo negativar?",
);
ok("papel correto", lida.corpo.mensagens?.[0]?.papel === "user");

// renomear e arquivar
await json(`/api/conversas/${convId}`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ titulo: "Negativação — SS Aquecedores (rev 2)" }),
});
const renomeada = await json(`/api/conversas/${convId}`);
ok("renomear funciona", renomeada.corpo.conversa?.titulo === "Negativação — SS Aquecedores (rev 2)");

await json(`/api/conversas/${convId}`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ arquivar: true }),
});
const listaAtivas = await json("/api/conversas");
ok(
  "arquivada some da lista padrão",
  !(listaAtivas.corpo.conversas ?? []).some((c) => c.id === convId),
);
const listaTodas = await json("/api/conversas?arquivadas=1");
ok(
  "arquivada aparece com ?arquivadas=1",
  (listaTodas.corpo.conversas ?? []).some((c) => c.id === convId),
);

// reabrir
await json(`/api/conversas/${convId}`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ arquivar: false }),
});
ok(
  "reabrir devolve à lista",
  (await json("/api/conversas")).corpo.conversas.some((c) => c.id === convId),
);

// ─────────────────────────────── 3. memória

secao("3. Memória via API");

const mem1 = await json("/api/memorias", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    tipo: "PREFERENCIA",
    titulo: "Dupla negativação",
    corpo: "O Cacique negativa em exata e ampla ao mesmo tempo, para cobrir variação sem matar volume.",
    importancia: 5,
    confianca: 0.9,
  }),
});
ok("POST /api/memorias cria (201)", mem1.status === 201, String(mem1.status));
const memId = mem1.corpo.memoria?.id;

const mem2 = await json("/api/memorias", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    tipo: "DECISAO",
    titulo: "Locatta cobra assinatura mensal",
    corpo: "A receita do Locatta vem de assinatura mensal via Cakto, não de comissão sobre aluguel.",
    importancia: 5,
  }),
});
ok("segunda memória criada", mem2.status === 201);

// FILTRO DE SEGREDO — o teste que mais importa
// Montado em partes de propósito (nunca um literal contíguo no arquivo) —
// GitHub Secret Scanning varre o texto BRUTO do commit, não o valor em
// runtime. O regex de detecção do Jarvis roda sobre a string já concatenada
// e continua vendo exatamente o mesmo formato de chave — só o arquivo fonte
// deixa de conter um literal com forma de segredo real.
const chaveFicticiaAnthropic = ["sk-ant-api03-", "AbCdEfGhIjKlMnOpQrSt", "UvWxYz0123456789"].join("");
const veneno = await json("/api/memorias", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    tipo: "FATO",
    titulo: "Chave da conta",
    corpo: `A chave é ${chaveFicticiaAnthropic} guarda isso`,
  }),
});
ok("memória com chave de API é RECUSADA (422)", veneno.status === 422, String(veneno.status));
ok(
  "motivo da recusa nomeia o padrão",
  /chave_anthropic/.test(veneno.corpo.detalhe ?? ""),
  veneno.corpo.detalhe?.slice(0, 80),
);

const veneno2 = await json("/api/memorias", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    tipo: "FATO",
    titulo: "Banco",
    corpo: "conecta em postgres://admin:senhaSecreta123@db.host:5432/prod",
  }),
});
ok("memória com senha em URL é RECUSADA", veneno2.status === 422, String(veneno2.status));

// busca
const busca = await json("/api/memorias?busca=" + encodeURIComponent("negativação exata ampla"));
ok("busca retorna resultado", (busca.corpo.memorias ?? []).length > 0, String(busca.corpo.memorias?.length));
ok("busca acha a memória certa", busca.corpo.memorias?.[0]?.titulo === "Dupla negativação");
ok("resultado traz score", typeof busca.corpo.memorias?.[0]?.score === "number");

const busca2 = await json("/api/memorias?busca=" + encodeURIComponent("como o locatta ganha dinheiro"));
ok(
  "busca semântica-por-palavra acha a decisão",
  (busca2.corpo.memorias ?? []).some((m) => m.titulo.includes("assinatura")),
);

// deduplicação: mandar a MESMA memória de novo não pode criar uma segunda
const repetida = await json("/api/memorias", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    tipo: "DECISAO",
    titulo: "Locatta cobra assinatura mensal",
    corpo: "A receita do Locatta vem de assinatura mensal via Cakto, não de comissão sobre aluguel.",
    importancia: 5,
  }),
});
ok("repetir memória devolve a existente", repetida.corpo.memoria?.id === mem2.corpo.memoria?.id);
const contagem = await json("/api/memorias?busca=" + encodeURIComponent("assinatura mensal cakto"));
ok(
  "não duplicou na busca",
  (contagem.corpo.memorias ?? []).filter((m) => m.titulo === "Locatta cobra assinatura mensal")
    .length === 1,
  `${(contagem.corpo.memorias ?? []).length} resultado(s)`,
);

// esquecer
await json(`/api/memorias?id=${memId}`, { method: "DELETE" });
const depoisEsquecer = await json("/api/memorias?busca=" + encodeURIComponent("dupla negativação"));
ok(
  "esquecer remove de verdade",
  !(depoisEsquecer.corpo.memorias ?? []).some((m) => m.id === memId),
);

// ─────────────────────────────── 4. conhecimento

secao("4. Base de conhecimento via API");

const fonte = await json("/api/conhecimento", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    titulo: "Base consolidada — 37 fontes",
    tipo: "pesquisa",
    categoria: "marketing",
    estado: "AGUARDANDO_CONTEUDO",
    observacao: "Registro criado. Conteúdo ainda não fornecido — nenhum trecho ingerido.",
  }),
});
ok("POST /api/conhecimento registra fonte (201)", fonte.status === 201, String(fonte.status));
ok(
  "fonte marcada AGUARDANDO_CONTEUDO",
  fonte.corpo.fonte?.estado === "AGUARDANDO_CONTEUDO",
  fonte.corpo.fonte?.estado,
);

const fontes = await json("/api/conhecimento");
// Idempotente de propósito: confere que ESTA fonte está na lista, não o total —
// senão o teste só passaria em banco limpo, que é o oposto de provar persistência.
ok(
  "GET lista a fonte criada agora",
  (fontes.corpo.fontes ?? []).some((f) => f.id === fonte.corpo.fonte?.id),
  `${fontes.corpo.fontes?.length} fonte(s) no total`,
);

const buscaConh = await json("/api/conhecimento?busca=negativacao");
ok(
  "busca em base vazia retorna zero (não inventa)",
  (buscaConh.corpo.trechos ?? []).length === 0,
  String(buscaConh.corpo.trechos?.length),
);

// ─────────────────────────────── 5. resiliência

secao("5. Erros tratados");

const semId = await json("/api/conversar", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ mensagem: "oi" }),
});
ok("conversar sem conversa_id → 400", semId.status === 400, String(semId.status));

const inexistente = await json("/api/conversar", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ conversa_id: "nao-existe", mensagem: "oi" }),
});
ok("conversa inexistente → 404", inexistente.status === 404, String(inexistente.status));

const vazia = await json("/api/memorias", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ titulo: "" }),
});
ok("memória sem corpo → 400", vazia.status === 400, String(vazia.status));

const conv404 = await json("/api/conversas/inexistente");
ok("conversa inexistente → 404", conv404.status === 404);

// ─────────────────────────────── limpeza

// Conversa pode legitimamente repetir título, então deduplicar seria errado —
// o certo é o teste não deixar lixo. Sem isso a barra lateral enche de
// histórico que o Cacique nunca teve.
secao("7. Limpeza do que o teste criou");
const { DatabaseSync } = await import("node:sqlite");
const dbTeste = new DatabaseSync("dados/jarvis.db");
dbTeste.exec("PRAGMA foreign_keys = ON");
dbTeste.prepare("DELETE FROM conversas WHERE id = ?").run(convId);
const sobrou = dbTeste
  .prepare("SELECT COUNT(*) n FROM conversas WHERE id = ?")
  .get(convId).n;
const orfas = dbTeste
  .prepare("SELECT COUNT(*) n FROM mensagens WHERE conversa_id = ?")
  .get(convId).n;
dbTeste.close();
ok("conversa de teste removida", sobrou === 0);
ok("mensagens caíram junto (CASCADE)", orfas === 0);

// ─────────────────────────────── resultado

console.log(`\n${"─".repeat(56)}`);
console.log(`PASSOU: ${passou}   FALHOU: ${falhou}`);
if (falhou > 0) {
  console.log("RESULTADO: FALHOU");
  process.exit(1);
}
console.log("RESULTADO: TUDO PASSOU");
console.log("\nO banco continua no disco. Rode de novo após reiniciar o servidor");
console.log("para provar que o estado sobrevive ao restart.");
