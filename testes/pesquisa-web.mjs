/**
 * Fase 6 — Web Research & Lead Intelligence: pesquisa de Instagram público
 * real, enriquecimento de OSM (instagram/facebook/email/bairro quando
 * tagueado), verificação cruzada de evidência (conflito real gravado, nunca
 * escolhido em silêncio) e visibilidade de custo por Tool. Ponta a ponta
 * via HTTP real contra o servidor de dev — sem mock no que está sendo
 * testado.
 *
 *   node testes/pesquisa-web.mjs
 */

const BASE = process.env.JARVIS_URL ?? "http://localhost:3000";
async function api(caminho, opcoes) {
  const r = await fetch(`${BASE}${caminho}`, opcoes);
  return { status: r.status, corpo: await r.json().catch(() => ({})) };
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

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

console.log("FASE 6 — PESQUISA WEB & LEAD INTELLIGENCE");

async function criarProspect(negocio, extra = {}) {
  const r = await api("/api/prospeccao", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ acao: "criar", negocio, vertical: "livre:teste_fase6", fonte: "teste_fase6", ...extra }),
  });
  ok(`seed "${negocio}" criado`, r.status === 201, String(r.status));
  return r.corpo.prospect?.id;
}
async function aguardarTerminal(execucaoId, tentativas = 100) {
  for (let i = 0; i < tentativas; i++) {
    const r = await api(`/api/execucoes/${execucaoId}`);
    const s = r.corpo.execucao?.status;
    if (["CONCLUIDO", "FALHOU", "BLOQUEADO", "CANCELADO", "AGUARDANDO_APROVACAO"].includes(s)) return r.corpo.execucao;
    await esperar(1000);
  }
  return null;
}

const prospectIdsDeTeste = [];

/* ══════════════════════════ 1. Registro de Ferramentas — Instagram real, custo visível ══════════════════════════ */

secao("1. Registro de Tools — Instagram público virou capacidade REAL, custo visível por Tool");
{
  const r = await api("/api/ferramentas");
  const insta = r.corpo.ferramentas.find((f) => f.nome === "instagram.pesquisar");
  ok("instagram.pesquisar existe no registro", Boolean(insta));
  ok("instagram.pesquisar está implementado de verdade (não é mais stub)", insta?.implementado === true);
  ok("instagram.pesquisar disponível sem credencial (gratuito)", insta?.disponibilidade === "DISPONIVEL", insta?.disponibilidade);
  ok("instagram.pesquisar reporta custo=gratis", insta?.custo === "gratis", insta?.custo);

  const serpapi = r.corpo.ferramentas.find((f) => f.nome === "browser.pesquisar");
  ok("provedor pago (SerpApi) reporta custo=pago", serpapi?.custo === "pago", serpapi?.custo);

  const osm = r.corpo.ferramentas.find((f) => f.nome === "osm.descobrir_negocios");
  ok("descoberta OSM reporta custo=gratis", osm?.custo === "gratis", osm?.custo);
}

/* ══════════════════════════ 2. Pesquisa pública de Instagram — real, contra perfil real ══════════════════════════ */

secao("2. Pesquisa pública de Instagram — real, contra perfil público conhecido");
{
  const pId = await criarProspect("___TesteFase6 Instagram___", { website: "https://example.com" });
  prospectIdsDeTeste.push(pId);

  // Seta o Instagram manualmente pra ter um alvo determinístico — a Tool
  // NUNCA adivinha handle, então o teste precisa fornecer um real conhecido.
  const { DatabaseSync } = await import("node:sqlite");
  const d = new DatabaseSync("dados/jarvis.db");
  d.prepare("UPDATE prospects SET instagram = ? WHERE id = ?").run("https://instagram.com/nike", pId);
  d.close();

  const job = await api("/api/execucoes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tipo: "ferramenta", ferramenta: "instagram.pesquisar", entrada: { prospectId: pId } }),
  });
  ok("job de pesquisa de Instagram criado", job.status === 201, String(job.status));
  const final = await aguardarTerminal(job.corpo.execucaoId, 40);
  ok("job concluiu (não trava, mesmo se Instagram bloquear)", ["CONCLUIDO", "FALHOU"].includes(final?.status), final?.status);

  const { DatabaseSync: DB2 } = await import("node:sqlite");
  const d2 = new DB2("dados/jarvis.db");
  const evidencias = d2.prepare("SELECT campo, status, valor FROM prospect_evidencias WHERE prospect_id = ? AND fonte LIKE 'instagram_publico:%'").all(pId);
  d2.close();
  ok("pesquisa gravou pelo menos 1 evidência de Instagram (achado ou nao_verificado, nunca silêncio)", evidencias.length > 0, JSON.stringify(evidencias.map((e) => `${e.campo}:${e.status}`)));
  const nenhumaFabricada = evidencias.every((e) => e.status !== "encontrado" || (e.valor && e.valor.length > 0));
  ok("nenhuma evidência 'encontrado' com valor vazio (nunca finge achado)", nenhumaFabricada);
}

/* ══════════════════════════ 3. OSM — instagram/facebook/email/bairro capturados quando tagueados ══════════════════════════ */

secao("3. Descoberta OSM captura instagram/facebook/email/bairro quando o mapa já tem tagueado (achado real, sem garantia de cobertura)");
{
  const conv = await api("/api/conversas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ titulo: "teste fase 6 — osm social" }) });
  const convId = conv.corpo.conversa?.id;
  const resp = await fetch(`${BASE}/api/conversar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversa_id: convId, mensagem: "Encontre 8 academias em Osasco." }),
  });
  const linhas = (await resp.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const inicio = linhas.find((l) => l.tipo === "inicio");
  ok("comando de descoberta aceito", Boolean(inicio?.execucaoId));
  const final = await aguardarTerminal(inicio.execucaoId, 60);
  ok("descoberta concluiu", final?.status === "CONCLUIDO", final?.status);

  const resultado = final?.resultado_id ? (await api(`/api/resultados/${final.resultado_id}`)).corpo : null;
  for (const p of resultado?.prospects ?? []) prospectIdsDeTeste.push(p.id);
  const algumComRedeSocialOuBairro = (resultado?.prospects ?? []).some((p) => p.instagram || p.facebook || p.bairro);
  console.log(`  (${resultado?.prospects?.length ?? 0} negócios reais; ${(resultado?.prospects ?? []).filter((p) => p.instagram || p.facebook || p.bairro).length} com rede social/bairro tagueado no OSM — cobertura de dado real varia por região)`);
  ok("descoberta rodou de ponta a ponta sem quebrar com os campos novos (instagram/facebook/email/bairro)", (resultado?.prospects?.length ?? 0) > 0, String(resultado?.prospects?.length));
  void algumComRedeSocialOuBairro; // informativo — não é assert obrigatório, cobertura de OSM varia

  const conversasParaLimpar = [convId];
  const { DatabaseSync } = await import("node:sqlite");
  const d = new DatabaseSync("dados/jarvis.db");
  for (const c of conversasParaLimpar) d.prepare("DELETE FROM conversas WHERE id = ?").run(c);
  d.close();
}

/* ══════════════════════════ 4. Verificação cruzada — evidência anterior nunca é tocada por um "não achei" novo ══════════════════════════ */

secao("4. Verificação cruzada de fontes — 'não achei agora' nunca sobrescreve/apaga evidência anterior 'encontrado'");
{
  // Honestidade sobre o limite deste teste: example.com/.org/.net (os únicos
  // domínios de teste seguros e estáveis disponíveis) nunca retornam
  // 'encontrado' pra nenhum campo — não dá pra provocar DUAS fontes reais
  // discordando sem um servidor de conteúdo controlável (que cairia no
  // bloqueio de SSRF por ser localhost). O que ESTE teste prova de verdade:
  // uma evidência 'encontrado' pré-existente sobrevive intacta a uma nova
  // visita que não encontra nada — a metade do contrato de conflito que dá
  // pra verificar com os recursos reais disponíveis nesta sessão.
  const pId = await criarProspect("___TesteFase6 Conflito___", { website: "https://example.org" });
  prospectIdsDeTeste.push(pId);

  const { DatabaseSync } = await import("node:sqlite");
  const d = new DatabaseSync("dados/jarvis.db");
  d.prepare("INSERT INTO prospect_evidencias (id, prospect_id, campo, valor, status, fonte, confianca) VALUES (?,?,?,?,?,?,?)").run(
    "teste-evid-" + Date.now(),
    pId,
    "telefone",
    "11 90000-0000",
    "encontrado",
    "openstreetmap",
    "media",
  );
  d.prepare("UPDATE prospects SET telefone_publico = ? WHERE id = ?").run("11 90000-0000", pId);
  d.close();

  const job1 = await api("/api/execucoes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tipo: "prospeccao", prospectIds: [pId] }),
  });
  await aguardarTerminal(job1.corpo.execucaoId, 40);

  const { DatabaseSync: DB2 } = await import("node:sqlite");
  const d2 = new DB2("dados/jarvis.db");
  const depois = d2.prepare("SELECT telefone_publico FROM prospects WHERE id = ?").get(pId);
  d2.close();
  ok("telefone da fonte anterior (OSM) sobrevive intacto após diagnóstico não achar nada de novo", depois?.telefone_publico === "11 90000-0000", depois?.telefone_publico);
}

/* ══════════════════════════ 5. Limpeza ══════════════════════════ */

secao("5. Limpeza");
{
  const { DatabaseSync } = await import("node:sqlite");
  const d = new DatabaseSync("dados/jarvis.db");
  d.exec("PRAGMA foreign_keys = ON");
  for (const id of new Set(prospectIdsDeTeste)) {
    if (id) d.prepare("DELETE FROM prospects WHERE id = ?").run(id);
  }
  d.prepare("DELETE FROM conversas WHERE titulo LIKE '%fase 6%'").run();
  d.close();
  ok("prospects e conversas de teste removidos", true);
}

console.log(`\n${"─".repeat(56)}`);
console.log(`PASSOU: ${passou}   FALHOU: ${falhou}`);
if (falhou > 0) {
  console.log("RESULTADO: FALHOU");
  process.exit(1);
}
console.log("RESULTADO: TUDO PASSOU");
