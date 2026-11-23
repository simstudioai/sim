/**
 * Loaded by `next.config.ts` before the `@/` alias is available, so
 * config-boundary dependencies use workspace packages or relative imports.
 */

import {
  ENTERPRISE_MASTER_ENV_VAR,
  type EnterpriseFeatureState,
  resolveEnterpriseFeatures,
} from '@sim/deployment-config/enterprise-features'
import {
  hasEnvCapabilityValue,
  inspectCapability,
  SANDBOX_CAPABILITY,
} from '@sim/deployment-config/env-capabilities'
import {
  getRegistrationPolicy,
  type RegistrationMode,
  resolveRegistrationMode,
} from '@sim/deployment-config/registration'
import {
  isImmutableDaytonaSnapshotRef,
  isImmutableE2BTemplateRef,
  isValidSandboxReleaseGeneration,
} from '@sim/utils/sandbox-references'
import { resolveCostMultiplier } from './cost-multiplier'
import {
  readProjectedEnterpriseFeatures,
  readProjectedRegistrationMode,
} from './deployment-projection'
import { env, envBoolean, envNumber, getEnv, isTruthy } from './env'

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
 * approval stamp arriving from the worker is cleared on the way to the client.
 *
 * The gate is a property of the lane, not only of the tool. Sim can hold a call
 * for a decision on the dispatch lane, where a streaming context and a decision
 * row exist. It cannot on the in-band route (`POST /api/copilot/tools/execute`),
 * which the mothership drives for background lanes, so that route refuses a
 * `requiresApproval` tool outright rather than running it ungated — see
 * `toolRequiresApprovalLane`. Any new execution lane has to answer the same
 * question before this flag is turned on.
 */
export const isCopilotToolPermissionsEnabled = isTruthy(env.COPILOT_TOOL_PERMISSIONS_ENABLED)

/** Deployment-only opt-in; authenticated resource permissions still apply. */
export const isMothershipBenchmarkEnabled = isTruthy(env.MOTHERSHIP_BENCHMARK_ENABLED)

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

if (isTruthy(env.ALLOW_PRIVATE_DATABASE_HOSTS)) {
  import('@sim/logger')
    .then(({ createLogger }) => {
      createLogger('EnvFlags').error(
        'ALLOW_PRIVATE_DATABASE_HOSTS was removed and has no effect; allow specific database hostnames with EGRESS_ALLOWED_HOSTS, or a database IP address (including IPv6) with a single-address EGRESS_ALLOWED_IP_RANGES entry'
      )
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

const resolvedRegistrationMode: RegistrationMode =
  typeof window === 'undefined'
    ? resolveServerRegistrationMode()
    : (readProjectedRegistrationMode() ?? 'open')

/**
 * Who may create an account and whether email/password and email OTP work at all
 * (`REGISTRATION_MODE`; see `@sim/deployment-config/registration` for the modes).
 *
 * The server resolves it from `REGISTRATION_MODE` and the deprecated variables it
 * replaces, failing closed, and enforces it in `@/lib/auth/auth`. The browser takes
 * the server's answer from the deployment-shape projection on `<html>`; a document
 * without one (a bare 404 or `global-error` shell) reads `open`, which only affects
 * which links render — the server still refuses.
 */
export function getRegistrationMode(): RegistrationMode {
  return resolvedRegistrationMode
}

function resolveServerRegistrationMode(): RegistrationMode {
  const { mode, warnings } = resolveRegistrationMode(getEnv)
  if (warnings.length > 0) {
    import('@sim/logger')
      .then(({ createLogger }) => {
        const logger = createLogger('EnvFlags')
        for (const warning of warnings) {
          const details = { ...warning.details, resolvedMode: mode }
          if (warning.code === 'invalid-mode') logger.error(warning.message, details)
          else logger.warn(warning.message, details)
        }
      })
      .catch(() => {
        // Fallback during config compilation when logger is unavailable
      })
  }
  return mode
}

const registrationPolicy = getRegistrationPolicy(resolvedRegistrationMode)

/**
 * No self-serve account creation by any method, social included (`closed`,
 * `closed-no-email`). Sign-in keeps working; SSO just-in-time provisioning and
 * SCIM still create users.
 */
export const isSelfServeRegistrationClosed = registrationPolicy.selfServeRegistrationClosed

/** New accounts may sign up with email/password or email OTP (`open` only). */
export const isEmailSignupAllowed = registrationPolicy.emailSignupAllowed

/**
 * Email/password and email OTP work at all, for sign-in as well as signup (every
 * mode except `no-email` and `closed-no-email`).
 */
export const isEmailPasswordAuthEnabled = registrationPolicy.emailPasswordAuthEnabled

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
 * Every enterprise feature, resolved once for this runtime.
 *
 * The server resolves the registry in `@sim/deployment-config/enterprise-features`
 * against its own environment: each feature is one server variable, plus the
 * `ENTERPRISE_ENABLED` master switch. With billing on, plans decide entitlement and
 * an unset flag stays off; with billing off, an unset flag falls through the master
 * switch to the feature's documented self-hosted default.
 *
 * The browser never reads those variables. It takes the server's answer from the
 * deployment-shape projection on `<html>` (`./deployment-projection`), present from
 * the first byte the browser parses, so module-scope reads such as the better-auth
 * client's plugin list agree with the server. A document without the projection (a
 * bare 404 or `global-error` shell) falls back to the registry's defaults with
 * nothing configured.
 */
const enterpriseFeatures: EnterpriseFeatureState =
  typeof window === 'undefined'
    ? resolveEnterpriseFeatures({
        readFlag: (envVar) => envBoolean(getEnv(envVar)),
        billingEnabled: isBillingEnabled,
        hosted: isHosted,
        masterEnabled: isTruthy(getEnv(ENTERPRISE_MASTER_ENV_VAR)),
      })
    : resolveBrowserEnterpriseFeatures()

function resolveBrowserEnterpriseFeatures(): EnterpriseFeatureState {
  const defaults = resolveEnterpriseFeatures({
    readFlag: () => undefined,
    billingEnabled: isBillingEnabled,
    hosted: isHosted,
    masterEnabled: false,
  })
  return readProjectedEnterpriseFeatures(defaults)
}

/**
 * Is SSO enabled for enterprise authentication
 */
export const isSsoEnabled = enterpriseFeatures.sso

/**
 * Is SCIM directory provisioning enabled.
 *
 * Hosted deployments default on; an explicit false defers activation during a rolling deploy.
 * Gates the settings section, the admin API, and the provisioning endpoints
 * alike. A connection whose organization loses the entitlement stops
 * authenticating rather than continuing to accept directory writes.
 */
export const isScimEnabled = enterpriseFeatures.scim

/**
 * Is organization usage monitoring enabled.
 *
 * Gates the settings section and the API that backs it, so nav and server always
 * answer the same question — a section visible but rejected (or reachable but
 * hidden) is exactly what this pairing exists to prevent.
 */
export const isUsageMonitoringEnabled = enterpriseFeatures.usageMonitoring

/**
 * Is access control (permission groups) enabled.
 * Required for permission-group enforcement to run at all off-hosted.
 */
export const isAccessControlEnabled = enterpriseFeatures.accessControl

/**
 * Is organizations enabled: always with billing (orgs come with billing), when
 * configured on, and whenever access control is on (access control requires
 * organizations).
 */
export const isOrganizationsEnabled = enterpriseFeatures.organizations

/**
 * Is inbox (Sim Mailer) enabled. On by default without billing; usable only with
 * `COPILOT_API_KEY`, which the inbox gates check separately.
 */
export const isInboxEnabled = enterpriseFeatures.inbox

/**
 * Whether deployment configuration entitles custom Function sandboxes.
 *
 * With billing enabled this is an explicit plan-gate override. Without billing,
 * either the Enterprise master switch or `SANDBOXES_ENABLED` enables it. Provider
 * readiness is applied separately by {@link isSandboxesEnabled} so entitlement can
 * never advertise a missing runtime. Server-only in meaning: the browser's
 * projection carries the combined availability, not the entitlement alone.
 */
export const isSandboxDeploymentEntitled = enterpriseFeatures.sandboxes

/**
 * Is audit log reading enabled.
 *
 * Off-hosted this replaces the enterprise-subscription check that audit access
 * used to require, which no billing-free deployment could ever satisfy.
 */
export const isAuditLogsEnabled = enterpriseFeatures.auditLogs

export const isCustomBlocksEnabled = enterpriseFeatures.customBlocks

/**
 * Is retention *deletion* enabled.
 *
 * Configuring retention has always been possible with billing off; this flag
 * governs whether the cleanup pass actually expires data. Opt-in on purpose —
 * see the note on `dataRetention` in the enterprise feature registry.
 */
export const isDataRetentionEnabled = enterpriseFeatures.dataRetention

/**
 * Is data drains enabled
 */
export const isDataDrainsEnabled = enterpriseFeatures.dataDrains

/**
 * Are organization session policies enabled
 */
export const isSessionPoliciesEnabled = enterpriseFeatures.sessionPolicies

/**
 * Are Credential Groups (managed connected accounts) enabled on a deployment
 * without billing.
 */
export const isCredentialGroupsEnabled = enterpriseFeatures.credentialGroups

/**
 * Is workspace forking enabled
 */
export const isForkingEnabled = enterpriseFeatures.forking

/**
 * The selected remote sandbox provider (`SANDBOX_PROVIDER`), defaulting to E2B.
 * Availability below is derived from THIS provider's credentials, so a
 * Daytona-only deployment (E2B unset) still enables remote execution.
 */
const sandboxProvider = inspectCapability(SANDBOX_CAPABILITY, env).providerId

/**
 * Whether remote code/shell execution is available with the selected provider.
 * Server-only: the browser cannot inspect provider credentials, and reads the
 * combined Sandbox availability from the deployment-shape projection instead.
 *
 * Both providers require their credential and dedicated Function base. The old
 * Mothership shell template/snapshot names are intentionally not fallbacks: a
 * deployment must build and configure the Function-owned image before exposing
 * the runtime.
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
 * `ENTERPRISE_ENABLED` or `SANDBOXES_ENABLED`. Both modes additionally require a
 * configured remote Function provider. The server verifies credentials and the
 * immutable Function base directly; the browser reads the server's combined
 * answer, which is the deployment shape's `sandboxes` feature.
 */
export const isSandboxesEnabled =
  typeof window === 'undefined'
    ? isRemoteSandboxEnabled && (isBillingEnabled || isSandboxDeploymentEntitled)
    : enterpriseFeatures.sandboxes

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
  return resolveCostMultiplier(env.COST_MULTIPLIER, isProd)
}
