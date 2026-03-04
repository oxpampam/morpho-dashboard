"use client";

import { useEffect, useRef, useState } from "react";
import { getWsClient } from "@/lib/graphql";

// ── Types ─────────────────────────────────────────────────────────────────────
interface FlowEvent {
  id:        string;
  vault_id:  string;
  assets:    string;
  flowType:  "DEPOSIT" | "WITHDRAW";
  timestamp: number;
  txHash:    string;
  chainId:   number; // derived client-side from vault_id
}

const SUBSCRIPTION = `
  subscription {
    LPFlow(order_by: { timestamp: desc }, limit: 600) {
      id vault_id assets flowType timestamp txHash
    }
  }
`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function chainIdFromVaultId(id: string): number {
  const parts = id.split("-");
  return parseInt(parts[parts.length - 1]) || 1;
}

/** Deterministic angle [0, 2π) from txHash */
function txAngle(txHash: string): number {
  const h = txHash.startsWith("0x") ? txHash.slice(2) : txHash;
  return ((parseInt(h.slice(0, 8), 16) % 36000) / 100) * (Math.PI / 180);
}

/** Deterministic radius fraction [0.12, 0.90] from txHash */
function txRadius(txHash: string): number {
  const h = txHash.startsWith("0x") ? txHash.slice(2) : txHash;
  return 0.12 + ((parseInt(h.slice(8, 16), 16) % 1000) / 1000) * 0.78;
}

/** Rough USD size for log-scaling bubble radius */
function toUSD(assets: string): number {
  const n = Number(assets);
  if (n <= 0) return 0;
  // heuristic: >1e12 → treat as 18-dec token (ETH scale), else 6-dec stable
  return n > 1e12 ? (n / 1e18) * 3000 : n / 1e6;
}

function bubbleSize(assets: string): number {
  const usd = toUSD(assets);
  return Math.max(3, Math.min(Math.log10(usd + 10) * 3, 16));
}

// ── Single radar canvas ───────────────────────────────────────────────────────
function RadarCanvas({
  chainId,
  events,
  paused,
}: {
  chainId: number;
  events:  FlowEvent[];
  paused:  boolean;
}) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const sweepRef   = useRef(0);
  const rafRef     = useRef(0);
  const lastTRef   = useRef(0);
  const eventsRef  = useRef(events);
  eventsRef.current = events;
  const pausedRef  = useRef(paused);
  pausedRef.current = paused;

  const isETH    = chainId === 1;
  const ACCENT   = isETH ? "#00d4ff" : "#a855f7";
  const SWEEP_R  = isETH ? "0,212,255" : "168,85,247";
  const BORDER   = isETH ? "#1e4a8a"   : "#4a1e8a";
  const LIFETIME = 3600; // seconds a bubble stays visible (1 hour)

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const DPR  = window.devicePixelRatio || 1;
    const SIZE = 300;
    canvas.width  = SIZE * DPR;
    canvas.height = SIZE * DPR;
    canvas.style.width  = `${SIZE}px`;
    canvas.style.height = `${SIZE}px`;

    const ctx = canvas.getContext("2d")!;
    ctx.scale(DPR, DPR);

    const cx = SIZE / 2;
    const cy = SIZE / 2;
    const R  = SIZE / 2 - 14;

    function draw(time: number) {
      const dt = lastTRef.current ? Math.min((time - lastTRef.current) / 1000, 0.05) : 0.016;
      lastTRef.current = time;

      if (!pausedRef.current) {
        sweepRef.current = (sweepRef.current + dt * (2 * Math.PI) / 4) % (2 * Math.PI);
      }
      const sweep = sweepRef.current;

      // ── Background ──────────────────────────────────────────────────────────
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.fillStyle = "#040a12";
      ctx.beginPath();
      ctx.arc(cx, cy, R + 12, 0, 2 * Math.PI);
      ctx.fill();

      // ── Grid rings ──────────────────────────────────────────────────────────
      for (let i = 1; i <= 4; i++) {
        ctx.strokeStyle = i === 4 ? `rgba(${SWEEP_R}, 0.25)` : "rgba(255,255,255,0.04)";
        ctx.lineWidth   = i === 4 ? 1.2 : 0.6;
        ctx.beginPath();
        ctx.arc(cx, cy, R * i / 4, 0, 2 * Math.PI);
        ctx.stroke();
      }

      // ── Cross-hairs ─────────────────────────────────────────────────────────
      ctx.strokeStyle = "rgba(255,255,255,0.04)";
      ctx.lineWidth   = 0.6;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
      ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R);
      for (let a = 1; a < 4; a++) {
        const ang = a * Math.PI / 4;
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R);
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(ang + Math.PI) * R, cy + Math.sin(ang + Math.PI) * R);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // ── Sweep trail ─────────────────────────────────────────────────────────
      const TRAIL = Math.PI * 0.55;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, R - 1, 0, 2 * Math.PI);
      ctx.clip();
      const STEPS = 48;
      for (let i = 0; i < STEPS; i++) {
        const t  = i / STEPS;
        const a1 = sweep - TRAIL + TRAIL * t;
        const a2 = sweep - TRAIL + TRAIL * (t + 1 / STEPS);
        ctx.fillStyle = `rgba(${SWEEP_R}, ${t * t * 0.22})`;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, R - 1, a1, a2);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();

      // ── Sweep line ──────────────────────────────────────────────────────────
      ctx.save();
      ctx.strokeStyle = `rgba(${SWEEP_R}, 0.9)`;
      ctx.lineWidth   = 1.5;
      ctx.shadowBlur  = 12;
      ctx.shadowColor = ACCENT;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(sweep) * R, cy + Math.sin(sweep) * R);
      ctx.stroke();
      ctx.restore();

      // ── Centre dot ──────────────────────────────────────────────────────────
      ctx.save();
      ctx.fillStyle   = ACCENT;
      ctx.shadowBlur  = 10;
      ctx.shadowColor = ACCENT;
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, 2 * Math.PI);
      ctx.fill();
      ctx.restore();

      // ── Bubbles ─────────────────────────────────────────────────────────────
      const now = Date.now() / 1000;
      for (const ev of eventsRef.current) {
        if (ev.chainId !== chainId) continue;
        const age = now - ev.timestamp;
        if (age < 0 || age > LIFETIME) continue;

        const angle = txAngle(ev.txHash);
        const rf    = txRadius(ev.txHash);
        const bx    = cx + Math.cos(angle) * rf * R;
        const by    = cy + Math.sin(angle) * rf * R;

        // glow when sweep is within 0.22 rad behind
        const diff = ((sweep - angle) + 2 * Math.PI) % (2 * Math.PI);
        const lit  = diff < 0.22;

        const fade  = Math.pow(1 - age / LIFETIME, 0.6);
        const alpha = lit ? 1.0 : fade * 0.55;
        const size  = bubbleSize(ev.assets);
        const isD   = ev.flowType === "DEPOSIT";
        const rgb   = isD ? "0,255,136" : "255,68,102";
        const glow  = isD ? "#00ff88" : "#ff4466";

        ctx.save();
        ctx.shadowBlur  = lit ? 18 : 5;
        ctx.shadowColor = glow;
        ctx.fillStyle   = `rgba(${rgb}, ${alpha})`;
        ctx.beginPath();
        ctx.arc(bx, by, size, 0, 2 * Math.PI);
        ctx.fill();

        if (size > 7) {
          ctx.strokeStyle = `rgba(${rgb}, ${alpha * 0.4})`;
          ctx.lineWidth   = 1;
          ctx.beginPath();
          ctx.arc(bx, by, size + 3.5, 0, 2 * Math.PI);
          ctx.stroke();
        }
        ctx.restore();
      }

      // ── Outer border ────────────────────────────────────────────────────────
      ctx.strokeStyle = BORDER;
      ctx.lineWidth   = 2;
      ctx.shadowBlur  = 8;
      ctx.shadowColor = ACCENT;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.shadowBlur = 0;

      rafRef.current = requestAnimationFrame(draw);
    }

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [chainId]); // eslint-disable-line react-hooks/exhaustive-deps

  return <canvas ref={canvasRef} style={{ display: "block" }} />;
}

// ── Stats row for one chain ───────────────────────────────────────────────────
function ChainStats({ events, chainId }: { events: FlowEvent[]; chainId: number }) {
  const recent = events.filter((e) => e.chainId === chainId && Date.now() / 1000 - e.timestamp < 3600);
  const deps  = recent.filter((e) => e.flowType === "DEPOSIT").length;
  const withs = recent.filter((e) => e.flowType === "WITHDRAW").length;
  const lastTs = recent.length ? Math.min(...recent.map((e) => e.timestamp)) : 0;
  const oldestMin = lastTs ? Math.round((Date.now() / 1000 - lastTs) / 60) : null;
  return (
    <div className="flex gap-3 text-[10px] justify-center">
      <span className="text-radar-green">▲ {deps} dep</span>
      <span className="text-radar-muted">·</span>
      <span className="text-radar-red">▼ {withs} with</span>
      <span className="text-radar-muted">last 1h</span>
      {oldestMin !== null && (
        <span className="text-radar-muted">· oldest {oldestMin}m ago</span>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function VaultRadar() {
  const [events,  setEvents]  = useState<FlowEvent[]>([]);
  const [paused,  setPaused]  = useState(false);
  const [connected, setConnected] = useState(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    const client = getWsClient();
    let unsub: (() => void) | undefined;

    const dispose = client.subscribe<{ LPFlow: Omit<FlowEvent, "chainId">[] }>(
      { query: SUBSCRIPTION },
      {
        next: ({ data }) => {
          if (!data) return;
          if (pausedRef.current) return;
          const enriched = data.LPFlow.map((e) => ({
            ...e,
            chainId: chainIdFromVaultId(e.vault_id),
          }));
          setEvents(enriched);
          setConnected(true);
        },
        error: () => setConnected(false),
        complete: () => setConnected(false),
      }
    );
    unsub = () => dispose();

    return () => unsub?.();
  }, []);

  const ethCount  = events.filter((e) => e.chainId === 1).length;
  const baseCount = events.filter((e) => e.chainId === 8453).length;

  return (
    <section className="flex flex-col h-full">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-radar-accent font-semibold tracking-widest uppercase text-sm glow-blue">
            Vault Radar
          </h2>
          <span
            className={`w-2 h-2 rounded-full ${connected ? "bg-radar-green live-dot" : "bg-radar-red"}`}
          />
        </div>
        <div className="flex items-center gap-3 text-[10px] text-radar-muted">
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-radar-green opacity-75" />
            Deposit
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-radar-red opacity-75" />
            Withdraw
          </span>
          <span>· bubble size = amount</span>
          <button
            onClick={() => setPaused((p) => !p)}
            className={`px-2 py-0.5 rounded border transition-colors ${
              paused
                ? "border-radar-yellow text-radar-yellow"
                : "border-radar-border text-radar-muted hover:text-slate-300"
            }`}
          >
            {paused ? "▶ Resume" : "⏸ Pause"}
          </button>
        </div>
      </div>

      {/* ── Dual radar ─────────────────────────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center gap-8">
        {/* ETH */}
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-blue-400 font-bold text-sm tracking-widest">ETHEREUM</span>
            <span className="text-[10px] text-radar-muted">{ethCount} events</span>
          </div>
          <div className="relative">
            <RadarCanvas chainId={1} events={events} paused={paused} />
          </div>
          <ChainStats events={events} chainId={1} />
        </div>

        {/* Divider */}
        <div className="h-64 w-px bg-radar-border opacity-40" />

        {/* Base */}
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-purple-400 font-bold text-sm tracking-widest">BASE</span>
            <span className="text-[10px] text-radar-muted">{baseCount} events</span>
          </div>
          <div className="relative">
            <RadarCanvas chainId={8453} events={events} paused={paused} />
          </div>
          <ChainStats events={events} chainId={8453} />
        </div>
      </div>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <div className="mt-3 flex justify-center gap-6 text-[10px] text-radar-muted">
        <span>Sweep: 1 rotation / 4s</span>
        <span>·</span>
        <span>Bubbles show last 1h · newest = brightest</span>
        <span>·</span>
        <span>Glow on sweep contact</span>
      </div>
    </section>
  );
}
