/**
 * Decides how a known secret literal is allowed to match inside a larger string.
 *
 * The matcher knows every secret's exact bytes, so this is not detection — it is the narrower
 * question of whether a substring hit is distinctive enough to be attributed to the secret rather
 * than to coincidence. A four-character value such as `test` occurs inside ordinary words; an
 * eight-character one effectively does not.
 */

/**
 * `'anywhere'` substitutes a hit at any offset.
 *
 * `'boundary'` substitutes a hit only when it sits on a word boundary, so a short literal can still
 * be replaced when it stands alone (`test`), is delimited (`key=test`, `"test"`, `user_test`), or is
 * the whole value, but cannot rewrite the interior of an unrelated token (`latest`).
 */
export type ResolvedSecretMatchPolicy = 'anywhere' | 'boundary'

/**
 * Shortest literal that may be substituted at an arbitrary offset inside surrounding text.
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
 * characters or fewer, and because a literal that short is the only kind that plausibly appears
 * inside unrelated log text by accident. Values below the floor are still substituted — they just
 * have to land on a word boundary, which covers standing alone, delimited, and whole-value cases.
 */
export const MIN_UNANCHORED_MATCH_LENGTH = 8

/**
 * Combining marks count so a substitution cannot split a grapheme cluster. `_` deliberately does
 * NOT: `sk_live_...` and `user_483920_profile` are the dominant way a secret gets joined into an
 * identifier, and treating `_` as a word character would suppress those hits entirely.
 */
const WORD_CHARACTER = /[\p{L}\p{N}\p{M}]/u

/** Classifies one secret literal by whether a hit on it could plausibly be a coincidence. */
export function getResolvedSecretMatchPolicy(plaintext: string): ResolvedSecretMatchPolicy {
  return plaintext.length >= MIN_UNANCHORED_MATCH_LENGTH ? 'anywhere' : 'boundary'
}

/**
 * Reads the whole code point occupying `index`, including when `index` addresses the trailing half
 * of a surrogate pair. Returns undefined out of range, which callers treat as "not a word
 * character" so an out-of-bounds probe widens the match rather than suppressing it.
 */
function codePointAt(value: string, index: number): number | undefined {
  if (index < 0 || index >= value.length) return undefined
  const code = value.codePointAt(index)
  if (code !== undefined && code >= 0xdc00 && code <= 0xdfff && index > 0) {
    const paired = value.codePointAt(index - 1)
    if (paired !== undefined && paired > 0xffff) return paired
  }
  return code
}

function isWordCharacter(value: string, index: number): boolean {
  const code = codePointAt(value, index)
  if (code === undefined) return false
  if (code < 0x80) {
    return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
  }
  return WORD_CHARACTER.test(String.fromCodePoint(code))
}

/**
 * True when the span `[start, end)` is not spliced into the middle of a surrounding word.
 *
 * A boundary exists wherever two adjacent characters are not both word characters, which is the
 * generalization of a regex `\b` to a span. `key=test` and `"test"` are anchored because `=` and
 * `"` are not word characters; `latest` is not, because `a` and `t` both are. A whole-value match
 * is anchored by the string edges, so an exact value is always replaceable regardless of policy.
 */
export function isWordBoundaryMatch(value: string, start: number, end: number): boolean {
  const startsWord = isWordCharacter(value, start - 1) && isWordCharacter(value, start)
  const endsWord = isWordCharacter(value, end) && isWordCharacter(value, end - 1)
  return !startsWord && !endsWord
}

/** True when a hit at `[start, end)` may be substituted under `policy`. Omitted policy is wide. */
export function satisfiesResolvedSecretMatchPolicy(
  value: string,
  start: number,
  end: number,
  policy: ResolvedSecretMatchPolicy | undefined
): boolean {
  return policy !== 'boundary' || isWordBoundaryMatch(value, start, end)
}
