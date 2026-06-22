import { db } from '@sim/db'
import { member, organization, settings, user, userStats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { isOrgAdminRole } from '@sim/platform-authz/workspace'
import { and, eq, sql } from 'drizzle-orm'
import { getLimitEmailSubject, renderLimitThresholdEmail } from '@/components/emails/render'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { isOrgScopedSubscription } from '@/lib/billing/subscriptions/utils'
import { buildUpgradeHref, type UpgradeReason } from '@/lib/billing/upgrade-reasons'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { sendEmail } from '@/lib/messaging/email/mailer'
import { getEmailPreferences } from '@/lib/messaging/email/unsubscribe'

const logger = createLogger('LimitNotifications')

/** Limit categories that send per-category threshold emails (credits has its own path). */
export type LimitCategory = Extract<UpgradeReason, 'storage' | 'tables' | 'seats'>

const WARN_THRESHOLD = 80
const REACH_THRESHOLD = 100
/** Usage must drop below this band before the same threshold can re-notify (hysteresis). */
const REARM_BELOW = 70

/**
 * Resolve the threshold a given usage percent should be notified at:
 * 100 at/over the limit, 80 when approaching, 0 otherwise.
 */
function thresholdFor(percent: number): 0 | 80 | 100 {
  if (percent >= REACH_THRESHOLD) return REACH_THRESHOLD
  if (percent >= WARN_THRESHOLD) return WARN_THRESHOLD
  return 0
}

/**
 * Atomically claim a threshold for a category: advance the stored value to
 * `threshold` only if it is currently lower, returning whether THIS call won the
 * advance. A single conditional UPDATE is race-free — concurrent crossings can't
 * both claim, so the email is sent exactly once per crossing.
 */
async function claimThreshold(
  scope: 'user' | 'organization',
  id: string,
  category: LimitCategory,
  threshold: number
): Promise<boolean> {
  const setExpr = sql`jsonb_set(coalesce(${scope === 'user' ? userStats.limitNotifications : organization.limitNotifications}, '{}'::jsonb), ARRAY[${category}], to_jsonb(${threshold}::int))`
  const onlyIfLower =
    scope === 'user'
      ? sql`coalesce((${userStats.limitNotifications} ->> ${category})::int, 0) < ${threshold}`
      : sql`coalesce((${organization.limitNotifications} ->> ${category})::int, 0) < ${threshold}`

  const claimed =
    scope === 'user'
      ? await db
          .update(userStats)
          .set({ limitNotifications: setExpr })
          .where(and(eq(userStats.userId, id), onlyIfLower))
          .returning({ id: userStats.userId })
      : await db
          .update(organization)
          .set({ limitNotifications: setExpr })
          .where(and(eq(organization.id, id), onlyIfLower))
          .returning({ id: organization.id })

  return claimed.length > 0
}

/** Re-arm a category (reset its stored threshold to 0) once usage falls back into the low band. */
async function rearmThreshold(
  scope: 'user' | 'organization',
  id: string,
  category: LimitCategory
): Promise<void> {
  const setExpr = sql`jsonb_set(coalesce(${scope === 'user' ? userStats.limitNotifications : organization.limitNotifications}, '{}'::jsonb), ARRAY[${category}], to_jsonb(0))`
  const onlyIfArmed =
    scope === 'user'
      ? sql`coalesce((${userStats.limitNotifications} ->> ${category})::int, 0) > 0`
      : sql`coalesce((${organization.limitNotifications} ->> ${category})::int, 0) > 0`

  if (scope === 'user') {
    await db
      .update(userStats)
      .set({ limitNotifications: setExpr })
      .where(and(eq(userStats.userId, id), onlyIfArmed))
  } else {
    await db
      .update(organization)
      .set({ limitNotifications: setExpr })
      .where(and(eq(organization.id, id), onlyIfArmed))
  }
}

/**
 * Send a usage-limit threshold email (80% warning / 100% reached) for a
 * non-credit category, edge-triggered on the mutation that changed usage.
 *
 * Dedup + re-arm: the highest threshold already emailed is persisted per
 * category on `user_stats` / `organization`. The send is gated on an atomic
 * {@link claimThreshold}, so a threshold emails exactly once per crossing even
 * under concurrent calls; it re-arms once usage drops below {@link REARM_BELOW}.
 * Best-effort — callers fire-and-forget; failures never block the mutation.
 *
 * Mirrors the credits path in `maybeSendUsageThresholdEmail`: skips when billing
 * is disabled, respects the per-user notifications toggle and unsubscribe
 * preferences, and emails org admins for organization-scoped limits.
 */
export async function maybeSendLimitThresholdEmail(params: {
  category: LimitCategory
  scope: 'user' | 'organization'
  workspaceId: string
  currentUsage: number
  limit: number
  /** Pre-formatted current usage for the email body, e.g. "4.2 GB", "9 seats". */
  usageLabel: string
  /** Pre-formatted limit for the email body, e.g. "5 GB", "10 seats". */
  limitLabel: string
  /**
   * Usage immediately BEFORE the mutation, when known (e.g. the pre-insert row
   * count). Lets a single large change that jumps from below the re-arm band
   * past a threshold still re-arm before claiming, so the re-warning isn't
   * suppressed. Omit when only the post-mutation usage is observable.
   */
  priorUsage?: number
  /**
   * When true, only the re-arm is evaluated and no email is ever sent. Used by
   * usage-decrease paths (e.g. a storage shrink) where usage can still be above
   * a threshold but the change is a drop, not a fresh crossing.
   */
  rearmOnly?: boolean
  userId?: string
  userEmail?: string
  userName?: string
  organizationId?: string
}): Promise<void> {
  try {
    if (!isBillingEnabled) return
    // A non-positive limit can't yield a percentage; a zero/negative `currentUsage`
    // still needs to re-arm below, so it is handled by the `desired === 0` return.
    if (params.limit <= 0) return

    const { category, scope } = params
    const percent = Math.max(0, (params.currentUsage / params.limit) * 100)
    const priorPercent =
      params.priorUsage != null && params.priorUsage >= 0
        ? (params.priorUsage / params.limit) * 100
        : percent
    const desired = thresholdFor(percent)

    const stateId = scope === 'user' ? params.userId : params.organizationId
    if (!stateId) return

    // Re-arm if usage is (or just was) back in the low band, so a fresh climb re-notifies.
    if (Math.min(percent, priorPercent) < REARM_BELOW) {
      await rearmThreshold(scope, stateId, category)
    }

    // Usage-decrease callers re-arm only — a drop is never a fresh crossing to email.
    if (params.rearmOnly || desired === 0) return

    if (!(await claimThreshold(scope, stateId, category, desired))) return

    const kind = desired === REACH_THRESHOLD ? 'reached' : 'warning'
    const percentUsed = Math.min(100, Math.round(percent))
    const upgradeLink = `${getBaseUrl()}${buildUpgradeHref(params.workspaceId, category)}`

    const sendTo = async (email: string, name?: string) => {
      const prefs = await getEmailPreferences(email)
      if (prefs?.unsubscribeAll || prefs?.unsubscribeNotifications) return

      const html = await renderLimitThresholdEmail({
        kind,
        reason: category,
        userName: name,
        usageLabel: params.usageLabel,
        limitLabel: params.limitLabel,
        percentUsed,
        upgradeLink,
      })

      await sendEmail({
        to: email,
        subject: getLimitEmailSubject(category, kind),
        html,
        emailType: 'notifications',
      })
    }

    if (scope === 'user' && params.userId && params.userEmail) {
      const rows = await db
        .select({ enabled: settings.billingUsageNotificationsEnabled })
        .from(settings)
        .where(eq(settings.userId, params.userId))
        .limit(1)
      if (rows.length > 0 && rows[0].enabled === false) return
      await sendTo(params.userEmail, params.userName)
    } else if (scope === 'organization' && params.organizationId) {
      const admins = await db
        .select({
          email: user.email,
          name: user.name,
          enabled: settings.billingUsageNotificationsEnabled,
          role: member.role,
        })
        .from(member)
        .innerJoin(user, eq(member.userId, user.id))
        .leftJoin(settings, eq(settings.userId, member.userId))
        .where(eq(member.organizationId, params.organizationId))

      for (const a of admins) {
        if (!isOrgAdminRole(a.role)) continue
        if (a.enabled === false) continue
        if (!a.email) continue
        // Isolate per-admin failures so one bad recipient doesn't skip the rest.
        try {
          await sendTo(a.email, a.name || undefined)
        } catch (sendError) {
          logger.error('Failed to send limit email to org admin', {
            category,
            email: a.email,
            error: sendError,
          })
        }
      }
    }

    logger.info('Sent usage-limit threshold email', {
      category,
      scope,
      kind,
      percentUsed,
    })
  } catch (error) {
    logger.error('Failed to send usage-limit threshold email', {
      category: params.category,
      scope: params.scope,
      error,
    })
  }
}

/**
 * Resolve billing scope for a billed account user, then dispatch the limit
 * threshold email via {@link maybeSendLimitThresholdEmail}.
 *
 * The single entry point for per-category usage-limit emails: callers supply the
 * billed user, the usage numbers, and pre-formatted labels, and this resolves
 * personal vs. pooled (org) scope and the recipient. Best-effort — never throws.
 *
 * @param params.billedUserId - User whose subscription determines billing scope
 *   (the uploader for storage; the workspace's billed account for tables).
 */
export async function maybeNotifyLimit(params: {
  category: LimitCategory
  billedUserId: string
  workspaceId: string
  currentUsage: number
  limit: number
  usageLabel: string
  limitLabel: string
  /** Usage before the mutation, when known — see {@link maybeSendLimitThresholdEmail}. */
  priorUsage?: number
  /** Re-arm only, never send — for usage-decrease callers. See {@link maybeSendLimitThresholdEmail}. */
  rearmOnly?: boolean
}): Promise<void> {
  try {
    const sub = await getHighestPrioritySubscription(params.billedUserId)
    const isOrg = Boolean(sub && isOrgScopedSubscription(sub, params.billedUserId))

    let userEmail: string | undefined
    let userName: string | undefined
    if (!isOrg) {
      const [row] = await db
        .select({ email: user.email, name: user.name })
        .from(user)
        .where(eq(user.id, params.billedUserId))
        .limit(1)
      userEmail = row?.email
      userName = row?.name || undefined
    }

    await maybeSendLimitThresholdEmail({
      category: params.category,
      scope: isOrg ? 'organization' : 'user',
      workspaceId: params.workspaceId,
      currentUsage: params.currentUsage,
      limit: params.limit,
      usageLabel: params.usageLabel,
      limitLabel: params.limitLabel,
      priorUsage: params.priorUsage,
      rearmOnly: params.rearmOnly,
      userId: params.billedUserId,
      userEmail,
      userName,
      organizationId: isOrg ? sub?.referenceId : undefined,
    })
  } catch (error) {
    logger.error('Failed to resolve scope for usage-limit notification', {
      category: params.category,
      billedUserId: params.billedUserId,
      error,
    })
  }
}
