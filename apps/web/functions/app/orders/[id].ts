// Per-order social meta for the in-app order page — same rewrite as /proof/:id so an app link
// shared anywhere also unfurls with that order's settlement card. See functions/proof/[id].ts.

const SITE = "https://metrx.pages.dev";
const API_BASE = "https://metrx-api.timjosh507.workers.dev";

type Ctx = {
  params: {id: string};
  request: Request;
  env: {ASSETS: {fetch: (req: Request) => Promise<Response>}};
};

interface ProofData {
  outcome?: string;
  reason?: {verdict?: string; scoreBps?: number} | null;
  hashChecks?: {matches?: boolean}[];
}

const OUTCOME_LABEL: Record<string, string> = {PAY: "PAID", REFUND: "REFUNDED", SLASH: "SLASHED", PENDING: "pending"};

class SetContent {
  private value: string;
  constructor(value: string) {
    this.value = value;
  }
  element(el: {setAttribute: (k: string, v: string) => void}) {
    el.setAttribute("content", this.value);
  }
}

class SetText {
  private value: string;
  constructor(value: string) {
    this.value = value;
  }
  element(el: {setInnerContent: (v: string) => void}) {
    el.setInnerContent(this.value);
  }
}

async function summarise(id: string) {
  try {
    const res = await fetch(`${API_BASE}/api/proof/${id}`, {signal: AbortSignal.timeout(2500)});
    if (!res.ok) return null;
    const proof = (await res.json()) as ProofData;
    const label = OUTCOME_LABEL[String(proof.outcome)] ?? "";
    const verdict = proof.reason?.verdict ? `${proof.reason.verdict} at ${(Number(proof.reason.scoreBps) || 0) / 100}%` : null;
    const checks = Array.isArray(proof.hashChecks) ? proof.hashChecks : [];
    return {label, verdict, matched: checks.filter((c) => c?.matches).length, total: checks.length};
  } catch {
    return null;
  }
}

export const onRequestGet = async (ctx: Ctx): Promise<Response> => {
  const id = String(ctx.params.id ?? "");
  const html = await ctx.env.ASSETS.fetch(new Request(new URL("/index.html", ctx.request.url).toString()));
  if (!/^\d+$/.test(id)) return html;

  const summary = await summarise(id);
  const title = summary?.label ? `Metrx · Order #${id} — ${summary.label}` : `Metrx · Order #${id}`;
  const facts: string[] = [];
  if (summary?.verdict) facts.push(`AI verdict ${summary.verdict}`);
  if (summary && summary.total) facts.push(`${summary.matched}/${summary.total} committed hashes verified on-chain`);
  const description =
    (facts.length ? `${facts.join(" · ")}. ` : "") +
    "Read this order end to end on Metrx — spec, delivery, the signed AI verdict, and the transaction that enforced it.";
  const image = `${SITE}/og/order/${id}.png`;
  const url = `${SITE}${new URL(ctx.request.url).pathname}`;

  return new HTMLRewriter()
    .on("title", new SetText(title))
    .on('meta[property="og:title"]', new SetContent(title))
    .on('meta[name="twitter:title"]', new SetContent(title))
    .on('meta[name="description"]', new SetContent(description))
    .on('meta[property="og:description"]', new SetContent(description))
    .on('meta[name="twitter:description"]', new SetContent(description))
    .on('meta[property="og:image"]', new SetContent(image))
    .on('meta[name="twitter:image"]', new SetContent(image))
    .on('meta[property="og:image:alt"]', new SetContent(`Metrx Order #${id} settlement card`))
    .on('meta[property="og:image:width"]', new SetContent("1200"))
    .on('meta[property="og:image:height"]', new SetContent("630"))
    .on('meta[property="og:url"]', new SetContent(url))
    .transform(html);
};
