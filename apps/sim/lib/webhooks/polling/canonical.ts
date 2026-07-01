/**
 * Resolve the live resource id for a canonical trigger field from a deployed
 * `webhook.providerConfig`.
 *
 * The canonical key — written at the deploy boundary by `buildProviderConfig`
 * and populated on pre-existing rows by migration `0253` — is authoritative and
 * is read first. The `transitionalFallback` values are read basic-first ONLY
 * when the canonical key is absent, i.e. for configs deployed before the
 * canonical key existed and not yet backfilled (including webhooks created by
 * the previous app version during a deploy cutover).
 *
 * The fallback is TRANSITIONAL: once the backfill is confirmed and every
 * deployed config carries the canonical key, it can be deleted in a follow-up
 * contract phase and callers can read the canonical key alone. It exists solely
 * for migration safety, not as permanent precedence logic.
 *
 * Empty strings are treated as unset (matching the previous basic-first `||`
 * reads); returns `undefined` when no member is set.
 *
 * @param canonicalValue - value stored under the group's `canonicalParamId`
 * @param transitionalFallback - the raw subblock values in basic-first order
 */
export function readCanonicalTriggerValue(
  canonicalValue: unknown,
  ...transitionalFallback: unknown[]
): string | undefined {
  for (const value of [canonicalValue, ...transitionalFallback]) {
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}
