import { getAllowedMcpDomainsFromEnv } from '@/lib/core/config/feature-flags'
import { createEnvVarPattern } from '@/executor/utils/reference-validation'

export class McpDomainNotAllowedError extends Error {
  constructor(domain: string) {
    super(`MCP server domain "${domain}" is not allowed by the server's ALLOWED_MCP_DOMAINS policy`)
    this.name = 'McpDomainNotAllowedError'
  }
}

/**
 * Core domain check. Returns null if the URL is allowed, or the hostname/url
 * string to use in the rejection error.
 */
function checkMcpDomain(url: string): string | null {
  const allowedDomains = getAllowedMcpDomainsFromEnv()
  if (allowedDomains === null) return null
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return allowedDomains.includes(hostname) ? null : hostname
  } catch {
    return url
  }
}

/**
 * Returns true if the URL's hostname contains an env var reference,
 * meaning domain validation must be deferred until env var resolution.
 * Only bypasses validation when the hostname itself is unresolvable —
 * env vars in the path/query do NOT bypass the domain check.
 */
function hasEnvVarInHostname(url: string): boolean {
  // If the entire URL is an env var reference, hostname is unknown
  if (url.trim().replace(createEnvVarPattern(), '').trim() === '') return true
  try {
    // Extract the authority portion (between :// and the first /, ?, or # per RFC 3986)
    const protocolEnd = url.indexOf('://')
    if (protocolEnd === -1) return createEnvVarPattern().test(url)
    const afterProtocol = url.substring(protocolEnd + 3)
    const authorityEnd = afterProtocol.search(/[/?#]/)
    const authority = authorityEnd === -1 ? afterProtocol : afterProtocol.substring(0, authorityEnd)
    return createEnvVarPattern().test(authority)
  } catch {
    return createEnvVarPattern().test(url)
  }
}

/**
 * Returns true if the URL's domain is allowed (or no restriction is configured).
 * URLs with env var references in the hostname are allowed — they will be
 * validated after resolution at execution time.
 */
export function isMcpDomainAllowed(url: string | undefined): boolean {
  if (!url) {
    return getAllowedMcpDomainsFromEnv() === null
  }
  if (hasEnvVarInHostname(url)) return true
  return checkMcpDomain(url) === null
}

/**
 * Throws McpDomainNotAllowedError if the URL's domain is not in the allowlist.
 * URLs with env var references in the hostname are skipped — they will be
 * validated after resolution at execution time.
 */
export function validateMcpDomain(url: string | undefined): void {
  if (!url) {
    if (getAllowedMcpDomainsFromEnv() !== null) {
      throw new McpDomainNotAllowedError('(empty)')
    }
    return
  }
  if (hasEnvVarInHostname(url)) return
  const rejected = checkMcpDomain(url)
  if (rejected !== null) {
    throw new McpDomainNotAllowedError(rejected)
  }
}
