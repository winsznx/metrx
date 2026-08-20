import {useEffect, useMemo, useState} from "react";
import {Link, useNavigate} from "react-router-dom";
import {useAccount} from "wagmi";
import {decodeEventLog} from "viem";
import {explorerAddress, hashJson, hashText, type JobSpec} from "@metrx/shared";
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
import {GetBot} from "@/components/GetBot";
import {clearDraft, loadDraft, saveDraft} from "@/lib/drafts";
import {DeployGate} from "@/components/DeployGate";
import {usePublicClient} from "wagmi";
import {CORE_ADDRESS} from "@/lib/config";

const DRAFT_KEY = "create";

const EXAMPLE = {
  title: "Summarize a support ticket",
  instructions:
    "Summarize this support ticket into exactly 3 action items. Do not invent facts that are not in the ticket.",
  input:
    "Customer says their October invoice was charged twice. They already emailed support once with no reply. They are asking for a refund of the duplicate charge and want confirmation by Friday.",
  rubric: [
    "Output must contain exactly 3 action items",
    "Output must mention the duplicate charge refund request",
    "Output must not invent facts absent from the ticket",
  ],
};

const BLANK = {title: "", instructions: "", input: "", rubric: [""]};

interface Draft {
  title: string;
  instructions: string;
  input: string;
  rubric: string[];
  price: string;
  maxSlash: string;
}

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

  const restored = useMemo(() => loadDraft<Draft>(DRAFT_KEY), []);
  const [draftRestored, setDraftRestored] = useState(!!restored);

  const [step, setStep] = useState<Step>("Task");
  const [config, setConfig] = useState<VerifierConfig | null>(null);
  const [supply, setSupply] = useState<Awaited<ReturnType<typeof api.operators>> | null>(null);
  const [configError, setConfigError] = useState<FriendlyError | null>(null);

  const [title, setTitle] = useState(restored?.title ?? EXAMPLE.title);
  const [instructions, setInstructions] = useState(restored?.instructions ?? EXAMPLE.instructions);
  const [input, setInput] = useState(restored?.input ?? EXAMPLE.input);
  const [rubric, setRubric] = useState<string[]>(restored?.rubric ?? EXAMPLE.rubric);
  /** True while the form still holds the untouched example, so it is never mistaken for real work. */
  const isExample =
    !restored &&
    title === EXAMPLE.title &&
    instructions === EXAMPLE.instructions &&
    input === EXAMPLE.input &&
    JSON.stringify(rubric) === JSON.stringify(EXAMPLE.rubric);

  const startBlank = () => {
    setTitle(BLANK.title);
    setInstructions(BLANK.instructions);
    setInput(BLANK.input);
    setRubric(BLANK.rubric);
    setStep("Task");
  };

  const [price, setPrice] = useState(restored?.price ?? "0.02");
  const [maxSlash, setMaxSlash] = useState(restored?.maxSlash ?? "0.01");
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

  const [preview, setPreview] = useState<Awaited<ReturnType<typeof api.previewVerdict>> | null>(null);
  const [previewOutput, setPreviewOutput] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<FriendlyError | null>(null);

  const [publishError, setPublishError] = useState<FriendlyError | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [createdOrderId, setCreatedOrderId] = useState<string | null>(null);
  /** Set the instant the escrow transaction confirms, independently of decoding the order id. */
  const [fundedTx, setFundedTx] = useState<`0x${string}` | null>(null);

  useEffect(() => {
    api
      .config()
      .then(setConfig)
      .catch((e) => setConfigError(humanError(e)));
    api.operators().then(setSupply).catch(() => setSupply(null));
  }, []);

  // Persist on every edit. The app itself tells people to go install a wallet or acquire BOT
  // mid-flow, so losing the draft on the return trip was self-inflicted.
  useEffect(() => {
    saveDraft<Draft>(DRAFT_KEY, {title, instructions, input, rubric, price, maxSlash});
  }, [title, instructions, input, rubric, price, maxSlash]);

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
  const unacceptable =
    !!supply && supply.activeCount > 0 && slashParsed.wei !== null && slashParsed.wei > BigInt(supply.maxAvailableStake);
  const overCollateralised =
    priceParsed.wei !== null && slashParsed.wei !== null && slashParsed.wei > priceParsed.wei * 5n;

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

      // The escrow is mined by the time send() resolves. Everything past this point is a read,
      // so a read failure must never be presented as a funding failure.
      setFundedTx(hash);
      clearDraft(DRAFT_KEY);

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
      if (!fundedTx) setPublishError(humanError(e));
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

      {isExample && (
        <div className="mt-6">
          <Notice
            tone="warn"
            title="This is a filled-in example, not your job"
            action={
              <button type="button" className="btn btn-primary" onClick={startBlank}>
                Start blank
              </button>
            }
          >
            Every field below is sample text so you can see the shape of a real order and test the rubric preview.
            Replace it with your own work before funding — this order would escrow real BOT against this example.
          </Notice>
        </div>
      )}

      {draftRestored && (
        <div className="mt-6">
          <Notice
            tone="neutral"
            title="Draft restored"
            action={
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  clearDraft(DRAFT_KEY);
                  setDraftRestored(false);
                  window.location.reload();
                }}
              >
                Start over
              </button>
            }
          >
            Picked up where you left off. Your draft is saved in this browser only, never sent anywhere until you fund.
          </Notice>
        </div>
      )}

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
            {supply && (
              <Notice
                tone={unacceptable ? "warn" : "neutral"}
                title={
                  supply.activeCount === 0
                    ? "No operators are registered yet"
                    : `${supply.activeCount} operator${supply.activeCount === 1 ? "" : "s"} available, most unlocked stake ${botAmount(BigInt(supply.maxAvailableStake))}`
                }
              >
                {supply.activeCount === 0 ? (
                  <p>
                    Nobody can accept this order right now. You can still fund it — the escrow is yours to cancel at any
                    time before an operator commits, and it refunds automatically if the delivery deadline passes.
                  </p>
                ) : unacceptable ? (
                  <p>
                    Your max slash is more than any registered operator currently has unlocked, so none of them can
                    accept this order. Lower it, or fund anyway and wait for an operator to stake more.
                  </p>
                ) : (
                  <p>
                    An operator must lock this much stake to accept, so a higher number buys you more protection and a
                    smaller pool of operators who can take the job.
                  </p>
                )}
                {supply.operators.filter((o) => o.active).length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {supply.operators
                      .filter((o) => o.active)
                      .slice(0, 4)
                      .map((o) => (
                        <li key={o.address} className="flex flex-wrap items-baseline gap-x-2">
                          <a
                            className="mono text-ink underline underline-offset-2"
                            href={explorerAddress(o.address)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {o.address.slice(0, 8)}…{o.address.slice(-4)}
                          </a>
                          <span className="text-stone">
                            {botAmount(BigInt(o.available))} free of {botAmount(BigInt(o.stake))} staked
                            {BigInt(o.slashed) > 0n ? `, ${botAmount(BigInt(o.slashed))} slashed to date` : ", never slashed"}
                          </span>
                        </li>
                      ))}
                  </ul>
                )}
                <p className="mt-2 text-stone">
                  Stake and slash history are the only signals Metrx has today. There is no reputation score, no
                  ratings, and no matching — an operator with free stake may still simply not take your job.
                </p>
              </Notice>
            )}
            {overCollateralised && (
              <Notice tone="warn" title="Max slash is much larger than the price">
                Asking for {botAmount(slashParsed.wei)} of stake against a {botAmount(priceParsed.wei)} job is a hard
                trade for an operator to accept. Most orders set it at or below the price.
              </Notice>
            )}
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
              <Field
                label="Verification deadline"
                hint="After this, a delivered order with no verdict refunds you and the operator is paid nothing, so give the verifier room."
              >
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
              <div className="space-y-3">
                <Notice tone="bad" title="Not enough BOT">
                  This wallet holds {botAmount(balance)}, which does not cover the {botAmount(priceParsed.wei)} escrow
                  plus gas.
                </Notice>
                <GetBot need="escrow" />
              </div>
            )}
          </div>
        )}

        {step === "Rubric" && (
          <div className="mt-8 border-t border-ink/10 pt-6">
            <Eyebrow>Test your rubric first</Eyebrow>
            <p className="mt-2 text-[15px] text-slate">
              Paste an example of the output you would accept and run the real verifier against it. Nothing is published
              and nothing is spent — this is only to check your rubric says what you think it says.
            </p>
            <div className="mt-4">
              <textarea
                className="field min-h-24"
                value={previewOutput}
                onChange={(e) => setPreviewOutput(e.target.value)}
                maxLength={20_000}
                placeholder="Paste an example output…"
              />
            </div>
            <div className="mt-3 space-y-3">
              <ErrorNotice error={previewError} />
              <button
                type="button"
                className="btn btn-ghost"
                disabled={!previewOutput.trim() || previewing || spec.rubric.length === 0}
                onClick={async () => {
                  setPreviewError(null);
                  setPreviewing(true);
                  try {
                    setPreview(await api.previewVerdict(spec, previewOutput));
                  } catch (e) {
                    setPreviewError(humanError(e));
                  } finally {
                    setPreviewing(false);
                  }
                }}
              >
                {previewing ? "Evaluating…" : "Preview the verdict"}
              </button>
              {preview && (
                <Notice
                  tone={preview.verdict === "PASS" ? "good" : "warn"}
                  title={`Preview verdict: ${preview.verdict} at ${(preview.scoreBps / 100).toFixed(0)}%`}
                >
                  <p>{preview.reason}</p>
                  {preview.rubricFindings.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {preview.rubricFindings.map((f) => (
                        <li key={f.rubricIndex}>
                          <span className={f.satisfied ? "text-deep" : "text-clay"}>
                            {f.satisfied ? "met" : "not met"}
                          </span>{" "}
                          — rule {f.rubricIndex}: {f.note}
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-2 text-ink">This was a dry run. No order exists and nothing was signed.</p>
                </Notice>
              )}
            </div>
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
            {fundedTx ? (
              <Notice tone="good" title={createdOrderId ? `Order #${createdOrderId} is funded and live` : "Your order is funded"}>
                <p>
                  Escrow of {botAmount(priceParsed.wei)} is held by the contract ·{" "}
                  <TxLink hash={fundedTx} label="view the transaction" />
                </p>
                {createdOrderId ? (
                  <p className="mt-1">Taking you to the order now.</p>
                ) : (
                  <p className="mt-1">
                    The transaction confirmed but the order number could not be read back.{" "}
                    <Link className="underline underline-offset-2" to="/app/orders">
                      Open your orders
                    </Link>{" "}
                    to find it. Do not fund again.
                  </p>
                )}
                <div className="mt-3 rounded-xl bg-paper/70 p-3">
                  <p className="text-ink">What happens next</p>
                  <ol className="mt-1 space-y-1">
                    <li>1. An operator stakes and accepts your order, then delivers their output.</li>
                    <li>
                      2. You come back and run the AI verifier from the order page. Nothing settles on its own — a
                      person has to trigger it.
                    </li>
                    <li>3. The verdict releases your escrow to the operator, or refunds you plus their slashed stake.</li>
                  </ol>
                  <p className="mt-2 text-stone">
                    If nobody delivers by your deadline, or no verdict lands by the verification deadline, you get your
                    BOT back automatically — you just have to close the order.
                  </p>
                </div>
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
                {insufficient && <GetBot need="escrow" />}
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!isConnected || wrongNetwork || tx.busy || publishing || insufficient || !CORE_ADDRESS}
                  onClick={fund}
                >
                  {tx.busy || publishing ? "Working…" : `Fund ${botAmount(priceParsed.wei)}`}
                </button>
                {!isConnected && <p className="text-sm text-stone">Connect a wallet above to fund this order.</p>}
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
