import { db, id as gerarId } from "@/lib/dados/db";
import { criarConversa, listarConversas } from "@/lib/dados/repositorio";
import {
  numeroAutorizado,
  normalizarNumero,
  ehMensagemDeCodigoVerificacao,
  redigirCodigoVerificacao,
  webhookAutorizado,
} from "@/lib/whatsapp/seguranca";
import { provedorWhatsapp } from "@/lib/whatsapp/adaptador";

export const runtime = "nodejs";

/**
 * Webhook do Evolution API.
 *
 * Uma mensagem de entrada NÃO tem uma engine própria — ela vira uma chamada
 * normal a /api/conversar, o mesmo caminho que a web usa. "Mesmo cérebro" não
 * é figura de linguagem aqui: é literalmente a mesma rota.
 *
 * Fronteira de segurança, antes de qualquer outra coisa: número não
 * autorizado é gravado como DADO (autorizado=0) e a resposta para. Nunca
 * processa como comando.
 */

type EventoEvolution = {
  event?: string;
  instance?: string;
  data?: {
    key?: { id?: string; remoteJid?: string; fromMe?: boolean };
    message?: { conversation?: string; extendedTextMessage?: { text?: string } };
    pushName?: string;
  };
};

function tituloConversaWhatsapp(numero: string) {
  return `WhatsApp — ${numero}`;
}

async function conversaDoNumero(numero: string): Promise<string> {
  const titulo = tituloConversaWhatsapp(numero);
  const existente = listarConversas(false).find((c) => c.titulo === titulo);
  if (existente) return existente.id;
  const nova = criarConversa(titulo, null);
  return nova.id;
}

export async function POST(req: Request) {
  // Fase 16 — achado real: sem isto, qualquer POST forjado com remoteJid
  // igual ao número do Cacique passava por numeroAutorizado() como se
  // fosse o Evolution de verdade. Ver WHATSAPP_WEBHOOK_SEGREDO em
  // whatsapp/seguranca.ts.
  const segredo = new URL(req.url).searchParams.get("segredo");
  if (!webhookAutorizado(segredo)) return Response.json({ ok: false, erro: "segredo_invalido" }, { status: 401 });

  const corpo = (await req.json().catch(() => null)) as EventoEvolution | null;
  if (!corpo) return Response.json({ ok: false }, { status: 400 });

  // Só nos interessa mensagem de texto de entrada, não eco das nossas.
  if (corpo.event !== "messages.upsert" || corpo.data?.key?.fromMe) {
    return Response.json({ ok: true, ignorado: true });
  }

  const numeroRemotoBruto = corpo.data?.key?.remoteJid ?? "";
  const numeroRemoto = normalizarNumero(numeroRemotoBruto.split("@")[0] ?? "");
  const textoBruto = corpo.data?.message?.conversation ?? corpo.data?.message?.extendedTextMessage?.text ?? "";
  const idProvedor = corpo.data?.key?.id;

  if (!numeroRemoto || !textoBruto || !idProvedor) {
    return Response.json({ ok: true, ignorado: true });
  }

  // Idempotência — o provedor pode reenviar o mesmo evento.
  const jaProcessada = db().prepare(`SELECT 1 FROM whatsapp_mensagens WHERE id_provedor = ?`).get(idProvedor);
  if (jaProcessada) return Response.json({ ok: true, duplicada: true });

  const autorizado = numeroAutorizado(numeroRemoto);
  const contemCodigo = ehMensagemDeCodigoVerificacao(textoBruto);
  // Nunca persiste o código de verificação, mesmo vindo de número autorizado.
  const textoParaGravar = contemCodigo ? redigirCodigoVerificacao(textoBruto) : textoBruto;

  const msgId = gerarId();
  db()
    .prepare(
      `INSERT INTO whatsapp_mensagens
        (id, id_provedor, direcao, numero_remoto, autorizado, tipo, conteudo_texto, estado_processamento)
       VALUES (?,?,?,?,?,?,?,?)`,
    )
    .run(msgId, idProvedor, "entrada", numeroRemoto, autorizado ? 1 : 0, "texto", textoParaGravar, "recebida");

  if (!autorizado) {
    // Dado, não comando. Registrado; não aciona nada.
    return Response.json({ ok: true, autorizado: false });
  }

  if (contemCodigo) {
    // Nunca processa código de verificação como comando — é conteúdo sensível.
    db()
      .prepare(`UPDATE whatsapp_mensagens SET estado_processamento = 'rejeitada' WHERE id = ?`)
      .run(msgId);
    await provedorWhatsapp.enviarTexto(numeroRemoto, "Código de verificação recebido. Não processo isso como comando.");
    return Response.json({ ok: true, codigo_verificacao: true });
  }

  try {
    db().prepare(`UPDATE whatsapp_mensagens SET estado_processamento = 'processando' WHERE id = ?`).run(msgId);

    const conversaId = await conversaDoNumero(numeroRemoto);
    db().prepare(`UPDATE whatsapp_mensagens SET conversa_id = ? WHERE id = ?`).run(conversaId, msgId);

    // Mesma rota que a web usa — nenhuma lógica de intenção/contexto duplicada.
    const resp = await fetch(new URL("/api/conversar", req.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversa_id: conversaId, mensagem: textoBruto, voz: true }),
    });

    let respostaTexto = "";
    if (resp.status === 503) {
      const j = await resp.json();
      respostaTexto = j.detalhe ?? "Motor de IA não configurado ainda.";
    } else if (resp.ok && resp.body) {
      const leitor = resp.body.getReader();
      const dec = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await leitor.read();
        if (done) break;
        buffer += dec.decode(value, { stream: true });
        const linhas = buffer.split("\n");
        buffer = linhas.pop() ?? "";
        for (const linha of linhas) {
          if (!linha.trim()) continue;
          const ev = JSON.parse(linha);
          if (ev.tipo === "texto") respostaTexto += ev.texto;
          if (ev.tipo === "erro") respostaTexto = `Erro: ${ev.detalhe}`;
        }
      }
    }

    if (respostaTexto) await provedorWhatsapp.enviarTexto(numeroRemoto, respostaTexto);

    db()
      .prepare(`UPDATE whatsapp_mensagens SET estado_processamento = 'respondida' WHERE id = ?`)
      .run(msgId);

    return Response.json({ ok: true });
  } catch (e) {
    const erro = e instanceof Error ? e.message.slice(0, 200) : "erro desconhecido";
    db()
      .prepare(`UPDATE whatsapp_mensagens SET estado_processamento = 'erro', erro = ? WHERE id = ?`)
      .run(erro, msgId);
    return Response.json({ ok: false, erro }, { status: 500 });
  }
}
