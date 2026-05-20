/**
 * Environment utility functions for consistent environment detection across the application
 */
import * as ipaddr from 'ipaddr.js'
import { env, getEnv, isFalsy, isTruthy } from './env'

/**
 * Is the application running in production mode
 */
export const isProd = env.NODE_ENV === 'production'

/**
 * Is the application running in development mode
 */
export const isDev = env.NODE_ENV === 'development'

/**
 * Is the application running in test mode
 */
export const isTest = env.NODE_ENV === 'test'

/**
 * Is this the hosted version of the application.
 * True for sim.ai and any subdomain of sim.ai (e.g. staging.sim.ai, dev.sim.ai).
 */
const appUrl = getEnv('NEXT_PUBLIC_APP_URL')
let appHostname = ''
try {
  appHostname = appUrl ? new URL(appUrl).hostname : ''
} catch {
  // invalid URL — isHosted stays false
}
export const isHosted = appHostname === 'sim.ai' || appHostname.endsWith('.sim.ai')

/**
 * Is billing enforcement enabled
 */
export const isBillingEnabled = isTruthy(env.BILLING_ENABLED)

/**
 * Is email verification enabled
 */
export const isEmailVerificationEnabled = isTruthy(env.EMAIL_VERIFICATION_ENABLED)

/**
 * Is authentication disabled (for self-hosted deployments behind private networks)
 * This flag is blocked when isHosted is true.
 */
export const isAuthDisabled = isTruthy(env.DISABLE_AUTH) && !isHosted

if (isTruthy(env.DISABLE_AUTH)) {
  import('@sim/logger')
    .then(({ createLogger }) => {
      const logger = createLogger('FeatureFlags')
      if (isHosted) {
        logger.error(
          'DISABLE_AUTH is set but ignored on hosted environment. Authentication remains enabled for security.'
        )
      } else {
        logger.warn(
          'DISABLE_AUTH is enabled. Authentication is bypassed and all requests use an anonymous session. Only use this in trusted private networks.'
        )
      }
    })
    .catch(() => {
      // Fallback during config compilation when logger is unavailable
    })
}

/**
 * Is user registration disabled
 */
export const isRegistrationDisabled = isTruthy(env.DISABLE_REGISTRATION)

/**
 * Is email/password authentication enabled (defaults to true)
 */
export const isEmailPasswordEnabled = !isFalsy(env.EMAIL_PASSWORD_SIGNUP_ENABLED)

/**
 * Is signup email validation enabled (disposable email blocking via better-auth-harmony)
 */
export const isSignupEmailValidationEnabled = isTruthy(env.SIGNUP_EMAIL_VALIDATION_ENABLED)

/**
 * Is Trigger.dev enabled for async job processing
 */
export const isTriggerDevEnabled = isTruthy(env.TRIGGER_DEV_ENABLED)

/**
 * Is SSO enabled for enterprise authentication
 */
export const isSsoEnabled = isTruthy(env.SSO_ENABLED)

/**
 * Is credential sets (email polling) enabled via env var override
 * This bypasses plan requirements for self-hosted deployments
 */
export const isCredentialSetsEnabled = isTruthy(env.CREDENTIAL_SETS_ENABLED)

/**
 * Is access control (permission groups) enabled via env var override
 * This bypasses plan requirements for self-hosted deployments
 */
export const isAccessControlEnabled = isTruthy(env.ACCESS_CONTROL_ENABLED)

/**
 * Is organizations enabled
 * True if billing is enabled (orgs come with billing), OR explicitly enabled via env var,
 * OR if access control is enabled (access control requires organizations)
 */
export const isOrganizationsEnabled =
  isBillingEnabled || isTruthy(env.ORGANIZATIONS_ENABLED) || isAccessControlEnabled

/**
 * Is inbox (Sim Mailer) enabled via env var override
 * This bypasses hosted requirements for self-hosted deployments
 */
export const isInboxEnabled = isTruthy(env.INBOX_ENABLED)

/**
 * Is whitelabeling enabled via env var override
 * This bypasses hosted requirements for self-hosted deployments
 */
export const isWhitelabelingEnabled = isTruthy(env.WHITELABELING_ENABLED)

/**
 * Is audit logs enabled via env var override
 * This bypasses hosted requirements for self-hosted deployments
 */
export const isAuditLogsEnabled = isTruthy(env.AUDIT_LOGS_ENABLED)

/**
 * Is data retention enabled via env var override
 * This bypasses hosted requirements for self-hosted deployments
 */
export const isDataRetentionEnabled = isTruthy(env.DATA_RETENTION_ENABLED)

/**
 * Is data drains enabled via env var override
 * This bypasses hosted requirements for self-hosted deployments
 */
export const isDataDrainsEnabled = isTruthy(env.DATA_DRAINS_ENABLED)

/**
 * Are workflow output columns enabled in user tables.
 * Defaults to false; set NEXT_PUBLIC_WORKFLOW_COLUMNS_ENABLED=true to show
 * the "Workflow" column type in the new-column dropdown.
 */
export const isWorkflowColumnsEnabledClient = isTruthy(
  getEnv('NEXT_PUBLIC_WORKFLOW_COLUMNS_ENABLED')
)

/**
 * Is E2B enabled for remote code execution
 */
export const isE2bEnabled = isTruthy(env.E2B_ENABLED)

/**
 * Whether Ollama is configured (OLLAMA_URL is set).
 * When true, models that are not in the static cloud model list and have no
 * slash-prefixed provider namespace are assumed to be Ollama models
 * and do not require an API key.
 */
export const isOllamaConfigured = Boolean(env.OLLAMA_URL)

/**
 * Whether Azure OpenAI / Azure Anthropic credentials are pre-configured at the server level
 * (via AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, AZURE_ANTHROPIC_ENDPOINT, etc.).
 * When true, the endpoint, API key, and API version fields are hidden in the Agent block UI.
 * Set NEXT_PUBLIC_AZURE_CONFIGURED=true in self-hosted deployments on Azure.
 */
export const isAzureConfigured = isTruthy(getEnv('NEXT_PUBLIC_AZURE_CONFIGURED'))

/**
 * Whether a Cohere API key is pre-configured server-side for the Knowledge block reranker
 * (`COHERE_API_KEY` or `COHERE_API_KEY_1/2/3`). When true, the Cohere API Key field is hidden
 * in the Knowledge block UI.
 * Set NEXT_PUBLIC_COHERE_CONFIGURED=true in self-hosted deployments that ship a Cohere key.
 */
export const isCohereConfigured = isTruthy(getEnv('NEXT_PUBLIC_COHERE_CONFIGURED'))

/**
 * Are invitations disabled globally
 * When true, workspace invitations are disabled for all users
 */
export const isInvitationsDisabled = isTruthy(env.DISABLE_INVITATIONS)

/**
 * Is public API access disabled globally
 * When true, the public API toggle is hidden and public API access is blocked
 */
export const isPublicApiDisabled = isTruthy(env.DISABLE_PUBLIC_API)

/**
 * Is Google OAuth login disabled
 * When true, the Google OAuth login button is hidden even when credentials are configured
 */
export const isGoogleAuthDisabled = isTruthy(env.DISABLE_GOOGLE_AUTH)

/**
 * Is GitHub OAuth login disabled
 * When true, the GitHub OAuth login button is hidden even when credentials are configured
 */
export const isGithubAuthDisabled = isTruthy(env.DISABLE_GITHUB_AUTH)

/**
 * Is React Grab enabled for UI element debugging
 * When true and in development mode, enables React Grab for copying UI element context to clipboard
 */
export const isReactGrabEnabled = isDev && isTruthy(env.REACT_GRAB_ENABLED)

/**
 * Is React Scan enabled for performance debugging
 * When true and in development mode, enables React Scan for detecting render performance issues
 */
export const isReactScanEnabled = isDev && isTruthy(env.REACT_SCAN_ENABLED)

/**
 * Returns the parsed allowlist of integration block types from the environment variable.
 * If not set or empty, returns null (meaning all integrations are allowed).
 */
export function getAllowedIntegrationsFromEnv(): string[] | null {
  if (!env.ALLOWED_INTEGRATIONS) return null
  const parsed = env.ALLOWED_INTEGRATIONS.split(',')
    .map((i) => i.trim().toLowerCase())
    .filter(Boolean)
  return parsed.length > 0 ? parsed : null
}

/**
 * Returns the list of blacklisted provider IDs from the environment variable.
 * If not set or empty, returns an empty array (meaning no providers are blacklisted).
 */
export function getBlacklistedProvidersFromEnv(): string[] {
  if (!env.BLACKLISTED_PROVIDERS) return []
  return env.BLACKLISTED_PROVIDERS.split(',')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * Normalizes a domain entry from the ALLOWED_MCP_DOMAINS env var.
 * Accepts bare hostnames (e.g., "mcp.company.com") or full URLs (e.g., "https://mcp.company.com").
 * Extracts the hostname in either case.
 */
function normalizeDomainEntry(entry: string): string {
  const trimmed = entry.trim().toLowerCase()
  if (!trimmed) return ''
  if (trimmed.includes('://')) {
    try {
      return new URL(trimmed).hostname
    } catch {
      return trimmed
    }
  }
  return trimmed
}

/**
 * Get allowed MCP server domains from the ALLOWED_MCP_DOMAINS env var.
 * Returns null if not set (all domains allowed), or parsed array of lowercase hostnames.
 * Accepts both bare hostnames and full URLs in the env var value.
 */
export function getAllowedMcpDomainsFromEnv(): string[] | null {
  if (!env.ALLOWED_MCP_DOMAINS) return null
  const parsed = env.ALLOWED_MCP_DOMAINS.split(',').map(normalizeDomainEntry).filter(Boolean)
  return parsed.length > 0 ? parsed : null
}

/**
 * Parsed form of the ALLOWED_PRIVATE_HOSTS env var.
 * - `hostnames`: lowercase hostnames matched against the original URL hostname
 * - `cidrs`: parsed IP ranges matched against the resolved IP after DNS lookup
 */
export interface AllowedPrivateHosts {
  hostnames: Set<string>
  cidrs: Array<[ipaddr.IPv4 | ipaddr.IPv6, number]>
}

let cachedAllowedPrivateHosts: AllowedPrivateHosts | null | undefined

/**
 * Get the parsed allowlist of private hosts and CIDRs that should bypass SSRF
 * private-IP blocking.
 *
 * Returns null if `ALLOWED_PRIVATE_HOSTS` is unset or has no parseable entries
 * (default — full SSRF block enforced). Otherwise returns a structure with
 * the lowercase hostnames and pre-parsed CIDR ranges to match against.
 *
 * Each entry can be:
 *   - A bare hostname (e.g., `gitlab.allot.internal`) — matched against the
 *     URL's original hostname, case-insensitive.
 *   - A literal IPv4/IPv6 address (e.g., `10.112.12.56`) — matched as a /32 or /128.
 *   - A CIDR range (e.g., `10.0.0.0/8`, `fd00::/8`) — matched against the
 *     resolved IP after DNS lookup.
 *
 * The result is cached for the process lifetime; env changes require a restart.
 */
export function getAllowedPrivateHostsFromEnv(): AllowedPrivateHosts | null {
  if (cachedAllowedPrivateHosts !== undefined) return cachedAllowedPrivateHosts
  if (!env.ALLOWED_PRIVATE_HOSTS) {
    cachedAllowedPrivateHosts = null
    return null
  }
  const hostnames = new Set<string>()
  const cidrs: AllowedPrivateHosts['cidrs'] = []
  for (const raw of env.ALLOWED_PRIVATE_HOSTS.split(',')) {
    const entry = raw.trim()
    if (!entry) continue
    if (entry.includes('/')) {
      try {
        cidrs.push(ipaddr.parseCIDR(entry))
        continue
      } catch {
        // fall through and treat as hostname
      }
    }
    if (ipaddr.isValid(entry)) {
      const addr = ipaddr.process(entry)
      cidrs.push([addr, addr.kind() === 'ipv4' ? 32 : 128])
      continue
    }
    hostnames.add(entry.toLowerCase())
  }
  if (hostnames.size === 0 && cidrs.length === 0) {
    cachedAllowedPrivateHosts = null
    return null
  }
  cachedAllowedPrivateHosts = { hostnames, cidrs }
  return cachedAllowedPrivateHosts
}

/**
 * Returns true if either the original hostname or the resolved IP appears in
 * the operator-curated `ALLOWED_PRIVATE_HOSTS` allowlist.
 *
 * Lets self-hosted deployments call internal services (e.g., GitLab on a 10.x
 * address) without disabling SSRF protection entirely.
 *
 * The caller should still run the standard private-IP check first; this
 * function is meant as an override gate after a block decision, not a
 * replacement for SSRF validation. When the env var is unset, returns false
 * and the default block stands.
 */
export function isAllowlistedPrivateHost(opts: { hostname?: string; ip?: string }): boolean {
  const allow = getAllowedPrivateHostsFromEnv()
  if (!allow) return false
  if (opts.hostname && allow.hostnames.has(opts.hostname.toLowerCase())) return true
  if (opts.ip && ipaddr.isValid(opts.ip)) {
    try {
      const addr = ipaddr.process(opts.ip)
      for (const range of allow.cidrs) {
        if (addr.kind() !== range[0].kind()) continue
        if (addr.match(range)) return true
      }
    } catch {
      // ignore unparseable IPs — caller already handled validation
    }
  }
  return false
}

/**
 * Test-only hook to reset the cached `ALLOWED_PRIVATE_HOSTS` parse result so
 * each test can swap the underlying env value without process restart.
 */
export function __resetAllowedPrivateHostsCacheForTest(): void {
  cachedAllowedPrivateHosts = undefined
}

/**
 * Get cost multiplier based on environment
 */
export function getCostMultiplier(): number {
  return isProd ? (env.COST_MULTIPLIER ?? 1) : 1
}
