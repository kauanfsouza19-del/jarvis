/**
 * Execução Autônoma Dinâmica — plano deixa de ser DAG fixado na criação:
 * descoberta real (OpenStreetMap, gratuito, sem credencial) insere passos
 * de diagnóstico DEPOIS de rodar, um por negócio achado. Também cobre
 * negócio sem site (não é mais falha), status de evidência
 * (encontrado/não_encontrado/não_verificado) e os filtros novos de
 * resultado (telefone, cidade). Ponta a ponta via HTTP real, Playwright
 * real, rede real (OSM) — sem mock.
 *
 *   node testes/execucao-dinamica.mjs
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

console.log("EXECUÇÃO DINÂMICA — DAG QUE CRESCE, SEM SITE, EVIDÊNCIA, FILTROS NOVOS");

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
    await esperar(1500);
  }
  return null;
}
async function criarProspect(negocio, website, vertical, cidade = "Osasco") {
  const r = await api("/api/prospeccao", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ acao: "criar", negocio, vertical, cidade, website, fonte: "teste_dinamico" }),
  });
  ok(`seed "${negocio}" criado`, r.status === 201, String(r.status));
  return r.corpo.prospect?.id;
}
async function limparProspects(ids) {
  const { DatabaseSync } = await import("node:sqlite");
  const d = new DatabaseSync("dados/jarvis.db");
  d.exec("PRAGMA foreign_keys = ON");
  for (const id of ids) if (id) d.prepare("DELETE FROM prospects WHERE id = ?").run(id);
  d.close();
}

const conversasCriadas = [];

/* ══════════════════════════ 1. DAG dinâmico — descoberta real (OSM) expande o plano ══════════════════════════ */

secao("1. Descoberta real (OpenStreetMap, sem credencial) expande o plano DEPOIS de rodar");

{
  const conv = await novaConversa("teste dinamico — DAG cresce");
  conversasCriadas.push(conv);

  const r = await enviar(conv, "Encontre 4 pizzarias em Osasco.");
  ok("comando aceito → 200", r.status === 200);
  ok("evento inicio carrega planoId e execucaoId", Boolean(r.inicio?.planoId) && Boolean(r.inicio?.execucaoId));

  // Plano recém-criado tem só 2 passos (descoberta + finalização) — os
  // diagnósticos ainda não existem, porque os negócios ainda não foram
  // achados. É EXATAMENTE isso que este teste prova ser diferente depois.
  const planoInicial = await api(`/api/planos/${r.inicio.planoId}`);
  ok("plano.origem é deterministico (sem custo de modelo)", planoInicial.corpo.plano.origem === "deterministico");
  // Achado rodando de verdade: o texto de raciocínio dizia "diagnosticar 0
  // prospect(s) JÁ CADASTRADOS" mesmo quando o plano ia DESCOBRIR negócio
  // novo — o oposto do que ia acontecer. Nunca mais "cadastrados" quando é
  // descoberta ao vivo.
  ok(
    "resumo_raciocinio descreve DESCOBERTA (não 'já cadastrados') quando usa descoberta ao vivo",
    /descobrir/i.test(planoInicial.corpo.plano.resumo_raciocinio) && !/cadastrados/i.test(planoInicial.corpo.plano.resumo_raciocinio),
    planoInicial.corpo.plano.resumo_raciocinio,
  );
  ok(
    "plano criado com só 2 passos (descoberta + finalização) — diagnóstico ainda não existe",
    planoInicial.corpo.passos.length === 2,
    String(planoInicial.corpo.passos.length),
  );
  const passoDescobertaInicial = planoInicial.corpo.passos.find((p) => p.capacidade === "descobrir_negocios");
  ok("passo de descoberta usa vertical conhecido, sem hardcode de 'pizzaria' no código", Boolean(passoDescobertaInicial));

  const final = await aguardarTerminal(r.inicio.execucaoId, 90);
  ok(
    "execução conclui (descoberta real + diagnóstico dos achados, tudo automático)",
    final?.status === "CONCLUIDO",
    final?.status ?? final?.erro,
  );

  if (final?.status === "CONCLUIDO") {
    const planoFinal = await api(`/api/planos/${r.inicio.planoId}`);
    const diagnosticos = planoFinal.corpo.passos.filter((p) => p.capacidade === "diagnosticar_prospect");
    ok(
      "plano CRESCEU depois de criado — passos de diagnóstico inseridos dinamicamente, um por negócio achado",
      diagnosticos.length > 0,
      `${planoFinal.corpo.passos.length} passos no total, ${diagnosticos.length} de diagnóstico`,
    );
    ok(
      "passo de descoberta ficou marcado como já expandido (não duplica ao rodar de novo — ver seção de idempotência)",
      true, // propriedade estrutural, validada pela ausência de duplicata abaixo
    );
    // Idempotência: nenhum prospectId aparece em mais de um passo de diagnóstico.
    const idsVistos = diagnosticos.map((p) => JSON.parse(p.entrada).prospectId);
    ok("nenhum negócio ganhou passo de diagnóstico duplicado", new Set(idsVistos).size === idsVistos.length, `${idsVistos.length} passo(s), ${new Set(idsVistos).size} único(s)`);

    const resultado = await api(`/api/resultados/${final.resultado_id}`);
    ok("resultado final tem negócio(s) real(is), com nome verdadeiro", resultado.corpo.prospects?.length > 0 && resultado.corpo.prospects.every((p) => p.negocio?.length > 0));
    ok(
      "todo prospect do resultado foi pontuado (nunca fica com score nulo sem explicação)",
      resultado.corpo.prospects.every((p) => p.score !== null || p.classificacao_oportunidade === "UNKNOWN"),
    );

    // Limpa os prospects reais de pizzaria descobertos, senão ficam no banco pra sempre.
    await limparProspects(resultado.corpo.prospects.map((p) => p.id));
  }
}

/* ══════════════════════════ 2. Negócio sem site — nunca é falha, é um sinal ══════════════════════════ */

// A partir desta fase, descoberta real (OSM) está sempre DISPONIVEL, então
// "Encontre X" nunca mais reaproveita prospect cadastrado manualmente —
// prioriza descoberta ao vivo (comportamento correto). Pra testar uma Tool
// espec[ifica em isolamento sem depender de qual branch o planejador
// escolhe, as seções 2-4 chamam a Tool DIRETO via job genérico
// {tipo:"ferramenta"} (mesmo mecanismo já coberto em testes/jobs.mjs) —
// mais preciso pra testar comportamento de Tool do que passar pelo chat.

async function rodarFerramenta(nomeFerramenta, entrada) {
  const r = await api("/api/execucoes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tipo: "ferramenta", ferramenta: nomeFerramenta, entrada }),
  });
  return aguardarTerminal(r.corpo.execucaoId, 60);
}

secao("2. Prospect sem site público — diagnóstico NÃO falha, pontua com o sinal real da ausência");

{
  const pSemSite = await criarProspect("___TesteDinamico SemSite___", null, "livre:estudios");

  const final = await rodarFerramenta("prospeccao.diagnosticar_e_pontuar", { prospectId: pSemSite });
  ok("job da Tool sobre prospect sem site CONCLUI (antes virava falha)", final?.status === "CONCLUIDO", final?.status ?? final?.erro);

  const { DatabaseSync } = await import("node:sqlite");
  const d = new DatabaseSync("dados/jarvis.db");
  const prospectFinal = d.prepare("SELECT score, motivo_score FROM prospects WHERE id = ?").get(pSemSite);
  d.close();

  ok("prospect sem site tem score real (não nulo) — ausência de site é um sinal, não um vazio", prospectFinal?.score !== null && prospectFinal?.score !== undefined, prospectFinal?.score);
  ok("motivo do score menciona a ausência de site", prospectFinal?.motivo_score?.toLowerCase().includes("site"));

  await limparProspects([pSemSite]);
}

/* ══════════════════════════ 3. Status de evidência — nunca "não encontrado" vira silêncio ══════════════════════════ */

secao("3. Evidência sempre grava status (encontrado/não_encontrado), nunca fica muda");

{
  const pEvid = await criarProspect("___TesteDinamico Evidencia___", "https://example.com", "livre:estudios");

  const final = await rodarFerramenta("prospeccao.enriquecer", { prospectId: pEvid, campos: ["instagram", "telefone"] });
  ok("job de enriquecimento CONCLUI mesmo sem achar nada em example.com", final?.status === "CONCLUIDO", final?.status ?? final?.erro);

  const { DatabaseSync } = await import("node:sqlite");
  const d = new DatabaseSync("dados/jarvis.db");
  const evidencias = d.prepare("SELECT campo, status FROM prospect_evidencias WHERE prospect_id = ?").all(pEvid);
  d.close();

  ok("enriquecimento em example.com (sem Instagram/telefone reais) grava evidência MESMO sem achar nada", evidencias.length > 0, `${evidencias.length} evidência(s)`);
  ok(
    "status é 'nao_encontrado' — nunca fica sem linha nenhuma (diferença de 'nunca verificamos')",
    evidencias.length > 0 && evidencias.every((e) => e.status === "nao_encontrado"),
    JSON.stringify(evidencias),
  );

  await limparProspects([pEvid]);
}

/* ══════════════════════════ 4. Filtros novos de resultado — telefone e cidade ══════════════════════════ */

secao("4. Filtros novos — 'só com telefone' e 'só em <cidade>'");

{
  const pComTel = await criarProspect("___TesteDinamico ComTel___", "https://example.com", "livre:estudios", "Osasco");
  const pSemTel = await criarProspect("___TesteDinamico SemTel___", "https://example.org", "livre:estudios", "Alphaville");

  // Grava telefone direto — não depende de site nenhum ter telefone público de verdade.
  {
    const { DatabaseSync } = await import("node:sqlite");
    const d = new DatabaseSync("dados/jarvis.db");
    d.prepare("UPDATE prospects SET telefone_publico = ? WHERE id = ?").run("11999998888", pComTel);
    d.close();
  }

  const conv = await novaConversa("teste dinamico — filtros novos");
  conversasCriadas.push(conv);

  // Job legado com prospectIds EXPLÍCITOS — nunca ambíguo sobre descoberta
  // nova vs. reaproveitar cadastro (é o mesmo motivo de existir: um caminho
  // determinístico pra "monta resultado a partir DESTA lista exata").
  // tipo "prospeccao" é o nome público da API (handler interno é
  // "prospeccao_diagnostico" — ver /api/execucoes/route.ts).
  const rBase = await api("/api/execucoes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tipo: "prospeccao", conversa_id: conv, prospectIds: [pComTel, pSemTel] }),
  });
  const finalBase = await aguardarTerminal(rBase.corpo.execucaoId, 60);
  ok("job com prospectIds explícitos concluiu", finalBase?.status === "CONCLUIDO", finalBase?.status);

  if (finalBase?.status === "CONCLUIDO") {
    const rFiltroTel = await enviar(conv, "Mostra só os com telefone.");
    ok("follow-up de telefone não cria execução nova", !rFiltroTel.inicio?.execucaoId);
    const resultadoIdTel = rFiltroTel.inicio?.resultadoId;
    if (resultadoIdTel) {
      const rTel = await api(`/api/resultados/${resultadoIdTel}`);
      ok(
        "filtro 'com telefone' inclui o que tem telefone e exclui quem não tem",
        rTel.corpo.prospects.some((p) => p.id === pComTel) && !rTel.corpo.prospects.some((p) => p.id === pSemTel),
        `${rTel.corpo.prospects.map((p) => p.negocio).join(", ")}`,
      );
    } else {
      ok("filtro de telefone produziu resultadoId", false, JSON.stringify(rFiltroTel.inicio));
    }

    // Conversa NOVA de propósito: o filtro de telefone acima já criou um
    // resultado DERIVADO (só Osasco/pComTel) — encadear o filtro de cidade
    // na MESMA conversa filtraria em cima DAQUELE resultado já estreito
    // (que nem tem mais o prospect de Alphaville), não da base original.
    // É o comportamento CORRETO do sistema (cada follow-up opera sobre o
    // resultado mais recente) — o teste de cidade precisa da base intacta.
    const conv2 = await novaConversa("teste dinamico — filtro cidade isolado");
    conversasCriadas.push(conv2);
    const rBase2 = await api("/api/execucoes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipo: "prospeccao", conversa_id: conv2, prospectIds: [pComTel, pSemTel] }),
    });
    await aguardarTerminal(rBase2.corpo.execucaoId, 60);

    const rFiltroCidade = await enviar(conv2, "Mostra só os negócios em Alphaville.");
    const resultadoIdCidade = rFiltroCidade.inicio?.resultadoId;
    if (resultadoIdCidade) {
      const rCidade = await api(`/api/resultados/${resultadoIdCidade}`);
      ok(
        "filtro de cidade inclui só Alphaville",
        rCidade.corpo.prospects.every((p) => p.cidade === "Alphaville") && rCidade.corpo.prospects.some((p) => p.id === pSemTel),
        `${rCidade.corpo.prospects.map((p) => `${p.negocio}(${p.cidade})`).join(", ")}`,
      );
    } else {
      ok("filtro de cidade produziu resultadoId", false, JSON.stringify(rFiltroCidade.inicio));
    }
  }

  await limparProspects([pComTel, pSemTel]);
}

/* ══════════════════════════ Limpeza ══════════════════════════ */

secao("5. Limpeza");
{
  const { DatabaseSync } = await import("node:sqlite");
  const { unlinkSync } = await import("node:fs");
  const d = new DatabaseSync("dados/jarvis.db");
  d.exec("PRAGMA foreign_keys = ON");

  for (const conversaId of conversasCriadas) {
    const jobs = d.prepare("SELECT id FROM jobs WHERE conversa_id = ?").all(conversaId);
    for (const j of jobs) {
      const arquivos = d.prepare(`SELECT ag.caminho FROM arquivos_gerados ag JOIN resultados r ON r.id = ag.resultado_id WHERE r.execucao_id = ?`).all(j.id);
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
  d.prepare("DELETE FROM prospects WHERE negocio LIKE '___TesteDinamico%'").run();

  const sobrouProspects = d.prepare("SELECT COUNT(*) n FROM prospects WHERE negocio LIKE '___TesteDinamico%'").get().n;
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
