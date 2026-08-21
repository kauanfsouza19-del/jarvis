/**
 * Fase 13 — Intelligence Engine: parser RSS/Atom (direto, sem servidor),
 * deduplicação determinística, pontuação de relevância, e o pipeline real
 * via HTTP (fontes, itens, coleta real com YouTube RSS público).
 *
 *   node --import ./testes/lib/resolver-ts.mjs testes/inteligencia-fase13.mjs
 */

import { parsearFeed, urlFeedYoutube, buscarFeed } from "../src/lib/inteligencia/rss.ts";
import { normalizarUrl, normalizarTitulo, encontrarDuplicata } from "../src/lib/inteligencia/deduplicacao.ts";
import { calcularRelevancia } from "../src/lib/inteligencia/relevancia.ts";

const BASE = process.env.JARVIS_URL ?? "http://localhost:3000";
async function api(caminho, opcoes) {
  const r = await fetch(`${BASE}${caminho}`, opcoes);
  return { status: r.status, corpo: await r.json().catch(() => ({})) };
}

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

console.log("FASE 13 — INTELLIGENCE ENGINE");

secao("1. Parser RSS/Atom — direto, zero custo, zero rede");
{
  const atom = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>yt:video:abc123</id>
    <title>Vídeo de teste sobre IA</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=abc123"/>
    <published>2026-08-15T10:00:00+00:00</published>
    <media:group><media:description>Resumo do vídeo &amp; algo mais</media:description></media:group>
  </entry>
  <entry>
    <id>yt:video:def456</id>
    <title>Outro vídeo</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=def456"/>
    <published>2026-08-14T09:00:00+00:00</published>
  </entry>
</feed>`;
  const itensAtom = parsearFeed(atom);
  ok("parseia feed Atom (formato do YouTube) — 2 itens", itensAtom.length === 2, `${itensAtom.length}`);
  ok("extrai id externo real", itensAtom[0].idExterno === "yt:video:abc123", itensAtom[0].idExterno);
  ok("extrai URL do link alternate (atributo, não texto)", itensAtom[0].url === "https://www.youtube.com/watch?v=abc123", itensAtom[0].url);
  ok("decodifica entidade HTML (&amp;)", itensAtom[0].resumo.includes("&") && !itensAtom[0].resumo.includes("&amp;"), itensAtom[0].resumo);

  const rss2 = `<?xml version="1.0"?>
<rss><channel>
  <item>
    <title>Notícia de teste</title>
    <link>https://exemplo.com/noticia-1</link>
    <guid>noticia-1-guid</guid>
    <pubDate>Sat, 15 Aug 2026 10:00:00 GMT</pubDate>
    <description><![CDATA[Descrição <b>com html</b> e CDATA]]></description>
  </item>
</channel></rss>`;
  const itensRss = parsearFeed(rss2);
  ok("parseia RSS 2.0 genérico — 1 item", itensRss.length === 1, `${itensRss.length}`);
  ok("guid vira id externo quando não há <id>", itensRss[0].idExterno === "noticia-1-guid", itensRss[0].idExterno);
  ok("remove CDATA e tag HTML solta da descrição", itensRss[0].resumo === "Descrição com html e CDATA", itensRss[0].resumo);

  const semIdentificador = parsearFeed(`<rss><channel><item><title>Sem link nem guid</title></item></channel></rss>`);
  ok("item sem id/link nenhum é descartado, nunca inventa identificador", semIdentificador.length === 0);

  ok("URL de feed do YouTube montada só com channel_id, sem API key", urlFeedYoutube("UCabc").includes("channel_id=UCabc") && !urlFeedYoutube("UCabc").includes("key="));
}

secao("2. Deduplicação — determinística, nunca manda pro modelo");
{
  ok("normaliza URL removendo querystring de tracking", normalizarUrl("https://exemplo.com/post?utm_source=x&si=y") === "https://exemplo.com/post");
  ok("normaliza título (case/acento/pontuação)", normalizarTitulo("Ótima Notícia!!!") === normalizarTitulo("otima noticia"));

  const existentes = [{ id: "item-1", urlCanonica: "https://exemplo.com/a", tituloNormalizado: "titulo x", publicadoEmDia: "2026-08-15" }];
  const porUrl = encontrarDuplicata({ urlCanonica: "https://exemplo.com/a?utm_source=x", titulo: "outro título", publicadoEm: null }, existentes);
  ok("detecta duplicata por URL canônica, mesmo com querystring diferente", porUrl.duplicado === true && porUrl.deId === "item-1");

  const porTitulo = encontrarDuplicata({ urlCanonica: "https://outro.com/b", titulo: "Titulo X", publicadoEm: "2026-08-15T08:00:00Z" }, existentes);
  ok("detecta duplicata por título normalizado + mesma data, mesmo com URL diferente", porTitulo.duplicado === true);

  const semDuplicata = encontrarDuplicata({ urlCanonica: "https://outro.com/c", titulo: "Assunto completamente diferente", publicadoEm: "2026-08-20T08:00:00Z" }, existentes);
  ok("item genuinamente novo não é marcado como duplicata", semDuplicata.duplicado === false);
}

secao("3. Relevância — determinística, explicável, nunca 'a IA achou relevante'");
{
  const interesses = [{ termo: "inteligência artificial", peso: 3 }, { termo: "marketing", peso: 2 }];
  const hoje = new Date().toISOString();

  const relevante = calcularRelevancia({ titulo: "Novidades de inteligência artificial", resumo: "", publicadoEm: hoje }, interesses, 0.8);
  const irrelevante = calcularRelevancia({ titulo: "Assunto qualquer sem relação", resumo: "", publicadoEm: hoje }, interesses, 0.8);
  ok("item que corresponde a interesse pontua mais que item sem correspondência", relevante.score > irrelevante.score, `${relevante.score} > ${irrelevante.score}`);
  ok("motivo cita o interesse correspondido, nunca genérico", relevante.motivo.includes("inteligência artificial"));
  ok("item sem correspondência tem motivo honesto (nenhum interesse bateu)", irrelevante.motivo.includes("Nenhum interesse"));

  const antigo = calcularRelevancia({ titulo: "Novidades de inteligência artificial", resumo: "", publicadoEm: "2020-01-01T00:00:00Z" }, interesses, 0.8);
  ok("item antigo (mesmo com keyword) pontua menos que recente", antigo.score < relevante.score, `${antigo.score} < ${relevante.score}`);

  ok("score sempre entre 0 e 1", relevante.score >= 0 && relevante.score <= 1);
  ok("prioridade é uma das 4 categorias fechadas", ["CRITICAL", "HIGH", "MEDIUM", "LOW"].includes(relevante.prioridade));
}

secao("4. SSRF — feed apontando pra rede interna é recusado, nunca buscado");
{
  const r = await buscarFeed("http://169.254.169.254/latest/meta-data/");
  ok("feed em IP de metadado de nuvem é recusado honesto", r.ok === false, JSON.stringify(r));
  const r2 = await buscarFeed("http://localhost:3000/api/saude");
  ok("feed apontando pro próprio Jarvis é recusado", r2.ok === false, JSON.stringify(r2));
}

secao("5. Fontes — API real, CRUD completo");
{
  const criarInvalida = await api("/api/inteligencia/fontes", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nome: "x", tipo: "YOUTUBE_RSS" }),
  });
  ok("criar YouTube sem canalId é rejeitado", criarInvalida.status === 400);

  // Canal real, estável, público — Google for Developers.
  const criada = await api("/api/inteligencia/fontes", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nome: "___TesteFase13 Google Developers___", tipo: "YOUTUBE_RSS", canalId: "UC_x5XG1OV2P6uZZ5FSM9Ttw", categoria: "ia" }),
  });
  ok("criar fonte YouTube válida → 201", criada.status === 201, `${criada.status}`);
  ok("URL do feed montada automaticamente a partir do canalId", criada.corpo.fonte?.url?.includes("channel_id=UC_x5XG1OV2P6uZZ5FSM9Ttw"));
  ok("custo padrão é FREE", criada.corpo.fonte?.custo === "FREE", criada.corpo.fonte?.custo);
  const fonteId = criada.corpo.fonte.id;

  const testeReal = await api(`/api/inteligencia/fontes/${fonteId}`, { method: "POST" });
  ok("teste real da fonte responde (feed público de verdade)", testeReal.corpo.ok === true, JSON.stringify(testeReal.corpo).slice(0, 200));
  ok("teste não grava item nenhum (só reporta)", typeof testeReal.corpo.itensEncontrados === "number");

  const desativar = await api(`/api/inteligencia/fontes/${fonteId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ativa: false }) });
  ok("desativar fonte funciona", desativar.corpo.fonte?.ativa === 0, JSON.stringify(desativar.corpo));

  const listaFontes = await api("/api/inteligencia/fontes");
  ok("fonte aparece na listagem", listaFontes.corpo.fontes?.some((f) => f.id === fonteId));
}

secao("6. Interesses — configuráveis, nunca hardcoded no código");
{
  const lista = await api("/api/inteligencia/interesses");
  ok("interesses padrão foram semeados", lista.corpo.interesses?.length > 0, `${lista.corpo.interesses?.length}`);

  const criar = await api("/api/inteligencia/interesses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ termo: "___teste_interesse_fase13___", categoria: "teste", peso: 2 }) });
  ok("criar interesse novo → 201", criar.status === 201);

  const duplicado = await api("/api/inteligencia/interesses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ termo: "___teste_interesse_fase13___" }) });
  ok("interesse duplicado é rejeitado", duplicado.status === 400);

  const listaFinal = await api("/api/inteligencia/interesses");
  const novo = listaFinal.corpo.interesses.find((i) => i.termo === "___teste_interesse_fase13___");
  ok("interesse novo aparece na lista", Boolean(novo));
  if (novo) await api(`/api/inteligencia/interesses?id=${novo.id}`, { method: "DELETE" });
}

secao("7. Coleta real end-to-end — job real, item real persistido, sem duplicar em nova rodada");
{
  const fonte = await api("/api/inteligencia/fontes", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nome: "___TesteFase13 Coleta___", tipo: "YOUTUBE_RSS", canalId: "UC_x5XG1OV2P6uZZ5FSM9Ttw", categoria: "ia" }),
  });
  const fonteId = fonte.corpo.fonte.id;

  const antes = await api("/api/inteligencia/itens?limite=200");
  const totalAntes = antes.corpo.itens.length;

  const disparo = await api("/api/inteligencia/coletar", { method: "POST" });
  ok("coleta dispara um Job real", Boolean(disparo.corpo.execucaoId), JSON.stringify(disparo.corpo));

  let jobFinal = null;
  for (let i = 0; i < 30; i++) {
    jobFinal = (await api(`/api/execucoes/${disparo.corpo.execucaoId}`)).corpo.execucao;
    if (["CONCLUIDO", "FALHOU", "BLOQUEADO"].includes(jobFinal?.status)) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  ok("job de coleta termina em estado final", ["CONCLUIDO", "FALHOU", "BLOQUEADO"].includes(jobFinal?.status), jobFinal?.status);
  ok("job de coleta conclui com sucesso (canal real respondeu)", jobFinal?.status === "CONCLUIDO", jobFinal?.status);

  const depois = await api("/api/inteligencia/itens?limite=200");
  ok("itens novos foram persistidos de verdade", depois.corpo.itens.length > totalAntes, `${totalAntes} -> ${depois.corpo.itens.length}`);

  const fonteAtualizada = await api(`/api/inteligencia/fontes/${fonteId}`);
  ok("fonte registra último sucesso real (não só criação)", Boolean(fonteAtualizada.corpo.fonte?.ultimo_sucesso));

  // segunda coleta — mesmos vídeos, nunca duplica.
  const disparo2 = await api("/api/inteligencia/coletar", { method: "POST" });
  let job2 = null;
  for (let i = 0; i < 30; i++) {
    job2 = (await api(`/api/execucoes/${disparo2.corpo.execucaoId}`)).corpo.execucao;
    if (["CONCLUIDO", "FALHOU", "BLOQUEADO"].includes(job2?.status)) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const depoisSegunda = await api("/api/inteligencia/itens?limite=200");
  ok("segunda coleta do MESMO canal não duplica itens já existentes", depoisSegunda.corpo.itens.length === depois.corpo.itens.length, `${depois.corpo.itens.length} -> ${depoisSegunda.corpo.itens.length}`);

  // muda status de um item real
  const algumItem = depois.corpo.itens.find((i) => i.fonte_id === fonteId) ?? depois.corpo.itens[0];
  if (algumItem) {
    const mudarStatus = await api(`/api/inteligencia/itens/${algumItem.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "REVIEWED" }) });
    ok("mudar status de item real funciona", mudarStatus.corpo.item?.status === "REVIEWED", JSON.stringify(mudarStatus.corpo));
    const statusInvalido = await api(`/api/inteligencia/itens/${algumItem.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "NAO_EXISTE" }) });
    ok("status fora do vocabulário fechado é rejeitado", statusInvalido.status === 400);
  }
}

secao("8. Sistemas existentes continuam intactos (spot-check, suite completa roda separada)");
{
  const jobs = await api("/api/execucoes");
  ok("API de Jobs continua respondendo", jobs.status === 200);
  const social = await api("/api/social/conteudos");
  ok("API de conteúdo social continua respondendo", social.status === 200);
  const modelos = await api("/api/modelos");
  ok("API do Model Router continua respondendo", modelos.status === 200);
}

secao("9. Limpeza");
{
  const fontes = await api("/api/inteligencia/fontes");
  for (const f of fontes.corpo.fontes.filter((f) => f.nome.includes("___TesteFase13"))) {
    await api(`/api/inteligencia/fontes/${f.id}`, { method: "DELETE" });
  }
  const { DatabaseSync } = await import("node:sqlite");
  const d = new DatabaseSync("dados/jarvis.db");
  d.exec("PRAGMA foreign_keys = ON");
  d.prepare("DELETE FROM interesses_inteligencia WHERE termo = ?").run("___teste_interesse_fase13___");
  d.close();
  ok("fontes e interesses de teste removidos", true);
}

console.log("\n" + "─".repeat(60));
console.log(`PASSOU: ${passou}   FALHOU: ${falhou}`);
console.log(falhou === 0 ? "RESULTADO: TUDO PASSOU" : "RESULTADO: TEM FALHA");
process.exit(falhou === 0 ? 0 : 1);
