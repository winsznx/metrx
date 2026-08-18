import type {Address, Hex} from "viem";
import {BOT_CHAIN_ID} from "./chains.js";

/**
 * The AIVerdict certificate.
 *
 * This is the only signature the settlement contract accepts. The digest binds the
 * order id together with every hash the buyer committed at creation time and the output
 * hash the operator committed at delivery time, so a certificate cannot be moved to a
 * different order, a looser rubric, a cheaper model, or a different output.
 */
export const AI_VERDICT_TYPES = {
  AIVerdict: [
    {name: "orderId", type: "uint256"},
    {name: "jobSpecHash", type: "bytes32"},
    {name: "inputHash", type: "bytes32"},
    {name: "rubricHash", type: "bytes32"},
    {name: "modelHash", type: "bytes32"},
    {name: "outputHash", type: "bytes32"},
    {name: "verdict", type: "uint8"},
    {name: "scoreBps", type: "uint16"},
    {name: "reasonHash", type: "bytes32"},
    {name: "evaluatedAt", type: "uint64"},
  ],
} as const;

export interface AIVerdictMessage {
  orderId: bigint;
  jobSpecHash: Hex;
  inputHash: Hex;
  rubricHash: Hex;
  modelHash: Hex;
  outputHash: Hex;
  verdict: number;
  scoreBps: number;
  reasonHash: Hex;
  evaluatedAt: bigint;
}

export const VERDICT_PASS = 1;
export const VERDICT_FAIL = 2;

export const aiVerdictDomain = (verifyingContract: Address, chainId: number = BOT_CHAIN_ID) =>
  ({
    name: "Metrx",
    version: "1",
    chainId,
    verifyingContract,
  }) as const;
