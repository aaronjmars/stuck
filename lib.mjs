// Shared helpers for stuck.mjs and bridges/*.mjs.
import { createPublicClient, http, decodeEventLog, getAddress } from "viem";
import * as chains from "viem/chains";
import { publicActionsL1 } from "viem/op-stack";

const KEY = process.env.ALCHEMY_KEY;
const DAY = 86400;
const now = () => Math.floor(Date.now() / 1000);

// ---------- rpc ----------

const rpcUrl = (net) => `https://${net}.g.alchemy.com/v2/${KEY}`;
const clients = new Map();
function client(chain, net) {
  if (!clients.has(net)) {
    clients.set(net, createPublicClient({ chain, transport: http(rpcUrl(net), { retryCount: 5, retryDelay: 400, timeout: 60_000 }) }));
  }
  return clients.get(net);
}
const l1 = () => client(chains.mainnet, "eth-mainnet").extend(publicActionsL1());

// Alchemy serves any block range when the result is <= 10k logs; split the range when it is not.
class RangeCapError extends Error {}
async function getLogsAll(c, params, from, to, { chunk = true } = {}) {
  try {
    return await c.getLogs({ ...params, fromBlock: from, toBlock: to });
  } catch (e) {
    const msg = `${e.details ?? ""} ${e.message ?? ""}`;
    // Some chains (Linea, zkSync, smaller OP Stack chains) cap the range at 10k blocks whatever the
    // result size: walk it in chunks, or let a per-address caller switch to the Transfers API.
    if (/up to a 10,?000 block range\. Based on your parameters, this block range should work/i.test(msg) && to - from >= 10_000n) {
      if (!chunk) throw new RangeCapError(msg);
      const chunks = [];
      for (let b = from; b <= to; b += 10_000n) chunks.push([b, b + 9_999n > to ? to : b + 9_999n]);
      return (await pool(chunks, 8, ([a, z]) => getLogsAll(c, params, a, z))).flat();
    }
    if (to <= from || !/exceed|range|limit|too many|10,?000/i.test(msg)) throw e;
    const mid = (from + to) / 2n;
    return [...(await getLogsAll(c, params, from, mid)), ...(await getLogsAll(c, params, mid + 1n, to))];
  }
}

// Per-address lookups on chains with the hard range cap: find candidate txs with the Transfers API.
async function transferTxs(c, user, to, category) {
  const out = [];
  let pageKey;
  do {
    const r = await c.request({ method: "alchemy_getAssetTransfers", params: [{ fromBlock: "0x0", toBlock: "latest", fromAddress: user, toAddress: to, category, withMetadata: true, maxCount: "0x3e8", ...(pageKey ? { pageKey } : {}) }] });
    out.push(...r.transfers);
    pageKey = r.pageKey;
  } while (pageKey);
  return out;
}

async function logsFromTxs(c, hashes, wanted) {
  const logs = await pool([...new Set(hashes)], 6, async (hash) => (await c.getTransactionReceipt({ hash })).logs);
  return logs.flat().flatMap((l) => {
    for (const { address, event } of wanted) {
      if (address && l.address.toLowerCase() !== address.toLowerCase()) continue;
      try { return [{ ...l, eventName: event.name, args: decodeEventLog({ abi: [event], data: l.data, topics: l.topics }).args }]; } catch {}
    }
    return [];
  });
}

const blockTimes = new Map();
async function blockTime(c, net, block) {
  const k = `${net}:${block}`;
  if (!blockTimes.has(k)) blockTimes.set(k, c.getBlock({ blockNumber: block }).then((b) => Number(b.timestamp)));
  return blockTimes.get(k);
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const j = i++; out[j] = await fn(items[j], j); }
  }));
  return out;
}

const revertText = (e) => `${e.shortMessage ?? ""} ${e.details ?? ""} ${e.message ?? ""}`;

// ---------- result model ----------
// status: claimable | ready-to-prove | ready-to-finalize | blocked | waiting | claimed | unknown
const STUCK = new Set(["claimable", "ready-to-prove", "ready-to-finalize"]);
const SHOWN = new Set([...STUCK, "blocked"]); // blocked = stuck, but only the bridge team can release it
const ETH = { kind: "native", symbol: "ETH", decimals: 18 };
const erc20 = (network, address) => ({ kind: "erc20", network, address: getAddress(address) });

async function fetchJson(url, tries = 2) {
  for (let i = 0; ; i++) {
    try { return await fetch(url, { signal: AbortSignal.timeout(30_000) }).then((r) => r.json()); }
    catch { if (i + 1 >= tries) return null; }
  }
}

export { KEY, DAY, now, rpcUrl, clients, client, l1, RangeCapError, getLogsAll, transferTxs, logsFromTxs, blockTimes, blockTime, pool, revertText, STUCK, SHOWN, ETH, erc20, fetchJson };
