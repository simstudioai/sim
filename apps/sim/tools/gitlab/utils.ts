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

/**
 * The GitLab member access levels, as the display name shown in the block and
 * the integer the REST API expects. This is the single source of truth for the
 * access-level enum: the block derives its combobox options from it, and runtime
 * coercion validates against it.
 *
 * @see https://docs.gitlab.com/api/members/#roles
 */
export const GITLAB_ACCESS_LEVELS = [
  { name: 'No access', value: 0 },
  { name: 'Minimal Access', value: 5 },
  { name: 'Guest', value: 10 },
  { name: 'Planner', value: 15 },
  { name: 'Reporter', value: 20 },
  { name: 'Security Manager', value: 25 },
  { name: 'Developer', value: 30 },
  { name: 'Maintainer', value: 40 },
  { name: 'Owner', value: 50 },
] as const

/**
 * Options for the block's access-level combobox. The `id` is the integer as a
 * string so a literal pick serializes to the same value GitLab expects, while a
 * reference expression (e.g. `<resolve.result.level>`) passes through untouched.
 */
export const GITLAB_ACCESS_LEVEL_OPTIONS: { label: string; id: string }[] =
  GITLAB_ACCESS_LEVELS.map((level) => ({ label: level.name, id: String(level.value) }))

const GITLAB_ACCESS_LEVEL_VALUES = new Set<number>(GITLAB_ACCESS_LEVELS.map((level) => level.value))

const GITLAB_ACCESS_LEVEL_BY_NAME = new Map<string, number>(
  GITLAB_ACCESS_LEVELS.map((level) => [level.name.toLowerCase(), level.value])
)

/**
 * Error thrown when a resolved access-level value is not one of the known GitLab
 * levels. Kept distinct so callers can surface a permissions-specific message.
 */
export class InvalidGitLabAccessLevelError extends Error {
  constructor(value: unknown) {
    const valid = GITLAB_ACCESS_LEVELS.map((level) => `${level.name} (${level.value})`).join(', ')
    super(`Invalid GitLab access level: ${JSON.stringify(value)}. Expected one of: ${valid}.`)
    this.name = 'InvalidGitLabAccessLevelError'
  }
}

/**
 * Coerces a runtime access-level value to the GitLab integer. Accepts an integer
 * (`30`), a numeric string (`'30'`), or a level name (`'Developer'`,
 * case-insensitive). This runs at execution time - after reference expressions
 * have resolved - so a level computed from a policy table (by name or number) is
 * accepted while any value outside the enum fails loudly.
 *
 * @throws {InvalidGitLabAccessLevelError} when the value is not a known level.
 */
export function coerceGitLabAccessLevel(value: unknown): number {
  if (typeof value === 'number' && GITLAB_ACCESS_LEVEL_VALUES.has(value)) {
    return value
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    const byName = GITLAB_ACCESS_LEVEL_BY_NAME.get(trimmed.toLowerCase())
    if (byName !== undefined) return byName
    const numeric = Number(trimmed)
    if (trimmed !== '' && Number.isFinite(numeric) && GITLAB_ACCESS_LEVEL_VALUES.has(numeric)) {
      return numeric
    }
  }
  throw new InvalidGitLabAccessLevelError(value)
}

/**
 * A GitLab access/membership resource is scoped either to a project or a group.
 * The two share an identical endpoint surface (`/members`, `/invitations`,
 * `/access_requests`) that differs only in the leading path segment.
 */
export type GitLabResourceType = 'project' | 'group'

/**
 * Encodes a GitLab project/group id or path exactly once, regardless of
 * whether the caller already URL-encoded it. GitLab's own API docs show
 * namespaced paths pre-encoded (e.g. `groups/gitlab-org%2Fgitlab-test`), so
 * callers - including LLM-authored block values that mirror that convention -
 * may pass either `mygroup/myproject` or `mygroup%2Fmyproject`. Decoding
 * first makes both inputs converge on the same single-encoded result;
 * without it, a pre-encoded `%2F` gets re-encoded to `%252F`, GitLab decodes
 * that once server-side to the literal string `%2F`, and the lookup 404s.
 */
function encodeGitLabResourceId(resourceId: string | number): string {
  const raw = String(resourceId).trim()
  let decoded = raw
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    // Not a valid percent-encoding (e.g. a bare `%`) - treat as already raw.
  }
  return encodeURIComponent(decoded)
}

/**
 * Builds the path segment for a project- or group-scoped access resource, e.g.
 * `projects/mygroup%2Fmyproject` or `groups/42`. The id is URL-encoded so that
 * raw paths (`mygroup/myproject`), pre-encoded paths (`mygroup%2Fmyproject`),
 * and numeric ids all work.
 */
export function getGitLabResourcePath(
  resourceType: GitLabResourceType,
  resourceId: string | number
): string {
  const encodedId = encodeGitLabResourceId(resourceId)
  const segment = resourceType === 'group' ? 'groups' : 'projects'
  return `${segment}/${encodedId}`
}
