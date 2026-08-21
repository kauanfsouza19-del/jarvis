import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Validação de URL antes de qualquer navegação real (Playwright) — SSRF é
 * o risco concreto aqui: `website` de um prospect pode vir de descoberta
 * automática (Places/OSM), ou seja, de uma fonte que o Jarvis não controla.
 * Sem esta checagem, um "site" malicioso apontando pra
 * `http://169.254.169.254/latest/meta-data/` (metadado de nuvem) ou
 * `http://localhost:3000/api/...` (o próprio Jarvis) faria o navegador
 * visitar rede interna em nome do sistema.
 *
 * A checagem resolve o hostname de verdade (nunca confia só na string —
 * "site-normal.com" pode resolver pra um IP interno via DNS rebinding) e
 * recusa qualquer resultado em faixa privada/loopback/link-local.
 */

export type ResultadoValidacaoUrl = { permitido: true; url: string } | { permitido: false; motivo: string };

const ESQUEMAS_PERMITIDOS = new Set(["http:", "https:"]);

/** IPv4 CIDR ranges nunca navegáveis — RFC 1918, loopback, link-local, CGNAT, reservado. */
const FAIXAS_V4_BLOQUEADAS: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local — inclui metadado de nuvem (169.254.169.254)
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reservado
];

function ipParaInt(ip: string): number {
  return ip.split(".").reduce((acc, o) => (acc << 8) + parseInt(o, 10), 0) >>> 0;
}

function v4EmFaixaBloqueada(ip: string): boolean {
  const alvo = ipParaInt(ip);
  return FAIXAS_V4_BLOQUEADAS.some(([base, bits]) => {
    const mascara = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (alvo & mascara) === (ipParaInt(base) & mascara);
  });
}

function v6Bloqueado(ip: string): boolean {
  const n = ip.toLowerCase();
  if (n === "::1" || n === "::") return true;
  if (n.startsWith("fe80:") || n.startsWith("fec0:")) return true; // link-local
  if (/^f[cd][0-9a-f]{2}:/.test(n)) return true; // fc00::/7 — unique local
  // IPv4 mapeado em IPv6 (::ffff:a.b.c.d) — desembrulha e checa como v4.
  const mapeado = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(n);
  if (mapeado) return v4EmFaixaBloqueada(mapeado[1]);
  return false;
}

/**
 * Resolve o hostname de verdade e recusa IP interno. Lança nada — sempre
 * devolve um resultado tipado, quem chama decide o que fazer (nunca
 * navega silenciosamente em caso de erro de validação).
 */
export async function validarUrlPublica(urlBruta: string): Promise<ResultadoValidacaoUrl> {
  let url: URL;
  try {
    url = new URL(urlBruta);
  } catch {
    return { permitido: false, motivo: "URL malformada" };
  }

  if (!ESQUEMAS_PERMITIDOS.has(url.protocol)) {
    return { permitido: false, motivo: `esquema "${url.protocol}" não permitido — só http/https` };
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    return { permitido: false, motivo: "hostname aponta pra rede local" };
  }

  // Hostname já é um IP literal — valida direto, sem lookup.
  const versaoIpLiteral = isIP(hostname);
  if (versaoIpLiteral === 4 && v4EmFaixaBloqueada(hostname)) {
    return { permitido: false, motivo: "IP em faixa privada/interna" };
  }
  if (versaoIpLiteral === 6 && v6Bloqueado(hostname)) {
    return { permitido: false, motivo: "IP em faixa privada/interna" };
  }

  if (versaoIpLiteral === 0) {
    // Hostname de verdade — resolve e valida CADA endereço retornado
    // (não só o primeiro; alguns hosts respondem com uma lista).
    let enderecos: Array<{ address: string; family: number }>;
    try {
      const resultado = await lookup(hostname, { all: true });
      enderecos = resultado;
    } catch (e) {
      return { permitido: false, motivo: `não foi possível resolver o hostname: ${e instanceof Error ? e.message : "erro desconhecido"}` };
    }
    if (enderecos.length === 0) return { permitido: false, motivo: "hostname não resolveu para nenhum endereço" };
    for (const { address, family } of enderecos) {
      if (family === 4 && v4EmFaixaBloqueada(address)) return { permitido: false, motivo: "hostname resolve para IP privado/interno" };
      if (family === 6 && v6Bloqueado(address)) return { permitido: false, motivo: "hostname resolve para IP privado/interno" };
    }
  }

  return { permitido: true, url: url.toString() };
}
