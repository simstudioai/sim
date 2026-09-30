import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { UsageUpgradePayload } from '@/lib/api/contracts/subscription'
import type {
  AttributedUsageLimitsResult,
  BillingAttributionSnapshot,
} from '@/lib/billing/core/billing-attribution'
import { getHighestPrioritySubscription } from '@/lib/billing/core/plan'
import { isEnterprise, isPaid } from '@/lib/billing/plan-helpers'
import { isOrgScopedSubscription } from '@/lib/billing/subscriptions/utils'
import { withinDeadline } from '@/lib/core/utils/deadline'

const logger = createLogger('UsageUpgrade')

const UPGRADE_PLAN_MESSAGE =
  "You've reached your usage limit. Please upgrade your plan to continue."

const MEMBER_CAP_MESSAGE =
  "You've reached the usage limit your organization set for you this billing period. Only an organization owner or admin can raise it — please ask them to continue."

/**
 * The upgrade card for a payer over its usage limit: a plan upgrade for a free payer, a limit
 * increase for a paid one, with copy naming who can raise an organization's limit. A member
 * over the cap their organization set gets copy naming who can raise that cap. An attributed
 * run reads the plan from its admission snapshot without a query; otherwise the actor's current
 * subscription decides, and a lookup that fails or outlasts `deadlineAt` falls back to the
 * plan-upgrade card.
 */
export async function resolveUsageUpgradePayload(
  userId: string,
  billingAttribution?: BillingAttributionSnapshot,
  scope?: AttributedUsageLimitsResult['scope'],
  deadlineAt?: number
): Promise<UsageUpgradePayload> {
  if (scope === 'member') {
    return { reason: 'usage_limit', action: 'increase_limit', message: MEMBER_CAP_MESSAGE }
  }
  let plan: string | undefined
  let orgScoped = false
  try {
    if (billingAttribution) {
      plan = billingAttribution.payerSubscription?.plan
      orgScoped = billingAttribution.billingEntity.type === 'organization'
    } else {
      const subscription = await (deadlineAt === undefined
        ? getHighestPrioritySubscription(userId)
        : withinDeadline(() => getHighestPrioritySubscription(userId), deadlineAt))
      plan = subscription?.plan
      orgScoped = isOrgScopedSubscription(subscription, userId)
    }
  } catch (error) {
    logger.warn('Failed to determine subscription plan, defaulting to upgrade_plan', {
      error: getErrorMessage(error),
    })
  }

  if (!plan || !isPaid(plan)) {
    return { reason: 'usage_limit', action: 'upgrade_plan', message: UPGRADE_PLAN_MESSAGE }
  }
  // Paid plans get `increase_limit`; the copy says who can raise it when the user cannot.
  const message = !orgScoped
    ? "You've reached your usage limit for this billing period. Please increase your usage limit from billing settings to continue."
    : isEnterprise(plan)
      ? "You've reached your organization's usage limit for this billing period. Only an organization admin or Sim support can raise an enterprise limit — reach out to them to continue."
      : "You've reached your organization's usage limit for this billing period. Only an organization owner or admin can raise the limit — please ask them to update it from the team billing settings."
  return { reason: 'usage_limit', action: 'increase_limit', message }
}

/** The assistant text that renders {@link payload} as the usage card. */
export function formatUsageUpgradeTag(payload: UsageUpgradePayload): string {
  return `<usage_upgrade>${JSON.stringify(payload)}</usage_upgrade>`
}
