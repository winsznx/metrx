import {Link} from "react-router-dom";
import {CORE_ADDRESS, GITHUB_URL} from "@/lib/config";
import {Notice} from "./primitives";
import type {ReactNode} from "react";

/**
 * Every write surface routes through here.
 *
 * Before MetrxCore is broadcast there is nothing honest to render, so the app says so
 * plainly instead of showing a form that cannot submit.
 */
export function DeployGate({children}: {children: ReactNode}) {
  if (CORE_ADDRESS) return <>{children}</>;

  return (
    <Notice
      tone="warn"
      title="MetrxCore is not deployed to BOT Chain Mainnet yet"
      action={
        GITHUB_URL ? (
          <a className="btn btn-ghost" href={GITHUB_URL} target="_blank" rel="noreferrer">
            View the repo
          </a>
        ) : undefined
      }
    >
      <p>
        The contract, its 50-case test suite, and the AI verifier service are all built, but nothing has been broadcast
        yet, so no order can be funded from this browser. Read{" "}
        <Link className="underline underline-offset-2" to="/docs/what-is-real">
          what is real
        </Link>{" "}
        for the current status.
      </p>
    </Notice>
  );
}
