import "server-only";

/**
 * Adaptador de provedor de WhatsApp.
 *
 * O núcleo do Jarvis (webhook, roteamento para /api/conversar, aprovações)
 * nunca fala com Evolution API diretamente — só com esta interface. Trocar
 * de provedor no futuro é trocar o adaptador, não reescrever o pipeline.
 *
 * Implementação atual: Evolution API (self-hosted, não-oficial, QR code) —
 * pedido explícito do Cacique: "não precisa ser API Oficial". Endpoints
 * conforme a documentação pública do Evolution API v2. NÃO foi testado
 * contra uma instância real neste ambiente: Docker não está disponível
 * aqui, então isto é código real e correto contra a documentação, mas
 * "AUTH_NECESSARIA / não verificado ao vivo" até rodar contra um servidor
 * de verdade — ver EstadoIntegracao.
 */

export type EstadoConexaoWhatsapp =
  | "DESCONECTADO"
  | "CONECTANDO"
  | "AGUARDANDO_QR"
  | "CONECTADO"
  | "RECONECTANDO"
  | "ERRO"
  | "EXPIRADO"
  | "INDISPONIVEL";

export type StatusWhatsapp = {
  estado: EstadoConexaoWhatsapp;
  numero: string | null;
  qrBase64: string | null;
  ultimoErro: string | null;
};

export interface ProvedorWhatsapp {
  obterQr(): Promise<{ qrBase64: string | null; estado: EstadoConexaoWhatsapp }>;
  obterStatus(): Promise<StatusWhatsapp>;
  enviarTexto(numero: string, texto: string): Promise<{ ok: boolean; erro?: string }>;
  enviarMidia(numero: string, urlOuBase64: string, tipo: "imagem" | "documento" | "audio"): Promise<{ ok: boolean; erro?: string }>;
  desconectar(): Promise<{ ok: boolean; erro?: string }>;
}

/** Config lida só de variável de ambiente — nunca hardcoded, nunca no banco. */
function config(): { baseUrl: string; apiKey: string; instancia: string } | null {
  const baseUrl = process.env.EVOLUTION_API_URL;
  const apiKey = process.env.EVOLUTION_API_KEY;
  const instancia = process.env.EVOLUTION_INSTANCIA ?? "jarvis";
  if (!baseUrl || !apiKey) return null;
  return { baseUrl: baseUrl.replace(/\/$/, ""), apiKey, instancia };
}

export function evolutionConfigurado(): boolean {
  return config() !== null;
}

class AdaptadorEvolutionApi implements ProvedorWhatsapp {
  private async chamar(caminho: string, opcoes?: RequestInit): Promise<Response> {
    const c = config();
    if (!c) throw new Error("EVOLUTION_API_URL/EVOLUTION_API_KEY não configuradas");
    return fetch(`${c.baseUrl}${caminho}`, {
      ...opcoes,
      headers: { "Content-Type": "application/json", apikey: c.apiKey, ...(opcoes?.headers ?? {}) },
      signal: AbortSignal.timeout(15000),
    });
  }

  async obterQr(): Promise<{ qrBase64: string | null; estado: EstadoConexaoWhatsapp }> {
    const c = config();
    if (!c) return { qrBase64: null, estado: "INDISPONIVEL" };
    try {
      const r = await this.chamar(`/instance/connect/${c.instancia}`);
      if (!r.ok) return { qrBase64: null, estado: "ERRO" };
      const j = (await r.json()) as { base64?: string; qrcode?: { base64?: string } };
      const qr = j.base64 ?? j.qrcode?.base64 ?? null;
      return { qrBase64: qr, estado: qr ? "AGUARDANDO_QR" : "CONECTANDO" };
    } catch (e) {
      return { qrBase64: null, estado: erroDeRede(e) };
    }
  }

  async obterStatus(): Promise<StatusWhatsapp> {
    const c = config();
    if (!c) return { estado: "INDISPONIVEL", numero: null, qrBase64: null, ultimoErro: "não configurado" };
    try {
      const r = await this.chamar(`/instance/connectionState/${c.instancia}`);
      if (!r.ok) {
        return { estado: "ERRO", numero: null, qrBase64: null, ultimoErro: `HTTP ${r.status}` };
      }
      const j = (await r.json()) as { instance?: { state?: string; owner?: string } };
      const estadoBruto = j.instance?.state ?? "close";
      const mapa: Record<string, EstadoConexaoWhatsapp> = {
        open: "CONECTADO",
        connecting: "CONECTANDO",
        close: "DESCONECTADO",
      };
      return {
        estado: mapa[estadoBruto] ?? "ERRO",
        numero: j.instance?.owner ?? null,
        qrBase64: null,
        ultimoErro: null,
      };
    } catch (e) {
      return { estado: erroDeRede(e), numero: null, qrBase64: null, ultimoErro: mensagemErro(e) };
    }
  }

  async enviarTexto(numero: string, texto: string) {
    const c = config();
    if (!c) return { ok: false, erro: "não configurado" };
    try {
      const r = await this.chamar(`/message/sendText/${c.instancia}`, {
        method: "POST",
        body: JSON.stringify({ number: numero, text: texto }),
      });
      return r.ok ? { ok: true } : { ok: false, erro: `HTTP ${r.status}` };
    } catch (e) {
      return { ok: false, erro: mensagemErro(e) };
    }
  }

  async enviarMidia(numero: string, urlOuBase64: string, tipo: "imagem" | "documento" | "audio") {
    const c = config();
    if (!c) return { ok: false, erro: "não configurado" };
    const mediatype = tipo === "imagem" ? "image" : tipo === "audio" ? "audio" : "document";
    try {
      const r = await this.chamar(`/message/sendMedia/${c.instancia}`, {
        method: "POST",
        body: JSON.stringify({ number: numero, mediatype, media: urlOuBase64 }),
      });
      return r.ok ? { ok: true } : { ok: false, erro: `HTTP ${r.status}` };
    } catch (e) {
      return { ok: false, erro: mensagemErro(e) };
    }
  }

  async desconectar() {
    const c = config();
    if (!c) return { ok: false, erro: "não configurado" };
    try {
      const r = await this.chamar(`/instance/logout/${c.instancia}`, { method: "DELETE" });
      return r.ok ? { ok: true } : { ok: false, erro: `HTTP ${r.status}` };
    } catch (e) {
      return { ok: false, erro: mensagemErro(e) };
    }
  }
}

function mensagemErro(e: unknown): string {
  return e instanceof Error ? e.message.slice(0, 200) : "erro desconhecido";
}

function erroDeRede(e: unknown): EstadoConexaoWhatsapp {
  // AbortError (timeout) ou connection refused → servidor Evolution API não
  // está de pé, não é um erro de credencial.
  return "INDISPONIVEL";
  void e;
}

export const provedorWhatsapp: ProvedorWhatsapp = new AdaptadorEvolutionApi();
