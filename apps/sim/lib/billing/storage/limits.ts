/**
 * Storage limit management
 * Similar to cost limits but for file storage quotas
 */

import { db } from '@sim/db'
import {
  DEFAULT_ENTERPRISE_STORAGE_LIMIT_GB,
  DEFAULT_FREE_STORAGE_LIMIT_GB,
  DEFAULT_PRO_STORAGE_LIMIT_GB,
  DEFAULT_TEAM_STORAGE_LIMIT_GB,
} from '@sim/db/constants'
import { organization, userStats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { isRecordLike } from '@sim/utils/object'
import { eq } from 'drizzle-orm'
import type { HighestPrioritySubscription } from '@/lib/billing/core/plan'
import type { BillingEntity } from '@/lib/billing/core/usage-log'
import { getPlanTypeForLimits, isEnterprise, isFree } from '@/lib/billing/plan-helpers'
import type { StorageBillingContext } from '@/lib/billing/storage/context'
import { getLegacyStorageBillingEntity } from '@/lib/billing/storage/entity'
import { getEnv } from '@/lib/core/config/env'
import { isBillingEnabled } from '@/lib/core/config/env-flags'

const logger = createLogger('StorageLimits')

type StorageLimits = ReturnType<typeof getStorageLimits>

interface StorageLimitResolutionInput {
  plan: string | null
  scope: BillingEntity['type']
  customStorageLimitGB: number | null
  limits: StorageLimits
}

interface StorageQuotaSnapshot {
  currentUsage: number
  limit: number
}

interface StorageQuotaResult extends StorageQuotaSnapshot {
  allowed: boolean
  error?: string
}

type SubscriptionErrorBehavior = 'return-null' | 'throw'

/**
 * Resolves the highest-priority subscription via a deferred import to avoid a
 * static cycle.
 */
async function resolveSub(
  userId: string,
  onError: SubscriptionErrorBehavior = 'return-null'
): Promise<HighestPrioritySubscription | null> {
  const { getHighestPrioritySubscription } = await import('@/lib/billing/core/subscription')
  return getHighestPrioritySubscription(userId, { onError })
}

/**
 * Convert GB to bytes
 */
function gbToBytes(gb: number): number {
  return gb * 1024 * 1024 * 1024
}

/**
 * Normalizes a positive finite custom storage limit.
 */
function normalizeCustomStorageLimitGB(value: unknown): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number(value)
        : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

/**
 * Reads the organization subscription metadata key used by pooled storage.
 */
function readCustomStorageLimitGB(metadata: unknown): number | null {
  return isRecordLike(metadata)
    ? normalizeCustomStorageLimitGB(metadata.customStorageLimitGB)
    : null
}

/**
 * Resolves a storage cap solely from normalized plan, scope, custom-limit, and
 * configured-limit inputs. Paid plans bucket by tier via
 * `getPlanTypeForLimits`; an organization's subscription metadata override
 * takes precedence over its tier default.
 */
function resolveStorageLimit({
  plan,
  scope,
  customStorageLimitGB,
  limits,
}: StorageLimitResolutionInput): number {
  if (!plan || isFree(plan)) return limits.free

  if (scope === 'organization' && customStorageLimitGB !== null) {
    return gbToBytes(customStorageLimitGB)
  }
  if (isEnterprise(plan)) return limits.enterpriseDefault

  const effectivePlan = getPlanTypeForLimits(plan)
  if (effectivePlan === 'pro') return limits.pro
  if (effectivePlan === 'team') return limits.team
  return limits.free
}

/**
 * Normalizes a legacy subscription into the shared limit resolver input.
 */
function resolveLegacyStorageLimit(
  subscription: HighestPrioritySubscription | null,
  billingEntity: Readonly<BillingEntity>
): number {
  return resolveStorageLimit({
    plan: subscription?.plan ?? null,
    scope: billingEntity.type,
    customStorageLimitGB:
      billingEntity.type === 'organization'
        ? readCustomStorageLimitGB(subscription?.metadata)
        : null,
    limits: getStorageLimits(),
  })
}

/**
 * Evaluates quota behavior from resolved values without performing I/O.
 */
function evaluateStorageQuota(
  enforced: boolean,
  additionalBytes: number,
  snapshot: StorageQuotaSnapshot | null
): StorageQuotaResult {
  if (!enforced) {
    return {
      allowed: true,
      currentUsage: 0,
      limit: Number.MAX_SAFE_INTEGER,
    }
  }

  if (!snapshot) {
    return {
      allowed: false,
      currentUsage: 0,
      limit: 0,
      error: 'Failed to check storage quota',
    }
  }

  const newUsage = snapshot.currentUsage + additionalBytes
  const allowed = newUsage <= snapshot.limit
  return {
    allowed,
    currentUsage: snapshot.currentUsage,
    limit: snapshot.limit,
    error: allowed
      ? undefined
      : `Storage limit exceeded. Used: ${(newUsage / 1024 ** 3).toFixed(2)}GB, Limit: ${(snapshot.limit / 1024 ** 3).toFixed(0)}GB`,
  }
}

/**
 * Whether storage quotas are enforced. Always on when billing is enabled;
 * with billing disabled, enforcement is opt-in by explicitly setting
 * `FREE_STORAGE_LIMIT_GB` (all accounts resolve to the free tier there).
 */
export function isStorageEnforcementEnabled(): boolean {
  if (isBillingEnabled) return true
  const explicit = getEnv('FREE_STORAGE_LIMIT_GB')
  return explicit != null && explicit !== '' && Number.parseInt(explicit) > 0
}

/**
 * Get storage limits from environment variables with fallback to constants
 * Returns limits in bytes
 */
export function getStorageLimits() {
  return {
    free: gbToBytes(
      Number.parseInt(getEnv('FREE_STORAGE_LIMIT_GB') || String(DEFAULT_FREE_STORAGE_LIMIT_GB))
    ),
    pro: gbToBytes(
      Number.parseInt(getEnv('PRO_STORAGE_LIMIT_GB') || String(DEFAULT_PRO_STORAGE_LIMIT_GB))
    ),
    team: gbToBytes(
      Number.parseInt(getEnv('TEAM_STORAGE_LIMIT_GB') || String(DEFAULT_TEAM_STORAGE_LIMIT_GB))
    ),
    enterpriseDefault: gbToBytes(
      Number.parseInt(
        getEnv('ENTERPRISE_STORAGE_LIMIT_GB') || String(DEFAULT_ENTERPRISE_STORAGE_LIMIT_GB)
      )
    ),
  }
}

/**
 * Gets the storage limit for an immutable workspace payer without resolving an
 * actor subscription.
 */
export function getStorageLimitForBillingContext(context: StorageBillingContext): number {
  return resolveStorageLimit({
    plan: context.plan,
    scope: context.billingEntity.type,
    customStorageLimitGB: context.customStorageLimitGB || null,
    limits: getStorageLimits(),
  })
}

/**
 * Get storage limit for a user based on their subscription. Returns limit in
 * bytes.
 *
 * @param prefetchedSub - Pass an already-resolved subscription (may be `null`)
 *   to skip the `getHighestPrioritySubscription` lookup on hot paths. Omit
 *   (leave `undefined`) to fetch it here.
 */
export async function getUserStorageLimit(
  userId: string,
  prefetchedSub?: HighestPrioritySubscription | null
): Promise<number> {
  try {
    const sub = prefetchedSub === undefined ? await resolveSub(userId) : prefetchedSub
    const billingEntity = getLegacyStorageBillingEntity(userId, sub)
    return resolveLegacyStorageLimit(sub, billingEntity)
  } catch (error) {
    logger.error('Error getting user storage limit:', error)
    return getStorageLimits().free
  }
}

/**
 * Reads one user or organization storage counter.
 */
async function readStorageUsageForEntity(billingEntity: Readonly<BillingEntity>): Promise<number> {
  if (billingEntity.type === 'organization') {
    const [record] = await db
      .select({ storageUsedBytes: organization.storageUsedBytes })
      .from(organization)
      .where(eq(organization.id, billingEntity.id))
      .limit(1)
    return record?.storageUsedBytes ?? 0
  }

  const [record] = await db
    .select({ storageUsedBytes: userStats.storageUsedBytes })
    .from(userStats)
    .where(eq(userStats.userId, billingEntity.id))
    .limit(1)
  return record?.storageUsedBytes ?? 0
}

/**
 * Get current storage usage for a user. Returns usage in bytes.
 *
 * @param prefetchedSub - Pass an already-resolved subscription (may be `null`)
 *   to skip the `getHighestPrioritySubscription` lookup on hot paths.
 */
export async function getUserStorageUsage(
  userId: string,
  prefetchedSub?: HighestPrioritySubscription | null
): Promise<number> {
  try {
    const sub = prefetchedSub === undefined ? await resolveSub(userId) : prefetchedSub
    return await readStorageUsageForEntity(getLegacyStorageBillingEntity(userId, sub))
  } catch (error) {
    logger.error('Error getting user storage usage:', error)
    return 0
  }
}

/**
 * Reads the exact workspace payer's storage counter.
 */
export async function getStorageUsageForBillingContext(
  context: StorageBillingContext
): Promise<number> {
  try {
    return await readStorageUsageForEntity(context.billingEntity)
  } catch (error) {
    logger.error('Error getting workspace payer storage usage:', error)
    return 0
  }
}

/**
 * Resolves the legacy user/subscription quota snapshot once.
 */
async function resolveUserStorageQuota(userId: string): Promise<StorageQuotaSnapshot> {
  const sub = await resolveSub(userId, 'throw')
  const billingEntity = getLegacyStorageBillingEntity(userId, sub)
  return {
    currentUsage: await readStorageUsageForEntity(billingEntity),
    limit: resolveLegacyStorageLimit(sub, billingEntity),
  }
}

/**
 * Resolves an immutable workspace payer quota snapshot.
 */
async function resolveBillingContextStorageQuota(
  context: StorageBillingContext
): Promise<StorageQuotaSnapshot> {
  return {
    currentUsage: await readStorageUsageForEntity(context.billingEntity),
    limit: getStorageLimitForBillingContext(context),
  }
}

/**
 * Applies shared quota behavior around a context-specific resolver.
 */
async function checkStorageQuotaWithResolver(
  additionalBytes: number,
  resolveSnapshot: () => Promise<StorageQuotaSnapshot>,
  logResolutionError: (error: unknown) => void
): Promise<StorageQuotaResult> {
  if (!isStorageEnforcementEnabled()) {
    return evaluateStorageQuota(false, additionalBytes, null)
  }

  try {
    return evaluateStorageQuota(true, additionalBytes, await resolveSnapshot())
  } catch (error) {
    logResolutionError(error)
    return evaluateStorageQuota(true, additionalBytes, null)
  }
}

/**
 * Check if user has storage quota available.
 * Billing-disabled deployments allow all uploads unless the operator
 * explicitly opted into enforcement via `FREE_STORAGE_LIMIT_GB`.
 */
export async function checkStorageQuota(
  userId: string,
  additionalBytes: number
): Promise<StorageQuotaResult> {
  return checkStorageQuotaWithResolver(
    additionalBytes,
    () => resolveUserStorageQuota(userId),
    (error) => logger.error('Error checking storage quota:', error)
  )
}

/**
 * Checks storage quota against a workspace-selected immutable payer.
 */
export async function checkStorageQuotaForBillingContext(
  context: StorageBillingContext,
  additionalBytes: number
): Promise<StorageQuotaResult> {
  return checkStorageQuotaWithResolver(
    additionalBytes,
    () => resolveBillingContextStorageQuota(context),
    (error) => logger.error('Error checking workspace payer storage quota:', error)
  )
}
