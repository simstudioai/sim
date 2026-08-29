/**
 * The DNS-resolving egress gate.
 *
 * Resolution and classification are one step here on purpose. A hostname says
 * nothing about where it points, so the only safe sequence is resolve, classify
 * every address, then connect to an address that was actually classified — which
 * is why this returns the address it approved. A caller that resolves again
 * instead of pinning what it was handed reopens the DNS-rebinding window this
 * exists to close.
 */

import { createLogger } from '@sim/logger'
import { preferIpv4, resolveHostAddresses } from '@sim/security/dns'
import {
  type EgressDecision,
  evaluateAddress,
  evaluateUrl,
  isLiftableByVouching,
  policyCanVouch,
} from '@sim/security/egress'
import { isIpLiteral, unwrapIpv6Brackets } from '@sim/security/ssrf'
import { toError } from '@sim/utils/errors'
import {
  describeEgressDenial,
  type EgressProfile,
  resolveEgressPolicy,
} from '@/lib/core/security/egress/profiles'

const logger = createLogger('Egress')

export interface EgressValidationSuccess {
  readonly isValid: true
  /** The address that was classified, and therefore the only one safe to dial. */
  readonly resolvedIP: string
  readonly originalHostname: string
}

export interface EgressValidationFailure {
  readonly isValid: false
  readonly error: string
}

export type EgressValidationResult = EgressValidationSuccess | EgressValidationFailure

type EgressDenial = Extract<EgressDecision, { allowed: false }>

function fail(
  decision: EgressDenial,
  url: string,
  paramName: string,
  profile: EgressProfile
): EgressValidationFailure {
  logger.warn('Blocked outbound request', {
    profile,
    reason: decision.reason,
    detail: decision.detail,
    paramName,
  })
  return { isValid: false, error: describeEgressDenial(decision, paramName, profile) }
}

/**
 * Validates a destination and returns the address to pin.
 *
 * `profile` is required rather than defaulted: a new call site must state where
 * its URL came from, because that is the only input to the trust decision and
 * guessing it wrong is silent in both directions.
 */
export async function validateEgressUrl(
  url: string | null | undefined,
  paramName: string,
  profile: EgressProfile
): Promise<EgressValidationResult> {
  if (!url || typeof url !== 'string') {
    return { isValid: false, error: `${paramName} is required and must be a string` }
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { isValid: false, error: `${paramName} must be a valid URL` }
  }

  const policy = resolveEgressPolicy(profile)

  const host = unwrapIpv6Brackets(parsed.hostname)
  const isLiteral = isIpLiteral(host)

  const preflight = evaluateUrl(parsed, policy)
  if (!preflight.allowed) {
    // For a literal the pre-flight already had the address, so its verdict is
    // final. For a hostname it judged the destination as unvouched; if this
    // policy could still vouch for it, resolve and let the address rule.
    const final = isLiteral || !policyCanVouch(policy) || !isLiftableByVouching(preflight.reason)
    if (final) return fail(preflight, url, paramName, profile)
  }

  // An IP literal was already classified by evaluateUrl; resolving it would only
  // hand DNS a chance to answer with something else.
  if (isLiteral) {
    return { isValid: true, resolvedIP: host, originalHostname: parsed.hostname }
  }

  let addresses: string[]
  try {
    addresses = (await resolveHostAddresses(host)).addresses
  } catch (error) {
    logger.warn('DNS lookup failed', { paramName, host, error: toError(error).message })
    return { isValid: false, error: `${paramName} hostname could not be resolved` }
  }

  // Refused records are filtered rather than failing the whole host: pinning to a
  // surviving permitted address is just as safe as refusing outright, and a
  // split-horizon resolver that answers with a private record alongside the
  // public one would otherwise be unusable.
  let refusal: EgressDenial | undefined
  const usable = addresses.filter((address) => {
    const decision = evaluateAddress(parsed, address, policy)
    if (decision.allowed) return true
    refusal ??= decision
    return false
  })

  if (usable.length === 0) {
    return fail(
      refusal ?? { allowed: false, reason: 'address-blocked', detail: 'no addresses resolved' },
      url,
      paramName,
      profile
    )
  }

  return {
    isValid: true,
    // Re-preferred over the surviving set so the pin is never an address the
    // filter above just refused.
    resolvedIP: preferIpv4(usable as [string, ...string[]]),
    originalHostname: parsed.hostname,
  }
}

/**
 * Re-checks a destination that has already been resolved — a redirect hop whose
 * target is an IP literal, or any point where the address is known and a fresh
 * lookup would be the wrong thing to do.
 */
export function checkResolvedEgress(
  url: URL,
  address: string,
  profile: EgressProfile
): EgressDecision {
  return evaluateAddress(url, address, resolveEgressPolicy(profile))
}

/**
 * The pre-DNS half of the same check, for a destination whose address is not
 * known yet — a redirect target named by hostname, where the scheme and port
 * still have to answer to the request's own policy.
 */
export function checkEgressUrl(url: URL, profile: EgressProfile): EgressDecision {
  return evaluateUrl(url, resolveEgressPolicy(profile))
}
