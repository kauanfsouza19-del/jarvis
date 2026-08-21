/**
 * Funções puras da Fase de Prospecção Comercial — normalização de resposta
 * de API (Places/SerpApi, com resposta FABRICADA, sem chave real nem rede)
 * e o motor de pontuação explicável (classificação HOT/HIGH/MEDIUM/LOW/
 * UNKNOWN, confiança, limiares configuráveis).
 *
 *   node --import ./testes/lib/resolver-ts.mjs testes/pesquisa-e-pontuacao.mjs
 */

import { normalizarRespostaPlaces, normalizarRespostaSerpApi } from "../src/lib/pesquisa/normalizacao.ts";
import { pontuarProspect, LIMIARES_OPORTUNIDADE, chaveDeduplicacao } from "../src/lib/prospeccao/pontuacao.ts";
import { analisarSinaisMarketing } from "../src/lib/prospeccao/marketing.ts";
import { validarInterpretacaoDerivada, interpretarComandoDerivado } from "../src/lib/orquestrador/interpretador.ts";

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
const lanca = (fn) => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};

console.log("PESQUISA (normalização) + PONTUAÇÃO EXPLICÁVEL + INTERPRETAÇÃO DERIVADA");

secao("1. normalizarRespostaPlaces — resposta fabricada da Google Places API (sem chave, sem rede)");
{
  const respostaOk = {
    status: "OK",
    results: [
      { place_id: "ChIJ_abc123", name: "Academia Fit Osasco", formatted_address: "Rua X, 100 - Centro, Osasco - SP, 06000-000, Brasil" },
      { place_id: "ChIJ_def456", name: "Academia Corpo & Cia", formatted_address: "Av. Y, 200 - Jardim, Osasco - SP, 06010-000, Brasil" },
    ],
  };
  const r = normalizarRespostaPlaces(respostaOk, "Osasco");
  ok("status OK com results → ok:true", r.ok === true);
  ok("2 negócios normalizados", r.ok && r.negocios.length === 2, r.ok ? String(r.negocios.length) : "erro");
  ok("place_id preservado", r.ok && r.negocios[0].placeId === "ChIJ_abc123");
  ok("cidade extraída do endereço formatado", r.ok && r.negocios[0].cidade === "Osasco", r.ok ? r.negocios[0].cidade : "-");

  const respostaVazia = normalizarRespostaPlaces({ status: "ZERO_RESULTS" }, "Osasco");
  ok("ZERO_RESULTS → ok:true com lista vazia (nunca erro)", respostaVazia.ok === true && respostaVazia.negocios.length === 0);

  const respostaNegada = normalizarRespostaPlaces({ status: "REQUEST_DENIED", error_message: "chave inválida" }, "Osasco");
  ok("REQUEST_DENIED → ok:false com motivo real (nunca finge sucesso)", respostaNegada.ok === false && respostaNegada.erro.includes("REQUEST_DENIED"));

  ok("resposta null → ok:false, nunca lança", normalizarRespostaPlaces(null, "Osasco").ok === false);
  ok("resposta sem results → ok:false", normalizarRespostaPlaces({ status: "OK" }, "Osasco").ok === false);

  const semPlaceId = normalizarRespostaPlaces({ status: "OK", results: [{ name: "Sem place_id" }] }, "Osasco");
  ok("resultado sem place_id é descartado (nunca cria prospect sem identificador real)", semPlaceId.ok && semPlaceId.negocios.length === 0);
}

secao("2. normalizarRespostaSerpApi — resposta fabricada (sem chave, sem rede)");
{
  const bruto = {
    organic_results: [
      { title: "Pizzaria X", link: "https://exemplo.com", snippet: "A melhor pizza de Osasco." },
      { title: "sem link", snippet: "descartado" },
    ],
  };
  const r = normalizarRespostaSerpApi(bruto);
  ok("1 resultado válido extraído (o sem link é descartado)", r.length === 1, String(r.length));
  ok("título e url corretos", r[0].titulo === "Pizzaria X" && r[0].url === "https://exemplo.com");
  ok("resposta sem organic_results → lista vazia, nunca lança", normalizarRespostaSerpApi({}).length === 0);
  ok("resposta null → lista vazia", normalizarRespostaSerpApi(null).length === 0);
}

secao("3. pontuarProspect — classificação explicável (HOT/HIGH/MEDIUM/LOW/UNKNOWN) e limiares configuráveis");
{
  const base = {
    vertical: "delivery_pizzaria",
    temWebsite: false,
    temWhatsapp: false,
    temInstagram: false,
    temEmail: false,
    temTelefone: false,
    temMetaPixel: null,
    temGtm: null,
    temGa4: null,
    viewportMobile: null,
    plataformaEcommerce: null,
    cnpjEncontrado: false,
  };

  const semNada = pontuarProspect(base);
  ok("sem site nem canal → classificação nunca finge saber além do que foi observado", ["LOW", "UNKNOWN"].includes(semNada.classificacao), semNada.classificacao);
  ok("fatoresNegativos não vazio quando não tem site", semNada.fatoresNegativos.length > 0);
  ok("fatoresPositivos vazio quando não há nada a favor", semNada.fatoresPositivos.length === 0);

  const completo = pontuarProspect({
    ...base,
    temWebsite: true,
    temWhatsapp: true,
    temInstagram: true,
    temEmail: true,
    temTelefone: true,
    temMetaPixel: false,
    temGtm: false,
    temGa4: false,
    viewportMobile: false,
    cnpjEncontrado: true,
  });
  ok(`site sem nenhum rastreamento + todos os canais → score alto (>= ${LIMIARES_OPORTUNIDADE.HIGH})`, completo.score >= LIMIARES_OPORTUNIDADE.HIGH, String(completo.score));
  ok("confiança alta quando há diagnóstico real de site (fatoresObservados >= 2)", completo.confianca === "alta", completo.confianca);
  ok("classificação bate com o limiar configurável (nunca número mágico solto)", completo.classificacao === (completo.score >= LIMIARES_OPORTUNIDADE.HOT ? "HOT" : "HIGH"), completo.classificacao);
  ok("fatoresAusentes sempre reportados (porte/avaliação/anúncio ativo — dados que exigem API não conectada)", completo.fatoresAusentes.length === 3);

  const comRastreamento = pontuarProspect({ ...base, temWebsite: true, temMetaPixel: true, temGtm: true, temGa4: false });
  ok("site COM rastreamento já presente → fator positivo, não oportunidade", comRastreamento.fatoresPositivos.some((f) => f.includes("Rastreamento")));
}

secao("4. chaveDeduplicacao — nunca cria negócio duplicado por fonte diferente");
{
  const porPlaceId = chaveDeduplicacao({ placeId: "abc", negocio: "X" });
  const porDominio = chaveDeduplicacao({ website: "https://www.exemplo.com/pagina", negocio: "X" });
  const porDominio2 = chaveDeduplicacao({ website: "https://exemplo.com", negocio: "Y diferente" });
  ok("place_id tem prioridade máxima", porPlaceId === "place:abc");
  ok("mesmo domínio (com/sem www, path diferente) gera a MESMA chave mesmo com nome diferente", porDominio === porDominio2, `${porDominio} vs ${porDominio2}`);
}

secao("5. analisarSinaisMarketing — vocabulário de probabilidade, nunca certeza");
{
  const semNada = analisarSinaisMarketing({
    url: "https://exemplo.com",
    httpStatus: 200,
    tempoCarregamentoMs: 100,
    temMetaPixel: false,
    temGtm: false,
    temGa4: false,
    temWhatsappLink: false,
    temInstagramLink: false,
    viewportMobile: true,
    tituloPagina: null,
    descricaoMeta: null,
    plataformaDetectada: null,
    erro: null,
    instagramHandle: null,
    whatsappNumero: null,
    emailEncontrado: null,
    telefoneEncontrado: null,
    facebookLink: null,
  });
  ok("nenhum sinal técnico → 'nao_detectado', nunca 'não anuncia'", semNada.sinais.filter((s) => s.sinal.includes("Pixel") || s.sinal.includes("GA4")).every((s) => s.status === "nao_detectado"));
  ok("resumo nunca afirma certeza absoluta de ausência", !semNada.resumo.toLowerCase().includes("nao anuncia") && !semNada.resumo.toLowerCase().includes("não anuncia"));
  ok("campanha ativa é SEMPRE inconclusivo (não observável só pelo site)", semNada.sinais.find((s) => s.sinal.includes("Campanha")).status === "inconclusivo");
  ok("provavelAtivoEmMidiaPaga é false quando nada foi detectado", semNada.provavelAtivoEmMidiaPaga === false);

  const comErro = analisarSinaisMarketing({
    url: "https://exemplo.com",
    httpStatus: null,
    tempoCarregamentoMs: null,
    temMetaPixel: false,
    temGtm: false,
    temGa4: false,
    temWhatsappLink: false,
    temInstagramLink: false,
    viewportMobile: false,
    tituloPagina: null,
    descricaoMeta: null,
    plataformaDetectada: null,
    erro: "timeout",
    instagramHandle: null,
    whatsappNumero: null,
    emailEncontrado: null,
    telefoneEncontrado: null,
    facebookLink: null,
  });
  ok("site que não carregou → TODOS os sinais inconclusivos, nunca 'não detectado'", comErro.sinais.every((s) => s.status === "inconclusivo"));
}

secao("6. Interpretação derivada — validação rejeita formato inválido (nunca vira passo de Plano quebrado)");
{
  ok("operação válida passa", validarInterpretacaoDerivada({ operacao: "ENRIQUECER", objetivo: "x", camposSolicitados: [], limite: null, confianca: "ALTA" }).operacao === "ENRIQUECER");
  ok("operação fora do vocabulário fechado é rejeitada", lanca(() => validarInterpretacaoDerivada({ operacao: "DELETAR_TUDO", objetivo: "x" })));
  ok("sem objetivo é rejeitado", lanca(() => validarInterpretacaoDerivada({ operacao: "PONTUAR" })));
  ok("null é rejeitado", lanca(() => validarInterpretacaoDerivada(null)));
  const comLixo = validarInterpretacaoDerivada({ operacao: "ENRIQUECER", objetivo: "x", camposSolicitados: ["instagram", 123, null], limite: 99999, confianca: "chute" });
  ok("campos não-string são filtrados, nunca lançam", JSON.stringify(comLixo.camposSolicitados) === '["instagram"]');
  ok("limite é sempre limitado a um teto sensato", comLixo.limite === 500);
  ok("confiança inválida cai pro padrão seguro MEDIA", comLixo.confianca === "MEDIA");
}

secao("7. interpretarComandoDerivado — não confunde descoberta nova com operação derivada");
{
  ok("'encontre pizzarias' nunca é interpretado como derivado", interpretarComandoDerivado("Encontre 30 pizzarias em Osasco.") === null);
  ok("pergunta solta não vira operação derivada por acaso", interpretarComandoDerivado("Qual é a capital da França?") === null);
}

console.log(`\n${"─".repeat(56)}`);
console.log(`PASSOU: ${passou}   FALHOU: ${falhou}`);
if (falhou > 0) {
  console.log("RESULTADO: FALHOU");
  process.exit(1);
}
console.log("RESULTADO: TUDO PASSOU");
