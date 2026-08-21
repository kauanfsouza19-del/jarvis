/**
 * Orquestrador — descoberta de capacidade, plano persistido, execução com
 * dependência/paralelismo/isolamento de falha, cancelamento, autonomia e
 * registro de Agente. Tudo via HTTP real contra o servidor de dev, na mesma
 * linha de testes/tarefas.mjs e testes/jobs.mjs, mas focado no que É NOVO
 * nesta fase (o Orquestrador em si, não o motor de Job que ele usa por
 * baixo — aquele já tem cobertura própria).
 *
 *   node testes/orquestrador.mjs
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

console.log("ORQUESTRADOR — PLANO, CAPACIDADE, EXECUÇÃO, AUTONOMIA");

async function criarProspect(negocio, website, cidade = "Osasco") {
  const r = await api("/api/prospeccao", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ acao: "criar", negocio, vertical: "delivery_pizzaria", cidade, website, fonte: "teste_orquestrador" }),
  });
  ok(`seed "${negocio}" criado`, r.status === 201, String(r.status));
  return r.corpo.prospect?.id;
}

async function novaConversa(titulo) {
  const r = await api("/api/conversas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ titulo }),
  });
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

// Dedup de prospect é por DOMÍNIO (ver src/lib/prospeccao/pontuacao.ts,
// chaveDeduplicacao) — só existem 3 domínios de documentação garantidos pelo
// RFC 2606 (example.com/.net/.org). Pra reusar esse pool pequeno em várias
// seções sem um seed "sumir" (virar 200/atualização em vez de 201/criação
// por já existir), cada seção limpa os próprios prospects por ID assim que
// termina de usá-los — a próxima seção então cria "de novo" no mesmo domínio
// sem colidir com nada que sobrou.
async function limparProspects(ids) {
  const { DatabaseSync } = await import("node:sqlite");
  const d = new DatabaseSync("dados/jarvis.db");
  d.exec("PRAGMA foreign_keys = ON");
  for (const id of ids) if (id) d.prepare("DELETE FROM prospects WHERE id = ?").run(id);
  d.close();
}

const conversasCriadas = [];

/* ══════════════════════════ 1. Descoberta de capacidade (5 estados, honesto) ══════════════════════════ */

secao("1. Descoberta dinâmica de capacidade — /api/ferramentas");

{
  const r = await api("/api/ferramentas");
  const fs = r.corpo.ferramentas ?? [];
  ok("GET /api/ferramentas → 200 com lista", r.status === 200 && Array.isArray(fs) && fs.length > 0, `${fs.length} ferramenta(s)`);
  ok("toda ferramenta expõe capacidade (nunca nome fixo p/ o planejador)", fs.every((f) => typeof f.capacidade === "string" && f.capacidade.length > 0));
  ok("toda ferramenta expõe disponibilidade", fs.every((f) => typeof f.disponibilidade === "string"));

  const porNome = Object.fromEntries(fs.map((f) => [f.nome, f]));

  ok("browser.diagnosticar_site → DISPONIVEL (real, implementado, sem credencial)", porNome["browser.diagnosticar_site"]?.disponibilidade === "DISPONIVEL");
  ok("prospeccao.diagnosticar_e_pontuar → DISPONIVEL", porNome["prospeccao.diagnosticar_e_pontuar"]?.disponibilidade === "DISPONIVEL");
  ok(
    "modelo.gerar_abordagem → REQUER_CREDENCIAL (sem ANTHROPIC_API_KEY neste ambiente)",
    porNome["modelo.gerar_abordagem"]?.disponibilidade === "REQUER_CREDENCIAL",
    porNome["modelo.gerar_abordagem"]?.disponibilidade,
  );
  ok(
    "whatsapp.enviar → NAO_IMPLEMENTADO (stub — nunca finge estar conectado; ver testes/ferramentas-tipos.mjs para REQUER_APROVACAO isolado)",
    porNome["whatsapp.enviar"]?.disponibilidade === "NAO_IMPLEMENTADO",
    porNome["whatsapp.enviar"]?.disponibilidade,
  );
  ok(
    // Fase de Prospecção Comercial: places.descobrir_negocios ganhou código
    // real (Google Places Text Search, ver pesquisa/places.ts) — não é mais
    // stub. Sem GOOGLE_PLACES_API_KEY neste ambiente, o estado honesto
    // passou a ser REQUER_CREDENCIAL (existe, falta chave), não mais
    // NAO_IMPLEMENTADO (não existia). Cobertura de REQUER_APROVACAO/
    // NAO_IMPLEMENTADO isolado continua em testes/ferramentas-tipos.mjs.
    "places.descobrir_negocios → REQUER_CREDENCIAL (código real, falta GOOGLE_PLACES_API_KEY)",
    porNome["places.descobrir_negocios"]?.disponibilidade === "REQUER_CREDENCIAL",
    porNome["places.descobrir_negocios"]?.disponibilidade,
  );
  ok(
    "google_ads.negativar → NAO_IMPLEMENTADO (não implementado vence sobre exigir aprovação)",
    porNome["google_ads.negativar"]?.disponibilidade === "NAO_IMPLEMENTADO",
    porNome["google_ads.negativar"]?.disponibilidade,
  );

  const naoExistente = await api("/api/planos/id-que-nao-existe");
  ok("GET /api/planos/:id inexistente → 404", naoExistente.status === 404);
}

/* ══════════════════════════ 2. Plano criado e persistido ══════════════════════════ */

secao("2. Objetivo em linguagem natural vira Plano persistido");

{
  const pid = await criarProspect("___TesteOrq Pizzaria Solo___", "https://example.com");
  const conversaId = await novaConversa("teste orquestrador — plano");
  conversasCriadas.push(conversaId);

  const r = await enviar(conversaId, "Encontre pizzarias em Osasco.");
  ok("comando aceito → 200", r.status === 200, String(r.status));
  ok("evento inicio carrega planoId", Boolean(r.inicio?.planoId), r.inicio?.planoId ?? "ausente");
  ok("evento inicio carrega execucaoId (autonomia padrão executa)", Boolean(r.inicio?.execucaoId));

  const planoResp = await api(`/api/planos/${r.inicio.planoId}`);
  ok("GET /api/planos/:id → 200", planoResp.status === 200);
  const { plano, passos } = planoResp.corpo;
  ok("plano.objetivo bate com a mensagem enviada", plano?.objetivo === "Encontre pizzarias em Osasco.");
  ok("plano.origem é deterministico (sem custo de modelo)", plano?.origem === "deterministico");
  ok("plano.resumo_raciocinio é curto e operacional (nunca vazio)", typeof plano?.resumo_raciocinio === "string" && plano.resumo_raciocinio.length > 0 && plano.resumo_raciocinio.length < 300);
  ok("plano já saiu de RASCUNHO (autonomia padrão executa)", plano?.estado !== "RASCUNHO", plano?.estado);
  ok("plano tem passos persistidos", Array.isArray(passos) && passos.length >= 2, `${passos?.length}`);

  // Descoberta ao vivo (OSM) está sempre disponível desde a fase de
  // Execução Dinâmica — "Encontre pizzarias" prioriza achar pizzaria REAL
  // em vez de reaproveitar o seed manual `pid` (comportamento correto e
  // intencional). O plano nasce com só 2 passos (descoberta + finalização)
  // — diagnóstico é inserido DINAMICAMENTE depois que a descoberta roda
  // (ver testes/execucao-dinamica.mjs seção 1 pra cobertura dedicada disso),
  // então a checagem de "existe passo de diagnóstico" só faz sentido DEPOIS
  // de esperar a execução, não no plano recém-criado.
  const passoResultado = passos.find((p) => p.capacidade === "gerar_arquivo_resultado");
  ok("passo final depende do passo de descoberta (grafo de dependência real)", JSON.parse(passoResultado.depende_de).length >= 1);

  const final = await aguardarTerminal(r.inicio.execucaoId, 90);
  ok("execução concluiu de verdade", final?.status === "CONCLUIDO", final?.status);

  const planoFinal = (await api(`/api/planos/${r.inicio.planoId}`)).corpo;
  const passoDiagnosticoDepois = planoFinal.passos.find((p) => p.capacidade === "diagnosticar_prospect");
  ok(
    "passo de diagnóstico foi inserido dinamicamente após a descoberta, com prospectId de verdade",
    Boolean(passoDiagnosticoDepois) && typeof JSON.parse(passoDiagnosticoDepois.entrada).prospectId === "string",
  );
  const passoFinalDepois = planoFinal.passos.find((p) => p.capacidade === "gerar_arquivo_resultado");
  ok(
    "passo especial 'gerar_arquivo_resultado' termina CONCLUIDO, não preso em espera (regressão do bug de loop infinito)",
    passoFinalDepois?.status === "CONCLUIDO",
    passoFinalDepois?.status,
  );
  ok("plano final marcado CONCLUIDO", planoFinal.plano.estado === "CONCLUIDO", planoFinal.plano.estado);

  // Limpa o seed manual E qualquer negócio real descoberto ao vivo nesta seção.
  const idsDescobertos = final?.resultado_id ? (await api(`/api/resultados/${final.resultado_id}`)).corpo.prospects.map((p) => p.id) : [];
  await limparProspects([pid, ...idsDescobertos]);
}

/* ══════════════════════════ 3. Dependência + paralelismo + limite de concorrência ══════════════════════════ */

secao("3. Múltiplos passos independentes rodam em paralelo (respeitando dependência)");

{
  const nomes = ["___TesteOrq Multi A___", "___TesteOrq Multi B___", "___TesteOrq Multi C___", "___TesteOrq Multi D___"];
  const sites = ["https://example.com", "https://example.org", "https://example.net", "https://example.edu"];
  const idsMulti = [];
  for (let i = 0; i < nomes.length; i++) idsMulti.push(await criarProspect(nomes[i], sites[i]));

  const conversaId = await novaConversa("teste orquestrador — paralelo");
  conversasCriadas.push(conversaId);

  const t0 = Date.now();
  const r = await enviar(conversaId, "Encontre 4 pizzarias em Osasco.");
  const final = await aguardarTerminal(r.inicio.execucaoId, 120);
  const duracao = Date.now() - t0;

  ok("execução com 4 prospects concluiu", final?.status === "CONCLUIDO", final?.status);

  const planoResp = await api(`/api/planos/${r.inicio.planoId}`);
  const diagnosticos = planoResp.corpo.passos.filter((p) => p.capacidade === "diagnosticar_prospect");
  ok("4 passos de diagnóstico persistidos, um por prospect", diagnosticos.length === 4, String(diagnosticos.length));
  ok("todos os 4 passos concluíram", diagnosticos.every((p) => p.status === "CONCLUIDO"), diagnosticos.map((p) => p.status).join(","));
  ok(
    "tempo total é compatível com execução em lotes paralelos (limite=3), não 4x serial",
    duracao < 100000,
    `${duracao}ms para 4 diagnósticos com LIMITE_CONCORRENCIA=3`,
  );

  const resultadoId = final.resultado_id;
  const resultado = (await api(`/api/resultados/${resultadoId}`)).corpo;
  ok("resultado final inclui os 4 prospects", resultado.prospects?.length === 4, String(resultado.prospects?.length));

  await limparProspects(idsMulti);
}

/* ══════════════════════════ 4. Isolamento de falha — um prospect ruim não derruba o plano ══════════════════════════ */

secao("4. Falha em um passo não derruba o plano inteiro (execução adaptativa)");

{
  const pOk = await criarProspect("___TesteOrq Isolamento OK___", "https://example.com");
  const pRuim = await criarProspect("___TesteOrq Isolamento Ruim___", "https://dominio-que-nao-existe-de-verdade-jarvis-teste.invalid");

  const conversaId = await novaConversa("teste orquestrador — falha parcial");
  conversasCriadas.push(conversaId);

  // prospectIds EXPLÍCITOS de propósito: isolamento de falha precisa de
  // controle determinístico sobre QUAIS dois prospects entram no plano (um
  // domínio bom, um inválido) — descoberta ao vivo (OSM) não garante isso.
  // "objetivo em linguagem natural" já é coberto pela seção 2 acima.
  const rCriacao = await api("/api/execucoes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tipo: "prospeccao", conversa_id: conversaId, prospectIds: [pOk, pRuim] }),
  });
  const final = await aguardarTerminal(rCriacao.corpo.execucaoId, 60);

  ok(
    "plano com falha PARCIAL ainda conclui (não é 'tudo ou nada')",
    final?.status === "CONCLUIDO",
    final?.status,
  );

  // O handler legado (tipo "prospeccao") inclui TODO prospect pedido no
  // resultado final, sucesso ou falha — não exclui o que falhou (isso é
  // comportamento do Orquestrador/Plano, testado de verdade com Plano real
  // em testes/execucao-dinamica.mjs seção 8). Aqui o isolamento é verificado
  // no que É próprio do handler legado: o prospect com domínio inválido
  // FALHOU o diagnóstico (score continua null) sem impedir o outro de ter
  // sucesso — nunca "tudo ou nada".
  const { DatabaseSync } = await import("node:sqlite");
  const dCheck = new DatabaseSync("dados/jarvis.db");
  const scoreOk = dCheck.prepare("SELECT score FROM prospects WHERE id = ?").get(pOk)?.score;
  const scoreRuim = dCheck.prepare("SELECT score FROM prospects WHERE id = ?").get(pRuim)?.score;
  dCheck.close();
  ok("prospect com domínio inválido nunca foi diagnosticado com sucesso (score continua null)", scoreRuim === null, `score=${scoreRuim}`);
  ok("prospect com site válido foi diagnosticado com sucesso, isolado da falha do outro", typeof scoreOk === "number", `score=${scoreOk}`);

  const resultado = (await api(`/api/resultados/${final.resultado_id}`)).corpo;
  ok("resultado final inclui os 2 prospects pedidos (handler legado não exclui falha — ver nota acima)", resultado.prospects?.length === 2, `${resultado.prospects?.length} prospect(s)`);

  await limparProspects([pOk, pRuim]);
}

/* ══════════════════════════ 5. Cancelamento cooperativo do plano orquestrado ══════════════════════════ */

secao("5. Cancelamento cooperativo de um plano em execução");

{
  const nomes = ["___TesteOrq Cancel A___", "___TesteOrq Cancel B___", "___TesteOrq Cancel C___"];
  const sitesCancel = ["https://example.com", "https://example.org", "https://example.net"];
  const ids = [];
  for (let i = 0; i < nomes.length; i++) ids.push(await criarProspect(nomes[i], sitesCancel[i]));

  const conversaId = await novaConversa("teste orquestrador — cancelamento");
  conversasCriadas.push(conversaId);

  const r = await enviar(conversaId, "Encontre 3 pizzarias em Osasco.");
  await esperar(1500); // deixa o primeiro lote começar de verdade antes de pedir cancelamento

  const cancelResp = await api(`/api/execucoes/${r.inicio.execucaoId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ acao: "cancelar" }),
  });
  ok("pedido de cancelamento de plano orquestrado aceito", cancelResp.corpo.ok === true, JSON.stringify(cancelResp.corpo));

  const final = await aguardarTerminal(r.inicio.execucaoId, 60);
  ok("job de plano orquestrado termina CANCELADO", final?.status === "CANCELADO", final?.status);

  const planoResp = await api(`/api/planos/${r.inicio.planoId}`);
  const naoConcluidos = planoResp.corpo.passos.filter((p) => p.status !== "CONCLUIDO");
  ok("cancelamento interrompeu antes de completar todos os passos", naoConcluidos.length > 0, `${naoConcluidos.length} passo(s) não concluído(s)`);

  await limparProspects(ids);
}

/* ══════════════════════════ 6. Autonomia — nível 0 só sugere, nunca executa ══════════════════════════ */

secao("6. Autonomia configurável — nível 0 gera plano mas NÃO cria job");

{
  const nivelAntes = await api("/api/autonomia");
  ok("GET /api/autonomia responde nível numérico com descrição em português", typeof nivelAntes.corpo.nivel === "number" && typeof nivelAntes.corpo.descricao === "string");
  ok("nível padrão é conservador (1 — só leitura automática)", nivelAntes.corpo.nivel === 1, String(nivelAntes.corpo.nivel));

  const setar0 = await api("/api/autonomia", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nivel: 0 }),
  });
  ok("PATCH nível 0 aceito", setar0.status === 200 && setar0.corpo.nivel === 0);

  const pid = await criarProspect("___TesteOrq Autonomia0___", "https://example.com");
  const conversaId = await novaConversa("teste orquestrador — autonomia 0");
  conversasCriadas.push(conversaId);

  const r = await enviar(conversaId, "Encontre pizzarias em Osasco.");
  ok("em autonomia 0, plano é criado (fica visível/revisável)", Boolean(r.inicio?.planoId));
  ok("em autonomia 0, NENHUM job é criado/disparado", !r.inicio?.execucaoId, JSON.stringify(r.inicio));

  const planoResp = await api(`/api/planos/${r.inicio.planoId}`);
  ok("plano fica em RASCUNHO, nunca silenciosamente aprovado", planoResp.corpo.plano.estado === "RASCUNHO", planoResp.corpo.plano.estado);

  const invalido = await api("/api/autonomia", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nivel: 99 }),
  });
  ok("nível fora do intervalo 0-4 é rejeitado → 400", invalido.status === 400, String(invalido.status));

  const semCorpo = await api("/api/autonomia", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{}" });
  ok("PATCH sem 'nivel' → 400", semCorpo.status === 400, String(semCorpo.status));

  // restaura o padrão pros demais testes/uso real do Cacique
  const restaurar = await api("/api/autonomia", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nivel: 1 }),
  });
  ok("autonomia restaurada para o padrão (1) ao final do teste", restaurar.corpo.nivel === 1);

  await limparProspects([pid]);
}

/* ══════════════════════════ 7. Registro de Agente — configuração, nunca código ══════════════════════════ */

secao("7. Registro de Agente (config-only)");

{
  const r = await api("/api/agentes");
  ok("GET /api/agentes → 200", r.status === 200);
  const seed = r.corpo.agentes?.find((a) => a.papel === "prospeccao");
  ok("Agente de Prospecção seedado existe e é ATIVO", seed?.estado === "ATIVO", JSON.stringify(seed));
  ok(
    "capacidades do agente seedado batem com o que o planejador determinístico realmente usa",
    JSON.parse(seed?.capacidades ?? "[]").includes("diagnosticar_prospect"),
  );

  const criar = await api("/api/agentes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nome: "___Teste Agente Temporário___",
      papel: "teste",
      objetivo: "Agente de teste automatizado — nunca deveria sobreviver ao teste.",
      capacidades: ["diagnosticar_prospect"],
    }),
  });
  ok("criar agente válido → 201", criar.status === 201, String(criar.status));
  ok("agente criado ganhou id real", Boolean(criar.corpo.agente?.id));
  const agenteTesteId = criar.corpo.agente?.id;

  const semCampo = await api("/api/agentes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nome: "sem objetivo nem capacidades" }),
  });
  ok("criar agente incompleto → 400 (config-only não aceita meia configuração)", semCampo.status === 400, String(semCampo.status));

  // limpeza direta no banco — não há rota DELETE (fora de escopo desta fase)
  const { DatabaseSync } = await import("node:sqlite");
  const dbLimpo = new DatabaseSync("dados/jarvis.db");
  dbLimpo.prepare("DELETE FROM agentes WHERE id = ?").run(agenteTesteId);
  dbLimpo.close();
}

/* ══════════════════════════ Limpeza ══════════════════════════ */

secao("8. Limpeza");

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
  d.prepare("DELETE FROM prospects WHERE negocio LIKE '___TesteOrq%'").run();

  const sobrouConversas = d
    .prepare(`SELECT COUNT(*) n FROM conversas WHERE id IN (${conversasCriadas.map(() => "?").join(",") || "NULL"})`)
    .get(...conversasCriadas).n;
  const sobrouProspects = d.prepare("SELECT COUNT(*) n FROM prospects WHERE negocio LIKE '___TesteOrq%'").get().n;
  d.close();

  ok("conversas de teste removidas", sobrouConversas === 0);
  ok("prospects de teste removidos", sobrouProspects === 0);
}

console.log(`\n${"─".repeat(56)}`);
console.log(`PASSOU: ${passou}   FALHOU: ${falhou}`);
if (falhou > 0) {
  console.log("RESULTADO: FALHOU");
  process.exit(1);
}
console.log("RESULTADO: TUDO PASSOU");
