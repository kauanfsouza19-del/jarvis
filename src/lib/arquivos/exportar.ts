import "server-only";
import { mkdirSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { db, id as gerarId } from "../dados/db";
import type { Prospect } from "../prospeccao/repositorio";
import { analisarSinaisMarketing } from "../prospeccao/marketing";
import { sugerirAnguloVenda } from "../prospeccao/inteligencia";
import type { SinaisSite } from "../pesquisa/navegador";

/**
 * Geração de arquivo real — nunca um botão de download decorativo.
 *
 * Grava em dados/arquivos/ (fora do git, mesmo diretório do banco). O botão
 * de download no cliente aponta para /api/arquivos/:id, que serve ESTE
 * arquivo do disco — não existe "arquivo fake" com link morto.
 */

const PASTA_ARQUIVOS = join(process.cwd(), "dados", "arquivos");

// Lista pensada pra ser útil de verdade pra um SDR abrir e trabalhar em
// cima — Fase 6, "resultado pronto pra prospecção". `angulo_venda` e
// `motivo_angulo` são as duas únicas colunas COMPUTADAS (não são coluna
// direta de `prospects`) — ver anguloVendaDoProspect abaixo.
const COLUNAS = [
  "negocio",
  "vertical",
  "cidade",
  "bairro",
  "endereco",
  "website",
  "whatsapp_publico",
  "instagram",
  "facebook",
  "telefone_publico",
  "email_publico",
  "contato_nome",
  "contato_cargo",
  "contato_status",
  "cnpj",
  "score",
  "classificacao_oportunidade",
  "confianca_pontuacao",
  "oportunidades",
  "motivo_score",
  "angulo_venda",
  "motivo_angulo",
  "abordagem_sugerida",
  "estado",
] as const;

const CABECALHO = [
  "Empresa",
  "Vertical",
  "Cidade",
  "Bairro",
  "Endereço",
  "Site",
  "WhatsApp",
  "Instagram",
  "Facebook",
  "Telefone",
  "E-mail",
  "Contato",
  "Cargo do contato",
  "Status do contato",
  "CNPJ",
  "Score",
  "Classificação",
  "Confiança do score",
  "Oportunidades",
  "Por que esse score",
  "Ângulo de venda sugerido",
  "Motivo do ângulo",
  "Abordagem sugerida",
  "Status",
];

/**
 * Ângulo de venda é COMPUTADO na hora de exportar, não gravado no prospect —
 * lê o último diagnóstico de site já salvo (sinais_brutos) e recalcula
 * marketing+ângulo em cima. Sem diagnóstico salvo (prospect sem site, ou
 * nunca diagnosticado), fica vazio — nunca inventa um ângulo sem evidência.
 */
function anguloVendaDoProspect(p: Prospect): { angulo: string; motivo: string } | null {
  const ultimo = db()
    .prepare(`SELECT sinais_brutos FROM diagnosticos_site WHERE prospect_id=? ORDER BY criado_em DESC LIMIT 1`)
    .get(p.id) as { sinais_brutos: string } | undefined;
  if (!ultimo?.sinais_brutos) return null;
  let sinais: SinaisSite;
  try {
    sinais = JSON.parse(ultimo.sinais_brutos) as SinaisSite;
  } catch {
    return null;
  }
  const marketing = analisarSinaisMarketing(sinais);
  return sugerirAnguloVenda(p, sinais, marketing, null);
}

function celula(p: Prospect, coluna: (typeof COLUNAS)[number]): string {
  if (coluna === "oportunidades") {
    try {
      return JSON.parse(p.oportunidades ?? "[]").join("; ");
    } catch {
      return "";
    }
  }
  if (coluna === "angulo_venda" || coluna === "motivo_angulo") {
    const angulo = anguloVendaDoProspect(p);
    if (!angulo) return "";
    return coluna === "angulo_venda" ? angulo.angulo : angulo.motivo;
  }
  const v = p[coluna as keyof Prospect];
  return v === null || v === undefined ? "" : String(v);
}

function escaparCsv(v: string): string {
  if (/[",\n;]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function gravar(nome: string, buffer: Buffer | string): { caminho: string; tamanho: number } {
  mkdirSync(PASTA_ARQUIVOS, { recursive: true });
  const caminho = join(PASTA_ARQUIVOS, nome);
  writeFileSync(caminho, buffer);
  return { caminho, tamanho: statSync(caminho).size };
}

/** Gera CSV real a partir dos prospects — string simples, sem dependência. */
export function gerarCsv(resultadoId: string, prospects: Prospect[]): { id: string; nome: string } {
  const linhas = [CABECALHO.join(",")];
  for (const p of prospects) {
    linhas.push(COLUNAS.map((c) => escaparCsv(celula(p, c))).join(","));
  }
  // BOM — Excel no Windows só lê acento certo com isso.
  const conteudo = "﻿" + linhas.join("\r\n");
  const nome = `prospects-${resultadoId.slice(0, 8)}.csv`;
  const { caminho, tamanho } = gravar(nome, conteudo);

  const arquivoId = gerarId();
  db()
    .prepare(
      `INSERT INTO arquivos_gerados (id, resultado_id, tipo, nome, mime_type, tamanho_bytes, caminho)
       VALUES (?,?,?,?,?,?,?)`,
    )
    .run(arquivoId, resultadoId, "csv", nome, "text/csv; charset=utf-8", tamanho, caminho);

  return { id: arquivoId, nome };
}

/** Gera XLSX real (ExcelJS) — planilha de verdade, não CSV com extensão trocada. */
export async function gerarXlsx(resultadoId: string, prospects: Prospect[]): Promise<{ id: string; nome: string }> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Jarvis";
  const ws = wb.addWorksheet("Prospects");

  ws.columns = CABECALHO.map((titulo, i) => ({
    header: titulo,
    key: COLUNAS[i],
    width: i === 0 ? 28 : i === 3 ? 26 : 16,
  }));
  ws.getRow(1).font = { bold: true };

  for (const p of prospects) {
    ws.addRow(Object.fromEntries(COLUNAS.map((c) => [c, celula(p, c)])));
  }

  const buffer = await wb.xlsx.writeBuffer();
  const nome = `prospects-${resultadoId.slice(0, 8)}.xlsx`;
  const { caminho, tamanho } = gravar(nome, Buffer.from(buffer));

  const arquivoId = gerarId();
  db()
    .prepare(
      `INSERT INTO arquivos_gerados (id, resultado_id, tipo, nome, mime_type, tamanho_bytes, caminho)
       VALUES (?,?,?,?,?,?,?)`,
    )
    .run(
      arquivoId,
      resultadoId,
      "xlsx",
      nome,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      tamanho,
      caminho,
    );

  return { id: arquivoId, nome };
}
