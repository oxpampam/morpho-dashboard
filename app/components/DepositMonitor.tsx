"use client";

import { useEffect, useRef, useState } from "react";
import { getWsClient, formatAmount, formatAge, shortAddr, chainLabel } from "@/lib/graphql";

// ── Types ────────────────────────────────────────────────────────────────────
interface Flow {
  id: string;
  vault: { name: string; chainId: number; asset: string };
  sender: string;
  owner: string;
  assets: string;
  flowType: "DEPOSIT" | "WITHDRAW";
  timestamp: number;
  txHash: string;
}

// ── Whale threshold: > 100k in the token's native units (heuristic) ──────────
function isWhale(assets: string, asset: string): boolean {
  // For USDC/USDT (6 dec) 100k = 100_000 * 1e6 = 1e11
  // For WETH/DAI  (18 dec) 100 ETH = 1e20
  // Simple heuristic: if raw > 1e17 OR (short dec & > 1e10)
  const n = BigInt(assets);
  return n > 100_000_000_000_000_000n; // 0.1 ETH equiv threshold → adjust per token
}

// ── Subscription query ────────────────────────────────────────────────────────
const SUB = `
  subscription LiveFlows {
    LPFlow(order_by: { timestamp: desc }, limit: 120) {
      id
      vault { name chainId asset }
      sender owner assets flowType timestamp txHash
    }
  }
`;

// ── Component ─────────────────────────────────────────────────────────────────
export default function DepositMonitor() {
  const [flows, setFlows]         = useState<Flow[]>([]);
  const [connected, setConnected] = useState(false);
  const [newIds, setNewIds]       = useState<Set<string>>(new Set());

  // Filters
  const [chain,    setChain]    = useState<"all" | "1" | "8453">("all");
  const [type,     setType]     = useState<"all" | "DEPOSIT" | "WITHDRAW">("all");
  const [minSize,  setMinSize]  = useState<"all" | "whale">("all");
  const [search,   setSearch]   = useState("");

  const prevIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    const client = getWsClient();
    const unsub  = client.subscribe<{ LPFlow: Flow[] }>(
      { query: SUB },
      {
        next: ({ data }) => {
          if (!data) return;
          setConnected(true);

          const incoming = data.LPFlow;
          const fresh = incoming
            .map((f) => f.id)
            .filter((id) => !prevIds.current.has(id));

          setNewIds(new Set(fresh));
          prevIds.current = new Set(incoming.map((f) => f.id));
          setFlows(incoming);

          // Clear highlight after 2 s
          setTimeout(() => setNewIds(new Set()), 2000);
        },
        error: () => setConnected(false),
        complete: () => setConnected(false),
      },
    );
    return () => unsub();
  }, []);

  // ── Filtering ──────────────────────────────────────────────────────────────
  const displayed = flows.filter((f) => {
    if (chain   !== "all" && String(f.vault.chainId) !== chain) return false;
    if (type    !== "all" && f.flowType !== type)               return false;
    if (minSize === "whale" && !isWhale(f.assets, f.vault.asset)) return false;
    if (search && !f.vault.name.toLowerCase().includes(search.toLowerCase())
               && !f.sender.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <section className="flex flex-col h-full">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-radar-accent font-semibold tracking-widest uppercase text-sm glow-blue">
          ⚡ Live Flow Feed
        </h2>
        <div className="flex items-center gap-2 text-xs text-radar-muted">
          <span className={`live-dot w-2 h-2 rounded-full ${connected ? "bg-radar-green" : "bg-radar-red"}`} />
          {connected ? "LIVE" : "connecting…"}
          <span className="text-radar-border">|</span>
          <span>{displayed.length} events</span>
        </div>
      </div>

      {/* ── Filters ────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2 mb-3 text-xs">
        {/* Search */}
        <input
          className="bg-radar-panel border border-radar-border rounded px-2 py-1 text-slate-300 placeholder-radar-muted focus:outline-none focus:border-radar-accent w-36"
          placeholder="vault / address…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {/* Chain */}
        <div className="flex rounded overflow-hidden border border-radar-border">
          {(["all", "1", "8453"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setChain(v)}
              className={`px-2 py-1 transition-colors ${chain === v ? "bg-radar-accent text-radar-bg font-bold" : "bg-radar-panel text-radar-muted hover:text-slate-300"}`}
            >
              {v === "all" ? "ALL" : v === "1" ? "ETH" : "BASE"}
            </button>
          ))}
        </div>
        {/* Type */}
        <div className="flex rounded overflow-hidden border border-radar-border">
          {(["all", "DEPOSIT", "WITHDRAW"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setType(v)}
              className={`px-2 py-1 transition-colors ${type === v ? "bg-radar-accent text-radar-bg font-bold" : "bg-radar-panel text-radar-muted hover:text-slate-300"}`}
            >
              {v === "all" ? "ALL" : v === "DEPOSIT" ? "⬆ DEP" : "⬇ WD"}
            </button>
          ))}
        </div>
        {/* Size */}
        <div className="flex rounded overflow-hidden border border-radar-border">
          {(["all", "whale"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setMinSize(v)}
              className={`px-2 py-1 transition-colors ${minSize === v ? "bg-radar-accent text-radar-bg font-bold" : "bg-radar-panel text-radar-muted hover:text-slate-300"}`}
            >
              {v === "all" ? "ALL SIZES" : "🐋 WHALES"}
            </button>
          ))}
        </div>
      </div>

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto rounded border border-radar-border">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 bg-radar-panel text-radar-muted uppercase tracking-wider z-10">
            <tr>
              <th className="px-3 py-2 text-left w-20">Age</th>
              <th className="px-3 py-2 text-left w-14">Chain</th>
              <th className="px-3 py-2 text-left">Vault</th>
              <th className="px-3 py-2 text-center w-20">Type</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2 text-left w-28">From</th>
              <th className="px-3 py-2 text-center w-10">TX</th>
            </tr>
          </thead>
          <tbody>
            {displayed.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-radar-muted py-8">
                  Syncing events…
                </td>
              </tr>
            )}
            {displayed.map((f) => {
              const isNew     = newIds.has(f.id);
              const isDeposit = f.flowType === "DEPOSIT";
              const whale     = isWhale(f.assets, f.vault.asset);
              const chain     = chainLabel(f.vault.chainId);
              const amount    = formatAmount(f.assets, f.vault.asset);
              const txUrl     = f.vault.chainId === 1
                ? `https://etherscan.io/tx/${f.txHash}`
                : `https://basescan.org/tx/${f.txHash}`;

              return (
                <tr
                  key={f.id}
                  className={[
                    "border-b border-radar-border transition-colors",
                    isNew ? "row-new bg-radar-accent/5" : "hover:bg-radar-panel/60",
                    whale ? "border-l-2 border-l-radar-yellow" : "",
                  ].join(" ")}
                >
                  <td className="px-3 py-1.5 text-radar-muted tabular-nums">
                    {formatAge(f.timestamp)}
                  </td>
                  <td className="px-3 py-1.5">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${chain === "ETH" ? "bg-blue-900/60 text-blue-300" : "bg-purple-900/60 text-purple-300"}`}>
                      {chain}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-slate-300 max-w-[180px] truncate">
                    {whale && <span className="mr-1">🐋</span>}
                    {f.vault.name}
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    <span className={`px-2 py-0.5 rounded font-bold text-[10px] ${isDeposit ? "bg-radar-green/15 text-radar-green glow-green" : "bg-radar-red/15 text-radar-red glow-red"}`}>
                      {isDeposit ? "⬆ DEP" : "⬇ WD"}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-300 font-medium">
                    {amount}
                  </td>
                  <td className="px-3 py-1.5 text-radar-muted font-mono">
                    {shortAddr(f.sender)}
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    <a
                      href={txUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-radar-accent hover:text-white transition-colors"
                      title="View on explorer"
                    >
                      ↗
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
