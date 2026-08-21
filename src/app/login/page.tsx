"use client";

/**
 * Login do navegador (Fase 15 — produção/single-user). Página nova,
 * separada do Command Center — não é um redesenho de nada existente, só o
 * portão que faltava na frente dele. Usa os mesmos tokens de cor de
 * globals.css (fundo/superficie/tinta/reator), sem inventar paleta nova.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function PaginaLogin() {
  const [senha, setSenha] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const router = useRouter();

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setCarregando(true);
    setErro(null);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senha }),
      });
      if (r.ok) {
        router.replace("/");
        router.refresh();
        return;
      }
      const corpo = await r.json().catch(() => ({}));
      if (r.status === 429) {
        setErro(`Muitas tentativas — aguarde antes de tentar de novo (até ${new Date(corpo.tentarNovamenteEm).toLocaleTimeString("pt-BR")}).`);
      } else if (r.status === 400) {
        setErro("JARVIS_TOKEN não está configurado neste ambiente — não há senha pra checar.");
      } else {
        setErro("Senha incorreta.");
      }
    } catch {
      setErro("Falha de rede — tente de novo.");
    } finally {
      setCarregando(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-fundo px-4">
      <form onSubmit={entrar} className="w-full max-w-sm rounded-xl border border-linha bg-superficie p-8">
        <h1 className="mb-1 text-lg font-medium text-tinta">Jarvis</h1>
        <p className="mb-6 text-sm text-tinta-media">Acesso restrito. Digite a senha para continuar.</p>

        <input
          type="password"
          autoFocus
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          placeholder="Senha"
          className="mb-4 w-full rounded-lg border border-linha bg-fundo-2 px-3 py-2 text-tinta outline-none focus:border-reator"
        />

        {erro && <p className="mb-4 text-sm text-risco">{erro}</p>}

        <button
          type="submit"
          disabled={carregando || !senha}
          className="w-full rounded-lg bg-reator px-3 py-2 font-medium text-fundo disabled:opacity-50"
        >
          {carregando ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </main>
  );
}
