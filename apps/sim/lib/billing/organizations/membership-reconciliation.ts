import { syncUsageLimitsFromSubscription } from '@/lib/billing/core/usage'
import { restoreUserProSubscription } from '@/lib/billing/organizations/membership'
import { MEMBER_BILLING_RECONCILIATION_EVENT_TYPE } from '@/lib/billing/organizations/membership-reconciliation-event'
import type { OutboxHandler } from '@/lib/core/outbox/service'

interface MemberBillingReconciliationPayload {
  userId: string
  organizationId: string
}

const reconcileMemberBillingAfterOrgLeave: OutboxHandler<
  MemberBillingReconciliationPayload
> = async (payload) => {
  await restoreUserProSubscription(payload.userId)
  await syncUsageLimitsFromSubscription(payload.userId)
}

export const membershipBillingOutboxHandlers = {
  [MEMBER_BILLING_RECONCILIATION_EVENT_TYPE]:
    reconcileMemberBillingAfterOrgLeave as OutboxHandler<unknown>,
} as const
