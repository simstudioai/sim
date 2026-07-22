import { domainToASCII } from 'node:url'
import { parse } from 'tldts'

/**
 * Normalizes one user-supplied SSO email domain to a canonical form. Inputs that
 * are URLs, email addresses, comma lists, IPs, public suffixes, or domains below
 * an unknown suffix are rejected.
 */
export function normalizeSSODomain(input: string): string | null {
  if (typeof input !== 'string') return null

  const trimmed = input.trim().replace(/\.$/, '')
  if (!trimmed || trimmed.includes(',')) return null
  if (/[:/@*?\s]/.test(trimmed)) return null

  const value = domainToASCII(trimmed).toLowerCase()
  if (!value) return null

  const result = parse(value, {
    allowPrivateDomains: true,
    validateHostname: true,
  })
  if (
    result.isIp ||
    !result.domain ||
    !result.publicSuffix ||
    (!result.isIcann && !result.isPrivate) ||
    result.hostname !== value ||
    result.publicSuffix === value
  ) {
    return null
  }

  return value
}
