import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { UsageUpgradePayload } from '@/lib/api/contracts/subscription'
import { CHAT_PLAN_REQUIRED_MESSAGE, CHAT_PLAN_REQUIRED_REASON } from '@/lib/billing/chat-plan'
import type { AttributedUsageLimitsResult } from '@/lib/billing/core/attribution'
import { getHighestPrioritySubscription } from '@/lib/billing/core/plan'
import type { BillingEntity } from '@/lib/billing/core/usage-log'
import { isEnterprise, isPaid } from '@/lib/billing/plan-helpers'
import { isOrgScopedSubscription } from '@/lib/billing/subscriptions/utils'

const logger = createLogger('UsageUpgrade')

const UPGRADE_PLAN_MESSAGE =
  "You've reached your usage limit. Please upgrade your plan to continue."

const MEMBER_CAP_MESSAGE =
  "You've reached the usage limit your organization set for you this billing period. Only an organization owner or admin can raise it — please ask them to continue."

/**
 * The payer a run is billed to, as the upgrade card needs it: its billing entity and its
 * subscription's plan. An attribution snapshot is one; a direct-v1 run's mid-run verdict carries one.
 */
export interface UsageUpgradePayer {
  readonly billingEntity: Readonly<BillingEntity>
  readonly payerSubscription: { readonly plan: string } | null
}

/**
 * The upgrade card for a payer over its usage limit: a plan upgrade for a free payer, a limit
 * increase for a paid one, with copy naming who can raise an organization's limit. A member
 * over the cap their organization set gets copy naming who can raise that cap. A known payer
 * decides the card without a query; otherwise the actor's current subscription decides, and a
 * lookup that fails falls back to the plan-upgrade card.
 */
export async function resolveUsageUpgradePayload(
  userId: string,
  payer?: UsageUpgradePayer,
  scope?: AttributedUsageLimitsResult['scope']
): Promise<UsageUpgradePayload> {
  if (scope === 'member') {
    return { reason: 'usage_limit', action: 'increase_limit', message: MEMBER_CAP_MESSAGE }
  }
  let plan: string | undefined
  let orgScoped = false
  try {
    if (payer) {
      plan = payer.payerSubscription?.plan
      orgScoped = payer.billingEntity.type === 'organization'
    } else {
      const subscription = await getHighestPrioritySubscription(userId)
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

/**
 * The card for a payer whose plan does not include Chat. Sim writes it at run admission, before
 * any worker run exists, so it never crosses the worker billing protocol: its reason widens only
 * the tag Sim renders, not the worker-shared card.
 */
export const CHAT_PLAN_REQUIRED_UPGRADE = {
  reason: CHAT_PLAN_REQUIRED_REASON,
  action: 'upgrade_plan',
  message: `${CHAT_PLAN_REQUIRED_MESSAGE} Upgrade your plan to talk to Sim.`,
} as const

/** Every card body the usage tag carries: the worker-shared card or Sim's Chat plan card. */
export type UsageUpgradeTagPayload = UsageUpgradePayload | typeof CHAT_PLAN_REQUIRED_UPGRADE

/** The assistant text that renders {@link payload} as the usage card. */
export function formatUsageUpgradeTag(payload: UsageUpgradeTagPayload): string {
  return `<usage_upgrade>${JSON.stringify(payload)}</usage_upgrade>`
}
