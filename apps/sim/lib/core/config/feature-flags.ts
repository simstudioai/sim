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
 * the global `enabled` default, the workspace/org/user allowlists, or
 * `adminEnabled` for platform admins. An absent clause never matches. Shape shared with the other
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
 * The single definition of a feature flag. Everything about a flag lives in one
 * place: its name (the registry key), a human-readable `description`, and the
 * `fallback` secret consulted when AppConfig isn't the source of truth (truthy ⇒ on
 * globally).
 *
 * Gating by workspace/org/user/admin is deliberately NOT part of a definition — it lives only
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
  'oauth-provider': {
    description:
      'Enable OAuth authorization, discovery, and API bearer tokens. Global on/off only; ' +
      'enable after all app instances support the OAuth token-family lifecycle.',
    fallback: 'OAUTH_PROVIDER_ENABLED',
  },
  'trigger-eu-region': {
    description:
      'Route Trigger.dev runs to eu-central-1 instead of the default us-east-1. Global on/off ' +
      'only — resolved without user/org context at every task-trigger call site via ' +
      'resolveTriggerRegion, so the whole deployment switches regions together.',
    fallback: 'TRIGGER_EU_REGION',
  },
  'tables-v2-api': {
    description:
      'Gate the internal predicate-grammar table query route (POST /api/table/[tableId]/query), ' +
      'its only caller. When off, that route returns 403 naming the gate (post-authz, so the ' +
      'masquerade 404 served nobody and broke the table_v2 block confusingly). Despite the ' +
      'name it does NOT gate any /api/v2/tables route. Gated by userId/orgId/admins via ' +
      'AppConfig; off-AppConfig falls back to TABLES_V2_API.',
    fallback: 'TABLES_V2_API',
  },
  'table-row-ttl': {
    description:
      'Enable TTL columns and the scheduled cleanup that removes expired table rows. ' +
      'Global on/off only; existing TTL data remains readable when disabled.',
    fallback: 'TABLE_ROW_TTL',
  },
  'credential-groups': {
    description:
      'Workspace-owned collections that gather managed OAuth credentials from external users. ' +
      'Gated by workspaceId via AppConfig (or globally); hosted workspaces must also have an ' +
      'Enterprise subscription. Off-AppConfig falls back to CREDENTIAL_GROUPS.',
    fallback: 'CREDENTIAL_GROUPS',
  },
  'knowledge-member-access': {
    description:
      'Permission-aware knowledge bases: lets a workspace admin sync a connector once per ' +
      'Credential Group member so each person sees only what their own account can read, and ' +
      'makes hybrid retrieval with a source-recency boost the default for searches in that ' +
      'workspace. Gated by workspaceId via AppConfig for members mode, which is judged by the ' +
      'workspace alone; the adminEnabled clause additionally opens the retrieval default to a ' +
      'platform admin anywhere. Off-AppConfig falls back to KNOWLEDGE_MEMBER_ACCESS. Requires ' +
      'the credential-groups flag for the connector side to do anything.',
    fallback: 'KNOWLEDGE_MEMBER_ACCESS',
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
 * The admin clause is resolved last and lazily: a global/userId/orgId/workspaceId
 * match short-circuits before any DB read, a rule without `adminEnabled` never queries,
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
