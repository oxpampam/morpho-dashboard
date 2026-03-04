"use client";

import { useEffect, useState } from "react";
import { gqlFetch, shortAddr } from "@/lib/graphql";

// ── Types ────────────────────────────────────────────────────────────────────
interface CuratorRow {
  brand:                string;
  curator:              string;  // primary address (most vaults) — used for Etherscan link
  address_count:        string;
  vault_count:          string;
  chain_count:          string;
  total_cap_changes:    string;
  total_revokes:        string;
  total_reallocations:  string;
  total_markets:        string;
  total_tvl_usd:        string;
  discipline_score:     string;
  activity_score:       string;
  tvl_score:            string;
  overall_score:        string;
}

function fmtTVL(raw: string): string {
  const n = parseFloat(raw);
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return n > 0 ? `$${n.toFixed(0)}` : "—";
}

const QUERY = `
  query {
    curator_scorecard(order_by: { overall_score: desc }) {
      brand curator address_count vault_count chain_count total_tvl_usd
      total_cap_changes total_revokes total_reallocations total_markets
      discipline_score activity_score tvl_score overall_score
    }
  }
`;

// ── Score bar ─────────────────────────────────────────────────────────────────
function ScoreBar({ value, max = 100 }: { value: number; max?: number }) {
  const pct   = Math.min((value / max) * 100, 100);
  const color = pct > 90 ? "#00ff88" : pct > 70 ? "#ffcc00" : "#ff4466";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1 bg-radar-border rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="tabular-nums text-[10px] w-10 text-right" style={{ color }}>
        {value.toFixed(1)}
      </span>
    </div>
  );
}

// ── Discipline badge ──────────────────────────────────────────────────────────
function DisciplineBadge({ score, revokes }: { score: number; revokes: number }) {
  if (revokes === 0)  return <span className="text-radar-green text-[10px] font-bold">CLEAN</span>;
  if (score > 0.95)   return <span className="text-radar-yellow text-[10px]">GOOD</span>;
  return <span className="text-radar-red text-[10px]">⚠ {revokes}R</span>;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function CuratorScorecard() {
  const [rows,    setRows]    = useState<CuratorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort,    setSort]    = useState<keyof CuratorRow>("overall_score");
  const [asc,     setAsc]     = useState(false);

  useEffect(() => {
    gqlFetch<{ curator_scorecard: CuratorRow[] }>(QUERY)
      .then((d) => { setRows(d.curator_scorecard); setLoading(false); })
      .catch(() => setLoading(false));

    const t = setInterval(() => {
      gqlFetch<{ curator_scorecard: CuratorRow[] }>(QUERY)
        .then((d) => setRows(d.curator_scorecard))
        .catch(() => {});
    }, 30_000);
    return () => clearInterval(t);
  }, []);

  const sorted = [...rows].sort((a, b) => {
    const av = parseFloat(a[sort] as string) || 0;
    const bv = parseFloat(b[sort] as string) || 0;
    return asc ? av - bv : bv - av;
  });

  function toggleSort(col: keyof CuratorRow) {
    if (sort === col) setAsc(!asc);
    else { setSort(col); setAsc(false); }
  }

  function th(label: string, col: keyof CuratorRow, title?: string) {
    const active = sort === col;
    return (
      <th
        className={`px-3 py-2 text-left cursor-pointer select-none hover:text-slate-300 transition-colors ${active ? "text-radar-accent" : "text-radar-muted"}`}
        onClick={() => toggleSort(col)}
        title={title}
      >
        {label} {active ? (asc ? "↑" : "↓") : ""}
      </th>
    );
  }

  return (
    <section className="flex flex-col h-full">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-radar-accent font-semibold tracking-widest uppercase text-sm glow-blue">
          🏆 Curator Scorecard
        </h2>
        <span className="text-xs text-radar-muted">{rows.length} curators · click header to sort</span>
      </div>

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto rounded border border-radar-border">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 bg-radar-panel text-radar-muted uppercase tracking-wider z-10">
            <tr>
              <th className="px-3 py-2 text-left text-radar-muted">#</th>
              <th className="px-3 py-2 text-left text-radar-muted">Curator</th>
              {th("TVL",      "total_tvl_usd",       "USD TVL across known assets (WETH/USDC/USDT/DAI/wBTC)")}
              {th("Vaults",   "vault_count",          "Total vaults across all addresses")}
              {th("Reallocs", "total_reallocations",  "Total reallocation events")}
              {th("Revokes",  "total_revokes",        "Revoked cap proposals")}
              <th className="px-3 py-2 text-left w-28 text-radar-muted" title="Log-normalized TVL score (0–100)">TVL Score</th>
              <th className="px-3 py-2 text-left text-radar-muted" title="1 − revokes/cap_changes">Discipline</th>
              {th("Score",    "overall_score",        "40% TVL + 30% discipline + 30% activity")}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={9} className="text-center text-radar-muted py-8">Loading scorecard…</td>
              </tr>
            )}
            {sorted.map((r, i) => {
              const overall    = parseFloat(r.overall_score);
              const tvlScore   = parseFloat(r.tvl_score);
              const discipline = parseFloat(r.discipline_score);
              const revokes    = parseInt(r.total_revokes);
              const addrs      = parseInt(r.address_count);
              const rowColor   = i === 0 ? "border-l-2 border-l-yellow-400" : i === 1 ? "border-l-2 border-l-slate-400" : i === 2 ? "border-l-2 border-l-amber-700" : "";

              return (
                <tr
                  key={r.brand}
                  className={`border-b border-radar-border hover:bg-radar-panel/60 transition-colors ${rowColor}`}
                >
                  <td className="px-3 py-2 text-radar-muted tabular-nums">
                    {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-baseline gap-1.5">
                      <a
                        href={`https://etherscan.io/address/${r.curator}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-slate-200 font-semibold hover:text-radar-accent transition-colors"
                        title={`Primary address: ${r.curator}`}
                      >
                        {r.brand}
                      </a>
                      <span className="font-mono text-[10px] text-radar-muted">{shortAddr(r.curator)}</span>
                    </div>
                    <div className="flex gap-1.5 mt-0.5">
                      {addrs > 1 && (
                        <span className="text-[9px] text-purple-400 font-bold">{addrs} addrs</span>
                      )}
                      {parseInt(r.chain_count) > 1 && (
                        <span className="text-[9px] text-blue-400 font-bold">MC</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 tabular-nums text-slate-300 font-mono text-[11px]">
                    {fmtTVL(r.total_tvl_usd)}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-center">{r.vault_count}</td>
                  <td className="px-3 py-2 tabular-nums text-center text-slate-300">
                    {Number(r.total_reallocations).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-center">
                    {revokes > 0
                      ? <span className="text-radar-red">⚠ {revokes}</span>
                      : <span className="text-radar-green text-[10px]">✓</span>}
                  </td>
                  <td className="px-3 py-2 w-28">
                    <ScoreBar value={tvlScore} max={100} />
                  </td>
                  <td className="px-3 py-2">
                    <DisciplineBadge score={discipline} revokes={revokes} />
                  </td>
                  <td className="px-3 py-2">
                    <ScoreBar value={overall} max={100} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Legend ─────────────────────────────────────────────────────────── */}
      <div className="mt-2 flex gap-3 text-[10px] text-radar-muted flex-wrap">
        <span>Score = <span className="text-radar-accent">40% TVL</span> + <span className="text-radar-yellow">30% discipline</span> + <span className="text-slate-400">30% activity</span></span>
        <span>·</span>
        <span><span className="text-purple-400 font-bold">N addrs</span> = N multisig addresses merged</span>
        <span>·</span>
        <span><span className="text-blue-400 font-bold">MC</span> = multi-chain</span>
      </div>
    </section>
  );
}
