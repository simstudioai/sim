import { getAllowedMcpDomainsFromEnv } from '@/lib/core/config/feature-flags'
import { getBaseUrl } from '@/lib/core/utils/urls'

export class McpDomainNotAllowedError extends Error {
  constructor(domain: string) {
    super(`MCP server domain "${domain}" is not allowed by the server's ALLOWED_MCP_DOMAINS policy`)
    this.name = 'McpDomainNotAllowedError'
  }
}

let cachedPlatformHostname: string | null = null
let platformHostnameResolved = false

/**
 * Returns the platform's own hostname (from getBaseUrl), lazy-cached.
 * Always lowercase. Returns null if the base URL is not configured or invalid.
 */
function getPlatformHostname(): string | null {
  if (platformHostnameResolved) return cachedPlatformHostname
  platformHostnameResolved = true
  try {
    cachedPlatformHostname = new URL(getBaseUrl()).hostname.toLowerCase()
  } catch {
    cachedPlatformHostname = null
  }
  return cachedPlatformHostname
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
    if (hostname === getPlatformHostname()) return null
    return allowedDomains.includes(hostname) ? null : hostname
  } catch {
    return url
  }
}

/**
 * Returns true if the URL's domain is allowed (or no restriction is configured).
 * The platform's own hostname (from getBaseUrl) is always allowed.
 */
export function isMcpDomainAllowed(url: string | undefined): boolean {
  if (!url) return true
  return checkMcpDomain(url) === null
}

/**
 * Throws McpDomainNotAllowedError if the URL's domain is not in the allowlist.
 * The platform's own hostname (from getBaseUrl) is always allowed.
 */
export function validateMcpDomain(url: string | undefined): void {
  if (!url) return
  const rejected = checkMcpDomain(url)
  if (rejected !== null) {
    throw new McpDomainNotAllowedError(rejected)
  }
}
