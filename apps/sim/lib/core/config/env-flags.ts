/**
 * Environment utility functions for consistent environment detection across the application
 */
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
 * Enables the strict attributed-v1 Sim/Copilot billing protocol after the Go
 * consumer has rolled out. Disabled is the Sim-first compatibility stage.
 */
export const isCopilotBillingAttributionV1Enabled = isTruthy(
  env.COPILOT_BILLING_ATTRIBUTION_V1_ENABLED
)

/**
 * Rejects markerless old-Go billing traffic after an operator explicitly
 * confirms the compatibility window has closed. Off by default.
 */
export const isCopilotBillingProtocolRequired = isTruthy(env.COPILOT_BILLING_PROTOCOL_REQUIRED)

/**
 * Is billing enforcement enabled.
 *
 * Server code reads `BILLING_ENABLED`. Server-only vars never reach browser
 * bundles, so client evaluation reads the `NEXT_PUBLIC_BILLING_ENABLED` twin
 * (via `window.__ENV`, populated by `<PublicEnvScript>`) — reading
 * `env.BILLING_ENABLED` in client code is always `undefined`. Deployments must
 * set both vars together.
 */
export const isBillingEnabled =
  typeof window === 'undefined'
    ? isTruthy(env.BILLING_ENABLED)
    : isTruthy(getEnv('NEXT_PUBLIC_BILLING_ENABLED'))

/**
 * Block free-plan accounts from programmatic workflow execution (API key, public
 * API, MCP server, generic webhooks, cross-origin chat embeds).
 * Gated behind {@link isBillingEnabled}; off by default so the paywall can ship
 * dark and be enabled per-deployment once verified.
 */
export const isFreeApiDeploymentGateEnabled = isTruthy(env.FREE_API_DEPLOYMENT_GATE_ENABLED)

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
      const logger = createLogger('EnvFlags')
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
 * Whether database/connector tools may connect to private, reserved, or loopback
 * hosts (e.g. Docker/K8s service names, localhost). Off by default: the SSRF guard
 * in {@link validateDatabaseHost} blocks these so an untrusted user cannot pivot
 * into the deployment's internal network. Self-hosted operators can opt in when
 * their database lives on the same private network. Blocked on the hosted platform
 * regardless of the env var, mirroring {@link isAuthDisabled}.
 */
export const isPrivateDatabaseHostsAllowed = isTruthy(env.ALLOW_PRIVATE_DATABASE_HOSTS) && !isHosted

if (isTruthy(env.ALLOW_PRIVATE_DATABASE_HOSTS)) {
  import('@sim/logger')
    .then(({ createLogger }) => {
      const logger = createLogger('EnvFlags')
      if (isHosted) {
        logger.error(
          'ALLOW_PRIVATE_DATABASE_HOSTS is set but ignored on hosted environment. Private/reserved database hosts remain blocked for security.'
        )
      } else {
        logger.warn(
          'ALLOW_PRIVATE_DATABASE_HOSTS is enabled. Database/connector tools may reach private, reserved, and loopback hosts. Only use this in trusted private networks.'
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
 * Is MX-based signup validation enabled (blocks no-MX domains and denylisted shared spam
 * mail backends). Opt-in to avoid adding a DNS dependency or blocking legitimate signups on
 * self-hosted deployments with non-standard mail setups; enable on abuse-targeted deployments.
 */
export const isSignupMxValidationEnabled = isTruthy(env.SIGNUP_MX_VALIDATION_ENABLED)

/**
 * Is AWS AppConfig the source of truth for the signup/login gating lists.
 * Hosted-only and requires both AppConfig identifiers (injected by the infra
 * stack). Self-hosted/OSS deployments always use the env-var fallback, so the
 * AppConfig client is never reached off-hosted.
 */
export const isAppConfigEnabled =
  isHosted && Boolean(env.APPCONFIG_APPLICATION && env.APPCONFIG_ENVIRONMENT)

/**
 * Is Trigger.dev enabled for async job processing
 */
export const isTriggerDevEnabled = isTruthy(env.TRIGGER_DEV_ENABLED)

/**
 * Is SSO enabled for enterprise authentication
 */
export const isSsoEnabled = isTruthy(env.SSO_ENABLED)

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
 * Is workspace forking enabled via env var override
 * This bypasses hosted (Enterprise) requirements for self-hosted deployments
 */
export const isForkingEnabled = isTruthy(env.FORKING_ENABLED)

/**
 * Is E2B enabled for remote code execution
 */
export const isE2bEnabled = isTruthy(env.E2B_ENABLED)

/**
 * Whether the E2B document-generation sandbox is enabled.
 *
 * Requires E2B (with an API key) AND a dedicated doc-generation template id.
 * When true, ALL four formats compile in the E2B doc sandbox: pptx/docx via Node
 * (pptxgenjs/docx + react-icons/sharp icons), pdf/xlsx via Python
 * (reportlab/openpyxl). When false, compilation stays on the JavaScript
 * (isolated-vm) path, byte-identical to its prior behavior (and xlsx is
 * unavailable). Drives both the Sim compile backend and the `docCompiler` flag
 * sent to the copilot file subagent so the agent's output and compiler agree.
 */
export const isE2BDocEnabled =
  isE2bEnabled && Boolean(env.E2B_API_KEY) && Boolean(env.MOTHERSHIP_E2B_DOC_TEMPLATE_ID)

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
 * Is Microsoft OAuth login disabled
 * When true, the Microsoft OAuth login button is hidden even when credentials are configured
 */
export const isMicrosoftAuthDisabled = isTruthy(env.DISABLE_MICROSOFT_AUTH)

/**
 * Is email/password signup disabled
 * When true, new registrations via email/password are blocked at the server level.
 * Existing users can still sign in with email/password.
 */
export const isEmailSignupDisabled = isTruthy(env.DISABLE_EMAIL_SIGNUP)

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
 * Returns the preview block types revealed via the environment variable — the
 * off-AppConfig reveal path for self-hosters and local dev. If not set or empty,
 * returns an empty array (all `preview: true` blocks stay hidden). Block types
 * are already lowercase snake_case, so entries are trimmed but not lowercased.
 */
export function getPreviewBlocksFromEnv(): string[] {
  if (!env.PREVIEW_BLOCKS) return []
  return env.PREVIEW_BLOCKS.split(',')
    .map((t) => t.trim())
    .filter(Boolean)
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
 * Get cost multiplier based on environment
 */
export function getCostMultiplier(): number {
  return isProd ? (env.COST_MULTIPLIER ?? 1) : 1
}
