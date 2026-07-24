import { Resolver } from 'node:dns/promises'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import type { OrganizationDomain } from '@/lib/api/contracts/organization'

const logger = createLogger('SSODomainVerification')

interface SsoDomainRow {
  id: string
  domain: string
  status: string
  verificationToken: string
  verifiedAt: Date | null
}

/**
 * Maps a stored `sso_domain` row to its API shape. The TXT value (which
 * embeds the verification token) is only returned for `pending` domains — an
 * already-verified row has no reason to expose its token.
 */
export function toDomainResponse(row: SsoDomainRow): OrganizationDomain {
  const status = row.status === 'verified' ? 'verified' : 'pending'
  return {
    id: row.id,
    domain: row.domain,
    status,
    verifiedAt: row.verifiedAt ? row.verifiedAt.toISOString() : null,
    challengeHost: buildChallengeHost(row.domain),
    txtRecordValue: status === 'pending' ? buildTxtRecordValue(row.verificationToken) : null,
  }
}

/**
 * DNS label the verification TXT record lives under, prefixed to the domain
 * being verified (e.g. `_sim-challenge.acme.com`). A dedicated underscore host
 * — rather than the apex — avoids colliding with the domain's SPF/DMARC/other
 * root TXT records and is the industry-standard placement.
 */
export const SSO_CHALLENGE_HOST_PREFIX = '_sim-challenge'

/** Prefix on the TXT record value, so the token is unambiguous among other TXT records. */
const TXT_VALUE_PREFIX = 'sim-domain-verification='

/** Public nameservers used for the challenge lookup, so verification does not
 * depend on (or get poisoned by) the host's local resolver/split-horizon DNS. */
const VERIFICATION_NAMESERVERS = ['1.1.1.1', '8.8.8.8']

const DNS_TIMEOUT_MS = 5000

/**
 * Shared resolver pinned to the public nameservers. Its config is fully static
 * and `resolveTxt` is safe to call concurrently, so a single module-scope
 * instance avoids re-allocating one per verification.
 */
const verificationResolver = new Resolver({ timeout: DNS_TIMEOUT_MS, tries: 2 })
verificationResolver.setServers(VERIFICATION_NAMESERVERS)

/** The fully-qualified host an org must create the TXT record on. */
export function buildChallengeHost(domain: string): string {
  return `${SSO_CHALLENGE_HOST_PREFIX}.${domain}`
}

/** The exact TXT record value an org must publish for a given token. */
export function buildTxtRecordValue(token: string): string {
  return `${TXT_VALUE_PREFIX}${token}`
}

/**
 * Generates a high-entropy verification token (~190 bits, URL-safe). Unguessable
 * so an attacker cannot pre-create the TXT record for a domain they don't own.
 */
export function generateVerificationToken(): string {
  return generateShortId(32)
}

/**
 * Resolves the challenge host's TXT records against public nameservers and
 * returns true when the expected `sim-domain-verification=<token>` value is
 * present. Never throws — resolution failures (NXDOMAIN, timeout, missing
 * record) resolve to `false` so a not-yet-propagated record simply reads as
 * unverified.
 */
export async function checkDomainTxtRecord(domain: string, token: string): Promise<boolean> {
  const host = buildChallengeHost(domain)
  const expected = buildTxtRecordValue(token)

  try {
    const records = await verificationResolver.resolveTxt(host)
    // Each TXT record may be split into multiple strings — join the chunks.
    return records.some((chunks) => chunks.join('') === expected)
  } catch (error) {
    logger.debug('TXT verification lookup failed (treated as unverified)', {
      host,
      error: getErrorMessage(error),
    })
    return false
  }
}
