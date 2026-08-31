import { createLogger } from '@sim/logger'
import { getAllowedMcpDomainsFromEnv } from '@/lib/core/config/env-flags'
import type { EgressProfile } from '@/lib/core/security/egress/profiles'
import { validateUrlWithDNS } from '@/lib/core/security/input-validation.server'
import { createEnvVarPattern } from '@/executor/utils/reference-validation'

const logger = createLogger('McpDomainCheck')

/**
 * An MCP server URL is a configured endpoint for software commonly self-hosted:
 * plain HTTP and an arbitrary port are ordinary, and reaching one on a private
 * address is a matter of the operator naming it in the egress allowlist.
 */
export const MCP_EGRESS_PROFILE: EgressProfile = 'selfHostedService'

/**
 * Profile for an MCP OAuth leg — discovery, registration, token exchange,
 * revocation.
 *
 * Every hop after the first takes its URL from authorization-server metadata,
 * which the remote server controls. Treating those as configured endpoints would
 * let a hostile server steer a leg at whatever the operator allowlisted for their
 * own workflows, so they get the provenance they actually have.
 */
export const OAUTH_EGRESS_PROFILE: EgressProfile = 'contentFetch'

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
 * Validates an MCP server URL against the deployment's egress policy and returns
 * the address to pin.
 *
 * Domain governance (`ALLOWED_MCP_DOMAINS`) and this check are separate
 * questions and both apply: an allowlisted domain still has to resolve somewhere
 * the deployment permits. They used to be alternatives — configuring the domain
 * list disabled this entirely — which left an allowlisted domain free to redirect
 * anywhere, cloud metadata included.
 *
 * `profile` defaults to the configured-server one. An OAuth leg passes
 * `contentFetch` instead, because those URLs come out of authorization-server
 * metadata rather than from whoever configured the server.
 *
 * Returns null when there is no URL yet, or when the hostname still contains an
 * unresolved env-var reference. That URL is checked again after resolution, at
 * which point it takes the normal path.
 *
 * @throws McpSsrfError when the policy refuses the destination
 * @throws McpDnsResolutionError when the hostname cannot be resolved
 */
export async function validateMcpServerSsrf(
  url: string | undefined,
  profile: EgressProfile = MCP_EGRESS_PROFILE
): Promise<string | null> {
  if (!url) return null
  if (hasEnvVarInHostname(url)) return null

  const validation = await validateUrlWithDNS(url, 'MCP server URL', profile)
  if (validation.isValid) return validation.resolvedIP

  const error = validation.error
  if (error.includes('could not be resolved')) {
    let hostname = url
    try {
      hostname = new URL(url).hostname
    } catch {
      // Fall back to the raw URL in the message.
    }
    logger.warn('DNS lookup failed for MCP server URL', { hostname })
    throw new McpDnsResolutionError(hostname)
  }
  logger.warn('MCP server URL refused by egress policy', { error })
  throw new McpSsrfError(error)
}
