"use client";

import { useEffect, useRef } from "react";
import type { EstadoReator } from "@/lib/eventos";

/**
 * Ambiente do Command Center — malha de nós conectados atrás da interface.
 *
 * Adaptação de uma referência visual (constelação com física de nós, linhas
 * de conexão, interação de cursor, anéis de radar) — não é cópia. O original
 * era conteúdo de tela cheia com título; aqui vira profundidade ambiente
 * atrás do reator, do HUD e da conversa, e nunca compete com eles: opacidade
 * baixa, z-index atrás de tudo, e pausa sempre que decoração perderia para
 * algo real na hierarquia de movimento.
 *
 * A intensidade visual segue o MESMO estado real do reator — não um relógio
 * decorativo próprio. Pensando acelera o movimento dos nós; planejando
 * aumenta as conexões; executando cria um pulso localizado perto do reator;
 * erro pontua alguns nós de âmbar sem tingir a tela; offline congela quase
 * tudo. Rótulos técnicos (CORE, MEMORY, TOOL…) só aparecem quando o sistema
 * de fato está fazendo aquilo — não são decoração de demo.
 */

type Props = {
  estado: EstadoReator;
  /** Overlay de voz aberto — ambiente recua para não competir com a voz. */
  atenuado?: boolean;
  /** Tools realmente ativas agora — vira rótulo técnico quando existe. */
  toolAtiva?: string | null;
  /** Nome do projeto/cliente do contexto atual — vira rótulo quando existe. */
  rotuloContexto?: string | null;
};

type No = {
  x: number;
  y: number;
  ox: number;
  oy: number;
  vx: number;
  vy: number;
  raio: number;
  fase: number;
};

const DENSIDADE = { desktop: 62, tablet: 34, mobile: 18 } as const;
const DIST_CONEXAO = 150;
const DPR_MAX = 2;
const FPS_ALVO = 30;

/** Multiplicadores de intensidade por estado real do reator — nada inventado. */
const INTENSIDADE: Record<EstadoReator, { vel: number; conexao: number; pulso: number }> = {
  ocioso: { vel: 0.16, conexao: 1, pulso: 0.5 },
  ouvindo: { vel: 0.3, conexao: 1.1, pulso: 0.7 },
  pensando: { vel: 0.55, conexao: 1.25, pulso: 1 },
  planejando: { vel: 0.4, conexao: 1.6, pulso: 0.9 },
  executando: { vel: 0.7, conexao: 1.3, pulso: 1.3 },
  aguardando_aprovacao: { vel: 0.22, conexao: 1, pulso: 0.6 },
  falando: { vel: 0.2, conexao: 0.9, pulso: 0.5 },
  erro: { vel: 0.25, conexao: 0.85, pulso: 0.8 },
  offline: { vel: 0.03, conexao: 0.5, pulso: 0.1 },
};

function densidadePorLargura(w: number): number {
  if (w < 640) return DENSIDADE.mobile;
  if (w < 1024) return DENSIDADE.tablet;
  return DENSIDADE.desktop;
}

export function JarvisConstellation({
  estado,
  atenuado = false,
  toolAtiva = null,
  rotuloContexto = null,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const estadoRef = useRef(estado);
  const atenuadoRef = useRef(atenuado);
  const toolRef = useRef(toolAtiva);
  const contextoRef = useRef(rotuloContexto);
  estadoRef.current = estado;
  atenuadoRef.current = atenuado;
  toolRef.current = toolAtiva;
  contextoRef.current = rotuloContexto;

  useEffect(() => {
    const canvasNulo = canvasRef.current;
    const containerNulo = containerRef.current;
    if (!canvasNulo || !containerNulo) return;
    const ctxNulo = canvasNulo.getContext("2d");
    if (!ctxNulo) return;

    // Rebindados como não-nulos: as funções abaixo são declarações içadas, e o
    // TypeScript não propaga a checagem acima para dentro delas — só para
    // `const` cujo tipo já nasce sem `| null`.
    const canvas = canvasNulo;
    const container = containerNulo;
    const ctx = ctxNulo;

    const reduzMovimento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let largura = 0;
    let altura = 0;
    let nos: No[] = [];
    let animId: number | null = null;
    let ultimoFrame = 0;
    let ativo = document.visibilityState === "visible";
    const mouse = { x: -9999, y: -9999, dentro: false };

    // Cores lidas do tema — profundidade ambiente, nunca paleta nova.
    const corLinha = getComputedStyle(document.documentElement)
      .getPropertyValue("--color-linha")
      .trim();
    const corReator = getComputedStyle(document.documentElement).getPropertyValue("--reator").trim();
    const corReatorClaro = getComputedStyle(document.documentElement)
      .getPropertyValue("--reator-claro")
      .trim();
    const corRisco = getComputedStyle(document.documentElement).getPropertyValue("--risco").trim();

    function criarNos(n: number) {
      const arr: No[] = [];
      for (let i = 0; i < n; i++) {
        const x = Math.random() * largura;
        const y = Math.random() * altura;
        arr.push({
          x,
          y,
          ox: x,
          oy: y,
          vx: (Math.random() - 0.5) * 0.3,
          vy: (Math.random() - 0.5) * 0.3,
          raio: 1 + Math.random() * 1.6,
          fase: Math.random() * Math.PI * 2,
        });
      }
      return arr;
    }

    function redimensionar() {
      const r = container.getBoundingClientRect();
      largura = r.width;
      altura = r.height;
      const dpr = Math.min(window.devicePixelRatio || 1, DPR_MAX);
      canvas.width = Math.max(1, Math.round(largura * dpr));
      canvas.height = Math.max(1, Math.round(altura * dpr));
      canvas.style.width = `${largura}px`;
      canvas.style.height = `${altura}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      nos = criarNos(densidadePorLargura(largura));
    }

    function desenharEstatico() {
      // prefers-reduced-motion: um quadro só, malha técnica fixa, sem física.
      ctx.clearRect(0, 0, largura, altura);
      ctx.strokeStyle = corLinha;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1;
      const passo = 64;
      for (let x = 0; x <= largura; x += passo) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, altura);
        ctx.stroke();
      }
      for (let y = 0; y <= altura; y += passo) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(largura, y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    function passo(tempo: number) {
      animId = requestAnimationFrame(passo);
      if (!ativo) return;
      if (tempo - ultimoFrame < 1000 / FPS_ALVO) return;
      const dt = Math.min(48, tempo - ultimoFrame || 16);
      ultimoFrame = tempo;

      // Verificação de tamanho a cada frame, não ResizeObserver.
      //
      // Achado testando ao vivo: neste ambiente de preview, nem
      // ResizeObserver nem o evento "resize" da window disparam quando o
      // viewport muda — confirmado anexando um observer isolado que ficou
      // mudo por 300ms depois de três resizes reais (o container em si
      // media o tamanho novo certinho via getBoundingClientRect, só o
      // observer não notificava). Em vez de depender de notificação, mede a
      // verdade a cada frame — o loop já roda mesmo, o custo de duas leituras
      // de clientWidth/clientHeight é irrelevante, e funciona em qualquer
      // navegador independente de qual API de notificação ele suporta.
      if (container.clientWidth !== largura || container.clientHeight !== altura) {
        redimensionar();
      }

      const intens = INTENSIDADE[estadoRef.current];
      const opacidadeBase = (atenuadoRef.current ? 0.35 : 1) * (estadoRef.current === "offline" ? 0.4 : 1);

      ctx.clearRect(0, 0, largura, altura);

      // física: deriva suave + retorno tipo mola à origem + repulsão local do cursor
      for (const no of nos) {
        no.vx += (no.ox - no.x) * 0.0009;
        no.vy += (no.oy - no.y) * 0.0009;

        if (mouse.dentro) {
          const dx = no.x - mouse.x;
          const dy = no.y - mouse.y;
          const d2 = dx * dx + dy * dy;
          const raioCursor = 130;
          if (d2 < raioCursor * raioCursor && d2 > 0.01) {
            const d = Math.sqrt(d2);
            const forca = (1 - d / raioCursor) * 0.9;
            no.vx += (dx / d) * forca;
            no.vy += (dy / d) * forca;
          }
        }

        no.vx *= 0.94;
        no.vy *= 0.94;
        no.x += no.vx * intens.vel * (dt / 16);
        no.y += no.vy * intens.vel * (dt / 16);
      }

      // conexões — só entre nós próximos, custo O(n²) mas n ≤ 62: irrelevante
      const distMax = DIST_CONEXAO * intens.conexao;
      ctx.lineWidth = 1;
      for (let i = 0; i < nos.length; i++) {
        for (let j = i + 1; j < nos.length; j++) {
          const dx = nos[i].x - nos[j].x;
          const dy = nos[i].y - nos[j].y;
          const d2 = dx * dx + dy * dy;
          if (d2 > distMax * distMax) continue;
          const d = Math.sqrt(d2);
          const op = (1 - d / distMax) * 0.16 * opacidadeBase;
          if (op <= 0.003) continue;
          ctx.strokeStyle = corLinha;
          ctx.globalAlpha = op;
          ctx.beginPath();
          ctx.moveTo(nos[i].x, nos[i].y);
          ctx.lineTo(nos[j].x, nos[j].y);
          ctx.stroke();
        }
      }

      // nós — pulso senoidal determinístico, cor de erro só nos nós próximos
      // do canto de status, nunca a tela inteira
      const t = tempo / 1000;
      for (let i = 0; i < nos.length; i++) {
        const no = nos[i];
        const pulso = 0.5 + Math.sin(t * 1.4 + no.fase) * 0.5;
        const cor = estadoRef.current === "erro" && i % 11 === 0 ? corRisco : corReator;
        ctx.fillStyle = cor;
        ctx.globalAlpha = (0.18 + pulso * 0.22 * intens.pulso) * opacidadeBase;
        ctx.beginPath();
        ctx.arc(no.x, no.y, no.raio, 0, Math.PI * 2);
        ctx.fill();
      }

      // anéis de radar — âncora fracionária perto de onde o reator fica no
      // layout (canto superior esquerdo da área de conversa)
      const ax = largura * 0.16;
      const ay = altura * 0.14;
      const numAneis = estadoRef.current === "offline" ? 0 : 2;
      for (let k = 0; k < numAneis; k++) {
        const ciclo = ((t * (0.25 + intens.pulso * 0.3) + k / numAneis) % 1);
        const r = ciclo * 130;
        ctx.strokeStyle = corReatorClaro;
        ctx.globalAlpha = (1 - ciclo) * 0.1 * opacidadeBase;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(ax, ay, r, 0, Math.PI * 2);
        ctx.stroke();
      }

      // rótulos técnicos — só os que são reais agora, no máximo 3
      ctx.globalAlpha = 0.3 * opacidadeBase;
      ctx.font = "9px var(--fonte-mono, monospace)";
      ctx.fillStyle = corReatorClaro;
      const rotulos: string[] = ["CORE"];
      if (toolRef.current) rotulos.push(toolRef.current.toUpperCase());
      if (contextoRef.current) rotulos.push(contextoRef.current.toUpperCase());
      rotulos.slice(0, 3).forEach((r, i) => {
        const px = largura - 90;
        const py = 24 + i * 16;
        if (px > 40 && py < altura - 10) ctx.fillText(r, px, py);
      });

      ctx.globalAlpha = 1;
    }

    redimensionar();
    if (reduzMovimento) {
      desenharEstatico();
    } else {
      animId = requestAnimationFrame(passo);
    }

    const aoRedimensionar = () => {
      redimensionar();
      if (reduzMovimento) desenharEstatico();
    };
    const aoMoverMouse = (e: MouseEvent) => {
      const r = container.getBoundingClientRect();
      mouse.x = e.clientX - r.left;
      mouse.y = e.clientY - r.top;
      mouse.dentro = true;
    };
    const aoSairMouse = () => {
      mouse.dentro = false;
    };
    const aoMudarVisibilidade = () => {
      ativo = document.visibilityState === "visible";
    };

    // ResizeObserver funciona em navegador real e é essencialmente grátis —
    // fica como caminho rápido. Mas no modo estático (reduced motion) não há
    // loop de frame verificando tamanho sozinho, então some com o intervalo
    // abaixo como reforço de baixa frequência — não é animação, é correção
    // ocasional depois de um resize de verdade.
    const ro = new ResizeObserver(aoRedimensionar);
    ro.observe(container);
    container.addEventListener("mousemove", aoMoverMouse);
    container.addEventListener("mouseleave", aoSairMouse);
    document.addEventListener("visibilitychange", aoMudarVisibilidade);

    let intervaloEstatico: ReturnType<typeof setInterval> | null = null;
    if (reduzMovimento) {
      intervaloEstatico = setInterval(() => {
        if (container.clientWidth !== largura || container.clientHeight !== altura) {
          redimensionar();
          desenharEstatico();
        }
      }, 600);
    }

    return () => {
      if (animId) cancelAnimationFrame(animId);
      if (intervaloEstatico) clearInterval(intervaloEstatico);
      ro.disconnect();
      container.removeEventListener("mousemove", aoMoverMouse);
      container.removeEventListener("mouseleave", aoSairMouse);
      document.removeEventListener("visibilitychange", aoMudarVisibilidade);
    };
  }, []);

  return (
    <div ref={containerRef} className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <canvas ref={canvasRef} className="absolute inset-0" />
    </div>
  );
}
