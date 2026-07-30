import { getBillingEntityBlockStatus } from '@/lib/billing/core/access'
import { resolveWorkspaceBillingPayer } from '@/lib/billing/core/billing-attribution'
import { resolveBillingInterval } from '@/lib/billing/core/subscription'
import { isEnterprise, isPaid, isPro, isTeam } from '@/lib/billing/plan-helpers'
import { hasPaidSubscriptionStatus } from '@/lib/billing/subscriptions/utils'

/**
 * The subscription access fields of a workspace's billed account, as a workspace-
 * scoped counterpart to the viewer's `/api/billing` data. Feed this to the
 * client `getSubscriptionAccessState` to derive `hasUsablePaidAccess` etc. for
 * the WORKSPACE (its exact organization or personal payer plan), instead of the
 * signed-in viewer's individual plan — so a free member of a paid workspace
 * isn't gated.
 *
 * Carries no usage/credit/Stripe data: safe to expose to any workspace member.
 */
export interface WorkspaceOwnerSubscriptionAccess {
  plan: string
  status: string | null
  isPaid: boolean
  isPro: boolean
  isTeam: boolean
  isEnterprise: boolean
  isOrgScoped: boolean
  organizationId: string | null
  billingInterval: 'month' | 'year'
  billingBlocked: boolean
  billingBlockedReason: 'payment_failed' | 'dispute' | null
}

/**
 * Resolves the workspace-selected organization or personal payer and returns
 * its exact subscription access fields.
 */
export async function getWorkspaceOwnerSubscriptionAccess(
  workspaceId: string
): Promise<WorkspaceOwnerSubscriptionAccess> {
  const payer = await resolveWorkspaceBillingPayer(workspaceId, { onMissing: 'return-null' })
  const subscription = payer?.payerSubscription ?? null
  const billingStatus = payer
    ? await getBillingEntityBlockStatus(
        payer.organizationId
          ? { type: 'organization', id: payer.organizationId }
          : { type: 'user', id: payer.billedAccountUserId }
      )
    : { billingBlocked: false, billingBlockedReason: null }

  const plan = subscription?.plan ?? 'free'
  const hasPaidEntitlement =
    hasPaidSubscriptionStatus(subscription?.status) && !billingStatus.billingBlocked
  const orgScoped = Boolean(payer?.organizationId)

  return {
    plan,
    status: subscription?.status ?? null,
    isPaid: hasPaidEntitlement && isPaid(plan),
    isPro: hasPaidEntitlement && isPro(plan),
    isTeam: hasPaidEntitlement && isTeam(plan),
    isEnterprise: hasPaidEntitlement && isEnterprise(plan),
    isOrgScoped: orgScoped,
    organizationId: payer?.organizationId ?? null,
    billingInterval: resolveBillingInterval(subscription),
    ...billingStatus,
  }
}
