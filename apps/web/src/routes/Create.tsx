import {useEffect, useMemo, useState} from "react";
import {useNavigate} from "react-router-dom";
import {useAccount} from "wagmi";
import {decodeEventLog} from "viem";
import {hashJson, hashText, type JobSpec} from "@metrx/shared";
import {api, type VerifierConfig} from "@/lib/api";
import {coreAbi, useBotBalance, useMetrxWrite, useNetworkGate} from "@/lib/contract";
import {botAmount, inSeconds, safeParseBot, timestamp} from "@/lib/format";
import {humanError, type FriendlyError} from "@/lib/errors";
import {
  Card,
  ErrorNotice,
  Eyebrow,
  Field,
  Mono,
  Notice,
  Row,
  Section,
  Spinner,
  TxLink,
} from "@/components/primitives";
import {ConnectButton, NetworkBanner} from "@/components/Wallet";
import {DeployGate} from "@/components/DeployGate";
import {usePublicClient} from "wagmi";
import {CORE_ADDRESS} from "@/lib/config";

const STEPS = ["Task", "Rubric", "Terms", "Review", "Fund"] as const;
type Step = (typeof STEPS)[number];

const DELIVERY_OPTIONS = [
  {label: "30 minutes", minutes: 30},
  {label: "2 hours", minutes: 120},
  {label: "12 hours", minutes: 720},
  {label: "3 days", minutes: 4320},
];

function durationLabel(minutes: number): string {
  const known = DELIVERY_OPTIONS.find((o) => o.minutes === minutes);
  if (known) return known.label;
  if (minutes < 60) return `${minutes} minutes`;
  if (minutes < 1440) return `${+(minutes / 60).toFixed(1)} hours`;
  return `${+(minutes / 1440).toFixed(1)} days`;
}

export default function Create() {
  const navigate = useNavigate();
  const {isConnected} = useAccount();
  const {wrongNetwork} = useNetworkGate();
  const balance = useBotBalance();
  const client = usePublicClient();
  const tx = useMetrxWrite();

  const [step, setStep] = useState<Step>("Task");
  const [config, setConfig] = useState<VerifierConfig | null>(null);
  const [configError, setConfigError] = useState<FriendlyError | null>(null);

  const [title, setTitle] = useState("Summarize a support ticket");
  const [instructions, setInstructions] = useState(
    "Summarize this support ticket into exactly 3 action items. Do not invent facts that are not in the ticket."
  );
  const [input, setInput] = useState(
    "Customer says their October invoice was charged twice. They already emailed support once with no reply. They are asking for a refund of the duplicate charge and want confirmation by Friday."
  );
  const [rubric, setRubric] = useState<string[]>([
    "Output must contain exactly 3 action items",
    "Output must mention the duplicate charge refund request",
    "Output must not invent facts absent from the ticket",
  ]);

  const [price, setPrice] = useState("0.02");
  const [maxSlash, setMaxSlash] = useState("0.01");
  const [deliveryMinutes, setDeliveryMinutes] = useState(120);
  const [verificationChoice, setVerificationChoice] = useState(240);

  // The verification window must end after delivery, so its options depend on the delivery
  // choice. Derived rather than synced, so changing delivery can never leave the second
  // select holding a value the contract would reject.
  const verificationOptions = useMemo(() => {
    const longer = DELIVERY_OPTIONS.filter((o) => o.minutes > deliveryMinutes).map((o) => o.minutes);
    return Array.from(new Set([deliveryMinutes * 2, ...longer])).sort((a, b) => a - b);
  }, [deliveryMinutes]);

  const verificationMinutes = verificationOptions.includes(verificationChoice)
    ? verificationChoice
    : verificationOptions[0]!;

  const [publishError, setPublishError] = useState<FriendlyError | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [createdOrderId, setCreatedOrderId] = useState<string | null>(null);

  useEffect(() => {
    api
      .config()
      .then(setConfig)
      .catch((e) => setConfigError(humanError(e)));
  }, []);

  const priceParsed = safeParseBot(price);
  const slashParsed = safeParseBot(maxSlash);

  const spec: JobSpec = useMemo(
    () => ({
      title: title.trim(),
      taskType: "text-eval",
      instructions: instructions.trim(),
      input: input.trim(),
      rubric: rubric.map((r) => r.trim()).filter(Boolean),
      modelId: config?.verifier.modelId ?? "",
    }),
    [title, instructions, input, rubric, config]
  );

  const hashes = useMemo(
    () => ({
      jobSpecHash: hashJson(spec),
      inputHash: hashText(spec.input),
      rubricHash: hashJson(spec.rubric),
      modelHash: hashText(spec.modelId),
    }),
    [spec]
  );

  const stepErrors: Record<Step, string | null> = {
    Task: !spec.title
      ? "Give the job a title."
      : spec.instructions.length < 10
        ? "Write instructions the operator can actually follow."
        : spec.input.length < 10
          ? "Provide the input the operator will work from."
          : null,
    Rubric:
      spec.rubric.length === 0
        ? "Add at least one rubric rule. This is exactly what the AI verifier will judge against."
        : null,
    Terms: priceParsed.error ?? slashParsed.error ?? (verificationMinutes <= deliveryMinutes ? "The verification window must end after the delivery deadline." : null),
    Review: config ? null : "Waiting for the verifier service to report its model.",
    Fund: null,
  };

  const insufficient = priceParsed.wei !== null && balance !== null && balance < priceParsed.wei;

  async function fund() {
    if (!priceParsed.wei || !slashParsed.wei || !client) return;
    setPublishError(null);
    setPublishing(true);
    try {
      // The spec must be readable before the order exists, or the verifier has nothing to fetch.
      const published = await api.publishJobSpec(spec);
      if (published.hash.toLowerCase() !== hashes.jobSpecHash.toLowerCase()) {
        throw new Error("The published job spec did not reproduce its hash. Nothing was funded.");
      }
      setPublishing(false);

      const hash = await tx.send(
        "createOrder",
        [
          hashes.jobSpecHash,
          hashes.inputHash,
          hashes.rubricHash,
          hashes.modelHash,
          inSeconds(deliveryMinutes),
          inSeconds(verificationMinutes),
          slashParsed.wei,
        ],
        priceParsed.wei
      );
      if (!hash) return;

      const receipt = await client.getTransactionReceipt({hash});
      const created = receipt.logs
        .filter((log) => log.address.toLowerCase() === CORE_ADDRESS?.toLowerCase())
        .map((log) => {
          try {
            return decodeEventLog({abi: coreAbi, data: log.data, topics: log.topics});
          } catch {
            return null;
          }
        })
        .find((e) => e?.eventName === "OrderCreated");

      const orderId = created ? String((created.args as unknown as {orderId: bigint}).orderId) : null;
      setCreatedOrderId(orderId);
      if (orderId) setTimeout(() => navigate(`/app/orders/${orderId}`), 1200);
    } catch (e) {
      setPublishing(false);
      setPublishError(humanError(e));
    }
  }

  const index = STEPS.indexOf(step);
  const canAdvance = !stepErrors[step];

  return (
    <Section className="py-14" width="narrow">
      <Eyebrow>Buyer</Eyebrow>
      <h1 className="headline mt-2 text-[38px]">Create a compute order</h1>
      <p className="mt-3 text-[17px] text-slate">
        Everything you write here is hashed on-chain when you fund. The AI verifier judges the delivered output against
        this rubric and nothing else.
      </p>

      <div className="mt-8 space-y-4">
        <DeployGate>
          <NetworkBanner />
          {!isConnected && (
            <Notice tone="neutral" title="Connect a wallet to fund an order" action={<ConnectButton />}>
              You can draft the whole order first. The wallet is only needed at the final step.
            </Notice>
          )}
          {configError && (
            <Notice tone="bad" title="Verifier service unreachable">
              {configError.detail} An order cannot be created until the verifier reports which model it runs, because
              that model is committed on-chain.
            </Notice>
          )}
          {config?.verifier.mocked && (
            <Notice tone="warn" title="This verifier is running in mock mode">
              Verdicts will come from a deterministic local stand-in, not a model. Anything settled now is a rehearsal,
              and every proof page will say so.
            </Notice>
          )}
        </DeployGate>
      </div>

      <ol className="mt-10 flex flex-wrap gap-x-6 gap-y-2">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-2 text-sm">
            <span className={`mono ${i <= index ? "text-ink" : "text-stone"}`}>{i + 1}</span>
            <span className={i === index ? "text-ink" : "text-stone"}>{s}</span>
          </li>
        ))}
      </ol>

      <Card className="mt-6 p-7">
        {step === "Task" && (
          <div className="space-y-5">
            <Field label="Title">
              <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
            </Field>
            <Field label="Instructions to the operator" hint="Be specific. Vague instructions produce vague output.">
              <textarea
                className="field min-h-28"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                maxLength={4000}
              />
            </Field>
            <Field label="Job input" hint="The material the operator works from. Hashed on-chain as inputHash.">
              <textarea
                className="field min-h-32"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                maxLength={8000}
              />
            </Field>
          </div>
        )}

        {step === "Rubric" && (
          <div className="space-y-4">
            <p className="text-[15px] text-slate">
              The AI verifier evaluates every rule independently. A PASS requires all of them. Write rules that can be
              checked by reading the output.
            </p>
            {rubric.map((rule, i) => (
              <div key={i} className="flex gap-2">
                <span className="mono mt-3 w-6 shrink-0 text-stone">{i}</span>
                <input
                  className="field"
                  value={rule}
                  onChange={(e) => setRubric(rubric.map((r, j) => (j === i ? e.target.value : r)))}
                  maxLength={240}
                />
                <button
                  type="button"
                  className="btn btn-ghost shrink-0 px-3"
                  onClick={() => setRubric(rubric.filter((_, j) => j !== i))}
                  aria-label={`Remove rule ${i}`}
                >
                  Remove
                </button>
              </div>
            ))}
            <button type="button" className="btn btn-ghost" onClick={() => setRubric([...rubric, ""])}>
              Add rubric rule
            </button>
          </div>
        )}

        {step === "Terms" && (
          <div className="space-y-5">
            <Field
              label="Price in BOT"
              hint="Held in escrow by the contract until settlement."
              error={priceParsed.error}
            >
              <input className="field" value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" />
            </Field>
            <Field
              label="Max slash in BOT"
              hint="Operator stake put at risk. On a FAIL verdict this is transferred to you on top of your refund."
              error={slashParsed.error}
            >
              <input
                className="field"
                value={maxSlash}
                onChange={(e) => setMaxSlash(e.target.value)}
                inputMode="decimal"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Delivery deadline" hint="After this, an undelivered order refunds you and slashes the operator.">
                <select className="field" value={deliveryMinutes} onChange={(e) => setDeliveryMinutes(Number(e.target.value))}>
                  {DELIVERY_OPTIONS.map((o) => (
                    <option key={o.minutes} value={o.minutes}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Verification deadline" hint="After this, a delivered order with no verdict refunds you.">
                <select
                  className="field"
                  value={verificationMinutes}
                  onChange={(e) => setVerificationChoice(Number(e.target.value))}
                >
                  {verificationOptions.map((m) => (
                    <option key={m} value={m}>
                      {durationLabel(m)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {insufficient && (
              <Notice tone="bad" title="Not enough BOT">
                This wallet holds {botAmount(balance)}, which does not cover the {botAmount(priceParsed.wei)} escrow
                plus gas.
              </Notice>
            )}
          </div>
        )}

        {step === "Review" && (
          <div>
            <p className="text-[15px] text-slate">
              These hashes are what the contract stores. The verifier refuses to judge anything that does not reproduce
              them exactly.
            </p>
            <div className="mt-5">
              <Row label="Price">{botAmount(priceParsed.wei)}</Row>
              <Row label="Max slash">{botAmount(slashParsed.wei)}</Row>
              <Row label="Delivery by">{timestamp(Number(inSeconds(deliveryMinutes)))}</Row>
              <Row label="Verdict by">{timestamp(Number(inSeconds(verificationMinutes)))}</Row>
              <Row label="Rubric rules">{spec.rubric.length}</Row>
              <Row label="Verifier model">
                <span className="mono">{spec.modelId || "—"}</span>
              </Row>
              <Row label="jobSpecHash">
                <Mono value={hashes.jobSpecHash} />
              </Row>
              <Row label="inputHash">
                <Mono value={hashes.inputHash} />
              </Row>
              <Row label="rubricHash">
                <Mono value={hashes.rubricHash} />
              </Row>
              <Row label="modelHash">
                <Mono value={hashes.modelHash} />
              </Row>
            </div>
          </div>
        )}

        {step === "Fund" && (
          <div className="space-y-4">
            {createdOrderId ? (
              <Notice tone="good" title={`Order #${createdOrderId} is funded and live`}>
                Escrow of {botAmount(priceParsed.wei)} is held by the contract. Taking you to the order now.
              </Notice>
            ) : (
              <>
                <p className="text-[15px] text-slate">
                  Funding publishes the job spec so operators and the verifier can read it, then sends one transaction
                  that escrows {botAmount(priceParsed.wei)} and commits every hash above.
                </p>
                {publishing && <Spinner label="Publishing the job spec…" />}
                {tx.phase === "awaiting-signature" && <Spinner label="Confirm in your wallet…" />}
                {tx.phase === "pending" && tx.hash && (
                  <p className="text-sm text-slate">
                    Waiting for confirmation · <TxLink hash={tx.hash} />
                  </p>
                )}
                <ErrorNotice error={publishError ?? tx.error} />
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!isConnected || wrongNetwork || tx.busy || publishing || insufficient || !CORE_ADDRESS}
                  onClick={fund}
                >
                  {tx.busy || publishing ? "Working…" : `Fund ${botAmount(priceParsed.wei)}`}
                </button>
              </>
            )}
          </div>
        )}

        {stepErrors[step] && step !== "Fund" && <p className="mt-5 text-sm text-clay">{stepErrors[step]}</p>}
      </Card>

      <div className="mt-5 flex justify-between">
        <button
          type="button"
          className="btn btn-ghost"
          disabled={index === 0}
          onClick={() => setStep(STEPS[index - 1]!)}
        >
          Back
        </button>
        {step !== "Fund" && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canAdvance}
            onClick={() => setStep(STEPS[index + 1]!)}
          >
            Continue
          </button>
        )}
      </div>
    </Section>
  );
}
