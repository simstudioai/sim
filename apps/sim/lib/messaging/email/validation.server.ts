import type { MxRecord } from 'dns'
import dns from 'dns/promises'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'

const logger = createLogger('EmailValidationServer')

const MX_LOOKUP_TIMEOUT_MS = 3000

export interface SignupEmailCheck {
  /** Whether the email may proceed to signup. */
  allowed: boolean
  /** Machine-readable block reason, present only when `allowed` is false. */
  reason?: 'no_mx' | 'blocked_mx_backend'
}

/**
 * Server-side signup email validation backed by an MX lookup.
 *
 * Rejects domains that resolve to no mail server (`no_mx`) or to a denylisted
 * catch-all backend (`blocked_mx_backend`). Designed to be fail-open: any DNS
 * timeout or transient resolver error allows the signup through so legitimate
 * users are never blocked by an infrastructure blip. Only a definitive
 * "domain has no MX" answer (`ENOTFOUND` / `ENODATA`) blocks.
 *
 * `blockedMxHosts` are case-insensitive substrings matched against each resolved
 * MX exchange — signup-spam botnets rotate throwaway domains but funnel them
 * through a few shared catch-all backends, so the MX host is a more stable signal
 * than the domain. Sourced from access-control config (AppConfig or env fallback).
 *
 * Server-only — imports `dns/promises`. Never import from client code. Gated by the caller
 * behind `isSignupMxValidationEnabled`; this function performs the check unconditionally.
 */
export async function validateSignupEmailMx(
  email: string,
  blockedMxHosts: string[]
): Promise<SignupEmailCheck> {
  const domain = email.split('@')[1]?.toLowerCase()
  if (!domain) return { allowed: true }

  let records: MxRecord[]
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  try {
    records = await Promise.race([
      dns.resolveMx(domain),
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error('mx_lookup_timeout')),
          MX_LOOKUP_TIMEOUT_MS
        )
      }),
    ])
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOTFOUND' || code === 'ENODATA') {
      logger.info('Blocked signup: domain has no MX record', { domain })
      return { allowed: false, reason: 'no_mx' }
    }
    logger.warn('MX lookup failed; allowing signup (fail-open)', {
      domain,
      error: getErrorMessage(error),
    })
    return { allowed: true }
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
  }

  if (!records || records.length === 0) {
    logger.info('Blocked signup: domain has no MX record', { domain })
    return { allowed: false, reason: 'no_mx' }
  }

  const match = records.find((record) => {
    const exchange = record.exchange.toLowerCase()
    return blockedMxHosts.some((host) => exchange.includes(host))
  })

  if (match) {
    logger.info('Blocked signup: denylisted MX backend', {
      domain,
      exchange: match.exchange,
    })
    return { allowed: false, reason: 'blocked_mx_backend' }
  }

  return { allowed: true }
}
