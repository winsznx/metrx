import type {ReactNode} from "react";
import {Link} from "react-router-dom";
import {explorerAddress} from "@metrx/shared";
import {CORE_ADDRESS, GITHUB_URL, VERIFIER_ADDRESS} from "@/lib/config";
import {Card, Eyebrow, Section} from "@/components/primitives";

function Prose({children}: {children: ReactNode}) {
  return <div className="space-y-4 text-[16px] leading-[1.75] text-slate">{children}</div>;
}

function H2({children, id}: {children: ReactNode; id?: string}) {
  return (
    <h2 id={id} className="headline mt-12 scroll-mt-24 text-[26px] text-ink">
      {children}
    </h2>
  );
}

const Addr = ({value, fallback}: {value: string | null; fallback: string}) =>
  value ? (
    <a className="mono underline underline-offset-2" href={explorerAddress(value)} target="_blank" rel="noreferrer">
      {value}
    </a>
  ) : (
    <span className="text-stone">{fallback}</span>
  );

// ---------------------------------------------------------------------------

export function WhatIsReal() {
  return (
    <Section className="py-14" width="narrow">
      <Eyebrow>Docs</Eyebrow>
      <h1 className="headline mt-2 text-[38px]">What is real</h1>
      <p className="mt-4 text-[17px] leading-relaxed text-slate">
        A plain account of what Metrx currently does, what it delegates to a trusted party, and what it does not do at
        all. Nothing on this page is aspirational.
      </p>

      <H2>What is real</H2>
      <Prose>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <span className="text-ink">MetrxCore is deployed to BOT Chain Mainnet</span> (chain 677) at{" "}
            <Addr value={CORE_ADDRESS} fallback="— not broadcast yet" />.
          </li>
          <li>
            <span className="text-ink">Escrow and stake are native BOT.</span> No wrapped token, no mock token, no
            stablecoin, and no ERC-20 approval anywhere in the flow.
          </li>
          <li>
            <span className="text-ink">The AI verifier signs real EIP-712 certificates.</span> Its address is{" "}
            <Addr value={VERIFIER_ADDRESS} fallback="— set at deploy" />, and the contract will only settle a PAY or
            SLASH against a signature that recovers to it.
          </li>
          <li>
            <span className="text-ink">Job specs, rubrics, delivered outputs, and verifier reasoning are public.</span>{" "}
            Each is content-addressed by the same keccak hash the contract stores, so anyone can re-derive it.
          </li>
          <li>
            <span className="text-ink">Deadlines resolve every order without cooperation.</span> An undelivered order
            refunds the buyer and slashes the operator. A delivered order with no verdict refunds the buyer and releases
            the operator's stake.
          </li>
          <li>
            <span className="text-ink">The settlement rules are tested twice.</span> A Foundry suite covers the
            contract, and an independent TypeScript reference model covers the same rules, so a divergence between them
            is a bug report rather than an opinion.
          </li>
        </ul>
      </Prose>

      <H2>What is trusted, not proven</H2>
      <Prose>
        <p>
          The AI verifier's judgement is the trust boundary. The contract enforces its signature; it cannot check
          whether the judgement was correct. A compromised or badly prompted verifier can pay a bad output or fail a
          good one.
        </p>
        <p>
          What Metrx buys you is that the judgement is public and bounded. The rubric was committed before the work
          started, the output was committed before it was judged, and the verifier's reasoning is published under a hash
          the settlement transaction carries. Disagreeing with a verdict is possible because all of the evidence is
          readable.
        </p>
        <p className="text-ink">
          The honest claim is publicly auditable AI adjudication, enforced by BOT Chain settlement.
        </p>
      </Prose>

      <H2 id="claims">What Metrx does not claim</H2>
      <Prose>
        <ul className="list-disc space-y-2 pl-5">
          <li>Not generalized trustless compute. Nothing here proves that arbitrary computation was performed.</li>
          <li>Not private compute. Job inputs and delivered outputs are published so the verdict can be audited.</li>
          <li>Not tokenized GPU ownership, compute receivables, or any RWA financial instrument.</li>
          <li>Not a decentralized verifier set. v1 has exactly one verifier address, fixed at deploy time.</li>
          <li>Not a marketplace with reputation, discovery, or pricing. Orders are matched by whoever is watching.</li>
          <li>No paymaster, bundler, or account abstraction. Every write is a plain EOA transaction.</li>
        </ul>
      </Prose>

      <H2>On mock mode</H2>
      <Prose>
        <p>
          The verifier service ships with a deterministic local stand-in behind{" "}
          <span className="mono">AI_PROVIDER=mock</span> so the full lifecycle can be exercised offline. Every mocked
          verdict is tagged as mocked in the API response and labelled in the UI. The mainnet proof runs listed in the
          repository record which provider actually signed them.
        </p>
      </Prose>

      <div className="mt-12">
        <Card className="p-6">
          <p className="text-sm text-slate">
            The full claim ledger, with proof level and evidence for each claim, lives in{" "}
            {GITHUB_URL ? (
              <a
                className="text-ink underline underline-offset-2"
                href={`${GITHUB_URL}/blob/main/CLAIM_LEDGER.md`}
                target="_blank"
                rel="noreferrer"
              >
                CLAIM_LEDGER.md
              </a>
            ) : (
              <span className="mono">CLAIM_LEDGER.md</span>
            )}
            . The threat model is in{" "}
            <Link className="text-ink underline underline-offset-2" to="/docs/security">
              Security
            </Link>
            .
          </p>
        </Card>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------

export function Security() {
  return (
    <Section className="py-14" width="narrow">
      <Eyebrow>Docs</Eyebrow>
      <h1 className="headline mt-2 text-[38px]">Security and trust model</h1>
      <p className="mt-4 text-[17px] leading-relaxed text-slate">
        What the settlement contract guarantees, what it deliberately does not, and how each guarantee is tested.
      </p>

      <H2>The one trusted party</H2>
      <Prose>
        <p>
          MetrxCore takes an AI verifier address at construction and never changes it. That address is the only
          signature the contract will accept for a PAY or SLASH outcome. Everything else in the system is permissionless:
          anyone can create an order, anyone can register as an operator, and anyone holding a valid certificate can
          submit it for settlement.
        </p>
        <p>
          If the verifier key is compromised, an attacker can settle any delivered order in either direction. It cannot
          mint value, drain escrow to itself, touch unrelated orders, or move an operator's unlocked stake. The blast
          radius is bounded to the outcome of orders that have already been delivered.
        </p>
      </Prose>

      <H2>What the contract enforces</H2>
      <Prose>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <span className="text-ink">Certificate binding.</span> The signed digest is rebuilt from on-chain state, so
            a certificate covering a different order, spec, rubric, model, or output cannot recover the verifier.
          </li>
          <li>
            <span className="text-ink">Replay protection.</span> A settled order is terminal. A second submission of the
            same certificate reverts on state, not on signature.
          </li>
          <li>
            <span className="text-ink">Signature hygiene.</span> Signatures must be 65 bytes with a low-s value, so the
            malleable counterpart of a valid signature is rejected.
          </li>
          <li>
            <span className="text-ink">Escrow conservation.</span> Every terminal path assigns the full escrow to
            exactly one party. Pay and refund are mutually exclusive in every transition.
          </li>
          <li>
            <span className="text-ink">Bounded slashing.</span> A slash never exceeds the stake locked for that order,
            and locked stake can never be withdrawn.
          </li>
          <li>
            <span className="text-ink">Timestamp sanity.</span> A certificate dated before its delivery, or more than
            fifteen minutes in the future, is rejected.
          </li>
          <li>
            <span className="text-ink">Reentrancy.</span> Every value-moving entry point holds a lock, and storage is
            final before any external call.
          </li>
          <li>
            <span className="text-ink">No stranded escrow.</span> Payouts are pushed with a bounded gas stipend; a
            recipient that reverts is credited instead, and can pull with <span className="mono">withdraw()</span>.
          </li>
        </ul>
      </Prose>

      <H2>Deadline behaviour</H2>
      <Prose>
        <p>
          The delivery and verification windows do not overlap. A verdict is only accepted up to the verification
          deadline; after it, only the timeout refund is possible. That removes any race between a late certificate and
          a timeout claim: exactly one of them is valid at any instant.
        </p>
        <p>
          A verifier timeout is deliberately conservative. The operator delivered on time and failed no obligation it
          controls, so its stake is released in full and only the escrow returns to the buyer. The operator carries the
          risk of not getting a certificate submitted in time, which is why the verifier run and the settlement
          transaction are both open to anyone, including the operator itself.
        </p>
      </Prose>

      <H2>Known limitations</H2>
      <Prose>
        <ul className="list-disc space-y-2 pl-5">
          <li>A single verifier is a single point of judgement failure. There is no appeal path in v1.</li>
          <li>
            A buyer can write a rubric that is impossible to satisfy. The rubric is public before an operator accepts,
            so the defence is that operators read it and decline.
          </li>
          <li>
            Artifacts are held off-chain. The hashes are on-chain, so tampering is detectable, but availability is not
            guaranteed by the chain.
          </li>
          <li>The contract is unaudited. It is small, fully tested, and deliberately has no admin, upgrade, or pause path.</li>
        </ul>
      </Prose>

      <H2>Reporting</H2>
      <Prose>
        <p>
          {GITHUB_URL ? (
            <>
              Open an issue at{" "}
              <a className="text-ink underline underline-offset-2" href={GITHUB_URL} target="_blank" rel="noreferrer">
                the repository
              </a>
              .
            </>
          ) : (
            <>Open an issue on the repository.</>
          )} The contract has no owner and no upgrade path, so a fix means a redeploy and a new address.
        </p>
      </Prose>
    </Section>
  );
}
