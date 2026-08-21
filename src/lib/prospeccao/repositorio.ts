import "server-only";
import { db, id as gerarId, auditar } from "../dados/db";
import { pontuarProspect, chaveDeduplicacao, type EntradaPontuacao } from "./pontuacao";
import { classificarContato } from "./inteligencia";
import type { SinaisSite } from "../pesquisa/navegador";

export type Prospect = {
  id: string;
  negocio: string;
  vertical: string;
  cidade: string | null;
  bairro: string | null;
  endereco: string | null;
  place_id: string | null;
  website: string | null;
  telefone_publico: string | null;
  whatsapp_publico: string | null;
  email_publico: string | null;
  instagram: string | null;
  facebook: string | null;
  cnpj: string | null;
  fonte: string;
  descoberto_em: string;
  verificado_em: string | null;
  estado: string;
  score: number | null;
  motivo_score: string | null;
  dor_observada: string | null;
  oportunidades: string | null;
  contatabilidade: number | null;
  classificacao_oportunidade: string | null;
  confianca_pontuacao: string | null;
  abordagem_sugerida: string | null;
  notas: string | null;
  /** Fase 6 — contato pessoal, só de dado estruturado (nunca inferido de nome solto). Ver prospeccao/inteligencia.ts classificarContato. */
  contato_nome: string | null;
  contato_cargo: string | null;
  contato_fonte: string | null;
  contato_confianca: string | null;
  contato_status: string | null;
};

export type StatusEvidencia = "encontrado" | "nao_encontrado" | "nao_verificado" | "inconclusivo" | "conflitante";

/**
 * Uma evidência de campo coletado publicamente — nunca gravada sem fonte.
 * `status` é o que impede "não achei agora" de virar "não existe": só
 * `encontrado` carrega valor de verdade; `conflitante` é quando DUAS fontes
 * diferentes discordam sobre o MESMO campo (Fase 6 — nunca escolhe uma
 * calada); os outros três são o motivo de não ter valor (verificado e
 * ausente / nunca verificado / página não deu pra confirmar), nunca a
 * ausência silenciosa de linha nenhuma.
 */
export type ProspectEvidencia = {
  id: string;
  prospect_id: string;
  campo: string;
  valor: string;
  status: StatusEvidencia;
  fonte: string;
  confianca: "alta" | "media" | "baixa";
  coletado_em: string;
};

/** Normaliza valor pra COMPARAÇÃO de conflito — remove formatação (espaço, protocolo, barra final), nunca muda o que é gravado. */
function normalizarValorComparavel(v: string): string {
  return v
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * Registra UMA evidência — a primitiva; registrarEvidenciasDeSite (abaixo) é
 * o caso comum de "várias de uma visita só". Verificação cruzada (Fase 6):
 * quando já existe uma evidência `encontrado` do MESMO campo, de fonte
 * DIFERENTE, com valor DIFERENTE, esta nova linha grava como `conflitante`
 * em vez de `encontrado` — nunca escolhe silenciosamente qual fonte está
 * certa. As DUAS linhas (a anterior e esta) continuam na tabela, auditáveis.
 */
export function registrarEvidencia(
  prospectId: string,
  campo: string,
  valor: string | null,
  fonte: string,
  confianca: "alta" | "media" | "baixa",
  status?: StatusEvidencia,
): StatusEvidencia {
  let statusReal: StatusEvidencia = status ?? (valor ? "encontrado" : "nao_encontrado");

  if (statusReal === "encontrado" && valor) {
    const anterior = db()
      .prepare(`SELECT valor, fonte FROM prospect_evidencias WHERE prospect_id=? AND campo=? AND status='encontrado' ORDER BY coletado_em DESC LIMIT 1`)
      .get(prospectId, campo) as { valor: string; fonte: string } | undefined;
    if (anterior && anterior.fonte !== fonte && normalizarValorComparavel(anterior.valor) !== normalizarValorComparavel(valor)) {
      statusReal = "conflitante";
    }
  }

  db()
    .prepare(`INSERT INTO prospect_evidencias (id, prospect_id, campo, valor, status, fonte, confianca) VALUES (?,?,?,?,?,?,?)`)
    .run(gerarId(), prospectId, campo, valor ?? "", statusReal, fonte, confianca);
  return statusReal;
}

type EntradaProspect = {
  negocio: string;
  vertical: string;
  cidade?: string | null;
  bairro?: string | null;
  endereco?: string | null;
  placeId?: string | null;
  website?: string | null;
  telefonePublico?: string | null;
  whatsappPublico?: string | null;
  emailPublico?: string | null;
  instagram?: string | null;
  facebook?: string | null;
  cnpj?: string | null;
  fonte: string;
  notas?: string | null;
};

/** Cria, ou — se já existe por place_id/CNPJ/domínio/telefone/nome — atualiza no lugar. */
export function criarOuAtualizarProspect(e: EntradaProspect): { prospect: Prospect; novo: boolean } {
  const chave = chaveDeduplicacao({
    placeId: e.placeId,
    cnpj: e.cnpj,
    website: e.website,
    telefone: e.telefonePublico,
    negocio: e.negocio,
  });

  const candidatos = db().prepare(`SELECT * FROM prospects`).all() as Prospect[];
  const existente = candidatos.find(
    (p) =>
      chaveDeduplicacao({
        placeId: p.place_id,
        cnpj: p.cnpj,
        website: p.website,
        telefone: p.telefone_publico,
        negocio: p.negocio,
      }) === chave,
  );

  if (existente) {
    db()
      .prepare(
        `UPDATE prospects
            SET cidade=COALESCE(?,cidade), bairro=COALESCE(?,bairro), endereco=COALESCE(?,endereco),
                website=COALESCE(?,website), telefone_publico=COALESCE(?,telefone_publico),
                whatsapp_publico=COALESCE(?,whatsapp_publico), email_publico=COALESCE(?,email_publico),
                instagram=COALESCE(?,instagram), facebook=COALESCE(?,facebook), cnpj=COALESCE(?,cnpj),
                verificado_em=datetime('now')
          WHERE id=?`,
      )
      .run(
        e.cidade ?? null,
        e.bairro ?? null,
        e.endereco ?? null,
        e.website ?? null,
        e.telefonePublico ?? null,
        e.whatsappPublico ?? null,
        e.emailPublico ?? null,
        e.instagram ?? null,
        e.facebook ?? null,
        e.cnpj ?? null,
        existente.id,
      );
    auditar({ acao: "prospeccao.atualizar", resultado: existente.id, motivo: "deduplicado: " + chave });
    return { prospect: db().prepare(`SELECT * FROM prospects WHERE id=?`).get(existente.id) as Prospect, novo: false };
  }

  const id = gerarId();
  db()
    .prepare(
      `INSERT INTO prospects
        (id, negocio, vertical, cidade, bairro, endereco, place_id, website, telefone_publico, whatsapp_publico,
         email_publico, instagram, facebook, cnpj, fonte, notas)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      id,
      e.negocio,
      e.vertical,
      e.cidade ?? null,
      e.bairro ?? null,
      e.endereco ?? null,
      e.placeId ?? null,
      e.website ?? null,
      e.telefonePublico ?? null,
      e.whatsappPublico ?? null,
      e.emailPublico ?? null,
      e.instagram ?? null,
      e.facebook ?? null,
      e.cnpj ?? null,
      e.fonte,
      e.notas ?? null,
    );
  auditar({ acao: "prospeccao.criar", resultado: id, motivo: e.fonte });
  return { prospect: db().prepare(`SELECT * FROM prospects WHERE id=?`).get(id) as Prospect, novo: true };
}

export function listarProspects(filtro?: { vertical?: string; cidade?: string; estado?: string }): Prospect[] {
  const cond: string[] = [];
  const args: unknown[] = [];
  if (filtro?.vertical) {
    cond.push("vertical = ?");
    args.push(filtro.vertical);
  }
  if (filtro?.cidade) {
    cond.push("cidade = ?");
    args.push(filtro.cidade);
  }
  if (filtro?.estado) {
    cond.push("estado = ?");
    args.push(filtro.estado);
  }
  const where = cond.length ? `WHERE ${cond.join(" AND ")}` : "";
  return db()
    .prepare(`SELECT * FROM prospects ${where} ORDER BY score DESC NULLS LAST, descoberto_em DESC LIMIT 200`)
    .all(...(args as never[])) as Prospect[];
}

export function obterProspect(id: string): Prospect | undefined {
  return db().prepare(`SELECT * FROM prospects WHERE id=?`).get(id) as Prospect | undefined;
}

/**
 * Grava UMA visita de site (a linha crua em diagnosticos_site) — a primitiva
 * de persistência, separada do cálculo de score/evidência abaixo pra poder
 * ser chamada sozinha quando um estágio do pipeline visita o site mas quem
 * decide pontuar é outro estágio (ver prospeccao/diagnostico.ts,
 * garantirSinais — reaproveitamento entre estágios do mesmo pipeline).
 */
export function registrarVisitaSite(prospectId: string, sinais: SinaisSite): void {
  db()
    .prepare(
      `INSERT INTO diagnosticos_site
        (id, prospect_id, url, http_status, tempo_carregamento_ms, tem_meta_pixel, tem_gtm, tem_ga4,
         tem_whatsapp_link, tem_instagram_link, viewport_mobile, titulo_pagina, descricao_meta,
         sinais_brutos, erro)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      gerarId(),
      prospectId,
      sinais.url,
      sinais.httpStatus,
      sinais.tempoCarregamentoMs,
      sinais.temMetaPixel ? 1 : 0,
      sinais.temGtm ? 1 : 0,
      sinais.temGa4 ? 1 : 0,
      sinais.temWhatsappLink ? 1 : 0,
      sinais.temInstagramLink ? 1 : 0,
      sinais.viewportMobile ? 1 : 0,
      sinais.tituloPagina,
      sinais.descricaoMeta,
      JSON.stringify(sinais),
      sinais.erro,
    );
}

/**
 * Roda o diagnóstico de site real (Playwright) sobre um prospect e grava
 * score + histórico de diagnóstico — nunca sobrescreve o diagnóstico
 * anterior, insere um novo registro com timestamp.
 *
 * `jaVisitado: true` pula o INSERT da visita (quem chamou já reaproveitou um
 * diagnóstico recente de outro estágio do mesmo pipeline via garantirSinais
 * — gravar de novo criaria uma segunda linha idêntica, como se o site
 * tivesse sido visitado duas vezes quando só foi uma).
 */
export function salvarDiagnostico(prospectId: string, sinais: SinaisSite, opcoes?: { jaVisitado?: boolean }) {
  if (!opcoes?.jaVisitado) registrarVisitaSite(prospectId, sinais);

  const p = obterProspect(prospectId);
  if (!p) return;

  const entrada: EntradaPontuacao = {
    vertical: p.vertical,
    temWebsite: Boolean(p.website) && !sinais.erro,
    temWhatsapp: Boolean(p.whatsapp_publico) || sinais.temWhatsappLink,
    temInstagram: Boolean(p.instagram) || sinais.temInstagramLink,
    temEmail: Boolean(p.email_publico),
    temTelefone: Boolean(p.telefone_publico),
    temMetaPixel: sinais.erro ? null : sinais.temMetaPixel,
    temGtm: sinais.erro ? null : sinais.temGtm,
    temGa4: sinais.erro ? null : sinais.temGa4,
    viewportMobile: sinais.erro ? null : sinais.viewportMobile,
    plataformaEcommerce: sinais.plataformaDetectada,
    cnpjEncontrado: Boolean(p.cnpj),
  };
  const resultado = pontuarProspect(entrada);
  gravarPontuacao(prospectId, resultado);

  // Enriquecimento incidental — a MESMA visita já extraiu contato público;
  // grava com evidência em vez de descartar. Nunca sobrescreve campo que o
  // prospect já tinha (manual ou de outra fonte) — só preenche o que
  // estava vazio, e sempre com fonte+confiança auditável.
  if (!sinais.erro) {
    registrarEvidenciasDeSite(prospectId, p.website ?? sinais.url, {
      instagram: sinais.instagramHandle,
      whatsapp: sinais.whatsappNumero,
      email: sinais.emailEncontrado,
      telefone: sinais.telefoneEncontrado,
      facebook: sinais.facebookLink,
    });
    registrarEnderecoEContatoEstruturado(prospectId, p.website ?? sinais.url, sinais.enderecoEstruturado, sinais.nomeContatoEstruturado, sinais.cargoContatoEstruturado);
  }

  auditar({ acao: "prospeccao.diagnosticar", resultado: prospectId, impacto: `score ${resultado.score}` });
  return resultado;
}

/**
 * Endereço/contato de dado ESTRUTURADO do site (schema.org) — Fase 6. Nunca
 * sobrescreve endereço já conhecido (ex: do OSM); contato pessoal só entra
 * se o prospect ainda não tinha nenhum (primeira fonte estruturada vence,
 * já que múltiplas fontes de "quem é o dono" tendem a ser mais ruído que
 * sinal — diferente de campo objetivo tipo telefone).
 */
function registrarEnderecoEContatoEstruturado(
  prospectId: string,
  fonteUrl: string,
  endereco: string | null,
  nomeContato: string | null,
  cargoContato: string | null,
): void {
  const p = obterProspect(prospectId);
  if (!p) return;
  const fonte = `site_publico:${fonteUrl}`;

  if (endereco) {
    registrarEvidencia(prospectId, "endereco", endereco, fonte, "alta");
    if (!p.endereco) db().prepare(`UPDATE prospects SET endereco=? WHERE id=?`).run(endereco, prospectId);
  }
  if (nomeContato) {
    registrarEvidencia(prospectId, "contato_nome", nomeContato, fonte, "media");
    if (!p.contato_nome) {
      const status = classificarContato(nomeContato, cargoContato);
      db()
        .prepare(`UPDATE prospects SET contato_nome=?, contato_cargo=?, contato_fonte=?, contato_confianca=?, contato_status=? WHERE id=?`)
        .run(nomeContato, cargoContato, fonte, "media", status, prospectId);
    }
  }
}

/** Grava o resultado de pontuação nas colunas do prospect — usado tanto pelo diagnóstico quanto pela repontuação sem nova visita. */
function gravarPontuacao(prospectId: string, resultado: ReturnType<typeof pontuarProspect>) {
  db()
    .prepare(
      `UPDATE prospects
          SET score=?, motivo_score=?, dor_observada=?, oportunidades=?, contatabilidade=?,
              classificacao_oportunidade=?, confianca_pontuacao=?, verificado_em=datetime('now')
        WHERE id=?`,
    )
    .run(
      resultado.score,
      resultado.motivos.join(" "),
      JSON.stringify(resultado.fatoresNegativos.map((sinal) => ({ sinal, observado_ou_inferido: "observado", evidencia: "diagnóstico de site real" }))),
      JSON.stringify(resultado.oportunidades),
      resultado.contatabilidade,
      resultado.classificacao,
      resultado.confianca,
      prospectId,
    );
}

/**
 * Repontua um prospect a partir do que JÁ está gravado (sem visitar o site
 * de novo) — usado quando o Cacique pede "pontue de novo" depois de um
 * enriquecimento que mudou os campos de contato, sem custo de rede nenhum.
 */
export function repontuarProspect(prospectId: string) {
  const p = obterProspect(prospectId);
  if (!p) return null;

  const ultimoDiagnostico = db()
    .prepare(`SELECT * FROM diagnosticos_site WHERE prospect_id=? ORDER BY criado_em DESC LIMIT 1`)
    .get(prospectId) as
    | { tem_meta_pixel: number; tem_gtm: number; tem_ga4: number; viewport_mobile: number; sinais_brutos: string; erro: string | null }
    | undefined;

  const sinaisBrutos = ultimoDiagnostico?.sinais_brutos ? (JSON.parse(ultimoDiagnostico.sinais_brutos) as SinaisSite) : null;

  const entrada: EntradaPontuacao = {
    vertical: p.vertical,
    temWebsite: Boolean(p.website),
    temWhatsapp: Boolean(p.whatsapp_publico),
    temInstagram: Boolean(p.instagram),
    temEmail: Boolean(p.email_publico),
    temTelefone: Boolean(p.telefone_publico),
    temMetaPixel: ultimoDiagnostico && !ultimoDiagnostico.erro ? Boolean(ultimoDiagnostico.tem_meta_pixel) : null,
    temGtm: ultimoDiagnostico && !ultimoDiagnostico.erro ? Boolean(ultimoDiagnostico.tem_gtm) : null,
    temGa4: ultimoDiagnostico && !ultimoDiagnostico.erro ? Boolean(ultimoDiagnostico.tem_ga4) : null,
    viewportMobile: ultimoDiagnostico && !ultimoDiagnostico.erro ? Boolean(ultimoDiagnostico.viewport_mobile) : null,
    plataformaEcommerce: sinaisBrutos?.plataformaDetectada ?? null,
    cnpjEncontrado: Boolean(p.cnpj),
  };
  const resultado = pontuarProspect(entrada);
  gravarPontuacao(prospectId, resultado);
  auditar({ acao: "prospeccao.repontuar", resultado: prospectId, impacto: `score ${resultado.score}` });
  return resultado;
}

const FORCA_CONFIANCA: Record<"alta" | "media" | "baixa", number> = { baixa: 0, media: 1, alta: 2 };

/**
 * Confiança da evidência ATUALMENTE por trás do valor gravado num campo —
 * a última linha "encontrado" pra esse campo, se houver. Sem linha nenhuma
 * (valor veio de cadastro manual, ou de antes de existir rastro de
 * evidência), null: trata como "não dá pra comparar", nunca como "fraco",
 * pra nunca sobrescrever um valor confiável sem prova de que o novo é
 * melhor.
 */
function confiancaAtualDoCampo(prospectId: string, campo: string): "alta" | "media" | "baixa" | null {
  const linha = db()
    .prepare(`SELECT confianca FROM prospect_evidencias WHERE prospect_id=? AND campo=? AND status='encontrado' ORDER BY coletado_em DESC LIMIT 1`)
    .get(prospectId, campo) as { confianca: "alta" | "media" | "baixa" } | undefined;
  return linha?.confianca ?? null;
}

/**
 * Registra evidência de campo público coletado — grava a linha de evidência
 * SEMPRE (achado ou não), e só atualiza a coluna do prospect quando isso não
 * arrisca piorar o que já está lá: coluna vazia (nada a perder) OU a nova
 * confiança é maior ou igual à confiança JÁ REGISTRADA por trás do valor
 * atual (nunca sobrescreve telefone verificado com um telefone incerto só
 * porque uma visita nova aconteceu). Sem uma confiança anterior conhecida
 * pra comparar, é tratado como "não sobrescreve" — o lado seguro.
 */
export function registrarEvidenciasDeSite(
  prospectId: string,
  fonteUrl: string,
  campos: { instagram: string | null; whatsapp: string | null; email: string | null; telefone: string | null; facebook: string | null },
) {
  const p = obterProspect(prospectId);
  if (!p) return;

  const fonte = `site_publico:${fonteUrl}`;
  // Confiança por campo: link estrutural (instagram/whatsapp/facebook) é
  // alta — a extração é uma URL/número inequívoco. E-mail é média (regex
  // de texto solto pode pegar endereço de rastreador). Telefone é sempre
  // baixa — o fallback sem "tel:" é o mais propenso a ruído (ver navegador.ts).
  const mapa: Array<[keyof typeof campos, keyof Prospect, "alta" | "media" | "baixa"]> = [
    ["instagram", "instagram", "alta"],
    ["whatsapp", "whatsapp_publico", "alta"],
    ["facebook", "facebook", "alta"],
    ["email", "email_publico", "media"],
    ["telefone", "telefone_publico", "baixa"],
  ];

  for (const [campoOrigem, colunaProspect, confianca] of mapa) {
    const valor = campos[campoOrigem];
    const colunaVazia = !p[colunaProspect];
    // Precisa ler a confiança ANTES de gravar a evidência nova — senão a
    // consulta acharia a própria linha que está prestes a ser inserida
    // (sempre "igual", nunca detectando piora de verdade).
    const confiancaAntesDeGravar = colunaVazia ? null : confiancaAtualDoCampo(prospectId, campoOrigem);

    // Grava SEMPRE, achado ou não — "verifiquei essa página e não achei"
    // é informação real (status nao_encontrado), diferente de nunca ter
    // verificado. É o que distingue "sem Instagram público" de "ainda não
    // procuramos o Instagram deste prospect".
    const statusGravado = registrarEvidencia(prospectId, campoOrigem, valor, fonte, confianca);
    if (!valor) continue;
    // Conflitante: DUAS fontes discordam sobre este campo — nunca escolhe
    // qual está certa sozinho, então a coluna do prospect NÃO é tocada
    // (fica com o valor anterior); a linha 'conflitante' em
    // prospect_evidencias é o registro auditável do desacordo.
    if (statusGravado === "conflitante") continue;

    const podeSobrescrever = colunaVazia || (confiancaAntesDeGravar !== null && FORCA_CONFIANCA[confianca] >= FORCA_CONFIANCA[confiancaAntesDeGravar]);
    if (podeSobrescrever) {
      db().prepare(`UPDATE prospects SET ${colunaProspect}=? WHERE id=?`).run(valor, prospectId);
    }
  }
}

/** Grava o texto de abordagem gerado — nunca envia nada, só persiste o rascunho. */
export function salvarAbordagem(prospectId: string, texto: string) {
  db().prepare(`UPDATE prospects SET abordagem_sugerida=? WHERE id=?`).run(texto, prospectId);
  auditar({ acao: "prospeccao.gerar_abordagem", resultado: prospectId });
}

export function evidenciasDoProspect(prospectId: string): ProspectEvidencia[] {
  return db()
    .prepare(`SELECT * FROM prospect_evidencias WHERE prospect_id=? ORDER BY coletado_em DESC`)
    .all(prospectId) as ProspectEvidencia[];
}
