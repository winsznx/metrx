import type {Hex} from "viem";
import {hashJson, hashText} from "@metrx/shared";
import {badRequest, notFound, type Env} from "./env.js";

/**
 * Content-addressed artifact store.
 *
 * Every artifact is keyed by the same keccak hash that was committed on-chain, so a
 * fetched artifact either reproduces its key or it is rejected. Storage picks the first
 * available backend: R2, then KV, then an in-process map for `wrangler dev` without
 * bindings. The memory backend is explicitly reported by `/api/config` so nothing can
 * quietly claim durability it does not have.
 */

export type ArtifactKind = "job-spec" | "delivery" | "reason";

const memory = new Map<string, string>();

export interface StoredArtifact {
  hash: Hex;
  kind: ArtifactKind;
  body: string;
  storedAt: number;
}

/**
 * Generic keyed storage on the same backend chain as artifacts.
 *
 * Certificate caching and rate limiting previously reached for `env.ARTIFACTS` directly, so
 * both silently did nothing whenever KV was unbound — in tests, and in any `wrangler dev`
 * without bindings. Going through one backend keeps behaviour identical everywhere.
 */
export async function putRecord(env: Env, key: string, value: unknown, ttlSeconds?: number): Promise<void> {
  const body = JSON.stringify(value);
  if (env.ARTIFACTS_R2) await env.ARTIFACTS_R2.put(key, body);
  else if (env.ARTIFACTS) await env.ARTIFACTS.put(key, body, ttlSeconds ? {expirationTtl: ttlSeconds} : undefined);
  else memory.set(key, body);
}

export async function getRecord<T>(env: Env, key: string): Promise<T | null> {
  let raw: string | null = null;
  try {
    if (env.ARTIFACTS_R2) {
      const object = await env.ARTIFACTS_R2.get(key);
      raw = object ? await object.text() : null;
    } else if (env.ARTIFACTS) {
      raw = await env.ARTIFACTS.get(key);
    } else {
      raw = memory.get(key) ?? null;
    }
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    // A cache is never worth an outage. A truncated or unreadable entry reads as a miss, and
    // the caller recomputes; an unguarded JSON.parse here took an endpoint down permanently.
    return null;
  }
}

export function backendName(env: Env): "r2" | "kv" | "memory" {
  if (env.ARTIFACTS_R2) return "r2";
  if (env.ARTIFACTS) return "kv";
  return "memory";
}

const key = (hash: string) => `artifact:${hash.toLowerCase()}`;

export async function putArtifact(env: Env, kind: ArtifactKind, content: unknown): Promise<StoredArtifact> {
  const isText = typeof content === "string";
  const body = isText ? content : JSON.stringify(content);
  const hash = isText ? hashText(content) : hashJson(content);

  const record: StoredArtifact = {hash, kind, body, storedAt: Date.now()};
  const serialised = JSON.stringify(record);

  if (env.ARTIFACTS_R2) await env.ARTIFACTS_R2.put(key(hash), serialised);
  else if (env.ARTIFACTS) await env.ARTIFACTS.put(key(hash), serialised);
  else memory.set(key(hash), serialised);

  return record;
}

export async function getArtifact(env: Env, hash: string): Promise<StoredArtifact | null> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw badRequest("bad_hash", "Artifact id must be a 32-byte keccak hash.");
  let raw: string | null = null;
  if (env.ARTIFACTS_R2) {
    const object = await env.ARTIFACTS_R2.get(key(hash));
    raw = object ? await object.text() : null;
  } else if (env.ARTIFACTS) {
    raw = await env.ARTIFACTS.get(key(hash));
  } else {
    raw = memory.get(key(hash)) ?? null;
  }
  return raw ? (JSON.parse(raw) as StoredArtifact) : null;
}

export async function requireArtifact(env: Env, hash: string, label: string): Promise<StoredArtifact> {
  const found = await getArtifact(env, hash);
  if (!found) {
    throw notFound(
      "artifact_missing",
      `The ${label} artifact for hash ${hash} is not in this store. Publish it before verifying.`
    );
  }
  return found;
}

export const parseArtifact = <T>(a: StoredArtifact): T => JSON.parse(a.body) as T;
