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

/** Common disposable domains for fast client-side feedback */
const DISPOSABLE_DOMAINS = new Set([
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

/**
 * Validates email syntax using RFC 5322 compliant regex
 */
function validateEmailSyntax(email: string): boolean {
  const emailRegex =
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/
  return emailRegex.test(email) && email.length <= 254
}

/**
 * Checks if domain has valid MX records (server-side only)
 */
async function checkMXRecord(domain: string): Promise<boolean> {
  if (typeof window !== 'undefined') {
    return true
  }

  try {
    const { promisify } = await import('util')
    const dns = await import('dns')
    const resolveMx = promisify(dns.resolveMx)

    const mxRecords = await resolveMx(domain)
    return mxRecords && mxRecords.length > 0
  } catch (error) {
    logger.debug('MX record check failed', { domain, error })
    return false
  }
}

/**
 * Checks if email is from a known disposable email provider
 */
function isDisposableEmail(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase()
  return domain ? DISPOSABLE_DOMAINS.has(domain) : false
}

/**
 * Checks for obvious patterns that indicate invalid emails
 */
function hasInvalidPatterns(email: string): boolean {
  if (email.includes('..')) return true

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

    checks.disposable = !isDisposableEmail(email)
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
        confidence: 'high',
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

    let mxTimeoutId: ReturnType<typeof setTimeout> | undefined
    try {
      const mxCheckPromise = checkMXRecord(domain)
      const timeoutPromise = new Promise<boolean>((_, reject) => {
        mxTimeoutId = setTimeout(() => reject(new Error('MX check timeout')), 5000)
      })

      checks.mxRecord = await Promise.race([mxCheckPromise, timeoutPromise])
    } catch (error) {
      logger.debug('MX record check failed or timed out', { domain, error })
      checks.mxRecord = false
    } finally {
      clearTimeout(mxTimeoutId)
    }

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
    mxRecord: true,
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

  checks.disposable = !isDisposableEmail(email)
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
