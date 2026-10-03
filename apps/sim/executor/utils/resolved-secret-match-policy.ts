/**
 * Decides whether a known secret literal may be substituted at all.
 *
 * The matcher knows every secret's exact bytes, so this is not detection — it is the narrower
 * question of whether a hit is distinctive enough to be attributed to the secret rather than to
 * coincidence.
 */

/**
 * Shortest literal a match on which counts as evidence that the secret is present.
 *
 * Length, not randomness, is what makes a coincidental hit implausible. Shannon entropy measured
 * over a literal's own character distribution answers "is this string internally varied", which is
 * not the same question and misfires badly on real credentials: an all-`f` 32-character HMAC key
 * scores 0.00 bits/char, a zero-padded card number scores 0.34, a zero-padded AWS key id scores
 * 1.02, and a zero-padded `sk_live_` key scores 1.50 — every one of them a full-length secret that
 * an entropy floor would demote. Sampling confirms the same for genuinely random values, where the
 * finite-sample bias of a short string drags the estimate down: at a 3.0 bits/char floor, 46% of
 * random 12-character hex, 74% of random 16-digit numerics, and 99% of 9-digit values fall below it.
 *
 * Eight is chosen because every false positive observed in practice came from a value of seven
 * characters or fewer.
 *
 * This is the whole rule, and the tier below it is deliberately gone. That tier substituted a short
 * literal whenever it landed on a word boundary — standing alone, delimited, or as the whole value —
 * on the theory that those positions made the hit unambiguous. Position is not the variable that
 * matters: a hit on `7` is uninformative wherever it sits, because the value space is ten. It
 * rewrote `_raw_idx = 7` into `_raw_idx = {{WEEKLY_OWNWORK_TTL}}` for the one shard whose index
 * collided with a TTL variable, and turned 2,000 boolean `had_error` cells into `[REDACTED_SECRET]`
 * because a `*_ENABLED` variable held `false`. Both were patched with per-value exception lists;
 * this floor subsumes them, so there are no exceptions left to maintain.
 *
 * The cost is explicit and was accepted: a secret shorter than this is no longer redacted from logs
 * or model-visible content. Substitution cannot hide such a value anyway — an observer who can read
 * the surrounding text can enumerate a space that small.
 */
export const MIN_SUBSTITUTABLE_LITERAL_LENGTH = 8

/**
 * True when a literal is too short for a match on it to be evidence that the secret is present.
 *
 * Applied where literals are turned into matchers, so it governs detection and substitution alike:
 * such a value is never rewritten out of content, and never recorded into durable provenance as
 * something a later read must redact.
 */
export function isNonIdentifyingSecretLiteral(plaintext: string): boolean {
  return plaintext.length < MIN_SUBSTITUTABLE_LITERAL_LENGTH
}
