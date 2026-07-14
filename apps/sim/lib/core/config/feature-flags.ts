import { fetchAppConfigProfile } from '@/lib/core/config/appconfig'
import type { AppConfigGateContext, AppConfigGateRule } from '@/lib/core/config/appconfig-rules'
import { matchesRule, parseGateConfig } from '@/lib/core/config/appconfig-rules'
import { env, isTruthy } from '@/lib/core/config/env'
import { isAppConfigEnabled } from '@/lib/core/config/env-flags'

/**
 * Name of the AppConfig configuration profile holding the gated feature flags.
 * Cross-repo contract: must match the `CfnConfigurationProfile` name created by
 * the infra stack.
 */
const FEATURE_FLAGS_PROFILE = 'feature-flags'

/**
 * A single flag's gating rule. A flag is ON for a context when ANY clause matches:
 * the global `enabled` default, the org/user allowlists, or `adminEnabled` for
 * platform admins. An absent clause never matches. Shape shared with the other
 * AppConfig gating documents via {@link AppConfigGateRule}.
 */
export type FeatureFlagRule = AppConfigGateRule

export type FeatureFlagsConfig = Record<string, FeatureFlagRule>

/**
 * Per-request evaluation context. Pass only the ids you have — a missing id skips
 * its clause. Admin status is resolved internally from `userId`; `isAdmin` is an
 * optional fast-path override for callers that already know it (e.g. admin routes).
 */
export type FeatureFlagContext = AppConfigGateContext

/**
 * Registry of known feature flags. Each maps to the secret consulted ONLY when
 * AppConfig is not the source of truth (self-hosted/OSS, local dev, or hosted
 * without APPCONFIG_*). A truthy secret turns the flag on globally.
 *
 * Gating by org/user/admin is available ONLY through the hosted AppConfig document
 * — it deliberately cannot be expressed here, so no environment can grant (e.g.)
 * admin access from a code literal. To add a flag, register its name and the secret
 * to fall back on.
 */
/**
 * The single definition of a feature flag. Everything about a flag lives in one
 * place: its name (the registry key), a human-readable `description`, and the
 * `fallback` secret consulted when AppConfig isn't the source of truth (truthy ⇒ on
 * globally).
 *
 * Gating by org/user/admin is deliberately NOT part of a definition — it lives only
 * in the hosted AppConfig document, so no environment can grant access from a code
 * literal.
 */
interface FeatureFlagDefinition {
  description: string
  /** Env/secret key consulted when AppConfig isn't the source of truth. Truthy ⇒ on. */
  fallback: keyof typeof env
}

/** The single registry of known flags. To add a flag, add one entry here. */
const FEATURE_FLAGS = {
  'mothership-beta': {
    description:
      'Mothership beta plan/changelog artifact surfaces in the copilot VFS and doc compiler. ' +
      'Note: userId/orgId targeting only works for WorkspaceVfs (resolved in materialize). ' +
      'getE2BDocFormat, resolveInputFiles, and resolveWorkflowAliasForWorkspace evaluate without ' +
      'user context — use enabled:true for global rollout rather than per-user targeting.',
    fallback: 'MOTHERSHIP_BETA_FEATURES',
  },
  'mothership-subagent-narration': {
    description:
      'Stream and render free-form assistant narration from Mothership subagents such as ' +
      'Workflow Agent. Disabled by default so only subagent lifecycle and tool activity are shown.',
    fallback: 'MOTHERSHIP_SUBAGENT_NARRATION',
  },
  'table-snapshot-cache': {
    description:
      'Mount Sim tables into code sandboxes by reference via a version-keyed CSV snapshot in ' +
      'object storage (reused across runs until the table mutates) instead of draining the whole ' +
      'table into web-process heap. resolveInputFiles evaluates without user context — use ' +
      'enabled:true for global rollout rather than per-user targeting.',
    fallback: 'TABLE_SNAPSHOT_CACHE',
  },
  'pii-redaction': {
    description:
      'Redact PII from workflow logs via configurable Data Retention rules (Presidio at the ' +
      'logger persist choke point) and expose the Data Retention config surfaces. Global on/off ' +
      'only — evaluated without user/org context so the persist path and config routes always ' +
      'agree.',
    fallback: 'PII_REDACTION',
  },
  'pii-granular-redaction': {
    description:
      'Expose the execution-altering PII redaction stages (redact the workflow input and every ' +
      'block output in-flight) in the Data Retention config, layered on top of pii-redaction. ' +
      'Global on/off only — gates the config surfaces (route write + UI). Because stored rules ' +
      'are the source of truth for the executor, a granular stage can only run once it was ' +
      'writable, so the executor is never flag-gated at runtime (avoiding a fail-open leak).',
    fallback: 'PII_GRANULAR_REDACTION',
  },
  'trigger-eu-region': {
    description:
      'Route Trigger.dev runs to eu-central-1 instead of the default us-east-1. Global on/off ' +
      'only — resolved without user/org context at every task-trigger call site via ' +
      'resolveTriggerRegion, so the whole deployment switches regions together.',
    fallback: 'TRIGGER_EU_REGION',
  },
  'workspace-forking': {
    description:
      'Runtime rollout gate for workspace forking (fork/promote/rollback), layered on top of ' +
      'the existing FORKING_ENABLED / Enterprise-plan gate at the shared assertForkingEnabled ' +
      'choke point. Enforced ONLY where AppConfig is the source of truth (Sim Cloud), so ' +
      'operators can dark-launch forking to specific orgs/users/admins without touching ' +
      'self-hosted/local behaviour. Fallback mirrors FORKING_ENABLED for off-AppConfig reads.',
    fallback: 'FORKING_ENABLED',
  },
  'deploy-as-block': {
    description:
      'Publish a deployed workflow as a reusable, org-wide custom block (custom name/SVG icon/' +
      'description; Start inputs become block inputs). Gates the Deploy-modal "Block" tab and the ' +
      'custom-block publish/list routes. Off-AppConfig falls back to DEPLOY_AS_BLOCK.',
    fallback: 'DEPLOY_AS_BLOCK',
  },
} satisfies Record<string, FeatureFlagDefinition>

/**
 * The closed set of known feature flags. Derived from the registry, so a flag
 * cannot exist — or be checked — without a definition (and its mandatory fallback).
 */
export type FeatureFlagName = keyof typeof FEATURE_FLAGS

/** Build the fallback document from each flag's secret. Truthy secret ⇒ enabled. */
function fallbackFlags(): FeatureFlagsConfig {
  const flags: FeatureFlagsConfig = {}
  for (const [name, def] of Object.entries(FEATURE_FLAGS) as Array<
    [string, FeatureFlagDefinition]
  >) {
    flags[name] = { enabled: isTruthy(env[def.fallback]) }
  }
  return flags
}

/**
 * Resolve platform-admin status lazily. Dynamically imported so the DB-backed
 * helper (and `@sim/db`) stay out of this config module's load graph for callers
 * that never reach an admin-gated flag.
 */
async function resolveAdmin(userId: string): Promise<boolean> {
  const { isPlatformAdmin } = await import('@/lib/permissions/super-user')
  return isPlatformAdmin(userId)
}

/**
 * The admin clause is resolved last and lazily: a global/userId/orgId match
 * short-circuits before any DB read, a rule without `adminEnabled` never queries,
 * and a missing `userId` resolves to `false` without a query.
 */
async function evaluate(
  rule: FeatureFlagRule | undefined,
  ctx: FeatureFlagContext
): Promise<boolean> {
  if (!rule) return false
  if (matchesRule(rule, ctx, false)) return true
  if (rule.adminEnabled) {
    const admin = ctx.isAdmin ?? (ctx.userId ? await resolveAdmin(ctx.userId) : false)
    if (admin) return true
  }
  return false
}

/**
 * Resolve the full flag document. Reads from AWS AppConfig on hosted deployments
 * (cached, ~30s TTL, never blocks after the first fetch), otherwise derives each
 * flag's on/off state from its registered fallback secret ({@link fallbackFlags}).
 */
export async function getFeatureFlags(): Promise<FeatureFlagsConfig> {
  if (!isAppConfigEnabled) return fallbackFlags()

  const value = await fetchAppConfigProfile(
    {
      application: env.APPCONFIG_APPLICATION as string,
      environment: env.APPCONFIG_ENVIRONMENT as string,
      profile: FEATURE_FLAGS_PROFILE,
    },
    parseGateConfig
  )

  return value ?? fallbackFlags()
}

/** Resolve a single flag for a context. Admin status is resolved internally from `userId`. */
export async function isFeatureEnabled(
  flag: FeatureFlagName,
  ctx: FeatureFlagContext = {}
): Promise<boolean> {
  const flags = await getFeatureFlags()
  return evaluate(flags[flag], ctx)
}
