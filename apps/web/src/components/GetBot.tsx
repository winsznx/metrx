import {BOT_BRIDGE_URL, BOT_CHAIN_SITE} from "@/lib/wallet";
import {Notice} from "./primitives";

/**
 * What to do when you have no BOT.
 *
 * Native BOT is needed three times over — escrow, stake and gas — so a zero balance is the
 * most common dead end in the product. Leaving it as a disabled button with no route out was
 * the single worst first-run experience, so every money screen links here.
 */
export function GetBot({
  need,
  tone = "warn",
}: {
  need: "escrow" | "stake" | "gas";
  tone?: "warn" | "bad" | "neutral";
}) {
  const why = {
    escrow: "Funding an order escrows native BOT in the settlement contract, and you also pay gas in BOT.",
    stake: "Registering as an operator posts native BOT as stake, and you also pay gas in BOT.",
    gas: "Every write on BOT Chain costs gas paid in native BOT.",
  }[need];

  return (
    <Notice tone={tone} title="You need BOT on BOT Chain Mainnet">
      <p>{why}</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>
          Bridge into chain 677 with the{" "}
          <a className="text-ink underline underline-offset-2" href={BOT_BRIDGE_URL} target="_blank" rel="noreferrer">
            official BOT Chain bridge
          </a>
          .
        </li>
        <li>
          Network details and other routes are on{" "}
          <a className="text-ink underline underline-offset-2" href={BOT_CHAIN_SITE} target="_blank" rel="noreferrer">
            botchain.ai
          </a>
          .
        </li>
        <li>
          Your balance refreshes here automatically once the BOT lands, so you can leave this tab open.
        </li>
      </ul>
      <p className="mt-2">
        Not ready to spend anything? Every settled order is readable without a wallet on the{" "}
        <a className="text-ink underline underline-offset-2" href="/proof">
          proof hub
        </a>
        .
      </p>
    </Notice>
  );
}
