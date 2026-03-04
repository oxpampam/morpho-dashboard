"use client";

import { useEffect, useState } from "react";
import { gqlFetch, shortAddr } from "@/lib/graphql";

// ── Raw GQL types ─────────────────────────────────────────────────────────────
interface RawVault {
  id: string; curator: string; name: string; asset: string;
  tvl: string; chainId: number;
}
interface RawCapChange { vault_id: string; changeType: string; }
interface RawReallocation { vault_id: string; }
interface RawVaultMarket { vault_id: string; }

// ── Computed row ──────────────────────────────────────────────────────────────
interface CuratorRow {
  brand: string; curator: string;
  address_count: number; vault_count: number; chain_count: number;
  total_tvl_usd: number; total_cap_changes: number; total_revokes: number;
  total_reallocations: number; total_markets: number;
  discipline_score: number; activity_score: number;
  tvl_score: number; overall_score: number;
}

// ── Asset → USD conversion (heuristic prices) ─────────────────────────────────
const TVL_USD: Record<string, (raw: string) => number> = {
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": r => Number(r) / 1e18 * 3000,  // WETH
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": r => Number(r) / 1e6,           // USDC
  "0xdac17f958d2ee523a2206206994597c13d831ec7": r => Number(r) / 1e6,           // USDT
  "0x6b175474e89094c44da98b954eedeac495271d0f": r => Number(r) / 1e18,          // DAI
  "0x83f20f44975d03b1b09e64809b757c47f942beea": r => Number(r) / 1e18,          // sDAI
  "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599": r => Number(r) / 1e8  * 100000, // wBTC
  "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0": r => Number(r) / 1e18 * 3200,  // wstETH
  "0xae7ab96520de3a18e5e111b5eaab095312d7fe84": r => Number(r) / 1e18 * 3000,  // stETH
  "0xf939e0a03fb07f59a73314e73794be0e57ac1b4e": r => Number(r) / 1e18,          // crvUSD
  "0x6c3ea9036406852006290770bedfcaba0e23a0e8": r => Number(r) / 1e6,           // PYUSD
  "0x4200000000000000000000000000000000000006": r => Number(r) / 1e18 * 3000,  // WETH Base
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": r => Number(r) / 1e6,           // USDC Base
  "0x50c5725949a6f0c72e6c4a641f24049a917db0cb": r => Number(r) / 1e18,          // DAI Base
  "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf": r => Number(r) / 1e8  * 100000, // cbBTC
  "0xecac9c5f704e954931349da37f60e39f515c11c1": r => Number(r) / 1e8  * 100000, // eBTC
};

function toUSD(asset: string, raw: string): number {
  const fn = TVL_USD[asset.toLowerCase()];
  return fn ? fn(raw) : 0;
}

// ── Brand extraction ──────────────────────────────────────────────────────────
function extractBrand(name: string): string {
  if (/mev\s*capital/i.test(name))    return "MEV Capital";
  if (/block\s*analitica/i.test(name)) return "BlockAnalitica";
  return name.trim().split(/\s+/)[0] ?? name;
}

function dominantBrand(names: string[]): string {
  const freq: Record<string, number> = {};
  for (const n of names) { const b = extractBrand(n); freq[b] = (freq[b] ?? 0) + 1; }
  return Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Unknown";
}

// ── Query (paginate up to 2000 vaults) ───────────────────────────────────────
const VAULT_QUERY = `query($offset:Int!) {
  Vault(limit:1000 offset:$offset order_by:{id:asc}) {
    id curator name asset tvl chainId
  }
}`;
const CC_QUERY    = `{ CapChange(limit:5000 order_by:{id:asc}) { vault_id changeType } }`;
const REAL_QUERY  = `{ Reallocation(limit:5000 order_by:{id:asc}) { vault_id } }`;
const VM_QUERY    = `{ VaultMarket(limit:5000 order_by:{id:asc}) { vault_id } }`;

async function fetchAll(): Promise<RawVault[]> {
  const vaults: RawVault[] = [];
  for (const offset of [0, 1000]) {
    const d = await gqlFetch<{ Vault: RawVault[] }>(VAULT_QUERY, { offset });
    vaults.push(...d.Vault);
    if (d.Vault.length < 1000) break;
  }
  return vaults;
}

// ── Score computation ─────────────────────────────────────────────────────────
function computeScorecard(
  vaults: RawVault[],
  capChanges: RawCapChange[],
  reallocations: RawReallocation[],
  vaultMarkets: RawVaultMarket[],
): CuratorRow[] {

  // Index counts by vault_id
  const ccCount:  Record<string, number> = {};
  const revCount: Record<string, number> = {};
  for (const cc of capChanges) {
    ccCount[cc.vault_id]   = (ccCount[cc.vault_id]   ?? 0) + 1;
    if (cc.changeType === "REVOKE")
      revCount[cc.vault_id] = (revCount[cc.vault_id] ?? 0) + 1;
  }
  const realCount: Record<string, number> = {};
  for (const r of reallocations) realCount[r.vault_id] = (realCount[r.vault_id] ?? 0) + 1;
  const vmCount:   Record<string, number> = {};
  for (const v of vaultMarkets) vmCount[v.vault_id]   = (vmCount[v.vault_id]   ?? 0) + 1;

  // Group vaults by curator
  const byCurator: Record<string, RawVault[]> = {};
  for (const v of vaults) {
    const c = v.curator.toLowerCase();
    (byCurator[c] ??= []).push(v);
  }

  // Per-curator brand determination
  const curatorBrand: Record<string, string> = {};
  for (const [c, vs] of Object.entries(byCurator))
    curatorBrand[c] = dominantBrand(vs.map(v => v.name));

  // Group curators by brand
  const byBrand: Record<string, string[]> = {};
  for (const [c, brand] of Object.entries(curatorBrand))
    (byBrand[brand] ??= []).push(c);

  // Aggregate per brand
  const rows: CuratorRow[] = [];
  for (const [brand, curators] of Object.entries(byBrand)) {
    const brandVaults = vaults.filter(v => curators.includes(v.curator.toLowerCase()));
    if (brandVaults.length === 0) continue;

    const vaultIds   = brandVaults.map(v => v.id);
    const chainIds   = new Set(brandVaults.map(v => v.chainId));
    const tvlUSD     = brandVaults.reduce((s, v) => s + toUSD(v.asset, v.tvl), 0);
    const capCh      = vaultIds.reduce((s, id) => s + (ccCount[id]   ?? 0), 0);
    const revokes    = vaultIds.reduce((s, id) => s + (revCount[id]  ?? 0), 0);
    const reallocs   = vaultIds.reduce((s, id) => s + (realCount[id] ?? 0), 0);
    const markets    = vaultIds.reduce((s, id) => s + (vmCount[id]   ?? 0), 0);

    if (capCh === 0 && reallocs === 0) continue; // skip inactive

    const discipline = capCh > 0 ? 1 - revokes / capCh : 1;
    const avgReallocPerVault = vaultIds.length > 0 ? reallocs / vaultIds.length : 0;
    const activity   = Math.min(
      (Math.log10(Math.max(avgReallocPerVault, 1) + 1) / Math.log10(10001)) * 100, 100
    );

    // Primary curator = one with most vaults
    const primary = curators.reduce((best, c) =>
      byCurator[c].length > (byCurator[best]?.length ?? 0) ? c : best, curators[0]);

    rows.push({
      brand, curator: primary,
      address_count: curators.length,
      vault_count: vaultIds.length,
      chain_count: chainIds.size,
      total_tvl_usd: tvlUSD,
      total_cap_changes: capCh, total_revokes: revokes,
      total_reallocations: reallocs, total_markets: markets,
      discipline_score: discipline, activity_score: activity,
      tvl_score: 0, overall_score: 0, // filled below
    });
  }

  // TVL score (log-normalised against max)
  const maxTVL = Math.max(...rows.map(r => r.total_tvl_usd), 1);
  for (const r of rows) {
    r.tvl_score = r.total_tvl_usd > 0
      ? (Math.log(r.total_tvl_usd + 1) / Math.log(maxTVL + 1)) * 100 : 0;
    r.overall_score =
      r.tvl_score / 100 * 40 +
      r.discipline_score * 30 +
      r.activity_score / 100 * 30;
  }

  return rows.sort((a, b) => b.overall_score - a.overall_score);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtTVL(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return n > 0 ? `$${n.toFixed(0)}` : "—";
}

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

function DisciplineBadge({ score, revokes }: { score: number; revokes: number }) {
  if (revokes === 0) return <span className="text-radar-green text-[10px] font-bold">CLEAN</span>;
  if (score > 0.95)  return <span className="text-radar-yellow text-[10px]">GOOD</span>;
  return <span className="text-radar-red text-[10px]">⚠ {revokes}R</span>;
}

// ── Component ─────────────────────────────────────────────────────────────────
type SortKey = keyof CuratorRow;

export default function CuratorScorecard() {
  const [rows,    setRows]    = useState<CuratorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort,    setSort]    = useState<SortKey>("overall_score");
  const [asc,     setAsc]     = useState(false);

  async function load() {
    const [vaults, ccData, realData, vmData] = await Promise.all([
      fetchAll(),
      gqlFetch<{ CapChange:    RawCapChange[]    }>(CC_QUERY),
      gqlFetch<{ Reallocation: RawReallocation[] }>(REAL_QUERY),
      gqlFetch<{ VaultMarket:  RawVaultMarket[]  }>(VM_QUERY),
    ]);
    setRows(computeScorecard(vaults, ccData.CapChange, realData.Reallocation, vmData.VaultMarket));
    setLoading(false);
  }

  useEffect(() => {
    load().catch(() => setLoading(false));
    const t = setInterval(() => load().catch(() => {}), 60_000);
    return () => clearInterval(t);
  }, []);

  const sorted = [...rows].sort((a, b) => {
    const av = a[sort] as number;
    const bv = b[sort] as number;
    return asc ? av - bv : bv - av;
  });

  function toggleSort(col: SortKey) {
    if (sort === col) setAsc(!asc); else { setSort(col); setAsc(false); }
  }

  function th(label: string, col: SortKey, title?: string) {
    const active = sort === col;
    return (
      <th
        className={`px-3 py-2 text-left cursor-pointer select-none hover:text-slate-300 transition-colors ${active ? "text-radar-accent" : "text-radar-muted"}`}
        onClick={() => toggleSort(col)} title={title}
      >
        {label} {active ? (asc ? "↑" : "↓") : ""}
      </th>
    );
  }

  return (
    <section className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-radar-accent font-semibold tracking-widest uppercase text-sm glow-blue">
          🏆 Curator Scorecard
        </h2>
        <span className="text-xs text-radar-muted">{rows.length} curators · click header to sort</span>
      </div>

      <div className="flex-1 overflow-y-auto rounded border border-radar-border">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 bg-radar-panel text-radar-muted uppercase tracking-wider z-10">
            <tr>
              <th className="px-3 py-2 text-left text-radar-muted">#</th>
              <th className="px-3 py-2 text-left text-radar-muted">Curator</th>
              {th("TVL",      "total_tvl_usd",      "USD TVL across known assets")}
              {th("Vaults",   "vault_count",         "Total vaults")}
              {th("Reallocs", "total_reallocations", "Total reallocation events")}
              {th("Revokes",  "total_revokes",       "Revoked cap proposals")}
              <th className="px-3 py-2 text-left w-28 text-radar-muted" title="Log-normalised TVL score (0–100)">TVL Score</th>
              <th className="px-3 py-2 text-left text-radar-muted" title="1 − revokes/cap_changes">Discipline</th>
              {th("Score",    "overall_score",       "40% TVL + 30% discipline + 30% activity")}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={9} className="text-center text-radar-muted py-8">Loading scorecard…</td></tr>
            )}
            {sorted.map((r, i) => {
              const rowColor = i === 0 ? "border-l-2 border-l-yellow-400"
                : i === 1 ? "border-l-2 border-l-slate-400"
                : i === 2 ? "border-l-2 border-l-amber-700" : "";
              return (
                <tr key={r.brand} className={`border-b border-radar-border hover:bg-radar-panel/60 transition-colors ${rowColor}`}>
                  <td className="px-3 py-2 text-radar-muted tabular-nums">
                    {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-baseline gap-1.5">
                      <a href={`https://etherscan.io/address/${r.curator}`} target="_blank" rel="noopener noreferrer"
                        className="text-slate-200 font-semibold hover:text-radar-accent transition-colors"
                        title={`Primary address: ${r.curator}`}>
                        {r.brand}
                      </a>
                      <span className="font-mono text-[10px] text-radar-muted">{shortAddr(r.curator)}</span>
                    </div>
                    <div className="flex gap-1.5 mt-0.5">
                      {r.address_count > 1 && <span className="text-[9px] text-purple-400 font-bold">{r.address_count} addrs</span>}
                      {r.chain_count   > 1 && <span className="text-[9px] text-blue-400 font-bold">MC</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2 tabular-nums text-slate-300 font-mono text-[11px]">{fmtTVL(r.total_tvl_usd)}</td>
                  <td className="px-3 py-2 tabular-nums text-center">{r.vault_count}</td>
                  <td className="px-3 py-2 tabular-nums text-center text-slate-300">{r.total_reallocations.toLocaleString()}</td>
                  <td className="px-3 py-2 tabular-nums text-center">
                    {r.total_revokes > 0
                      ? <span className="text-radar-red">⚠ {r.total_revokes}</span>
                      : <span className="text-radar-green text-[10px]">✓</span>}
                  </td>
                  <td className="px-3 py-2 w-28"><ScoreBar value={r.tvl_score} /></td>
                  <td className="px-3 py-2"><DisciplineBadge score={r.discipline_score} revokes={r.total_revokes} /></td>
                  <td className="px-3 py-2"><ScoreBar value={r.overall_score} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

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
