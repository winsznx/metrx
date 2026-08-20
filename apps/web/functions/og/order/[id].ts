// Dynamic per-order Open Graph image, rendered at the edge with satori + resvg (workers-og).
//
// It reuses the public proof bundle the settlement worker already serves (/api/proof/:id), so the
// card cannot claim anything the on-chain evidence does not. The settlement worker is left
// untouched — this lives on the Pages side and only reads.

import {ImageResponse, loadGoogleFont} from "workers-og";

const API_BASE = "https://metrx-api.timjosh507.workers.dev";

// The card is a cryptographic receipt, so it is set entirely in the product's mono face.
const OUTCOME: Record<string, {label: string; color: string; eyebrow: string}> = {
  PAY: {label: "PAID", color: "#0f9c78", eyebrow: "SETTLED ON BOT CHAIN MAINNET"},
  REFUND: {label: "REFUNDED", color: "#b07a1f", eyebrow: "SETTLED ON BOT CHAIN MAINNET"},
  SLASH: {label: "SLASHED", color: "#9c3b24", eyebrow: "SETTLED ON BOT CHAIN MAINNET"},
  PENDING: {label: "PENDING", color: "#6b6259", eyebrow: "SETTLEMENT PENDING · BOT CHAIN"},
};

type Ctx = {
  params: {id: string};
  request: Request;
  waitUntil: (p: Promise<unknown>) => void;
};

interface ProofData {
  outcome?: string;
  reason?: {verdict?: string; scoreBps?: number; modelId?: string} | null;
  hashChecks?: {matches?: boolean}[];
  order?: {status?: string};
  jobSpec?: {modelId?: string} | null;
}

interface Card {
  id: string;
  label: string;
  color: string;
  eyebrow: string;
  line1: string;
  line2: string;
  model: string;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const formatScore = (bps: number) => {
  const pct = (Number(bps) || 0) / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`;
};

function fallbackCard(id: string): Card {
  return {
    id,
    label: "METRX",
    color: "#141311",
    eyebrow: "COMPUTE SETTLEMENT · BOT CHAIN MAINNET",
    line1: "Fund a job, deliver, an AI verifier signs the verdict.",
    line2: "BOT Chain enforces PAY, REFUND, or SLASH.",
    model: "metrx.pages.dev",
  };
}

async function loadCard(id: string): Promise<Card> {
  try {
    const res = await fetch(`${API_BASE}/api/proof/${id}`, {signal: AbortSignal.timeout(4000)});
    if (!res.ok) return fallbackCard(id);
    const proof = (await res.json()) as ProofData;
    const outcome = OUTCOME[String(proof.outcome)] ?? OUTCOME.PENDING;
    const reason = proof.reason ?? null;
    const checks = Array.isArray(proof.hashChecks) ? proof.hashChecks : [];
    const matched = checks.filter((c) => c?.matches).length;
    const status = proof.order?.status ?? "Open";
    return {
      id,
      label: outcome.label,
      color: outcome.color,
      eyebrow: outcome.eyebrow,
      line1: reason?.verdict ? `AI verdict ${reason.verdict} · ${formatScore(reason.scoreBps ?? 0)}` : `Status: ${status}`,
      line2: checks.length
        ? `${matched}/${checks.length} committed hashes verified on-chain`
        : "Escrow held by the contract on BOT Chain",
      model: String(reason?.modelId ?? proof.jobSpec?.modelId ?? "BOT Chain Mainnet"),
    };
  } catch {
    return fallbackCard(id);
  }
}

function markup(d: Card) {
  return `
  <div style="display:flex;flex-direction:column;justify-content:space-between;width:1200px;height:630px;padding:76px;background:#f7f1e8;font-family:Mono;">
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <div style="display:flex;align-items:center;">
        <div style="display:flex;width:26px;height:26px;border-radius:7px;background:#14c79a;margin-right:16px;"></div>
        <div style="display:flex;font-size:31px;font-weight:600;color:#141311;">Metrx</div>
      </div>
      <div style="display:flex;align-items:center;border:1px solid rgba(20,19,17,0.16);border-radius:999px;padding:10px 22px;font-size:21px;color:#4b5563;">Order #${escapeHtml(d.id)}</div>
    </div>
    <div style="display:flex;flex-direction:column;">
      <div style="display:flex;font-size:21px;letter-spacing:4px;color:#8a8178;margin-bottom:20px;">${escapeHtml(d.eyebrow)}</div>
      <div style="display:flex;font-size:150px;font-weight:600;letter-spacing:-5px;line-height:1;color:${d.color};">${escapeHtml(d.label)}</div>
      <div style="display:flex;font-size:31px;color:#141311;margin-top:34px;">${escapeHtml(d.line1)}</div>
      <div style="display:flex;font-size:26px;color:#4b5563;margin-top:14px;">${escapeHtml(d.line2)}</div>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <div style="display:flex;font-size:20px;color:#8a8178;">${escapeHtml(d.model)}</div>
      <div style="display:flex;font-size:20px;color:#8a8178;">metrx.pages.dev/proof/${escapeHtml(d.id)}</div>
    </div>
  </div>`;
}

let fontsPromise: Promise<{name: string; data: ArrayBuffer; weight: 400 | 600; style: "normal"}[]> | null = null;
function fonts() {
  // Load the full face (no `text=` subset — a subset returned glyph-less boxes) and register it
  // under a single-word family name. satori matches font-family exactly, and a name with spaces or
  // quotes gets mangled by the lightweight CSS parser and silently drops the font (tofu).
  fontsPromise ??= Promise.all([
    loadGoogleFont({family: "IBM Plex Mono", weight: 400}),
    loadGoogleFont({family: "IBM Plex Mono", weight: 600}),
  ]).then(([regular, bold]) => [
    {name: "Mono", data: regular, weight: 400 as const, style: "normal" as const},
    {name: "Mono", data: bold, weight: 600 as const, style: "normal" as const},
  ]);
  return fontsPromise;
}

export const onRequestGet = async (ctx: Ctx): Promise<Response> => {
  const id = String(ctx.params.id ?? "").replace(/\.png$/i, "");
  if (!/^\d+$/.test(id)) return new Response("Not found", {status: 404});

  const store = (caches as unknown as {default: Cache}).default;
  // Version the cache key so a new card design invalidates old renders at the edge, independent
  // of the public URL that scrapers cache by. Bump v2 -> v3 when the card changes again.
  const cacheKey = new Request(`https://og-cache.metrx.internal/v2/order/${id}.png`);
  const cached = await store.match(cacheKey);
  if (cached) return cached;

  const [card, fontData] = await Promise.all([loadCard(id), fonts()]);
  const image = new ImageResponse(markup(card), {width: 1200, height: 630, fonts: fontData});

  const res = new Response(image.body, {status: 200, headers: new Headers(image.headers)});
  res.headers.set("content-type", "image/png");
  res.headers.set("cache-control", "public, max-age=3600, s-maxage=86400");
  ctx.waitUntil(store.put(cacheKey, res.clone()));
  return res;
};
