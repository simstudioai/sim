/**
 * Loaded by `next.config.ts` before the `@/` alias is available, so
 * config-boundary dependencies use workspace packages or relative imports.
 */

import {
  isImmutableDaytonaSnapshotRef,
  isImmutableE2BTemplateRef,
  isValidSandboxReleaseGeneration,
} from '@sim/utils/sandbox-references'
import {
  ENTERPRISE_FEATURE_LEGACY_DEFAULTS,
  type EnterpriseFeature,
  resolveEnterpriseEntitlement,
  resolveSandboxFeatureAvailability,
} from './enterprise-entitlements'
import { env, envBoolean, envNumber, getEnv, isFalsy, isTruthy } from './env'
import { hasEnvCapabilityValue, inspectCapability, SANDBOX_CAPABILITY } from './env-capabilities'

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
 *
 * Workspace surfaces in the browser read `hosted` from the deployment shape the
 * workspace host context carries (`@/lib/core/config/deployment-shape`), not this
 * constant: it is computed once from the `NEXT_PUBLIC_*` transport the root layout
 * emits, which a `global-error` or bare 404 document never provides.
 */
const appUrl = getEnv('NEXT_PUBLIC_APP_URL')
let appHostname = ''
try {
  appHostname = appUrl ? new URL(appUrl).hostname : ''
} catch {
  /** An unparseable configured URL reads as self-hosted. */
}
/**
 * Local-development escape hatch for exercising hosted-only paths (the sim-auto
 * pool, platform keys, hosted-only UI) without pointing `NEXT_PUBLIC_APP_URL` at
 * a sim.ai hostname, which would break local callback URLs. Ignored in
 * production builds, so a self-hosted deployment can never claim to be Sim's
 * hosted environment.
 */
const forceHosted = !isProd && isTruthy(getEnv('NEXT_PUBLIC_FORCE_HOSTED'))

export const isHosted = forceHosted || appHostname === 'sim.ai' || appHostname.endsWith('.sim.ai')

/**
 * Are the Chat module's surfaces shown. On by default, so a deployment that
 * already has `COPILOT_API_KEY` keeps Chat without setting anything; the setup
 * wizard writes the opt-out when you skip the key.
 *
 * This governs presentation only. Whether Chat can actually reach the mothership
 * is a separate question answered by `COPILOT_API_KEY`, which gates the paths
 * that need it (the Sim Chat block, prompt-job claims, inbox execution). Keeping
 * them separate is what lets this be a single variable: the secret key could
 * never be read in the browser, but `NEXT_PUBLIC_CHAT_DISABLED` can — no twin to
 * keep in sync.
 *
 * Read at module scope or inline during render only. Resolving it through
 * `useState`/`useEffect` would render chat surfaces before removing them.
 */
export const isChatEnabled = !isTruthy(getEnv('NEXT_PUBLIC_CHAT_DISABLED'))

/**
 * Forces the sidebar service-status notice into its critical preview state.
 * This is an explicit testing override; when unset, hosted deployments read
 * the live status page and other deployments do not mount the notice.
 */
export const isStatusNoticePreviewEnabled = isTruthy(getEnv('NEXT_PUBLIC_STATUS_NOTICE_PREVIEW'))

/**
 * Holds tools the catalog marks `requiresApproval` — shell commands, workflow
 * runs, sandboxed code, deployments, integration calls — behind an explicit
 * Allow / Skip prompt, blocking the mothership turn until the user answers.
 *
 * Off by default: turning it on makes the copilot prompt on its most frequently
 * used tools, so it is an opt-in change in how the product feels, not just a
 * safety toggle. With it off nothing is stamped, gated, or persisted, and an
 * approval stamp arriving from Go is cleared on the way to the client.
 */
export const isCopilotToolPermissionsEnabled = isTruthy(env.COPILOT_TOOL_PERMISSIONS_ENABLED)

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
 * Destinations on a private network that outbound requests may reach, as raw
 * operator config. Empty on the hosted platform regardless of what is set, so a
 * tenant can never pivot into Sim's own network — mirroring {@link isAuthDisabled}.
 *
 * Read through a function rather than captured at module load so a changed value
 * is picked up, and parsed in `@sim/security/egress` rather than here: this file
 * is loaded by `next.config.ts` before the `@/` alias exists and must stay
 * dependency-light.
 */
export function getEgressAllowedHosts(): string | undefined {
  return isHosted ? undefined : env.EGRESS_ALLOWED_HOSTS
}

export function getEgressAllowedIpRanges(): string | undefined {
  return isHosted ? undefined : env.EGRESS_ALLOWED_IP_RANGES
}

/**
 * Whether the deprecated `ALLOW_PRIVATE_DATABASE_HOSTS` is set.
 *
 * It stood for a blanket "database and connector tools may reach anything
 * private", so it maps to a policy that vouches for every private address rather
 * than to a range list — a list would silently drop the ranges it never
 * enumerated, CGNAT (`100.64.0.0/10`, where Tailscale lives) among them.
 *
 * Scoped to database hosts, which is all the flag ever governed. Widening it to
 * HTTP destinations would hand every workflow author on an upgrading deployment
 * a route into the internal network they never granted.
 */
export function isLegacyPrivateDatabaseAccessAllowed(): boolean {
  return !isHosted && isTruthy(env.ALLOW_PRIVATE_DATABASE_HOSTS)
}

if (isTruthy(env.ALLOW_PRIVATE_DATABASE_HOSTS)) {
  import('@sim/logger')
    .then(({ createLogger }) => {
      const logger = createLogger('EnvFlags')
      if (isHosted) {
        logger.error(
          'ALLOW_PRIVATE_DATABASE_HOSTS is set but ignored on hosted environment. Private, reserved, and loopback destinations remain blocked for security.'
        )
      } else {
        logger.warn(
          'ALLOW_PRIVATE_DATABASE_HOSTS is deprecated. It opens the whole private address space to database and connector tools. Replace it with EGRESS_ALLOWED_HOSTS / EGRESS_ALLOWED_IP_RANGES naming only the destinations you need.'
        )
      }
    })
    .catch(() => {
      // Fallback during config compilation when logger is unavailable
    })
}

if (env.EGRESS_ALLOWED_HOSTS || env.EGRESS_ALLOWED_IP_RANGES) {
  import('@sim/logger')
    .then(({ createLogger }) => {
      const logger = createLogger('EnvFlags')
      if (isHosted) {
        logger.error(
          'EGRESS_ALLOWED_HOSTS/EGRESS_ALLOWED_IP_RANGES are set but ignored on hosted environment. Private, reserved, and loopback destinations remain blocked for security.'
        )
      } else {
        // The entries themselves are internal network topology and stay out of
        // the log line, which may leave the deployment.
        logger.warn(
          'Private-network egress allowlist is configured. Outbound requests may reach the listed destinations. Only use this on a trusted private network.'
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
 * Whether the deployment's Slack app is approved for `app_mentions:read`,
 * `assistant:write`, and `im:history` — the scopes backing the native Sim app
 * trigger's mention, assistant-thread, and DM events.
 *
 * Off by default because Slack rejects the ENTIRE authorization when it requests
 * a scope the app is not approved for, breaking every Slack connect. Sim Cloud's
 * app is directory-listed and pinned to its review-approved set, so this stays
 * off there until review lands; a self-hosted deployment pointing at its own
 * (unlisted) Slack app can opt in.
 *
 * Server code reads `SLACK_EXTENDED_SCOPES`. Server-only vars never reach browser
 * bundles, so client evaluation reads the `NEXT_PUBLIC_SLACK_EXTENDED_SCOPES`
 * twin (see {@link isBillingEnabled}) — deployments must set both together. The
 * server value decides the grant; the client value only decides what the credential
 * pickers advertise and treat as missing.
 */
export const isSlackExtendedScopesEnabled =
  typeof window === 'undefined'
    ? isTruthy(env.SLACK_EXTENDED_SCOPES)
    : isTruthy(getEnv('NEXT_PUBLIC_SLACK_EXTENDED_SCOPES'))

/**
 * Is Trigger.dev enabled for async job processing
 */
export const isTriggerDevEnabled = isTruthy(env.TRIGGER_DEV_ENABLED)

/**
 * Turns on the whole enterprise suite for a deployment that does not run
 * billing. Individual feature flags below still win where they are set, so an
 * operator can enable everything and then switch one feature back off.
 *
 * Server code reads `ENTERPRISE_ENABLED`; the browser reads the
 * `NEXT_PUBLIC_ENTERPRISE_ENABLED` twin (see {@link isBillingEnabled}).
 * Deployments must set both together.
 */
export const isEnterpriseEnabled =
  typeof window === 'undefined'
    ? isTruthy(env.ENTERPRISE_ENABLED)
    : isTruthy(getEnv('NEXT_PUBLIC_ENTERPRISE_ENABLED'))

/**
 * Reads a feature's own flag as a tri-state, picking the server var or its
 * browser twin for the current runtime. `undefined` means the operator left it
 * unset, which is what lets the master switch and legacy default apply.
 */
function explicitEnterpriseFlag(
  serverValue: boolean | string | undefined,
  clientKey: string
): boolean | undefined {
  return typeof window === 'undefined' ? envBoolean(serverValue) : envBoolean(getEnv(clientKey))
}

/**
 * Resolves one enterprise feature for this deployment.
 *
 * When billing runs, subscription plans decide entitlement and these flags are
 * only explicit overrides — so an unset flag stays `false` and never widens
 * access on Sim Cloud. When billing is off there is no plan to consult, so
 * resolution falls through the master switch to the feature's legacy default
 * (see {@link ENTERPRISE_FEATURE_LEGACY_DEFAULTS}).
 */
function enterpriseFeatureEnabled(
  feature: EnterpriseFeature,
  serverValue: boolean | string | undefined,
  clientKey: string
): boolean {
  const explicit = explicitEnterpriseFlag(serverValue, clientKey)
  if (isBillingEnabled) return explicit ?? false
  return resolveEnterpriseEntitlement({
    explicit,
    masterEnabled: isEnterpriseEnabled,
    legacyDefault: ENTERPRISE_FEATURE_LEGACY_DEFAULTS[feature],
  })
}

/**
 * Is SSO enabled for enterprise authentication
 */
export const isSsoEnabled = enterpriseFeatureEnabled(
  'sso',
  env.SSO_ENABLED,
  'NEXT_PUBLIC_SSO_ENABLED'
)

/**
 * Is SCIM directory provisioning enabled.
 *
 * Hosted deployments default on; an explicit false defers activation during a rolling deploy.
 * Gates the settings section, the admin API, and the provisioning endpoints
 * alike. A connection whose organization loses the entitlement stops
 * authenticating rather than continuing to accept directory writes.
 */
export const isScimEnabled = isHosted
  ? (explicitEnterpriseFlag(env.SCIM_ENABLED, 'NEXT_PUBLIC_SCIM_ENABLED') ?? true)
  : enterpriseFeatureEnabled('scim', env.SCIM_ENABLED, 'NEXT_PUBLIC_SCIM_ENABLED')

/**
 * Is organization usage monitoring enabled.
 *
 * Gates the settings section and the API that backs it, so nav and server always
 * answer the same question — a section visible but rejected (or reachable but
 * hidden) is exactly what this pairing exists to prevent.
 */
export const isUsageMonitoringEnabled = enterpriseFeatureEnabled(
  'usageMonitoring',
  env.USAGE_MONITORING_ENABLED,
  'NEXT_PUBLIC_USAGE_MONITORING_ENABLED'
)

/**
 * Is access control (permission groups) enabled.
 * Required for permission-group enforcement to run at all off-hosted.
 */
export const isAccessControlEnabled = enterpriseFeatureEnabled(
  'accessControl',
  env.ACCESS_CONTROL_ENABLED,
  'NEXT_PUBLIC_ACCESS_CONTROL_ENABLED'
)

/**
 * Is organizations enabled.
 * True if billing is enabled (orgs come with billing), OR resolved on for this
 * deployment, OR if access control is enabled (access control requires
 * organizations).
 *
 * Each term resolves through its `NEXT_PUBLIC_*` twin in the browser (see
 * {@link isBillingEnabled}), so client code — e.g. the better-auth
 * `organizationClient` plugin registration — sees the same value as the server.
 */
export const isOrganizationsEnabled =
  isBillingEnabled ||
  enterpriseFeatureEnabled(
    'organizations',
    env.ORGANIZATIONS_ENABLED,
    'NEXT_PUBLIC_ORGANIZATIONS_ENABLED'
  ) ||
  isAccessControlEnabled

/**
 * Is inbox (Sim Mailer) enabled
 */
export const isInboxEnabled = enterpriseFeatureEnabled(
  'inbox',
  env.INBOX_ENABLED,
  'NEXT_PUBLIC_INBOX_ENABLED'
)

/**
 * Whether deployment configuration entitles custom Function sandboxes.
 *
 * With billing enabled this is an explicit plan-gate override. Without billing,
 * either the Enterprise master switch or the Sandbox-specific server/client pair
 * enables the feature. Provider readiness is applied separately by
 * {@link isSandboxesEnabled} so entitlement can never advertise a missing runtime.
 */
export const isSandboxDeploymentEntitled = enterpriseFeatureEnabled(
  'sandboxes',
  env.SANDBOXES_ENABLED,
  'NEXT_PUBLIC_SANDBOXES_ENABLED'
)

/**
 * Is whitelabeling enabled
 */
export const isWhitelabelingEnabled = enterpriseFeatureEnabled(
  'whitelabeling',
  env.WHITELABELING_ENABLED,
  'NEXT_PUBLIC_WHITELABELING_ENABLED'
)

/**
 * Is audit log reading enabled.
 *
 * Off-hosted this replaces the enterprise-subscription check that audit access
 * used to require, which no billing-free deployment could ever satisfy.
 */
export const isAuditLogsEnabled = enterpriseFeatureEnabled(
  'auditLogs',
  env.AUDIT_LOGS_ENABLED,
  'NEXT_PUBLIC_AUDIT_LOGS_ENABLED'
)

export const isCustomBlocksEnabled = enterpriseFeatureEnabled(
  'customBlocks',
  env.CUSTOM_BLOCKS_ENABLED,
  'NEXT_PUBLIC_CUSTOM_BLOCKS_ENABLED'
)

/**
 * Is retention *deletion* enabled.
 *
 * Configuring retention has always been possible with billing off; this flag
 * governs whether the cleanup pass actually expires data. Opt-in on purpose —
 * see the note on `dataRetention` in {@link ENTERPRISE_FEATURE_LEGACY_DEFAULTS}.
 */
export const isDataRetentionEnabled = enterpriseFeatureEnabled(
  'dataRetention',
  env.DATA_RETENTION_ENABLED,
  'NEXT_PUBLIC_DATA_RETENTION_ENABLED'
)

/**
 * Is data drains enabled
 */
export const isDataDrainsEnabled = enterpriseFeatureEnabled(
  'dataDrains',
  env.DATA_DRAINS_ENABLED,
  'NEXT_PUBLIC_DATA_DRAINS_ENABLED'
)

/**
 * Are organization session policies enabled
 */
export const isSessionPoliciesEnabled = enterpriseFeatureEnabled(
  'sessionPolicies',
  env.SESSION_POLICIES_ENABLED,
  'NEXT_PUBLIC_SESSION_POLICIES_ENABLED'
)

/**
 * Is workspace forking enabled
 */
export const isForkingEnabled = enterpriseFeatureEnabled(
  'forking',
  env.FORKING_ENABLED,
  'NEXT_PUBLIC_FORKING_ENABLED'
)

/**
 * The selected remote sandbox provider (`SANDBOX_PROVIDER`), defaulting to E2B.
 * Availability below is derived from THIS provider's credentials, so a
 * Daytona-only deployment (E2B unset) still enables remote execution.
 */
const sandboxProvider = inspectCapability(SANDBOX_CAPABILITY, env).providerId

/**
 * Whether remote code/shell execution is available with the selected provider.
 *
 * Both providers require their credential and dedicated Function base. The old
 * Mothership shell template/snapshot names are intentionally not fallbacks: a
 * deployment must build and configure the Function-owned image before exposing
 * the runtime.
 *
 * The browser cannot inspect provider credentials, so
 * `NEXT_PUBLIC_SANDBOXES_ENABLED` is its readiness projection. Set the public
 * value only after this server-side check succeeds; `npx sim-setup doctor`
 * reports mismatches in either direction.
 */
export const isRemoteSandboxEnabled =
  sandboxProvider === 'daytona'
    ? hasEnvCapabilityValue(env, 'DAYTONA_API_KEY') &&
      Boolean(
        env.DAYTONA_FUNCTION_SNAPSHOT_ID &&
          isImmutableDaytonaSnapshotRef(env.DAYTONA_FUNCTION_SNAPSHOT_ID)
      )
    : sandboxProvider === 'e2b'
      ? isTruthy(env.E2B_ENABLED) &&
        hasEnvCapabilityValue(env, 'E2B_API_KEY') &&
        Boolean(
          env.E2B_FUNCTION_TEMPLATE_ID && isImmutableE2BTemplateRef(env.E2B_FUNCTION_TEMPLATE_ID)
        ) &&
        Boolean(
          env.E2B_FUNCTION_TEMPLATE_GENERATION &&
            isValidSandboxReleaseGeneration(env.E2B_FUNCTION_TEMPLATE_GENERATION)
        )
      : false

/**
 * Whether the complete custom-Sandbox feature is available on this deployment.
 *
 * Billing supplies hosted entitlement, while billing-free deployments require
 * the Enterprise pair or the Sandbox-specific pair. Both modes additionally
 * require a configured remote Function provider. The public flag projects that
 * provider readiness into the browser; the server always verifies credentials
 * and the immutable Function base directly.
 */
export const isSandboxesEnabled = resolveSandboxFeatureAvailability({
  billingEnabled: isBillingEnabled,
  deploymentEntitled: isSandboxDeploymentEntitled,
  remoteProviderEnabled:
    typeof window === 'undefined'
      ? isRemoteSandboxEnabled
      : isTruthy(getEnv('NEXT_PUBLIC_SANDBOXES_ENABLED')),
})

/**
 * Whether the selected provider can serve Mothership's own code image.
 * This is intentionally independent of {@link isRemoteSandboxEnabled}: the
 * Function and Mothership images have separate release and rollout lifecycles.
 */
export const isMothershipSandboxEnabled =
  sandboxProvider === 'daytona'
    ? hasEnvCapabilityValue(env, 'DAYTONA_API_KEY') &&
      hasEnvCapabilityValue(env, 'DAYTONA_SHELL_SNAPSHOT_ID')
    : sandboxProvider === 'e2b'
      ? isTruthy(env.E2B_ENABLED) &&
        hasEnvCapabilityValue(env, 'E2B_API_KEY') &&
        hasEnvCapabilityValue(env, 'MOTHERSHIP_E2B_TEMPLATE_ID')
      : false

/**
 * Whether the document-generation sandbox is available with the selected
 * provider — its credential AND its dedicated doc image (E2B doc template, or
 * Daytona doc snapshot).
 *
 * When true, ALL four formats compile in the doc sandbox: pptx/docx via Node
 * (pptxgenjs/docx + react-icons/sharp icons), pdf/xlsx via Python
 * (reportlab/openpyxl). When false, compilation stays on the JavaScript
 * (isolated-vm) path, byte-identical to its prior behavior (and xlsx is
 * unavailable). Drives both the Sim compile backend and the `docCompiler` flag
 * sent to the copilot file subagent so the agent's output and compiler agree.
 */
export const isDocSandboxEnabled =
  sandboxProvider === 'daytona'
    ? hasEnvCapabilityValue(env, 'DAYTONA_API_KEY') &&
      hasEnvCapabilityValue(env, 'DAYTONA_DOC_SNAPSHOT_ID')
    : sandboxProvider === 'e2b'
      ? isTruthy(env.E2B_ENABLED) &&
        hasEnvCapabilityValue(env, 'E2B_API_KEY') &&
        hasEnvCapabilityValue(env, 'MOTHERSHIP_E2B_DOC_TEMPLATE_ID')
      : false

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
 * Get cost multiplier based on environment.
 *
 * `COST_MULTIPLIER` is declared as a number but arrives as a string from
 * `process.env` because `createEnv` skips validation, so it is normalized
 * through {@link envNumber}. Unset, empty, non-numeric, and negative values
 * fall back to 1.
 */
export function getCostMultiplier(): number {
  return isProd ? envNumber(env.COST_MULTIPLIER, 1) : 1
}
