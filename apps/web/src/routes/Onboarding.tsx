import {Link, useSearchParams} from "react-router-dom";
import {useAccount} from "wagmi";
import {availableStake} from "@metrx/shared";
import {isRegistered, useBotBalance, useNetworkGate, useOperator, useOrders} from "@/lib/contract";
import {botAmount} from "@/lib/format";
import {Card, Eyebrow, Section} from "@/components/primitives";
import {ConnectButton, NetworkBanner} from "@/components/Wallet";
import {GetBot} from "@/components/GetBot";
import {DeployGate} from "@/components/DeployGate";
import type {ReactNode} from "react";

type Role = "buyer" | "operator";

/**
 * First-run checklist.
 *
 * Every row is derived from state the app already reads, so it cannot drift from reality,
 * and each unmet row carries its own way out. Without this a first-time visitor landed on a
 * bare dashboard with three buttons and no idea which prerequisite they were missing.
 */
export default function Onboarding() {
  const [params, setParams] = useSearchParams();
  const role: Role = params.get("role") === "operator" ? "operator" : "buyer";

  const {address, isConnected} = useAccount();
  const {wrongNetwork} = useNetworkGate();
  const balance = useBotBalance();
  const operator = useOperator(address);
  const orders = useOrders(60);

  const registered = isRegistered(operator.data);
  const mine = (orders.data ?? []).filter(
    (o) => address && (role === "buyer" ? o.buyer : o.operator).toLowerCase() === address.toLowerCase()
  );
  const hasBot = balance !== null && balance > 0n;

  const steps: {label: string; done: boolean; body: ReactNode}[] =
    role === "buyer"
      ? [
          {
            label: "Connect a wallet",
            done: isConnected,
            body: isConnected ? (
              <span className="mono">{address}</span>
            ) : (
              <div className="flex flex-col items-start gap-2">
                <span>Metrx uses your browser wallet. Nothing is stored on our side.</span>
                <ConnectButton />
              </div>
            ),
          },
          {
            label: "Switch to BOT Chain Mainnet",
            done: isConnected && !wrongNetwork,
            body: wrongNetwork ? "Your wallet is on another network. The banner above will switch it." : "Chain 677.",
          },
          {
            label: "Hold some BOT",
            done: hasBot,
            body: hasBot ? (
              `This wallet holds ${botAmount(balance)}. You need BOT for the escrow and for gas.`
            ) : (
              <GetBot need="escrow" tone="neutral" />
            ),
          },
          {
            label: "Write the job and its rubric",
            done: mine.length > 0,
            body: (
              <>
                The rubric is the whole contract with the operator: the AI verifier judges the delivered output against
                those rules and nothing else.{" "}
                <Link className="text-ink underline underline-offset-2" to="/app/create">
                  Open the create wizard
                </Link>
                .
              </>
            ),
          },
          {
            label: "Fund the order and come back to settle it",
            done: mine.length > 0,
            body: "Nothing settles on its own. Once an operator delivers, open the order and run the AI verifier to release or refund the escrow.",
          },
        ]
      : [
          {
            label: "Connect a wallet",
            done: isConnected,
            body: isConnected ? <span className="mono">{address}</span> : <ConnectButton />,
          },
          {
            label: "Switch to BOT Chain Mainnet",
            done: isConnected && !wrongNetwork,
            body: wrongNetwork ? "Your wallet is on another network." : "Chain 677.",
          },
          {
            label: "Hold some BOT",
            done: hasBot,
            body: hasBot ? `This wallet holds ${botAmount(balance)}.` : <GetBot need="stake" tone="neutral" />,
          },
          {
            label: "Register and post stake",
            done: registered,
            body: registered ? (
              `Staked ${botAmount(operator.data!.stake)}, ${botAmount(availableStake(operator.data!))} unlocked.`
            ) : (
              <>
                Your stake is what makes your delivery worth trusting. A failed or missed delivery transfers the order's
                max slash to the buyer.{" "}
                <Link className="text-ink underline underline-offset-2" to="/app/operator">
                  Register
                </Link>
                .
              </>
            ),
          },
          {
            label: "Accept a funded job and deliver before the deadline",
            done: mine.length > 0,
            body: "Accepting locks the order's max slash. Deliver on time and a passing verdict pays you the full escrow.",
          },
        ];

  const complete = steps.filter((s) => s.done).length;

  return (
    <Section className="py-14" width="narrow">
      <Eyebrow>Getting started</Eyebrow>
      <h1 className="headline mt-2 text-[38px]">
        {role === "buyer" ? "Buy compute in five steps" : "Sell compute in five steps"}
      </h1>
      <p className="mt-3 text-[17px] text-slate">
        {complete} of {steps.length} done. Everything here is checked live against your wallet and BOT Chain.
      </p>

      <div className="mt-6 flex gap-2">
        {(["buyer", "operator"] as Role[]).map((r) => (
          <button
            key={r}
            type="button"
            className={`btn ${role === r ? "btn-primary" : "btn-ghost"} px-4 py-1.5 text-[13px]`}
            onClick={() => setParams({role: r})}
          >
            {r === "buyer" ? "I buy compute" : "I operate compute"}
          </button>
        ))}
      </div>

      <div className="mt-6">
        <DeployGate>
          <NetworkBanner />
        </DeployGate>
      </div>

      <ol className="mt-8 space-y-3">
        {steps.map((s, i) => (
          <li key={s.label}>
            <Card className="p-6">
              <div className="flex items-start gap-4">
                <span
                  className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${
                    s.done ? "bg-bot/20 text-deep" : "border border-ink/20 text-stone"
                  }`}
                  aria-hidden="true"
                >
                  {s.done ? "✓" : i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={`text-[15px] font-medium ${s.done ? "text-stone line-through" : "text-ink"}`}>
                    {s.label}
                  </p>
                  <div className="mt-1.5 text-sm text-slate">{s.body}</div>
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ol>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link to={role === "buyer" ? "/app/create" : "/app/operator"} className="btn btn-primary">
          {role === "buyer" ? "Create a compute order" : "Open the operator console"}
        </Link>
        <Link to="/proof" className="btn btn-ghost">
          Look at a settled order first
        </Link>
      </div>
    </Section>
  );
}
