/**
 * Draft persistence.
 *
 * The app's own guidance sends people away mid-flow to install a wallet or acquire BOT, and
 * without this the return trip silently discarded a job spec or a delivered output. Drafts are
 * local to the browser and cleared the moment the work is committed on-chain.
 */

const PREFIX = "metrx:draft:";

export function loadDraft<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function saveDraft<T>(key: string, value: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Private mode or a full quota. A lost draft must never break the flow.
  }
}

export function clearDraft(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    // ignore
  }
}
