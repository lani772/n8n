import { createHash } from "node:crypto";

/** Stable hash for the JSON representation returned to the user for review. */
export function hashDraft(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value) ?? "undefined").digest("hex");
}

/**
 * Approval is valid only when the client presents the reviewed hash and the
 * stored requirements still hash to that same value.
 */
export function isDraftApprovalValid(
  requirements: unknown,
  storedDraftHash: string | undefined,
  submittedDraftHash: string,
): boolean {
  return Boolean(
    storedDraftHash &&
    submittedDraftHash === storedDraftHash &&
    hashDraft(requirements) === storedDraftHash
  );
}
