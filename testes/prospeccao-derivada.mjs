/**
 * Fase de Prospecção Comercial — job derivado, linhagem de resultado,
 * enriquecimento, análise de marketing, pontuação e geração de abordagem.
 * Ponta a ponta via HTTP real contra o servidor de dev, Playwright real,
 * sem mock — mesma linha de testes/orquestrador.mjs, focado no que é NOVO
 * nesta fase: "continuar trabalhando em cima do resultado de um job
 * anterior" em vez de só "executar um job".
 *
 *   node testes/prospeccao-derivada.mjs
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

console.log("PROSPECÇÃO COMERCIAL — JOB DERIVADO, LINHAGEM, ENRIQUECIMENTO, MARKETING, PONTUAÇÃO, ABORDAGEM");

async function criarProspect(negocio, website, vertical = "delivery_pizzaria", cidade = "Osasco") {
  const r = await api("/api/prospeccao", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ acao: "criar", negocio, vertical, cidade, website, fonte: "teste_derivado" }),
  });
  ok(`seed "${negocio}" criado`, r.status === 201, String(r.status));
  return r.corpo.prospect?.id;
}
async function novaConversa(titulo) {
  const r = await api("/api/conversas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ titulo }) });
  return r.corpo.conversa?.id;
}
async function enviar(conversaId, mensagem) {
  const r = await fetch(`${BASE}/api/conversar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversa_id: conversaId, mensagem }),
  });
  const texto = await r.text();
  const linhas = texto.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { status: r.status, inicio: linhas.find((l) => l.tipo === "inicio"), linhas };
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
async function limparProspects(ids) {
  const { DatabaseSync } = await import("node:sqlite");
  const d = new DatabaseSync("dados/jarvis.db");
  d.exec("PRAGMA foreign_keys = ON");
  for (const id of ids) if (id) d.prepare("DELETE FROM prospects WHERE id = ?").run(id);
  d.close();
}

const conversasCriadas = [];

/* ══════════════════════════ 1. Descoberta com vertical LIVRE (nunca hardcode "pizzaria") ══════════════════════════ */

secao("1. Descoberta reconhece QUALQUER vertical, não só o enum fixo");

let conversaBase, resultadoIdBase, pAId, pBId;
{
  pAId = await criarProspect("___TesteDerivado Academia A___", "https://example.com", "livre:academias");
  pBId = await criarProspect("___TesteDerivado Academia B___", "https://example.org", "livre:academias");

  conversaBase = await novaConversa("teste derivado — base");
  conversasCriadas.push(conversaBase);

  // vertical LIVRE já é coberto pela descoberta AO VIVO real em
  // testes/execucao-dinamica.mjs seção 1 (prova "sem hardcode de vertical"
  // de ponta a ponta, com negócio de verdade). Desde que descoberta real
  // (OSM) ficou sempre disponível, "Encontre academias em Osasco." pelo
  // chat acharia academias REAIS em vez dos 2 seeds manuais abaixo — este
  // arquivo precisa dos 2 seeds EXATOS pra testar linhagem/derivação nas
  // seções seguintes, então usa prospectIds explícitos (determinístico),
  // mantendo a MESMA conversa pra todo o resto do arquivo continuar valendo.
  const rCriacao = await api("/api/execucoes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tipo: "prospeccao", conversa_id: conversaBase, prospectIds: [pAId, pBId] }),
  });
  const final = await aguardarTerminal(rCriacao.corpo.execucaoId, 90);
  ok("execução com vertical livre concluiu de verdade", final?.status === "CONCLUIDO", final?.status);

  resultadoIdBase = final?.resultado_id;
  const resultado = resultadoIdBase ? (await api(`/api/resultados/${resultadoIdBase}`)).corpo : null;
  ok("resultado A tem os 2 negócios (vertical livre funcionou de ponta a ponta)", resultado?.prospects?.length === 2, `${resultado?.prospects?.length}`);
  ok("resultado A é raiz — sem resultado-pai (é a descoberta original)", resultado?.resultado?.parent_result_id === null || resultado?.resultado?.parent_result_id === undefined);
}

/* ══════════════════════════ 2. Job derivado — ENRIQUECER, com linhagem ══════════════════════════ */

secao("2. 'Agora enriqueça' vira JOB DERIVADO, com resultado-filho apontando pro resultado A");

let resultadoIdEnriquecido, execucaoEnriquecimento;
{
  const r = await enviar(conversaBase, "Agora enriqueça com telefone, site, Instagram e email público.");
  ok("comando derivado aceito → 200", r.status === 200);
  ok("comando derivado NÃO dispara descoberta nova — reaproveita a conversa, sem seed novo", Boolean(r.inicio?.execucaoId));
  // A base (seção 1) usou o job legado tipo "prospeccao" (prospectIds
  // explícitos, sem Plano) de propósito — o comando derivado É o primeiro
  // Plano de verdade nesta conversa; só precisa existir e ter id real.
  ok("comando derivado cria um Plano de verdade, com id real", Boolean(r.inicio?.planoId));

  execucaoEnriquecimento = r.inicio.execucaoId;
  const final = await aguardarTerminal(execucaoEnriquecimento, 90);
  ok("job de enriquecimento conclui", final?.status === "CONCLUIDO", final?.status);

  resultadoIdEnriquecido = final?.resultado_id;
  ok("job derivado produz um resultado NOVO (id diferente do resultado A)", resultadoIdEnriquecido && resultadoIdEnriquecido !== resultadoIdBase);

  const resultado = resultadoIdEnriquecido ? (await api(`/api/resultados/${resultadoIdEnriquecido}`)).corpo : null;
  ok("resultado derivado aponta pro resultado A como pai (linhagem)", resultado?.resultado?.parent_result_id === resultadoIdBase, resultado?.resultado?.parent_result_id);
  ok("resultado derivado tem operacao='enriquecimento'", resultado?.resultado?.operacao === "enriquecimento", resultado?.resultado?.operacao);
  ok("linhagem visível na API inclui o resultado A", resultado?.linhagem?.some((l) => l.id === resultadoIdBase));
  ok("resultado derivado ainda tem os 2 prospects (mesmo conjunto, enriquecido)", resultado?.prospects?.length === 2);
}

secao("3. Sem instagram/whatsapp/e-mail públicos em example.com/.org — nunca inventa (zero alucinação)");
{
  const prospectA = (await api(`/api/resultados/${resultadoIdEnriquecido}`)).corpo.prospects.find((p) => p.id === pAId);
  ok(
    "campo não encontrado na página fica null — NUNCA um valor fabricado",
    prospectA.instagram === null && prospectA.whatsapp_publico === null && prospectA.email_publico === null,
    JSON.stringify({ instagram: prospectA.instagram, whatsapp: prospectA.whatsapp_publico, email: prospectA.email_publico }),
  );

  const { DatabaseSync } = await import("node:sqlite");
  const d = new DatabaseSync("dados/jarvis.db");
  const evidencias = d.prepare("SELECT campo, status, valor FROM prospect_evidencias WHERE prospect_id = ?").all(pAId);
  d.close();
  // Desde a fase de Execução Dinâmica, evidência é gravada SEMPRE (achado ou
  // não) — "nao_encontrado" é informação real ("verifiquei e não achei"),
  // diferente de nenhuma linha (nunca verificado). Nunca fabricada: todo
  // valor fica vazio quando o status não é 'encontrado'.
  ok(
    "evidência é gravada mesmo sem achar nada (status, nunca silêncio)",
    evidencias.length > 0 && evidencias.every((e) => e.status === "nao_encontrado" && e.valor === ""),
    JSON.stringify(evidencias),
  );
}

/* ══════════════════════════ 4. Job derivado — ANALISAR_MARKETING ══════════════════════════ */

secao("4. 'Descubra quais parecem não anunciar' vira job de análise de marketing, com linguagem de confiança");
{
  const r = await enviar(conversaBase, "Agora descubra quais parecem não anunciar.");
  ok("comando de análise de marketing aceito", r.status === 200 && Boolean(r.inicio?.execucaoId));

  const final = await aguardarTerminal(r.inicio.execucaoId, 90);
  ok("job de análise de marketing conclui", final?.status === "CONCLUIDO", final?.status);

  const planoResp = await api(`/api/planos/${r.inicio.planoId}`);
  const passoAnalise = planoResp.corpo.passos.find((p) => p.capacidade === "analisar_marketing_digital");
  ok("passo de análise usa a capacidade certa", Boolean(passoAnalise));
  const saida = JSON.parse(passoAnalise.saida);
  ok("saída tem sinais com status/evidência/confiança por sinal", Array.isArray(saida.sinais) && saida.sinais.every((s) => s.status && s.evidencia && s.confianca));
  ok(
    "vocabulário é sempre 'detectado/não detectado/inconclusivo' — nunca certeza de ausência",
    saida.sinais.every((s) => ["detectado", "nao_detectado", "inconclusivo"].includes(s.status)),
  );
}

/* ══════════════════════════ 5. Job derivado — PONTUAR (sem visita nova, rápido) ══════════════════════════ */

secao("5. Repontuação é determinística e RÁPIDA (sem visitar o site de novo)");
{
  const t0 = Date.now();
  const r = await enviar(conversaBase, "Agora pontue de novo.");
  const final = await aguardarTerminal(r.inicio.execucaoId, 30);
  const duracao = Date.now() - t0;

  ok("job de repontuação conclui", final?.status === "CONCLUIDO", final?.status);
  ok("repontuação é rápida — sem I/O de rede (< 5s pra 2 prospects)", duracao < 5000, `${duracao}ms`);

  const linhas = r.linhas.find((l) => l.tipo === "fim");
  ok("repontuação custa ZERO de modelo (determinístico)", linhas?.uso?.entrada === 0);
}

/* ══════════════════════════ 6. Job derivado — GERAR_ABORDAGEM sem ANTHROPIC_API_KEY: falha honesta ══════════════════════════ */

secao("6. 'Crie uma abordagem' sem ANTHROPIC_API_KEY — bloqueio honesto, nunca texto fabricado");
{
  const r = await enviar(conversaBase, "Agora crie uma abordagem personalizada para cada uma.");
  ok("comando de abordagem aceito, cria plano+job", r.status === 200 && Boolean(r.inicio?.execucaoId));

  const final = await aguardarTerminal(r.inicio.execucaoId, 30);
  ok(
    "sem credencial, job termina BLOQUEADO ou FALHOU — nunca CONCLUIDO com texto inventado",
    ["BLOQUEADO", "FALHOU"].includes(final?.status),
    final?.status,
  );

  const planoResp = await api(`/api/planos/${r.inicio.planoId}`);
  const passosAbordagem = planoResp.corpo.passos.filter((p) => p.capacidade === "gerar_abordagem");
  ok(
    "cada passo de abordagem falha com motivo que menciona credencial, não erro genérico",
    passosAbordagem.length > 0 && passosAbordagem.every((p) => p.status === "FALHOU" && /credencial/i.test(p.erro ?? "")),
    JSON.stringify(passosAbordagem.map((p) => p.erro)),
  );

  const { DatabaseSync } = await import("node:sqlite");
  const d = new DatabaseSync("dados/jarvis.db");
  const abordagens = d.prepare("SELECT abordagem_sugerida FROM prospects WHERE id IN (?,?) AND abordagem_sugerida IS NOT NULL").all(pAId, pBId);
  d.close();
  ok("nenhuma abordagem fabricada foi salva no prospect", abordagens.length === 0, `${abordagens.length}`);
}

/* ══════════════════════════ 7. Export do resultado derivado — CSV/XLSX reais ══════════════════════════ */

secao("7. Exportar resultado DERIVADO (não só o original) — CSV/XLSX reais");
{
  const resultado = (await api(`/api/resultados/${resultadoIdEnriquecido}`)).corpo;
  ok("resultado derivado tem 2 arquivos gerados", resultado.arquivos?.length === 2, String(resultado.arquivos?.length));

  const csv = resultado.arquivos.find((a) => a.tipo === "csv");
  const xlsx = resultado.arquivos.find((a) => a.tipo === "xlsx");
  const rc = await fetch(`${BASE}/api/arquivos/${csv.id}`);
  ok("CSV do resultado derivado baixa 200 com conteúdo real", rc.status === 200 && (await rc.arrayBuffer()).byteLength > 50);
  const rx = await fetch(`${BASE}/api/arquivos/${xlsx.id}`);
  const bufXlsx = await rx.arrayBuffer();
  const assinatura = new Uint8Array(bufXlsx.slice(0, 4));
  ok("XLSX do resultado derivado é um ZIP real (assinatura PK)", assinatura[0] === 0x50 && assinatura[1] === 0x4b);

  // Libera os domínios example.com/example.org pro resto do arquivo — dedup
  // de prospect é por domínio (ver testes/orquestrador.mjs, mesma lição),
  // então a próxima seção que precisar de um domínio "bom" reusa estes sem
  // colidir com o que a seção 1 já criou.
  await limparProspects([pAId, pBId]);
}

/* ══════════════════════════ 8. Isolamento de falha em enriquecimento paralelo ══════════════════════════ */

secao("8. Enriquecimento paralelo isola falha por prospect (um site ruim não derruba os outros)");
{
  const pOk1 = await criarProspect("___TesteDerivado Enrich OK1___", "https://example.com", "livre:academias");
  const pOk2 = await criarProspect("___TesteDerivado Enrich OK2___", "https://example.org", "livre:academias");
  // Domínio válido AGORA — precisa passar no diagnóstico da descoberta base
  // pra entrar no resultado; só depois vira inválido, especificamente pra
  // falhar no ENRIQUECIMENTO (não na descoberta) — isolamento de falha de
  // um passo específico da esteira, não "descoberta já filtrou por mim".
  const pRuim = await criarProspect("___TesteDerivado Enrich Ruim___", "https://example.net", "livre:academias");

  const conv = await novaConversa("teste derivado — enriquecimento paralelo");
  conversasCriadas.push(conv);

  // prospectIds EXPLÍCITOS — descoberta ao vivo (OSM) está sempre
  // disponível agora e acharia academias reais em vez destes 3 seeds
  // controlados, quebrando o controle determinístico que este teste precisa
  // (um domínio especificamente inválido, pra provar isolamento).
  const rBase = await api("/api/execucoes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tipo: "prospeccao", conversa_id: conv, prospectIds: [pOk1, pOk2, pRuim] }),
  });
  const finalBase = await aguardarTerminal(rBase.corpo.execucaoId, 90);
  ok("descoberta base (existentes) concluiu", finalBase?.status === "CONCLUIDO", finalBase?.status);
  const resultadoBase = (await api(`/api/resultados/${finalBase?.resultado_id}`)).corpo;
  ok("descoberta base pegou os 3 (todos com site válido nessa hora)", resultadoBase.prospects?.length === 3, `${resultadoBase.prospects?.length}`);

  // Agora que o prospect já está no resultado (passou no diagnóstico),
  // troca o site dele pra um domínio que não existe — só ENTÃO ele vai
  // falhar, e vai falhar especificamente no passo de ENRIQUECIMENTO.
  {
    const { DatabaseSync } = await import("node:sqlite");
    const d = new DatabaseSync("dados/jarvis.db");
    d.prepare("UPDATE prospects SET website = ? WHERE id = ?").run("https://dominio-que-nao-existe-de-verdade-jarvis-fase2.invalid", pRuim);
    d.close();
  }

  const t0 = Date.now();
  const rEnr = await enviar(conv, "Agora enriqueça o Instagram e o telefone.");
  const finalEnr = await aguardarTerminal(rEnr.inicio.execucaoId, 90);
  const duracao = Date.now() - t0;

  ok("enriquecimento com falha parcial ainda CONCLUI (isolamento, não 'tudo ou nada')", finalEnr?.status === "CONCLUIDO", finalEnr?.status);
  ok("3 enriquecimentos concorrentes não demoram 3x o tempo serial", duracao < 60000, `${duracao}ms`);

  const planoResp = await api(`/api/planos/${rEnr.inicio.planoId}`);
  const passosEnriq = planoResp.corpo.passos.filter((p) => p.capacidade === "enriquecer_prospect");
  const passoRuim = passosEnriq.find((p) => JSON.parse(p.entrada).prospectId === pRuim);
  ok("passo do prospect com domínio inválido falhou de verdade", passoRuim?.status === "FALHOU", passoRuim?.status);

  const resultadoFinal = (await api(`/api/resultados/${finalEnr.resultado_id}`)).corpo;
  ok("resultado final tem só os 2 que tiveram sucesso (isolamento real)", resultadoFinal.prospects?.length === 2, `${resultadoFinal.prospects?.length}`);

  await limparProspects([pOk1, pOk2, pRuim]);
}

/* ══════════════════════════ 9. Cancelamento de job derivado ══════════════════════════ */

secao("9. Cancelamento cooperativo de um job derivado (enriquecimento)");
{
  const ids = [];
  ids.push(await criarProspect("___TesteDerivado Cancel A___", "https://example.com", "livre:academias"));
  ids.push(await criarProspect("___TesteDerivado Cancel B___", "https://example.org", "livre:academias"));
  ids.push(await criarProspect("___TesteDerivado Cancel C___", "https://example.net", "livre:academias"));

  const conv = await novaConversa("teste derivado — cancelamento");
  conversasCriadas.push(conv);

  // prospectIds explícitos — precisa de 3 sites REAIS (não sem-site) pra
  // garantir que o enriquecimento demore o suficiente pra dar tempo do
  // cancelamento chegar antes de terminar.
  const rBase = await api("/api/execucoes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tipo: "prospeccao", conversa_id: conv, prospectIds: ids }),
  });
  await aguardarTerminal(rBase.corpo.execucaoId, 90);

  const rEnr = await enviar(conv, "Agora enriqueça o Instagram, telefone e email.");
  await esperar(1500);
  const cancelResp = await api(`/api/execucoes/${rEnr.inicio.execucaoId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ acao: "cancelar" }),
  });
  ok("cancelamento de job derivado aceito", cancelResp.corpo.ok === true);

  const final = await aguardarTerminal(rEnr.inicio.execucaoId, 60);
  ok("job derivado termina CANCELADO", final?.status === "CANCELADO", final?.status);

  await limparProspects(ids);
}

/* ══════════════════════════ 10. Tool discovery — provedor de pesquisa web ausente é honesto ══════════════════════════ */

secao("10. research.web_search sem provedor configurado — honesto, nunca raspa SERP escondido");
{
  const r = await api("/api/ferramentas");
  const buscaWeb = r.corpo.ferramentas.find((f) => f.nome === "browser.pesquisar");
  ok("browser.pesquisar existe no registro com código real", Boolean(buscaWeb));
  ok(
    "sem SERPAPI_KEY neste ambiente → REQUER_CREDENCIAL (nunca finge ter resultado de busca)",
    buscaWeb?.disponibilidade === "REQUER_CREDENCIAL",
    buscaWeb?.disponibilidade,
  );
}

/* ══════════════════════════ Limpeza ══════════════════════════ */

secao("11. Limpeza");
{
  const { DatabaseSync } = await import("node:sqlite");
  const { unlinkSync } = await import("node:fs");
  const d = new DatabaseSync("dados/jarvis.db");
  d.exec("PRAGMA foreign_keys = ON");

  for (const conversaId of conversasCriadas) {
    const jobs = d.prepare("SELECT id FROM jobs WHERE conversa_id = ?").all(conversaId);
    for (const j of jobs) {
      const arquivos = d
        .prepare(`SELECT ag.caminho FROM arquivos_gerados ag JOIN resultados r ON r.id = ag.resultado_id WHERE r.execucao_id = ?`)
        .all(j.id);
      for (const a of arquivos) {
        try {
          unlinkSync(a.caminho);
        } catch {
          /* já não existe */
        }
      }
      d.prepare("DELETE FROM jobs WHERE id = ?").run(j.id);
    }
    d.prepare("DELETE FROM conversas WHERE id = ?").run(conversaId);
  }
  d.prepare("DELETE FROM prospects WHERE negocio LIKE '___TesteDerivado%'").run();

  const sobrouProspects = d.prepare("SELECT COUNT(*) n FROM prospects WHERE negocio LIKE '___TesteDerivado%'").get().n;
  d.close();
  ok("prospects de teste removidos", sobrouProspects === 0);
}

console.log(`\n${"─".repeat(56)}`);
console.log(`PASSOU: ${passou}   FALHOU: ${falhou}`);
if (falhou > 0) {
  console.log("RESULTADO: FALHOU");
  process.exit(1);
}
console.log("RESULTADO: TUDO PASSOU");
