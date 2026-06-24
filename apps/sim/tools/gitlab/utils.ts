const DEFAULT_GITLAB_HOST = 'gitlab.com'

/**
 * Error thrown when a user-supplied GitLab host is structurally unsafe to use
 * as the target of a server-side request that carries the user's access token.
 */
export class UnsafeGitLabHostError extends Error {
  constructor(rawHost: string) {
    super(`Invalid GitLab host: ${rawHost}`)
    this.name = 'UnsafeGitLabHostError'
  }
}

/**
 * Rejects a host that is structurally unsafe to fetch with the caller's token.
 *
 * The host is later interpolated into `https://<host>/api/v4`, so anything that
 * could change the request's authority (userinfo `@`, an embedded path/query/
 * fragment, whitespace, or control characters) must be rejected to prevent the
 * `PRIVATE-TOKEN` header from being sent to an attacker-controlled origin. The
 * allowed alphabet is hostname labels plus an optional `:port`, so self-managed
 * hosts such as `gitlab.example.com` or `gitlab.example.com:8443` keep working.
 * This is a structural guard only; DNS-based private-IP/SSRF checks remain the
 * responsibility of the fetch layer.
 */
function assertSafeGitLabHostString(host: string, rawHost: string): void {
  const hostnameWithoutPort = host.replace(/:\d+$/, '')
  const allowedHostChars = /^[A-Za-z0-9.-]+$/
  if (!allowedHostChars.test(hostnameWithoutPort)) {
    throw new UnsafeGitLabHostError(rawHost)
  }
  if (hostnameWithoutPort.startsWith('.') || hostnameWithoutPort.endsWith('.')) {
    throw new UnsafeGitLabHostError(rawHost)
  }
  if (hostnameWithoutPort.split('.').some((label) => label.length === 0)) {
    throw new UnsafeGitLabHostError(rawHost)
  }
}

/**
 * Normalizes a GitLab host value: trims whitespace, strips any protocol prefix
 * and trailing slashes, validates that the result is a bare host (optionally
 * with a port), and falls back to gitlab.com when empty. Mirrors the GitLab
 * connector so tools, triggers, and connectors resolve hosts identically.
 *
 * @throws {UnsafeGitLabHostError} when a non-empty host is structurally unsafe.
 */
export function normalizeGitLabHost(rawHost: unknown): string {
  const raw = typeof rawHost === 'string' ? rawHost.trim() : ''
  if (!raw) return DEFAULT_GITLAB_HOST
  const host = raw
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
    .trim()
  if (!host) return DEFAULT_GITLAB_HOST
  assertSafeGitLabHostString(host, String(rawHost))
  return host
}

/**
 * Builds the REST API v4 base URL for the configured host. Defaults to
 * gitlab.com so existing workflows that never set a host keep working.
 *
 * @throws {UnsafeGitLabHostError} when a non-empty host is structurally unsafe.
 */
export function getGitLabApiBase(rawHost: unknown): string {
  return `https://${normalizeGitLabHost(rawHost)}/api/v4`
}
