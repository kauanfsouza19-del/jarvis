import "server-only";
import { readFile } from "node:fs/promises";
import { listarArquivosPasta, baixarArquivo, type ArquivoDrive } from "../google/drive";
import { salvarCriativoStaging } from "../criativos/armazenamento";
import {
  registrarCriativo,
  obterCriativo,
  obterCriativoPorDriveFileId,
  listarCriativos,
  atualizarStatusCriativo,
  registrarEnvioMeta,
  registrarFonteCriativo,
  listarFontesCriativo,
  type Criativo,
  type TipoCriativo,
  type FonteCriativo,
  type NovaFonteCriativo,
} from "../criativos/biblioteca";
import { enviarImagemCreativo, enviarVideoCreativo } from "./meta-ads";

/**
 * Orquestração do pipeline de criativo (Fase 27b) — a camada de "cola"
 * entre Drive (google/drive.ts), staging local (criativos/armazenamento.ts),
 * a Biblioteca (criativos/biblioteca.ts) e o upload real pra Meta
 * (ferramentas/meta-ads.ts). Mesmo papel que ferramentas/codigo.ts tem
 * pro código do próprio Jarvis: funções puras aqui, viram Ferramenta em
 * ferramentas/registro.ts.
 */

function tipoDoMime(mimeType: string): TipoCriativo | null {
  if (mimeType.startsWith("image/")) return "imagem";
  if (mimeType.startsWith("video/")) return "video";
  return null;
}

export type ResultadoIngestao = { novos: number; jaExistiam: number; falhas: Array<{ arquivo: string; erro: string }> };

/**
 * Lista a pasta do Drive de uma Fonte de Criativo registrada, baixa
 * QUALQUER arquivo ainda não presente na Biblioteca (dedup real via
 * drive_file_id, ver biblioteca.ts) e grava no staging local. NUNCA toca
 * o Meta nesta função — ingestão e envio são passos separados de
 * propósito (ingestão é reversível/interna; envio pro Meta cria ativo
 * real na conta do cliente, por isso é uma Tool própria com aprovação).
 */
export async function ingerirCriativosDaFonte(fonteId: string): Promise<ResultadoIngestao> {
  const fonte = listarFontesCriativo(false).find((f) => f.id === fonteId);
  if (!fonte) throw new Error(`fonte de criativo "${fonteId}" não encontrada`);
  if (!fonte.habilitada) throw new Error(`fonte de criativo "${fonte.nome}" está desabilitada`);

  const lista = await listarArquivosPasta(fonte.drive_folder_id);
  if (!lista.ok) throw new Error(lista.erro);

  const resultado: ResultadoIngestao = { novos: 0, jaExistiam: 0, falhas: [] };

  for (const arquivo of lista.dados) {
    const tipo = tipoDoMime(arquivo.mimeType);
    if (!tipo) continue; // não deveria acontecer (drive.ts já filtra por mime), defesa extra

    try {
      // Checagem barata ANTES de baixar — drive_file_id já identifica o
      // arquivo de forma única (ver dedup real em biblioteca.ts); sem
      // isto, reingerir a mesma pasta baixaria de novo tudo que já está
      // na Biblioteca só pra descobrir o dedup depois de gastar a
      // banda/tempo. `registrarCriativo` continua sendo a fonte de
      // verdade do dedup (checagem no nível do banco); isto é só a
      // otimização de nunca baixar à toa.
      if (obterCriativoPorDriveFileId(arquivo.id)) {
        resultado.jaExistiam++;
        continue;
      }

      const baixado = await baixarArquivo(arquivo.id);
      if (!baixado.ok) {
        resultado.falhas.push({ arquivo: arquivo.name, erro: baixado.erro });
        continue;
      }

      const salvo = await salvarCriativoStaging(arquivo.name, baixado.dados.bytes);

      const criativo = registrarCriativo({
        origem: "google_drive",
        driveFileId: arquivo.id,
        driveFolderId: fonte.drive_folder_id,
        nomeArquivo: arquivo.name,
        mimeType: arquivo.mimeType,
        tipo,
        largura: arquivo.imageMediaMetadata?.width ?? arquivo.videoMediaMetadata?.width ?? null,
        altura: arquivo.imageMediaMetadata?.height ?? arquivo.videoMediaMetadata?.height ?? null,
        duracaoSegundos: arquivo.videoMediaMetadata?.durationMillis ? Number(arquivo.videoMediaMetadata.durationMillis) / 1000 : null,
        tamanhoBytes: salvo.tamanhoBytes,
        checksumSha256: salvo.checksumSha256,
        caminhoLocal: salvo.caminhoLocal,
        contaMetaId: fonte.conta_meta_id,
        cliente: fonte.cliente,
        campanhaAlvo: fonte.campanha_alvo_padrao,
      });

      if (criativo.status === "NOVO") {
        atualizarStatusCriativo(criativo.id, "BAIXADO");
        resultado.novos++;
      } else {
        resultado.jaExistiam++;
      }
    } catch (e) {
      resultado.falhas.push({ arquivo: arquivo.name, erro: e instanceof Error ? e.message : "erro desconhecido" });
    }
  }

  return resultado;
}

export type ResultadoEnvioCriativo = { criativoId: string; tipo: TipoCriativo; metaCreativeHash?: string; metaVideoId?: string };

/**
 * Envia um criativo JÁ baixado (staging local) pro Media Library da conta
 * Meta de destino. NUNCA cria anúncio sozinho — devolve só o hash/videoId,
 * que precisa ser passado pra meta_ads.criar_campanha_teste ou uma futura
 * Tool de "trocar criativo de anúncio existente" (ver relatório da fase —
 * troca em anúncio já ativo é passo seguinte, não feito ainda). Cria
 * ativo real e persistente na conta do cliente — é por isso que a Tool
 * que expõe isto (ver registro.ts) exige aprovação explícita, mesma régua
 * de qualquer mutação Meta desta esteira.
 */
export async function enviarCriativoParaMeta(criativoId: string): Promise<ResultadoEnvioCriativo> {
  const criativo = obterCriativo(criativoId);
  if (!criativo) throw new Error(`criativo "${criativoId}" não encontrado na Biblioteca`);
  if (!criativo.caminho_local) throw new Error(`criativo "${criativoId}" não tem arquivo em staging — rode a ingestão antes`);
  if (!criativo.conta_meta_id) throw new Error(`criativo "${criativoId}" não tem conta_meta_id definida (ver Fonte de Criativo)`);

  let bytes: Buffer;
  try {
    bytes = await readFile(criativo.caminho_local);
  } catch (e) {
    atualizarStatusCriativo(criativoId, "FALHOU", `staging ilegível: ${e instanceof Error ? e.message : "erro"}`);
    throw new Error(`arquivo de staging não pôde ser lido — o criativo pode ter sido limpo pela retenção. Rode a ingestão de novo.`);
  }

  try {
    if (criativo.tipo === "imagem") {
      const enviado = await enviarImagemCreativo(criativo.conta_meta_id, bytes, criativo.nome_arquivo);
      registrarEnvioMeta(criativoId, { metaCreativeHash: enviado.hash });
      return { criativoId, tipo: "imagem", metaCreativeHash: enviado.hash };
    } else {
      const enviado = await enviarVideoCreativo(criativo.conta_meta_id, bytes, criativo.nome_arquivo);
      registrarEnvioMeta(criativoId, { metaVideoId: enviado.videoId });
      return { criativoId, tipo: "video", metaVideoId: enviado.videoId };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "erro desconhecido";
    atualizarStatusCriativo(criativoId, "FALHOU", msg);
    throw e;
  }
}

export { listarCriativos, registrarFonteCriativo, listarFontesCriativo, obterCriativo };
export type { Criativo, FonteCriativo, NovaFonteCriativo, ArquivoDrive };
