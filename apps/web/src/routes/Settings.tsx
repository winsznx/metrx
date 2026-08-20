import {useAccount, useDisconnect} from "wagmi";
import {Link} from "react-router-dom";
import {explorerAddress} from "@metrx/shared";
import {useBotBalance, useNetworkGate} from "@/lib/contract";
import {botAmount} from "@/lib/format";
import {clearDraft} from "@/lib/drafts";
import {API_BASE, CORE_ADDRESS, VERIFIER_ADDRESS} from "@/lib/config";
import {Card, Eyebrow, Notice, Row, Section} from "@/components/primitives";
import {ConnectButton} from "@/components/Wallet";
import {useState} from "react";

/** Wallet, session and local data. PRD 9.7 — disconnect was previously an unlabelled chip click. */
export default function Settings() {
  const {address, isConnected, connector} = useAccount();
  const {disconnect} = useDisconnect();
  const {wrongNetwork, chainId} = useNetworkGate();
  const balance = useBotBalance();
  const [cleared, setCleared] = useState(false);

  return (
    <Section className="py-14" width="narrow">
      <Eyebrow>Settings</Eyebrow>
      <h1 className="headline mt-2 text-[38px]">Wallet and session</h1>

      <Card className="mt-8 p-7">
        <Eyebrow>Wallet</Eyebrow>
        {isConnected && address ? (
          <div className="mt-3">
            <Row label="Address">
              <a className="mono underline underline-offset-2" href={explorerAddress(address)} target="_blank" rel="noreferrer">
                {address}
              </a>
            </Row>
            <Row label="Wallet">{connector?.name ?? "Injected"}</Row>
            <Row label="Network">{wrongNetwork ? `Chain ${chainId} — not BOT Chain` : "BOT Chain Mainnet · 677"}</Row>
            <Row label="Balance">{botAmount(balance)}</Row>
            <div className="mt-5">
              <button
                type="button"
                className="btn border border-clay/30 text-clay hover:border-clay/50 hover:bg-clay/10"
                onClick={() => disconnect()}
              >
                Disconnect wallet
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-slate">No wallet connected. Reading Metrx never requires one.</p>
            <ConnectButton />
          </div>
        )}
      </Card>

      <Card className="mt-4 p-7">
        <Eyebrow>Local data</Eyebrow>
        <p className="mt-2 text-sm text-slate">
          Metrx keeps unsent job and delivery drafts in this browser so a reload does not lose your work. Nothing else
          is stored, and nothing leaves your machine until you publish or fund.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              Object.keys(localStorage)
                .filter((k) => k.startsWith("metrx:draft:"))
                .forEach((k) => clearDraft(k.replace("metrx:draft:", "")));
              setCleared(true);
            }}
          >
            Clear saved drafts
          </button>
          {cleared && <span className="text-sm text-deep">Cleared.</span>}
        </div>
        <Notice tone="neutral" title="Disconnecting does not touch your orders">
          Orders live in the contract, not in this browser. Escrow, stake and deadlines are unaffected by disconnecting
          or clearing drafts.
        </Notice>
      </Card>

      <Card className="mt-4 p-7">
        <Eyebrow>This deployment</Eyebrow>
        <div className="mt-3">
          <Row label="Settlement contract">
            {CORE_ADDRESS ? (
              <a className="mono underline underline-offset-2" href={`${explorerAddress(CORE_ADDRESS)}#code`} target="_blank" rel="noreferrer">
                {CORE_ADDRESS}
              </a>
            ) : (
              "Not deployed"
            )}
          </Row>
          <Row label="AI verifier">
            {VERIFIER_ADDRESS ? (
              <a className="mono underline underline-offset-2" href={explorerAddress(VERIFIER_ADDRESS)} target="_blank" rel="noreferrer">
                {VERIFIER_ADDRESS}
              </a>
            ) : (
              "—"
            )}
          </Row>
          <Row label="Verifier API">
            <span className="mono">{API_BASE}</span>
          </Row>
        </div>
        <p className="mt-4 text-sm text-slate">
          What this deployment does and does not prove is written up in{" "}
          <Link className="text-ink underline underline-offset-2" to="/docs/what-is-real">
            what is real
          </Link>
          .
        </p>
      </Card>
    </Section>
  );
}
