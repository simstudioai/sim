import { fetchAppConfigProfile } from '@/lib/core/config/appconfig'
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
 * the global `enabled` default, the org/user allowlists, or `admins` for platform
 * admins. An absent clause never matches.
 */
export interface FeatureFlagRule {
  enabled?: boolean
  orgIds?: string[]
  userIds?: string[]
  adminEnabled?: boolean
}

export type FeatureFlagsConfig = Record<string, FeatureFlagRule>

/**
 * Per-request evaluation context. Pass only the ids you have — a missing id skips
 * its clause. Admin status is resolved internally from `userId`; `isAdmin` is an
 * optional fast-path override for callers that already know it (e.g. admin routes).
 */
export interface FeatureFlagContext {
  userId?: string | null
  orgId?: string | null
  isAdmin?: boolean
}

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

function normalizeIds(values: unknown): string[] | undefined {
  if (!Array.isArray(values)) return undefined
  const ids = Array.from(new Set(values.map((v) => String(v).trim()).filter(Boolean)))
  return ids.length > 0 ? ids : undefined
}

function normalizeRule(value: unknown): FeatureFlagRule | null {
  if (!value || typeof value !== 'object') return null
  const obj = value as Record<string, unknown>
  const rule: FeatureFlagRule = {}
  if (typeof obj.enabled === 'boolean') rule.enabled = obj.enabled
  if (typeof obj.adminEnabled === 'boolean') rule.adminEnabled = obj.adminEnabled
  const orgIds = normalizeIds(obj.orgIds)
  if (orgIds) rule.orgIds = orgIds
  const userIds = normalizeIds(obj.userIds)
  if (userIds) rule.userIds = userIds
  return rule
}

/** Coerce an arbitrary AppConfig/JSON value into a config, dropping malformed entries. */
function parseConfig(json: unknown): FeatureFlagsConfig {
  const obj = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>
  const flags: FeatureFlagsConfig = {}
  for (const [name, value] of Object.entries(obj)) {
    const rule = normalizeRule(value)
    if (rule) flags[name] = rule
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
 * short-circuits before any DB read, a rule without `admins` never queries, and a
 * missing `userId` resolves to `false` without a query.
 */
async function evaluate(
  rule: FeatureFlagRule | undefined,
  ctx: FeatureFlagContext
): Promise<boolean> {
  if (!rule) return false
  if (rule.enabled) return true
  if (ctx.userId && rule.userIds?.includes(ctx.userId)) return true
  if (ctx.orgId && rule.orgIds?.includes(ctx.orgId)) return true
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
    parseConfig
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
