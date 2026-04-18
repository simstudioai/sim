import dns from 'dns/promises'
import { createLogger } from '@sim/logger'
import * as ipaddr from 'ipaddr.js'
import { getAllowedMcpDomainsFromEnv } from '@/lib/core/config/feature-flags'
import { isPrivateOrReservedIP } from '@/lib/core/security/input-validation.server'
import { toError } from '@/lib/core/utils/helpers'
import { createEnvVarPattern } from '@/executor/utils/reference-validation'

const logger = createLogger('McpDomainCheck')

export class McpDomainNotAllowedError extends Error {
  constructor(domain: string) {
    super(`MCP server domain "${domain}" is not allowed by the server's ALLOWED_MCP_DOMAINS policy`)
    this.name = 'McpDomainNotAllowedError'
  }
}

export class McpSsrfError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'McpSsrfError'
  }
}

export class McpDnsResolutionError extends Error {
  constructor(hostname: string) {
    super(`MCP server URL hostname "${hostname}" could not be resolved`)
    this.name = 'McpDnsResolutionError'
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

/**
 * Returns true if the IP is a loopback address (full 127.0.0.0/8 range, or ::1).
 */
function isLoopbackIP(ip: string): boolean {
  try {
    if (!ipaddr.isValid(ip)) return false
    return ipaddr.process(ip).range() === 'loopback'
  } catch {
    return false
  }
}

/**
 * Returns true if the hostname is localhost or a loopback IP literal.
 * Expects IPv6 brackets to already be stripped.
 */
function isLocalhostHostname(hostname: string): boolean {
  const clean = hostname.toLowerCase()
  if (clean === 'localhost') return true
  return ipaddr.isValid(clean) && isLoopbackIP(clean)
}

/**
 * Validates an MCP server URL against SSRF attacks by resolving DNS and
 * rejecting private/reserved IP ranges (RFC-1918, link-local, cloud metadata).
 *
 * Only active when ALLOWED_MCP_DOMAINS is **not configured**. When an admin
 * has set an explicit domain allowlist, they control which domains are
 * reachable and private-network MCP servers are legitimate. Applying SSRF
 * blocking on top of an admin-curated list would break self-hosted
 * deployments where MCP servers run on internal networks.
 *
 * Does NOT enforce protocol (HTTP is allowed) or block service ports — MCP
 * servers legitimately run on HTTP and on arbitrary ports.
 *
 * Localhost/loopback is always allowed for local dev MCP servers.
 * URLs with env var references in the hostname are skipped — they will be
 * validated after resolution at execution time.
 *
 * @throws McpSsrfError if the URL resolves to a blocked IP address
 */
export async function validateMcpServerSsrf(url: string | undefined): Promise<void> {
  if (!url) return
  if (getAllowedMcpDomainsFromEnv() !== null) return
  if (hasEnvVarInHostname(url)) return

  let hostname: string
  try {
    hostname = new URL(url).hostname
  } catch {
    throw new McpSsrfError('MCP server URL is not a valid URL')
  }

  const cleanHostname =
    hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname

  if (isLocalhostHostname(cleanHostname)) return

  if (ipaddr.isValid(cleanHostname) && isPrivateOrReservedIP(cleanHostname)) {
    throw new McpSsrfError('MCP server URL cannot point to a private or reserved IP address')
  }

  try {
    const { address } = await dns.lookup(cleanHostname, { verbatim: true })

    if (isPrivateOrReservedIP(address) && !isLoopbackIP(address)) {
      logger.warn('MCP server URL resolves to blocked IP address', {
        hostname,
        resolvedIP: address,
      })
      throw new McpSsrfError('MCP server URL resolves to a blocked IP address')
    }
  } catch (error) {
    if (error instanceof McpSsrfError) throw error
    logger.warn('DNS lookup failed for MCP server URL', {
      hostname,
      error: toError(error).message,
    })
    throw new McpDnsResolutionError(cleanHostname)
  }
}
