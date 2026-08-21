/**
 * Fase 5 — Pipeline Dinâmico de Ponta a Ponta: um único objetivo encadeia
 * DESCOBERTA -> ENRIQUECIMENTO -> DIAGNÓSTICO -> ANÁLISE DE MARKETING ->
 * (seleção) -> ABORDAGEM, tudo dinamicamente inserido depois que cada
 * estágio roda de verdade — nunca um DAG fixo pré-calculado. O Planejador
 * decide QUAIS estágios encadear a partir do texto do objetivo (nunca todos
 * por padrão). Ponta a ponta via HTTP real, OpenStreetMap real (sem
 * credencial), Playwright real — sem mock.
 *
 *   node testes/pipeline-dinamico.mjs
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

console.log("PIPELINE DINÂMICO DE PONTA A PONTA — FASE 5");

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
async function aguardarTerminal(execucaoId, tentativas = 150) {
  for (let i = 0; i < tentativas; i++) {
    const r = await api(`/api/execucoes/${execucaoId}`);
    const s = r.corpo.execucao?.status;
    if (["CONCLUIDO", "FALHOU", "BLOQUEADO", "CANCELADO", "AGUARDANDO_APROVACAO"].includes(s)) return r.corpo.execucao;
    await esperar(1000);
  }
  return null;
}

const conversasCriadas = [];
const prospectIdsDeTeste = [];

/* ══════════════════════════ 1. Objetivo raso ("encontre") NÃO encadeia estágio nenhum a mais ══════════════════════════ */

secao("1. Objetivo raso — 'encontre' não força enriquecimento nem marketing (Planejador nunca força todos os estágios)");
{
  const conv = await novaConversa("teste pipeline — raso");
  conversasCriadas.push(conv);
  const r = await enviar(conv, "Encontre 2 academias em Osasco.");
  ok("comando aceito", r.status === 200);
  const final = await aguardarTerminal(r.inicio.execucaoId);
  ok("job concluiu", final?.status === "CONCLUIDO", final?.status);

  const plano = await api(`/api/planos/${r.inicio.planoId}`);
  const capacidades = (plano.corpo.passos ?? []).map((p) => p.capacidade);
  ok("plano NÃO tem passo de enriquecimento (raso não pede)", !capacidades.includes("enriquecer_prospect"), capacidades.join(","));
  ok("plano NÃO tem passo de análise de marketing (raso não pede)", !capacidades.includes("analisar_marketing_digital"), capacidades.join(","));
  ok("plano TEM diagnóstico (sempre grava score)", capacidades.includes("diagnosticar_prospect"));

  const resultado = final?.resultado_id ? (await api(`/api/resultados/${final.resultado_id}`)).corpo : null;
  for (const p of resultado?.prospects ?? []) prospectIdsDeTeste.push(p.id);
}

/* ══════════════════════════ 2. "boas oportunidades" encadeia o pipeline PROFUNDO ══════════════════════════ */

secao("2. 'boas oportunidades' encadeia enriquecimento -> diagnóstico -> marketing, um estágio de cada vez, dinamicamente");
let resultadoProfundo;
{
  const conv = await novaConversa("teste pipeline — profundo");
  conversasCriadas.push(conv);
  const r = await enviar(conv, "Encontre 6 academias em Alphaville que parecem boas oportunidades.");
  ok("comando aceito", r.status === 200);

  const final = await aguardarTerminal(r.inicio.execucaoId, 180);
  ok("job concluiu", final?.status === "CONCLUIDO", final?.status);

  const plano = await api(`/api/planos/${r.inicio.planoId}`);
  const resumo = plano.corpo.plano?.resumo_raciocinio ?? "";
  ok("resumo do plano descreve a cadeia (não é o texto raso de sempre)", /→/.test(resumo) || /enriquec/i.test(resumo), resumo);
  const passos = plano.corpo.passos ?? [];
  const capacidades = passos.map((p) => p.capacidade);
  ok("plano CRESCEU com enriquecimento dinamicamente", capacidades.includes("enriquecer_prospect"), capacidades.join(","));
  ok("plano CRESCEU com diagnóstico dinamicamente", capacidades.includes("diagnosticar_prospect"));
  ok("plano CRESCEU com análise de marketing dinamicamente", capacidades.includes("analisar_marketing_digital"));

  // Cada estágio deve depender do estágio anterior do MESMO prospect —
  // prova que é uma CADEIA, não passos soltos e paralelos sem relação.
  const diagPassos = passos.filter((p) => p.capacidade === "diagnosticar_prospect");
  const temDependenciaEncadeada = diagPassos.every((p) => {
    const deps = JSON.parse(p.depende_de ?? "[]");
    if (deps.length === 0) return false;
    return deps.some((depId) => passos.find((x) => x.id === depId)?.capacidade === "enriquecer_prospect");
  });
  ok("cada diagnóstico depende do ENRIQUECIMENTO do mesmo prospect (cadeia real, não paralelo solto)", temDependenciaEncadeada);

  const idsDoLote = [
    ...new Set(
      passos
        .filter((p) => p.capacidade === "diagnosticar_prospect")
        .map((p) => JSON.parse(p.entrada).prospectId)
        .filter(Boolean),
    ),
  ];
  prospectIdsDeTeste.push(...idsDoLote);

  ok("achou pelo menos 1 prospect pra testar reaproveitamento", idsDoLote.length > 0, String(idsDoLote.length));

  if (idsDoLote.length > 0) {
    const { DatabaseSync } = await import("node:sqlite");
    const d = new DatabaseSync("dados/jarvis.db");
    for (const id of idsDoLote) {
      const p = d.prepare("SELECT website FROM prospects WHERE id = ?").get(id);
      if (!p?.website) continue; // sem site não visita nada, não tem o que reaproveitar
      const visitas = d.prepare("SELECT COUNT(*) AS n FROM diagnosticos_site WHERE prospect_id = ?").get(id);
      ok(
        `prospect com site foi visitado 1 VEZ só (enriquecimento + diagnóstico + marketing reaproveitaram, não revisitaram 3x)`,
        visitas.n === 1,
        `${id.slice(0, 8)} — ${visitas.n} visita(s)`,
      );
    }
    d.close();
  }

  // Evidência mais forte nunca é sobrescrita por mais fraca: quando o OSM já
  // tagueou telefone na descoberta (confiança "media", ver ferramentas/
  // registro.ts osmDescobrirNegocios), o enriquecimento/diagnóstico que
  // rodou DEPOIS (extração de site, confiança sempre "baixa") não pode ter
  // trocado esse valor por um diferente e mais fraco.
  if (idsDoLote.length > 0) {
    const { DatabaseSync } = await import("node:sqlite");
    const d = new DatabaseSync("dados/jarvis.db");
    let algumComEvidenciaOSM = false;
    for (const id of idsDoLote) {
      const evidenciaOSM = d
        .prepare("SELECT valor FROM prospect_evidencias WHERE prospect_id = ? AND campo = 'telefone' AND fonte = 'openstreetmap' AND status = 'encontrado' ORDER BY coletado_em ASC LIMIT 1")
        .get(id);
      if (!evidenciaOSM) continue;
      algumComEvidenciaOSM = true;
      const prospect = d.prepare("SELECT telefone_publico FROM prospects WHERE id = ?").get(id);
      ok(
        `telefone com evidência OSM (média confiança) não foi sobrescrito por extração de site (baixa confiança) — ${id.slice(0, 8)}`,
        prospect?.telefone_publico === evidenciaOSM.valor,
        `OSM=${evidenciaOSM.valor} atual=${prospect?.telefone_publico}`,
      );
    }
    d.close();
    if (!algumComEvidenciaOSM) console.log("  (nenhum negócio deste lote tinha telefone tagueado no OSM — proteção de força de evidência não exercida nesta rodada, achado real de cobertura de dados)");
  }

  resultadoProfundo = final?.resultado_id ? (await api(`/api/resultados/${final.resultado_id}`)).corpo : null;
  ok("resultado final tem os prospects", (resultadoProfundo?.prospects?.length ?? 0) > 0, String(resultadoProfundo?.prospects?.length));
}

/* ══════════════════════════ 3. Abordagem: seleção das melhores N, e falha de abordagem NUNCA derruba o prospect ══════════════════════════ */

secao("3. 'prepare abordagem para as melhores N' seleciona depois do pipeline completo — sem credencial, falha honesta SEM perder o prospect");
{
  const conv = await novaConversa("teste pipeline — abordagem");
  conversasCriadas.push(conv);
  const r = await enviar(conv, "Encontre 2 academias em Osasco boas oportunidades e prepare abordagem para as melhores 2.");
  ok("comando aceito", r.status === 200);

  const final = await aguardarTerminal(r.inicio.execucaoId, 180);
  ok("job não trava — termina em estado final", Boolean(final?.status), final?.status);

  const plano = await api(`/api/planos/${r.inicio.planoId}`);
  const passos = plano.corpo.passos ?? [];
  const passosAbordagem = passos.filter((p) => p.capacidade === "gerar_abordagem");
  ok("plano tentou gerar abordagem (seleção pós-pipeline aconteceu)", passosAbordagem.length > 0, String(passosAbordagem.length));
  ok(
    "abordagem falhou honesto por falta de credencial (ambiente de teste não tem ANTHROPIC_API_KEY)",
    passosAbordagem.every((p) => p.status === "FALHOU" && /credencial/i.test(p.erro ?? "")),
    passosAbordagem.map((p) => `${p.status}:${p.erro}`).join(" | "),
  );

  const resultado = final?.resultado_id ? (await api(`/api/resultados/${final.resultado_id}`)).corpo : null;
  ok(
    "MESMO com abordagem falhando, os prospects (descobertos+diagnosticados) continuam no resultado — abordagem é complemento, não pré-requisito",
    (resultado?.prospects?.length ?? 0) > 0,
    String(resultado?.prospects?.length),
  );
  for (const p of resultado?.prospects ?? []) prospectIdsDeTeste.push(p.id);
}

/* ══════════════════════════ 4. Limpeza ══════════════════════════ */

secao("4. Limpeza");
{
  const { DatabaseSync } = await import("node:sqlite");
  const d = new DatabaseSync("dados/jarvis.db");
  d.exec("PRAGMA foreign_keys = ON");
  for (const id of new Set(prospectIdsDeTeste)) {
    d.prepare("DELETE FROM prospects WHERE id = ?").run(id);
  }
  for (const conv of conversasCriadas) {
    d.prepare("DELETE FROM conversas WHERE id = ?").run(conv);
  }
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
