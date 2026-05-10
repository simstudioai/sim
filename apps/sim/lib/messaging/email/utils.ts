import { env } from '@/lib/core/config/env'
import { getEmailDomain } from '@/lib/core/utils/urls'

export const EMAIL_HEADER_CONTROL_CHARS_REGEX = /[\r\n]/

export const NO_EMAIL_HEADER_CONTROL_CHARS_REGEX = /^[^\r\n]*$/

export function hasEmailHeaderControlChars(value: string): boolean {
  return EMAIL_HEADER_CONTROL_CHARS_REGEX.test(value)
}

/**
 * Get the from email address, preferring FROM_EMAIL_ADDRESS over EMAIL_DOMAIN
 */
export function getFromEmailAddress(): string {
  if (env.FROM_EMAIL_ADDRESS?.trim()) {
    return env.FROM_EMAIL_ADDRESS
  }
  // Fallback to constructing from EMAIL_DOMAIN
  return `noreply@${env.EMAIL_DOMAIN || getEmailDomain()}`
}

/**
 * Extract the email address from a "Name <email>" formatted string"
 */
export function extractEmailFromAddress(fromAddress: string): string | undefined {
  const match = fromAddress.match(/<([^>]+)>/)
  if (match) {
    return match[1]
  }
  if (fromAddress.includes('@') && !fromAddress.includes('<')) {
    return fromAddress.trim()
  }
  return undefined
}

/**
 * Get the personal email from address and reply-to
 */
export function getPersonalEmailFrom(): { from: string; replyTo: string | undefined } {
  const personalFrom = env.PERSONAL_EMAIL_FROM
  if (personalFrom) {
    return {
      from: personalFrom,
      replyTo: extractEmailFromAddress(personalFrom),
    }
  }
  return {
    from: getFromEmailAddress(),
    replyTo: undefined,
  }
}
