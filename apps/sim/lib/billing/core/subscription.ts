import { db } from '@sim/db'
import { member, organization, subscription, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { getEffectiveBillingStatus, isOrganizationBillingBlocked } from '@/lib/billing/core/access'
import { getHighestPrioritySubscription } from '@/lib/billing/core/plan'
import {
  getPlanTierCredits,
  isPro as isPlanPro,
  isTeam as isPlanTeam,
} from '@/lib/billing/plan-helpers'
import {
  checkEnterprisePlan,
  checkProPlan,
  checkTeamPlan,
  ENTITLED_SUBSCRIPTION_STATUSES,
  hasUsableSubscriptionAccess,
  USABLE_SUBSCRIPTION_STATUSES,
} from '@/lib/billing/subscriptions/utils'
import {
  isAccessControlEnabled,
  isBillingEnabled,
  isCredentialSetsEnabled,
  isHosted,
  isInboxEnabled,
  isSsoEnabled,
} from '@/lib/core/config/feature-flags'
import { getBaseUrl } from '@/lib/core/utils/urls'

const logger = createLogger('SubscriptionCore')

export { getHighestPrioritySubscription }

export interface SubscriptionMetadata {
  billingInterval?: 'month' | 'year'
  [key: string]: unknown
}

export interface HasPaidSubscriptionOptions {
  onError?: 'assume-active' | 'throw'
}

/**
 * Extract the billing interval from subscription metadata, defaulting to 'month'.
 */
export function getBillingInterval(
  metadata: SubscriptionMetadata | null | undefined
): 'month' | 'year' {
  return metadata?.billingInterval === 'year' ? 'year' : 'month'
}

/**
 * Merge a `billingInterval` value into a subscription's metadata JSON column.
 */
export async function writeBillingInterval(
  subscriptionId: string,
  interval: 'month' | 'year'
): Promise<void> {
  const patch = JSON.stringify({ billingInterval: interval })
  await db
    .update(subscription)
    .set({
      metadata: sql`(COALESCE(metadata::jsonb, '{}'::jsonb) || ${patch}::jsonb)::json`,
    })
    .where(eq(subscription.id, subscriptionId))
}

/**
 * Sync the subscription's `plan` column to match Stripe. Closes a gap
 * where plan changes (Pro → Team upgrades, tier swaps) updated price,
 * seats, and referenceId at Stripe but left the DB plan stale. Returns
 * `true` if a write was issued, `false` if no change was needed.
 */
export async function syncSubscriptionPlan(
  subscriptionId: string,
  currentPlan: string | null,
  planFromStripe: string | null
): Promise<boolean> {
  if (!planFromStripe) return false
  if (currentPlan === planFromStripe) return false

  await db
    .update(subscription)
    .set({ plan: planFromStripe })
    .where(eq(subscription.id, subscriptionId))

  logger.info('Synced subscription plan name from Stripe', {
    subscriptionId,
    previousPlan: currentPlan,
    newPlan: planFromStripe,
  })

  return true
}

/**
 * Get the organization's subscription row when its status is one of
 * `USABLE_SUBSCRIPTION_STATUSES` (product access — stricter than
 * `ENTITLED_SUBSCRIPTION_STATUSES` which also includes `past_due`).
 * Use this for feature-gating ("can this org use the product right
 * now"). Use `getOrganizationSubscription` (from `core/billing.ts`)
 * when you need the billing-side entitlement row that includes
 * past-due subscriptions. Returns `null` when there is no usable sub.
 */
export async function getOrganizationSubscriptionUsable(organizationId: string) {
  try {
    const [orgSub] = await db
      .select()
      .from(subscription)
      .where(
        and(
          eq(subscription.referenceId, organizationId),
          inArray(subscription.status, USABLE_SUBSCRIPTION_STATUSES)
        )
      )
      .limit(1)

    return orgSub ?? null
  } catch (error) {
    logger.error('Error getting usable organization subscription', { error, organizationId })
    return null
  }
}

/**
 * Check if a referenceId (user ID or org ID) has a paid subscription row.
 * Used for duplicate subscription prevention and transfer safety.
 *
 * Fails closed by default: returns true on error to prevent duplicate creation.
 */
export async function hasPaidSubscription(
  referenceId: string,
  options: HasPaidSubscriptionOptions = {}
): Promise<boolean> {
  const { onError = 'assume-active' } = options

  try {
    const [activeSub] = await db
      .select({ id: subscription.id })
      .from(subscription)
      .where(
        and(
          eq(subscription.referenceId, referenceId),
          inArray(subscription.status, ENTITLED_SUBSCRIPTION_STATUSES)
        )
      )
      .limit(1)

    return !!activeSub
  } catch (error) {
    logger.error('Error checking active subscription', { error, referenceId })

    if (onError === 'throw') {
      throw error
    }

    return true
  }
}

export async function getOrganizationIdForSubscriptionReference(
  referenceId: string
): Promise<string | null> {
  const [referencedOrganization] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, referenceId))
    .limit(1)

  if (referencedOrganization) {
    return referencedOrganization.id
  }

  const [memberRecord] = await db
    .select({
      organizationId: member.organizationId,
      role: member.role,
    })
    .from(member)
    .where(eq(member.userId, referenceId))
    .limit(1)

  if (memberRecord && (memberRecord.role === 'owner' || memberRecord.role === 'admin')) {
    return memberRecord.organizationId
  }

  return null
}

/**
 * Check if user is on Pro plan (direct or via organization)
 */
export async function isProPlan(userId: string): Promise<boolean> {
  try {
    if (!isBillingEnabled) {
      return true
    }

    const subscription = await getHighestPrioritySubscription(userId)
    const isPro =
      subscription &&
      (checkProPlan(subscription) ||
        checkTeamPlan(subscription) ||
        checkEnterprisePlan(subscription))

    if (isPro) {
      logger.info('User has pro-level plan', { userId, plan: subscription.plan })
    }

    return !!isPro
  } catch (error) {
    logger.error('Error checking pro plan status', { error, userId })
    return false
  }
}

/**
 * Check if user is on Team plan (direct or via organization)
 */
export async function isTeamPlan(userId: string): Promise<boolean> {
  try {
    if (!isBillingEnabled) {
      return true
    }

    const subscription = await getHighestPrioritySubscription(userId)
    const isTeam =
      subscription && (checkTeamPlan(subscription) || checkEnterprisePlan(subscription))

    if (isTeam) {
      logger.info('User has team-level plan', { userId, plan: subscription.plan })
    }

    return !!isTeam
  } catch (error) {
    logger.error('Error checking team plan status', { error, userId })
    return false
  }
}

/**
 * Check if user is on Enterprise plan (direct or via organization)
 */
export async function isEnterprisePlan(userId: string): Promise<boolean> {
  try {
    if (!isBillingEnabled) {
      return true
    }

    const subscription = await getHighestPrioritySubscription(userId)
    const isEnterprise = subscription && checkEnterprisePlan(subscription)

    if (isEnterprise) {
      logger.info('User has enterprise plan', { userId, plan: subscription.plan })
    }

    return !!isEnterprise
  } catch (error) {
    logger.error('Error checking enterprise plan status', { error, userId })
    return false
  }
}

/**
 * Check if user is an admin or owner of an enterprise organization
 * Returns true if:
 * - User is a member of an enterprise organization AND
 * - User's role in that organization is 'owner' or 'admin'
 *
 * In non-production environments, returns true for convenience.
 */
export async function isEnterpriseOrgAdminOrOwner(userId: string): Promise<boolean> {
  try {
    if (!isBillingEnabled) {
      return true
    }

    const [memberRecord] = await db
      .select({
        organizationId: member.organizationId,
        role: member.role,
      })
      .from(member)
      .where(eq(member.userId, userId))
      .limit(1)

    if (!memberRecord) {
      return false
    }

    if (memberRecord.role !== 'owner' && memberRecord.role !== 'admin') {
      return false
    }

    const billingStatus = await getEffectiveBillingStatus(userId)
    if (billingStatus.billingBlocked) {
      return false
    }

    const orgSub = await getOrganizationSubscriptionUsable(memberRecord.organizationId)

    const isEnterprise = orgSub && checkEnterprisePlan(orgSub)

    if (isEnterprise) {
      logger.info('User is enterprise org admin/owner', {
        userId,
        organizationId: memberRecord.organizationId,
        role: memberRecord.role,
      })
    }

    return !!isEnterprise
  } catch (error) {
    logger.error('Error checking enterprise org admin/owner status', { error, userId })
    return false
  }
}

/**
 * Check if user is an admin or owner of a team or enterprise organization
 * Returns true if:
 * - User is a member of a team/enterprise organization AND
 * - User's role in that organization is 'owner' or 'admin'
 *
 * In non-production environments, returns true for convenience.
 */
export async function isTeamOrgAdminOrOwner(userId: string): Promise<boolean> {
  try {
    if (!isBillingEnabled) {
      return true
    }

    const [memberRecord] = await db
      .select({
        organizationId: member.organizationId,
        role: member.role,
      })
      .from(member)
      .where(eq(member.userId, userId))
      .limit(1)

    if (!memberRecord) {
      return false
    }

    if (memberRecord.role !== 'owner' && memberRecord.role !== 'admin') {
      return false
    }

    const billingStatus = await getEffectiveBillingStatus(userId)
    if (billingStatus.billingBlocked) {
      return false
    }

    const orgSub = await getOrganizationSubscriptionUsable(memberRecord.organizationId)

    const hasTeamPlan = orgSub && (checkTeamPlan(orgSub) || checkEnterprisePlan(orgSub))

    if (hasTeamPlan) {
      logger.info('User is team org admin/owner', {
        userId,
        organizationId: memberRecord.organizationId,
        role: memberRecord.role,
        plan: orgSub.plan,
      })
    }

    return !!hasTeamPlan
  } catch (error) {
    logger.error('Error checking team org admin/owner status', { error, userId })
    return false
  }
}

/**
 * Check if an organization has team or enterprise plan
 * Used at execution time (e.g., polling services) to check org billing directly
 */
export async function isOrganizationOnTeamOrEnterprisePlan(
  organizationId: string
): Promise<boolean> {
  try {
    if (!isBillingEnabled) {
      return true
    }

    if (isCredentialSetsEnabled && !isHosted) {
      return true
    }

    if (await isOrganizationBillingBlocked(organizationId)) {
      return false
    }

    const orgSub = await getOrganizationSubscriptionUsable(organizationId)

    return !!orgSub && (checkTeamPlan(orgSub) || checkEnterprisePlan(orgSub))
  } catch (error) {
    logger.error('Error checking organization plan status', { error, organizationId })
    return false
  }
}

/**
 * Check if an organization has an enterprise plan
 * Used for Access Control (Permission Groups) feature gating
 */
export async function isOrganizationOnEnterprisePlan(organizationId: string): Promise<boolean> {
  try {
    if (!isBillingEnabled) {
      return true
    }

    if (isAccessControlEnabled && !isHosted) {
      return true
    }

    if (await isOrganizationBillingBlocked(organizationId)) {
      return false
    }

    const orgSub = await getOrganizationSubscriptionUsable(organizationId)

    return !!orgSub && checkEnterprisePlan(orgSub)
  } catch (error) {
    logger.error('Error checking organization enterprise plan status', { error, organizationId })
    return false
  }
}

/**
 * Check if user has access to credential sets (email polling) feature
 * Returns true if:
 * - CREDENTIAL_SETS_ENABLED env var is set (self-hosted override), OR
 * - User is admin/owner of a team/enterprise organization
 *
 * In non-production environments, returns true for convenience.
 */
export async function hasCredentialSetsAccess(userId: string): Promise<boolean> {
  try {
    if (isCredentialSetsEnabled && !isHosted) {
      return true
    }

    return isTeamOrgAdminOrOwner(userId)
  } catch (error) {
    logger.error('Error checking credential sets access', { error, userId })
    return false
  }
}

/**
 * Check if user has access to SSO feature
 * Returns true if:
 * - SSO_ENABLED env var is set (self-hosted override), OR
 * - User is admin/owner of an enterprise organization
 *
 * In non-production environments, returns true for convenience.
 */
export async function hasSSOAccess(userId: string): Promise<boolean> {
  try {
    if (isSsoEnabled && !isHosted) {
      return true
    }

    return isEnterpriseOrgAdminOrOwner(userId)
  } catch (error) {
    logger.error('Error checking SSO access', { error, userId })
    return false
  }
}

/**
 * Check whether a workspace is entitled to the Access Control (Permission Groups)
 * feature. Entitlement follows the workspace's `billedAccountUserId`:
 * - self-hosted override honored via ACCESS_CONTROL_ENABLED, OR
 * - billing disabled, OR
 * - the workspace belongs to an enterprise-plan organization (org-mode), OR
 * - the billed user has an individual enterprise subscription (personal workspace).
 */
export async function isWorkspaceOnEnterprisePlan(workspaceId: string): Promise<boolean> {
  try {
    if (!isBillingEnabled) return true
    if (isAccessControlEnabled && !isHosted) return true

    const { getWorkspaceWithOwner } = await import('@/lib/workspaces/permissions/utils')
    const ws = await getWorkspaceWithOwner(workspaceId, { includeArchived: true })
    if (!ws) return false

    if (ws.organizationId) {
      return isOrganizationOnEnterprisePlan(ws.organizationId)
    }

    const billedSub = await getHighestPrioritySubscription(ws.billedAccountUserId)
    return !!billedSub && checkEnterprisePlan(billedSub)
  } catch (error) {
    logger.error('Error checking workspace enterprise plan status', { error, workspaceId })
    return false
  }
}

/**
 * Check if user has access to inbox (Sim Mailer) feature
 * Returns true if:
 * - INBOX_ENABLED env var is set, OR
 * - Non-production environment, OR
 * - User has a Max plan (credits >= 25000) or enterprise plan
 */
export async function hasInboxAccess(userId: string): Promise<boolean> {
  try {
    if (isInboxEnabled) {
      return true
    }
    if (!isBillingEnabled) {
      return true
    }
    const [sub, billingStatus] = await Promise.all([
      getHighestPrioritySubscription(userId),
      getEffectiveBillingStatus(userId),
    ])
    if (!sub) return false
    if (!hasUsableSubscriptionAccess(sub.status, billingStatus.billingBlocked)) return false
    return getPlanTierCredits(sub.plan) >= 25000 || checkEnterprisePlan(sub)
  } catch (error) {
    logger.error('Error checking inbox access', { error, userId })
    return false
  }
}

/**
 * Check if user has access to live sync (every 5 minutes) for KB connectors
 * Returns true if:
 * - Self-hosted deployment, OR
 * - User has a Max plan (credits >= 25000) or enterprise plan
 */
export async function hasLiveSyncAccess(userId: string): Promise<boolean> {
  try {
    if (!isHosted) {
      return true
    }
    const [sub, billingStatus] = await Promise.all([
      getHighestPrioritySubscription(userId),
      getEffectiveBillingStatus(userId),
    ])
    if (!sub) return false
    if (!hasUsableSubscriptionAccess(sub.status, billingStatus.billingBlocked)) return false
    return getPlanTierCredits(sub.plan) >= 25000 || checkEnterprisePlan(sub)
  } catch (error) {
    logger.error('Error checking live sync access', { error, userId })
    return false
  }
}

/**
 * Send welcome email for Pro and Team plan subscriptions
 */
export async function sendPlanWelcomeEmail(subscription: any): Promise<void> {
  try {
    const subPlan = subscription.plan
    if (isPlanPro(subPlan) || isPlanTeam(subPlan)) {
      const userId = subscription.referenceId
      const users = await db
        .select({ email: user.email, name: user.name })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1)

      if (users.length > 0 && users[0].email) {
        const { getEmailSubject, renderPlanWelcomeEmail } = await import('@/components/emails')
        const { sendEmail } = await import('@/lib/messaging/email/mailer')

        const baseUrl = getBaseUrl()
        const { getDisplayPlanName } = await import('@/lib/billing/plan-helpers')
        const html = await renderPlanWelcomeEmail({
          planName: getDisplayPlanName(subPlan),
          userName: users[0].name || undefined,
          loginLink: `${baseUrl}/login`,
        })

        const displayName = getDisplayPlanName(subPlan)
        await sendEmail({
          to: users[0].email,
          subject: `Your ${displayName} plan is now active on ${(await import('@/ee/whitelabeling')).getBrandConfig().name}`,
          html,
          emailType: 'updates',
        })

        logger.info('Plan welcome email sent successfully', {
          userId,
          email: users[0].email,
          plan: subPlan,
        })
      }
    }
  } catch (error) {
    logger.error('Failed to send plan welcome email', {
      error,
      subscriptionId: subscription.id,
      plan: subscription.plan,
    })
    throw error
  }
}
