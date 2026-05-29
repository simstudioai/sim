import type { MxRecord } from 'dns'
import dns from 'dns/promises'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { env } from '@/lib/core/config/env'

const logger = createLogger('EmailValidationServer')

const MX_LOOKUP_TIMEOUT_MS = 3000

/**
 * MX-host substrings to block, supplied at runtime via `BLOCKED_EMAIL_MX_HOSTS`.
 *
 * Signup-spam botnets rotate throwaway domains rapidly but funnel them through a
 * small number of shared catch-all mail providers, so the resolved MX host is a
 * far more stable signal than the domain itself. Each entry is matched as a
 * case-insensitive substring against the domain's resolved MX exchanges. No
 * hosts are hardcoded — operators configure their own denylist out of band.
 */
function getBlockedMxHosts(): string[] {
  return (
    env.BLOCKED_EMAIL_MX_HOSTS?.split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean) ?? []
  )
}

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
 * Server-only — imports `dns/promises`. Never import from client code. Gated by the caller
 * behind `isSignupMxValidationEnabled`; this function performs the check unconditionally.
 */
export async function validateSignupEmailMx(email: string): Promise<SignupEmailCheck> {
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

  const blocked = getBlockedMxHosts()
  const match = records.find((record) => {
    const exchange = record.exchange.toLowerCase()
    return blocked.some((host) => exchange.includes(host))
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
