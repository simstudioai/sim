import { isValidEmailSyntax } from '@sim/utils/string'

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
 * Quick email validation for client-side form feedback.
 */
export function quickValidateEmail(email: string): EmailValidationResult {
  const checks = {
    syntax: false,
    domain: false,
    mxRecord: true,
    disposable: false,
  }

  checks.syntax = isValidEmailSyntax(email)
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

/**
 * App-level policy for a single access-allowlist entry, applied on top of the
 * caller's format gate. A bare `@domain` entry carries no local part, so the
 * address-level checks (disposable providers, suspicious patterns) only apply
 * to full addresses.
 *
 * @returns the rejection reason, or `null` when the entry is accepted.
 */
export function validateAllowlistEntry(entry: string): string | null {
  if (entry.startsWith('@')) return null
  const result = quickValidateEmail(entry)
  return result.isValid ? null : (result.reason ?? 'Invalid email')
}
