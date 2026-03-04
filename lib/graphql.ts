import { createClient, type Client } from "graphql-ws";

const HTTP  = process.env.NEXT_PUBLIC_GRAPHQL_HTTP  ?? "http://localhost:8080/v1/graphql";
const WS    = process.env.NEXT_PUBLIC_GRAPHQL_WS    ?? "ws://localhost:8080/v1/graphql";
const SECRET = process.env.NEXT_PUBLIC_HASURA_SECRET ?? "testing";

const HEADERS = { "x-hasura-admin-secret": SECRET };

// ── HTTP query ────────────────────────────────────────────────────────────────
export async function gqlFetch<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res  = await fetch(HTTP, {
    method:  "POST",
    headers: { "Content-Type": "application/json", ...HEADERS },
    body:    JSON.stringify({ query, variables }),
    cache:   "no-store",
  });
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0].message);
  return json.data as T;
}

// ── WebSocket subscription client (singleton) ─────────────────────────────────
let wsClient: Client | null = null;

export function getWsClient(): Client {
  if (!wsClient) {
    wsClient = createClient({
      url:              WS,
      connectionParams: HEADERS,
    });
  }
  return wsClient;
}

// ── Token decimals lookup ─────────────────────────────────────────────────────
const DECIMALS: Record<string, number> = {
  // Ethereum
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": 18, // WETH
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": 6,  // USDC
  "0xdac17f958d2ee523a2206206994597c13d831ec7": 6,  // USDT
  "0x6b175474e89094c44da98b954eedeac495271d0f": 18, // DAI
  "0x83f20f44975d03b1b09e64809b757c47f942beea": 18, // sDAI
  "0x57f5e098cad7a3d1eed53991d4d66c45c9af7812": 18, // USDM
  "0x6c3ea9036406852006290770bedfcaba0e23a0e8": 6,  // PYUSD
  "0xd533a949740bb3306d119cc777fa900ba034cd52": 18, // CRV
  "0xf939e0a03fb07f59a73314e73794be0e57ac1b4e": 18, // crvUSD
  // Base
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": 6,  // USDC Base
  "0x4200000000000000000000000000000000000006": 18, // WETH Base
  "0x50c5725949a6f0c72e6c4a641f24049a917db0cb": 18, // DAI Base
};

export function decimalsFor(asset: string): number {
  return DECIMALS[asset.toLowerCase()] ?? 18;
}

export function formatAmount(raw: string, asset: string): string {
  const dec = decimalsFor(asset);
  const big  = BigInt(raw);
  const div  = 10n ** BigInt(dec);
  const whole = big / div;
  const frac  = big % div;
  const fracStr = frac.toString().padStart(dec, "0").slice(0, 2);
  return `${Number(whole).toLocaleString()}.${fracStr}`;
}

export function formatAge(timestamp: number): string {
  const sec = Math.floor(Date.now() / 1000) - timestamp;
  if (sec < 60)   return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

export function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function chainLabel(chainId: number): string {
  return chainId === 1 ? "ETH" : "BASE";
}
