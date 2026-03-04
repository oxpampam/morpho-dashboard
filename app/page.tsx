"use client";

import { useState } from "react";
import DepositMonitor  from "./components/DepositMonitor";
import CuratorScorecard from "./components/CuratorScorecard";
import VaultRadar from "./components/VaultRadar";

type Tab = "feed" | "radar" | "scorecard";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "feed",      label: "Live Feed",       icon: "📥" },
  { id: "radar",     label: "Vault Radar",     icon: "📡" },
  { id: "scorecard", label: "Curator Score",   icon: "🏆" },
];

export default function Page() {
  const [tab, setTab] = useState<Tab>("feed");

  return (
    <div className="flex flex-col min-h-screen">
      {/* ── Navbar ───────────────────────────────────────────────────────────── */}
      <header className="border-b border-radar-border px-6 py-3 flex items-center justify-between bg-radar-panel/80 backdrop-blur sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <span className="text-radar-accent text-xl">📡</span>
          <div>
            <h1 className="text-radar-accent font-bold tracking-widest uppercase text-sm glow-blue">
              Morpho Radar
            </h1>
            <p className="text-[10px] text-radar-muted tracking-wide">
              Real-time MetaMorpho vault intelligence · Ethereum + Base
            </p>
          </div>
        </div>

        {/* ── Tab bar ──────────────────────────────────────────────────────── */}
        <nav className="flex items-center gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-colors border ${
                tab === t.id
                  ? "bg-radar-accent/10 border-radar-accent text-radar-accent glow-blue"
                  : "border-transparent text-radar-muted hover:text-slate-300 hover:border-radar-border"
              }`}
            >
              <span>{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-4 text-[10px] text-radar-muted">
          <a
            href="http://localhost:8080/console"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-radar-accent transition-colors"
          >
            Hasura Console ↗
          </a>
          <span className="text-radar-border">|</span>
          <span>Envio HyperIndex v2.32</span>
        </div>
      </header>

      {/* ── Main panel ───────────────────────────────────────────────────────── */}
      <main className="flex-1 p-4 overflow-hidden" style={{ height: "calc(100vh - 56px)" }}>

        {/* Live Feed + Scorecard side-by-side */}
        {tab === "feed" && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 h-full">
            <div className="bg-radar-panel border border-radar-border rounded-lg p-4 flex flex-col overflow-hidden">
              <DepositMonitor />
            </div>
            <div className="bg-radar-panel border border-radar-border rounded-lg p-4 flex flex-col overflow-hidden">
              <CuratorScorecard />
            </div>
          </div>
        )}

        {/* Vault Radar — full width */}
        {tab === "radar" && (
          <div className="bg-radar-panel border border-radar-border rounded-lg p-4 flex flex-col h-full overflow-hidden">
            <VaultRadar />
          </div>
        )}

        {/* Scorecard — full width */}
        {tab === "scorecard" && (
          <div className="bg-radar-panel border border-radar-border rounded-lg p-4 flex flex-col h-full overflow-hidden">
            <CuratorScorecard />
          </div>
        )}
      </main>
    </div>
  );
}
