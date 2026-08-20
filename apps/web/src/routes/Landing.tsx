import {Link} from "react-router-dom";
import {useEffect, useState} from "react";
import {ORDER_STATUS, explorerContract, type OrderStatus} from "@metrx/shared";
import {CORE_ADDRESS, DEMO_VIDEO_URL, GITHUB_URL} from "@/lib/config";
import {api, type ProofIndexResponse} from "@/lib/api";
import {Card, Eyebrow, Section, Chip, EmptyState, StatusPill} from "@/components/primitives";
import {HeroArtwork} from "@/components/HeroArtwork";
import {botAmount, shortAddress} from "@/lib/format";

/** The proof API serialises every numeric chain field as a decimal string. */
const statusOf = (order: Record<string, string>): OrderStatus => ORDER_STATUS[Number(order.status)] ?? "None";

export default function Landing() {
  return (
    <>
      <Hero />
      <Problem />
      <Mechanism />
      <WhyAiNative />
      <ProductFlow />
      <LiveProof />
      <TrustBoundary />
    </>
  );
}

function Hero() {
  return (
    <div className="relative isolate overflow-hidden pb-28 pt-24 md:pb-36 md:pt-32">
      <HeroArtwork />
      <Section>
        <div className="max-w-3xl">
          <span className="pill bg-ink text-paper">BOT Chain Mainnet · Chain 677</span>
          <h1 className="display mt-6 text-[46px] md:text-[76px]">
            Compute delivery should settle, not depend on trust.
          </h1>
          <p className="mt-6 max-w-2xl text-[19px] leading-relaxed text-slate">
            Metrx lets AI teams fund compute jobs, operators deliver results, and an AI verifier trigger BOT Chain
            settlement: PAY, REFUND, or SLASH.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link to="/app" className="btn btn-primary px-7 py-3.5 text-base">
              Launch app
            </Link>
            <Link to="/proof" className="btn btn-ghost px-7 py-3.5 text-base">
              View live proof
            </Link>
          </div>

          <div className="mt-10 flex flex-wrap gap-2">
            {["BOT Chain Mainnet", "Native BOT escrow", "AI-signed verdicts", "PAY / REFUND / SLASH"].map((c) => (
              <Chip key={c}>{c}</Chip>
            ))}
          </div>
        </div>
      </Section>
    </div>
  );
}

function Problem() {
  return (
    <Section className="py-20 md:py-28">
      <div className="grid gap-12 md:grid-cols-[0.9fr_1.1fr]">
        <div>
          <Eyebrow>The problem</Eyebrow>
          <h2 className="headline mt-3 text-[34px] md:text-[44px]">
            Off-chain compute creates on-chain payment disputes.
          </h2>
        </div>
        <div className="space-y-5 text-[17px] leading-relaxed text-slate">
          <p>
            The work happens somewhere you cannot see. A GPU somewhere runs a job, a result lands in a private
            dashboard, and the evidence of delivery is a screenshot in a group chat.
          </p>
          <p>
            So payment falls back on reputation. Buyers prepay centralized credits and hope. Operators run jobs for
            unknown wallets and hope. When the output is wrong, the argument happens in DMs and whoever holds the money
            wins.
          </p>
          <p className="text-ink">
            Metrx moves the last step on-chain. The job spec, the rubric, the delivered output, and the verdict that
            judged it are all public and hash-committed, and BOT Chain enforces the outcome.
          </p>
        </div>
      </div>
    </Section>
  );
}

function Mechanism() {
  const steps = [
    {
      n: "01",
      title: "Fund",
      body: "The buyer writes a job spec and a rubric, then funds the order with native BOT. The spec, input, rubric, and the verifier model are hashed on-chain at creation, so the terms cannot move afterwards.",
    },
    {
      n: "02",
      title: "Verify",
      body: "An operator stakes BOT, accepts the order, and commits the hash of its output. The AI verifier reads the spec, the rubric, and that exact output, then signs an EIP-712 certificate carrying its verdict, score, and reason.",
    },
    {
      n: "03",
      title: "Settle",
      body: "Anyone can submit the certificate. The contract recovers the verifier's signature and enforces the result: PASS pays the operator, FAIL refunds the buyer and slashes the operator's stake.",
    },
  ];

  return (
    <Section className="py-20 md:py-24">
      <Eyebrow>Mechanism</Eyebrow>
      <h2 className="headline mt-3 max-w-2xl text-[34px] md:text-[44px]">One job. One verdict. One settlement.</h2>
      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {steps.map((s) => (
          <Card key={s.n} className="flex flex-col gap-3 p-7">
            <span className="mono text-stone">{s.n}</span>
            <h3 className="headline text-[24px]">{s.title}</h3>
            <p className="text-[15px] leading-relaxed text-slate">{s.body}</p>
          </Card>
        ))}
      </div>
      <p className="mono mt-8 text-stone">
        buyer funds → operator delivers → AI verifier signs → BOT Chain settles PAY / REFUND / SLASH
      </p>
    </Section>
  );
}

function WhyAiNative() {
  return (
    <Section className="py-20 md:py-24">
      <div className="grid gap-12 md:grid-cols-[0.9fr_1.1fr]">
        <div>
          <Eyebrow>Why AI-native</Eyebrow>
          <h2 className="headline mt-3 text-[34px] md:text-[44px]">
            The model is the settlement authority, not a feature.
          </h2>
        </div>
        <div className="space-y-5 text-[17px] leading-relaxed text-slate">
          <p>
            Metrx is not a chatbot with a blockchain attached. The AI verifier&apos;s signed verdict is the only thing
            that releases escrow. Remove the model and no order can settle — the product does not degrade into a manual
            path, it stops.
          </p>
          <p className="text-ink">
            The model decides; the contract only enforces what it decided. On every order, an AI judgement is what moves
            real BOT between a buyer and an operator.
          </p>
          <p>
            The provider behind the model is swappable infrastructure. What is load-bearing is that the verdict is
            committed on-chain, bound to one job, and worthless anywhere else — the AI is a participant in settlement,
            not a third-party API call decorating a screen.
          </p>
        </div>
      </div>
    </Section>
  );
}

function ProductFlow() {
  const paths = [
    {
      role: "Buyers",
      lead: "You need a bounded compute job done and you do not want to prepay a stranger.",
      steps: [
        "Write the task, the input, and the rubric the output must satisfy.",
        "Fund the order in native BOT and set the delivery and verification deadlines.",
        "Watch the operator deliver, then run the AI verifier against your rubric.",
        "Get paid work, or get your escrow back plus the operator's slashed stake.",
      ],
      cta: {to: "/app/create", label: "Create a compute order"},
    },
    {
      role: "Operators",
      lead: "You sell compute and you want payment assurance before running anything.",
      steps: [
        "Register once and stake native BOT to signal you have something at risk.",
        "Accept a funded order. The escrow is already locked before you start work.",
        "Deliver your output and commit its hash on-chain.",
        "A passing verdict pays you the full escrow and releases your stake.",
      ],
      cta: {to: "/app/operator", label: "Register as an operator"},
    },
  ];

  return (
    <Section className="py-20 md:py-24">
      <Eyebrow>Product</Eyebrow>
      <h2 className="headline mt-3 text-[34px] md:text-[44px]">Built for buyers and operators.</h2>
      <div className="mt-12 grid gap-4 md:grid-cols-2">
        {paths.map((p) => (
          <Card key={p.role} className="flex flex-col p-8">
            <h3 className="headline text-[26px]">{p.role}</h3>
            <p className="mt-2 text-[15px] text-slate">{p.lead}</p>
            <ol className="mt-6 flex-1 space-y-3">
              {p.steps.map((s, i) => (
                <li key={s} className="flex gap-3 text-[15px] leading-relaxed text-slate">
                  <span className="mono mt-0.5 shrink-0 text-stone">{i + 1}</span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
            <Link to={p.cta.to} className="btn btn-ghost mt-7 self-start">
              {p.cta.label}
            </Link>
          </Card>
        ))}
      </div>
    </Section>
  );
}

function LiveProof() {
  const [index, setIndex] = useState<ProofIndexResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .proofIndex(8)
      .then((r) => !cancelled && setIndex(r))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const orders = index?.orders ?? [];
  const pay = orders.find((o) => statusOf(o) === "Paid");
  const slash = orders.find((o) => statusOf(o) === "Slashed");
  const highlights = [pay, slash].filter(Boolean) as Record<string, string>[];

  return (
    <Section className="py-20 md:py-24">
      <Eyebrow>Live proof</Eyebrow>
      <h2 className="headline mt-3 text-[34px] md:text-[44px]">The proof is the product.</h2>
      <p className="mt-4 max-w-2xl text-[17px] text-slate">
        Every settlement is a public BOT Chain transaction. No wallet required to read any of it.
      </p>

      <div className="mt-10 grid gap-4 md:grid-cols-2">
        {highlights.length > 0 ? (
          highlights.map((o) => <ProofCard key={o.id} order={o} />)
        ) : (
          <div className="md:col-span-2">
            <EmptyState title={CORE_ADDRESS ? "No settled orders yet" : "Pending mainnet proof"}>
              {CORE_ADDRESS ? (
                <>
                  MetrxCore is live at <span className="mono">{shortAddress(CORE_ADDRESS)}</span>, and the first PAY and
                  SLASH lifecycles will appear here the moment they settle.
                  {failed && " The proof API is not reachable from this browser right now."}
                </>
              ) : (
                <>
                  MetrxCore has not been broadcast to BOT Chain Mainnet yet, so there is nothing to show. This card
                  stays empty rather than displaying a rehearsal.
                </>
              )}
            </EmptyState>
          </div>
        )}
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <Card className="p-6">
          <Eyebrow>Contract</Eyebrow>
          {CORE_ADDRESS ? (
            <a
              className="mono mt-2 block break-all text-ink underline decoration-ink/25 underline-offset-2"
              href={explorerContract(CORE_ADDRESS)}
              target="_blank"
              rel="noreferrer"
            >
              {CORE_ADDRESS}
            </a>
          ) : (
            <p className="mt-2 text-sm text-stone">Not deployed yet.</p>
          )}
        </Card>
        <Card className="p-6">
          <Eyebrow>Repository</Eyebrow>
          {GITHUB_URL ? (
            <a
              className="mt-2 block text-sm text-ink underline decoration-ink/25 underline-offset-2"
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
            >
              Contracts, tests, and the verifier service
            </a>
          ) : (
            <p className="mt-2 text-sm text-stone">Source link published with the submission.</p>
          )}
        </Card>
        <Card className="p-6">
          <Eyebrow>Demo</Eyebrow>
          {DEMO_VIDEO_URL ? (
            <a
              className="mt-2 block text-sm text-ink underline decoration-ink/25 underline-offset-2"
              href={DEMO_VIDEO_URL}
              target="_blank"
              rel="noreferrer"
            >
              Watch the 3-minute walkthrough
            </a>
          ) : (
            <Link className="mt-2 block text-sm text-ink underline decoration-ink/25 underline-offset-2" to="/app/onboarding">
              Walk through it yourself in five steps
            </Link>
          )}
        </Card>
      </div>

      <Link to="/proof" className="btn btn-ghost mt-8">
        Open the proof hub
      </Link>
    </Section>
  );
}

function ProofCard({order}: {order: Record<string, string>}) {
  const status = statusOf(order);
  return (
    <Link to={`/proof/${order.id}`} className="card p-7 transition-colors hover:border-ink/25">
      <div className="flex items-center justify-between">
        <span className="mono text-stone">Order #{order.id}</span>
        <StatusPill status={status} />
      </div>
      <p className="headline mt-4 text-[28px]">{botAmount(BigInt(order.price ?? "0"))}</p>
      <p className="mt-2 text-sm text-slate">
        {status === "Paid"
          ? "The AI verifier passed the delivered output and the contract paid the operator."
          : "The AI verifier failed the delivered output. The buyer was refunded and the operator was slashed."}
      </p>
      <p className="mt-4 text-sm text-ink underline decoration-ink/25 underline-offset-2">Read the proof →</p>
    </Link>
  );
}

function TrustBoundary() {
  return (
    <Section className="py-20 md:py-24">
      <div className="grid gap-12 md:grid-cols-[0.9fr_1.1fr]">
        <div>
          <Eyebrow>Trust boundary</Eyebrow>
          <h2 className="headline mt-3 text-[34px] md:text-[44px]">What Metrx proves — and what it does not.</h2>
        </div>
        <div>
          <div className="space-y-4">
            <Card className="p-6">
              <p className="text-sm font-medium text-ink">What is enforced</p>
              <ul className="mt-2 space-y-1.5 text-[15px] text-slate">
                <li>Escrow and stake move only through the settlement contract.</li>
                <li>A payout requires a signature from the AI verifier named at deploy time.</li>
                <li>A certificate is bound to one order, spec, rubric, model, and output.</li>
                <li>Deadlines resolve every order without needing anyone's cooperation.</li>
              </ul>
            </Card>
            <Card className="p-6">
              <p className="text-sm font-medium text-ink">What is trusted</p>
              <ul className="mt-2 space-y-1.5 text-[15px] text-slate">
                <li>The AI verifier's judgement itself. It is public and auditable, not proven.</li>
                <li>The published artifacts are readable by anyone, so its reasoning can be checked.</li>
              </ul>
            </Card>
          </div>
          <p className="mt-5 text-[15px] leading-relaxed text-slate">
            This is publicly auditable AI adjudication enforced by BOT Chain settlement. It is not cryptographic proof
            of computation, not private compute, and not tokenized GPU ownership.
          </p>
          <Link to="/docs/what-is-real" className="btn btn-ghost mt-6">
            Read what is real
          </Link>
        </div>
      </div>
    </Section>
  );
}
