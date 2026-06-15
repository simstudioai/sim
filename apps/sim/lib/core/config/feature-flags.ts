import { fetchAppConfigProfile } from '@/lib/core/config/appconfig'
import { env } from '@/lib/core/config/env'
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
  admins?: boolean
}

export interface FeatureFlagsConfig {
  flags: Record<string, FeatureFlagRule>
}

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
 * Fallback flags used when AppConfig is not the source of truth (self-hosted/OSS,
 * local dev, or hosted without APPCONFIG_*). When AppConfig is enabled it fully
 * replaces this. Add/edit defaults here.
 */
const DEFAULT_FEATURE_FLAGS: FeatureFlagsConfig = {
  flags: {
    // e.g. 'new-canvas': { admins: true },
    // e.g. 'beta-export': { orgIds: ['org_123'], userIds: ['user_abc'] },
  },
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
  if (typeof obj.admins === 'boolean') rule.admins = obj.admins
  const orgIds = normalizeIds(obj.orgIds)
  if (orgIds) rule.orgIds = orgIds
  const userIds = normalizeIds(obj.userIds)
  if (userIds) rule.userIds = userIds
  return rule
}

/** Coerce an arbitrary AppConfig/JSON value into a config, dropping malformed entries. */
function parseConfig(json: unknown): FeatureFlagsConfig {
  const obj = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>
  const rawFlags = (obj.flags && typeof obj.flags === 'object' ? obj.flags : {}) as Record<
    string,
    unknown
  >
  const flags: Record<string, FeatureFlagRule> = {}
  for (const [name, value] of Object.entries(rawFlags)) {
    const rule = normalizeRule(value)
    if (rule) flags[name] = rule
  }
  return { flags }
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
  if (rule.admins) {
    const admin = ctx.isAdmin ?? (ctx.userId ? await resolveAdmin(ctx.userId) : false)
    if (admin) return true
  }
  return false
}

/**
 * Resolve the full flag document. Reads from AWS AppConfig on hosted deployments
 * (cached, ~30s TTL, never blocks after the first fetch), otherwise returns the
 * in-file {@link DEFAULT_FEATURE_FLAGS}.
 */
export async function getFeatureFlags(): Promise<FeatureFlagsConfig> {
  if (!isAppConfigEnabled) return DEFAULT_FEATURE_FLAGS

  const value = await fetchAppConfigProfile(
    {
      application: env.APPCONFIG_APPLICATION as string,
      environment: env.APPCONFIG_ENVIRONMENT as string,
      profile: FEATURE_FLAGS_PROFILE,
    },
    parseConfig
  )

  return value ?? DEFAULT_FEATURE_FLAGS
}

/** Resolve a single flag for a context. Admin status is resolved internally from `userId`. */
export async function isFeatureEnabled(
  flag: string,
  ctx: FeatureFlagContext = {}
): Promise<boolean> {
  const { flags } = await getFeatureFlags()
  return evaluate(flags[flag], ctx)
}
