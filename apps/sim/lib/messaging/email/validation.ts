import { createLogger } from '@sim/logger'

const logger = createLogger('EmailValidation')

export interface EmailValidationResult {
  isValid: boolean
  reason?: string
  confidence: 'high' | 'medium' | 'low'
  checks: {
    syntax: boolean
    domain: boolean
    mxRecord: boolean
    disposable: boolean
  }
}

/** Common disposable domains for fast client-side checks (no heavy import needed) */
const DISPOSABLE_DOMAINS_INLINE = new Set([
  '10minutemail.com',
  '10minutemail.net',
  'catchmail.io',
  'dispostable.com',
  'emailondeck.com',
  'fakemailgenerator.com',
  'getnada.com',
  'guerrillamail.com',
  'guerrillamailblock.com',
  'mail.gw',
  'mailinator.com',
  'oakon.com',
  'pokemail.net',
  'salt.email',
  'sharebot.net',
  'sharklasers.com',
  'spam4.me',
  'temp-mail.org',
  'tempail.com',
  'tempmail.org',
  'tempr.email',
  'temporary-mail.net',
  'throwaway.email',
  'yopmail.com',
])

/** Full disposable domain list from npm package (~5.3K domains), lazy-loaded server-side only */
let disposableDomainsFull: Set<string> | null = null

function getDisposableDomainsFull(): Set<string> {
  if (!disposableDomainsFull) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const domains = require('disposable-email-domains') as string[]
      disposableDomainsFull = new Set(domains)
    } catch {
      logger.warn('Failed to load disposable-email-domains package')
      disposableDomainsFull = new Set()
    }
  }
  return disposableDomainsFull
}

/** MX hostnames used by known disposable email backends */
const DISPOSABLE_MX_BACKENDS = new Set(['in.mail.gw', 'smtp.catchmail.io', 'mx.yopmail.com'])

/** Per-domain MX result cache — avoids redundant DNS queries for concurrent or repeated sign-ups */
const mxCache = new Map<string, { result: boolean; expires: number }>()
const MX_CACHE_MAX = 1_000

function setMxCache(domain: string, entry: { result: boolean; expires: number }) {
  if (mxCache.size >= MX_CACHE_MAX && !mxCache.has(domain)) {
    mxCache.delete(mxCache.keys().next().value!)
  }
  mxCache.set(domain, entry)
}

/**
 * Validates email syntax using RFC 5322 compliant regex
 */
function validateEmailSyntax(email: string): boolean {
  const emailRegex =
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/
  return emailRegex.test(email) && email.length <= 254
}

/**
 * Checks if domain has valid MX records and is not backed by a disposable email service (server-side only)
 */
async function checkMXRecord(
  domain: string
): Promise<{ exists: boolean; isDisposableBackend: boolean }> {
  // Skip MX check on client-side (browser)
  if (typeof window !== 'undefined') {
    return { exists: true, isDisposableBackend: false }
  }

  try {
    const { promisify } = await import('util')
    const dns = await import('dns')
    const resolveMx = promisify(dns.resolveMx)

    const mxRecords = await resolveMx(domain)
    if (!mxRecords || mxRecords.length === 0) {
      return { exists: false, isDisposableBackend: false }
    }

    const isDisposableBackend = mxRecords.some((record: { exchange: string }) =>
      DISPOSABLE_MX_BACKENDS.has(record.exchange.toLowerCase().replace(/\.$/, ''))
    )

    return { exists: true, isDisposableBackend }
  } catch (error) {
    logger.debug('MX record check failed', { domain, error })
    return { exists: false, isDisposableBackend: false }
  }
}

/**
 * Checks against the full disposable email domain list (~5.3K domains server-side, inline list client-side)
 */
export function isDisposableEmailFull(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase()
  if (!domain) return false
  return DISPOSABLE_DOMAINS_INLINE.has(domain) || getDisposableDomainsFull().has(domain)
}

/**
 * Checks if an email's MX records point to a known disposable email backend (server-side only)
 */
export async function isDisposableMxBackend(email: string): Promise<boolean> {
  const domain = email.split('@')[1]?.toLowerCase()
  if (!domain) return false

  const now = Date.now()
  const cached = mxCache.get(domain)
  if (cached) {
    if (cached.expires > now) return cached.result
    mxCache.delete(domain)
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    const mxCheckPromise = checkMXRecord(domain)
    const timeoutPromise = new Promise<{ exists: boolean; isDisposableBackend: boolean }>(
      (_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('MX check timeout')), 5000)
      }
    )
    const result = await Promise.race([mxCheckPromise, timeoutPromise])
    setMxCache(domain, { result: result.isDisposableBackend, expires: now + 5 * 60 * 1000 })
    return result.isDisposableBackend
  } catch {
    setMxCache(domain, { result: false, expires: now + 60 * 1000 })
    return false
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Checks for obvious patterns that indicate invalid emails
 */
function hasInvalidPatterns(email: string): boolean {
  // Check for consecutive dots (RFC violation)
  if (email.includes('..')) return true

  // Check for local part length (RFC limit is 64 characters)
  const localPart = email.split('@')[0]
  if (localPart && localPart.length > 64) return true

  return false
}

/**
 * Validates an email address comprehensively
 */
export async function validateEmail(email: string): Promise<EmailValidationResult> {
  const checks = {
    syntax: false,
    domain: false,
    mxRecord: false,
    disposable: false,
  }

  try {
    // 1. Basic syntax validation
    checks.syntax = validateEmailSyntax(email)
    if (!checks.syntax) {
      return {
        isValid: false,
        reason: 'Invalid email format',
        confidence: 'high',
        checks,
      }
    }

    const domain = email.split('@')[1]?.toLowerCase()
    if (!domain) {
      return {
        isValid: false,
        reason: 'Missing domain',
        confidence: 'high',
        checks,
      }
    }

    // 2. Check for disposable email against full list (server-side)
    checks.disposable = !isDisposableEmailFull(email)
    if (!checks.disposable) {
      return {
        isValid: false,
        reason: 'Disposable email addresses are not allowed',
        confidence: 'high',
        checks,
      }
    }

    // 3. Check for invalid patterns
    if (hasInvalidPatterns(email)) {
      return {
        isValid: false,
        reason: 'Email contains suspicious patterns',
        confidence: 'high',
        checks,
      }
    }

    // 4. Domain validation - check for obvious invalid domains
    checks.domain = domain.includes('.') && !domain.startsWith('.') && !domain.endsWith('.')
    if (!checks.domain) {
      return {
        isValid: false,
        reason: 'Invalid domain format',
        confidence: 'high',
        checks,
      }
    }

    // 5. MX record check (with timeout) — also detects disposable email backends
    let mxTimeoutId: ReturnType<typeof setTimeout> | undefined
    try {
      const mxCheckPromise = checkMXRecord(domain)
      const timeoutPromise = new Promise<{ exists: boolean; isDisposableBackend: boolean }>(
        (_, reject) => {
          mxTimeoutId = setTimeout(() => reject(new Error('MX check timeout')), 5000)
        }
      )

      const mxResult = await Promise.race([mxCheckPromise, timeoutPromise])
      checks.mxRecord = mxResult.exists

      if (mxResult.isDisposableBackend) {
        checks.disposable = false
        return {
          isValid: false,
          reason: 'Disposable email addresses are not allowed',
          confidence: 'high',
          checks,
        }
      }
    } catch (error) {
      logger.debug('MX record check failed or timed out', { domain, error })
      checks.mxRecord = false
    } finally {
      clearTimeout(mxTimeoutId)
    }

    // Determine overall validity and confidence
    if (!checks.mxRecord) {
      return {
        isValid: false,
        reason: 'Domain does not accept emails (no MX records)',
        confidence: 'high',
        checks,
      }
    }

    return {
      isValid: true,
      confidence: 'high',
      checks,
    }
  } catch (error) {
    logger.error('Email validation error', { email, error })
    return {
      isValid: false,
      reason: 'Validation service temporarily unavailable',
      confidence: 'low',
      checks,
    }
  }
}

/**
 * Quick validation for high-volume scenarios (skips MX check)
 */
export function quickValidateEmail(email: string): EmailValidationResult {
  const checks = {
    syntax: false,
    domain: false,
    mxRecord: true, // Skip MX check for performance
    disposable: false,
  }

  checks.syntax = validateEmailSyntax(email)
  if (!checks.syntax) {
    return {
      isValid: false,
      reason: 'Invalid email format',
      confidence: 'high',
      checks,
    }
  }

  const domain = email.split('@')[1]?.toLowerCase()
  if (!domain) {
    return {
      isValid: false,
      reason: 'Missing domain',
      confidence: 'high',
      checks,
    }
  }

  checks.disposable = !isDisposableEmailFull(email)
  if (!checks.disposable) {
    return {
      isValid: false,
      reason: 'Disposable email addresses are not allowed',
      confidence: 'high',
      checks,
    }
  }

  if (hasInvalidPatterns(email)) {
    return {
      isValid: false,
      reason: 'Email contains suspicious patterns',
      confidence: 'medium',
      checks,
    }
  }

  checks.domain = domain.includes('.') && !domain.startsWith('.') && !domain.endsWith('.')
  if (!checks.domain) {
    return {
      isValid: false,
      reason: 'Invalid domain format',
      confidence: 'high',
      checks,
    }
  }

  return {
    isValid: true,
    confidence: 'medium',
    checks,
  }
}
