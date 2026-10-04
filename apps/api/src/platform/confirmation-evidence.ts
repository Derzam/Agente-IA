import { createHash } from "node:crypto";
/** Called only on signed provider input, before durable inbox persistence.
 * Already-hashed client buttons are deliberately rejected: possession of a DB hash is not consent.
 */
export function confirmationEvidence(button: string): string {
  if (!button.startsWith("confirm:")) return button;
  const match =
    /^confirm:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):([A-Za-z0-9_-]{43})$/i.exec(
      button,
    );
  return match
    ? `confirm:${match[1]!.toLowerCase()}:sha256:${createHash("sha256").update(match[2]!).digest("hex")}`
    : "confirmation.invalid";
}
