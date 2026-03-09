import { db } from '@sim/db'
import { member, subscription, user, userStats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { getHighestPrioritySubscription } from '@/lib/billing/core/plan'
import { getUserUsageLimit } from '@/lib/billing/core/usage'
import {
  checkEnterprisePlan,
  checkProPlan,
  checkTeamPlan,
  getFreeTierLimit,
  getPerUserMinimumLimit,
} from '@/lib/billing/subscriptions/utils'
import type { UserSubscriptionState } from '@/lib/billing/types'
import {
  isAccessControlEnabled,
  isCredentialSetsEnabled,
  isHosted,
  isProd,
  isSsoEnabled,
} from '@/lib/core/config/feature-flags'
import { getBaseUrl } from '@/lib/core/utils/urls'

const logger = createLogger('SubscriptionCore')

export { getHighestPrioritySubscription }

/**
 * Check if a referenceId (user ID or org ID) has an active subscription
 * Used for duplicate subscription prevention
 *
 * Fails closed: returns true on error to prevent duplicate creation
 */
export async function hasActiveSubscription(referenceId: string): Promise<boolean> {
  try {
    const [activeSub] = await db
      .select({ id: subscription.id })
      .from(subscription)
      .where(and(eq(subscription.referenceId, referenceId), eq(subscription.status, 'active')))
      .limit(1)

    return !!activeSub
  } catch (error) {
    logger.error('Error checking active subscription', { error, referenceId })
    // Fail closed: assume subscription exists to prevent duplicate creation
    return true
  }
}

/**
 * Check if user is on Pro plan (direct or via organization)
 */
export async function isProPlan(userId: string): Promise<boolean> {
  try {
    if (!isProd) {
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
    if (!isProd) {
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
    if (!isProd) {
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
    if (!isProd) {
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

    const [orgSub] = await db
      .select()
      .from(subscription)
      .where(
        and(
          eq(subscription.referenceId, memberRecord.organizationId),
          eq(subscription.status, 'active')
        )
      )
      .limit(1)

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
    if (!isProd) {
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

    const [orgSub] = await db
      .select()
      .from(subscription)
      .where(
        and(
          eq(subscription.referenceId, memberRecord.organizationId),
          eq(subscription.status, 'active')
        )
      )
      .limit(1)

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
    if (!isProd) {
      return true
    }

    if (isCredentialSetsEnabled && !isHosted) {
      return true
    }

    const [orgSub] = await db
      .select()
      .from(subscription)
      .where(and(eq(subscription.referenceId, organizationId), eq(subscription.status, 'active')))
      .limit(1)

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
    if (!isProd) {
      return true
    }

    if (isAccessControlEnabled && !isHosted) {
      return true
    }

    const [orgSub] = await db
      .select()
      .from(subscription)
      .where(and(eq(subscription.referenceId, organizationId), eq(subscription.status, 'active')))
      .limit(1)

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
 * Check if user has access to Access Control (Permission Groups) feature
 * Returns true if:
 * - ACCESS_CONTROL_ENABLED env var is set (self-hosted override), OR
 * - User is admin/owner of an enterprise organization
 *
 * In non-production environments, returns true for convenience.
 */
export async function hasAccessControlAccess(userId: string): Promise<boolean> {
  try {
    if (isAccessControlEnabled && !isHosted) {
      return true
    }

    return isEnterpriseOrgAdminOrOwner(userId)
  } catch (error) {
    logger.error('Error checking access control access', { error, userId })
    return false
  }
}

/**
 * Check if user has exceeded their cost limit based on current period usage
 */
export async function hasExceededCostLimit(userId: string): Promise<boolean> {
  try {
    if (!isProd) {
      return false
    }

    const subscription = await getHighestPrioritySubscription(userId)

    let limit = getFreeTierLimit() // Default free tier limit

    if (subscription) {
      // Team/Enterprise: Use organization limit
      if (subscription.plan === 'team' || subscription.plan === 'enterprise') {
        limit = await getUserUsageLimit(userId)
        logger.info('Using organization limit', {
          userId,
          plan: subscription.plan,
          limit,
        })
      } else {
        // Pro/Free: Use individual limit
        limit = getPerUserMinimumLimit(subscription)
        logger.info('Using subscription-based limit', {
          userId,
          plan: subscription.plan,
          limit,
        })
      }
    } else {
      logger.info('Using free tier limit', { userId, limit })
    }

    // Get user stats to check current period usage
    const statsRecords = await db.select().from(userStats).where(eq(userStats.userId, userId))

    if (statsRecords.length === 0) {
      return false
    }

    // Use current period cost instead of total cost for accurate billing period tracking
    const currentCost = Number.parseFloat(
      statsRecords[0].currentPeriodCost?.toString() || statsRecords[0].totalCost.toString()
    )

    logger.info('Checking cost limit', { userId, currentCost, limit })

    return currentCost >= limit
  } catch (error) {
    logger.error('Error checking cost limit', { error, userId })
    return false // Be conservative in case of error
  }
}

/**
 * Check if sharing features are enabled for user
 */
// Removed unused feature flag helpers: isSharingEnabled, isMultiplayerEnabled, isWorkspaceCollaborationEnabled

/**
 * Get comprehensive subscription state for a user
 * Single function to get all subscription information
 */
export async function getUserSubscriptionState(userId: string): Promise<UserSubscriptionState> {
  try {
    // Get subscription and user stats in parallel to minimize DB calls
    const [subscription, statsRecords] = await Promise.all([
      getHighestPrioritySubscription(userId),
      db.select().from(userStats).where(eq(userStats.userId, userId)).limit(1),
    ])

    // Determine plan types based on subscription (avoid redundant DB calls)
    const isPro =
      !isProd ||
      !!(
        subscription &&
        (checkProPlan(subscription) ||
          checkTeamPlan(subscription) ||
          checkEnterprisePlan(subscription))
      )
    const isTeam =
      !isProd ||
      !!(subscription && (checkTeamPlan(subscription) || checkEnterprisePlan(subscription)))
    const isEnterprise = !isProd || !!(subscription && checkEnterprisePlan(subscription))
    const isFree = !isPro && !isTeam && !isEnterprise

    // Determine plan name
    let planName = 'free'
    if (isEnterprise) planName = 'enterprise'
    else if (isTeam) planName = 'team'
    else if (isPro) planName = 'pro'

    // Check cost limit using already-fetched user stats
    let hasExceededLimit = false
    if (isProd && statsRecords.length > 0) {
      let limit = getFreeTierLimit() // Default free tier limit
      if (subscription) {
        // Team/Enterprise: Use organization limit
        if (subscription.plan === 'team' || subscription.plan === 'enterprise') {
          limit = await getUserUsageLimit(userId)
        } else {
          // Pro/Free: Use individual limit
          limit = getPerUserMinimumLimit(subscription)
        }
      }

      const currentCost = Number.parseFloat(
        statsRecords[0].currentPeriodCost?.toString() || statsRecords[0].totalCost.toString()
      )
      hasExceededLimit = currentCost >= limit
    }

    return {
      isPro,
      isTeam,
      isEnterprise,
      isFree,
      highestPrioritySubscription: subscription,
      hasExceededLimit,
      planName,
    }
  } catch (error) {
    logger.error('Error getting user subscription state', { error, userId })

    // Return safe defaults in case of error
    return {
      isPro: false,
      isTeam: false,
      isEnterprise: false,
      isFree: true,
      highestPrioritySubscription: null,
      hasExceededLimit: false,
      planName: 'free',
    }
  }
}

/**
 * Send welcome email for Pro and Team plan subscriptions
 */
export async function sendPlanWelcomeEmail(subscription: any): Promise<void> {
  try {
    const subPlan = subscription.plan
    if (subPlan === 'pro' || subPlan === 'team') {
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
        const html = await renderPlanWelcomeEmail({
          planName: subPlan === 'pro' ? 'Pro' : 'Team',
          userName: users[0].name || undefined,
          loginLink: `${baseUrl}/login`,
        })

        await sendEmail({
          to: users[0].email,
          subject: getEmailSubject(subPlan === 'pro' ? 'plan-welcome-pro' : 'plan-welcome-team'),
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
