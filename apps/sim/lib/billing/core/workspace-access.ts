import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { isEnterprise, isPaid, isPro, isTeam } from '@/lib/billing/plan-helpers'
import {
  hasPaidSubscriptionStatus,
  isOrgScopedSubscription,
} from '@/lib/billing/subscriptions/utils'
import { getWorkspaceBilledAccountUserId } from '@/lib/workspaces/utils'

/**
 * The subscription access fields of a workspace's billed account, as a workspace-
 * scoped counterpart to the viewer's `/api/billing` data. Feed this to the
 * client `getSubscriptionAccessState` to derive `hasUsablePaidAccess` etc. for
 * the WORKSPACE (its owner's rolled-up plan), instead of the signed-in viewer's
 * individual plan — so a free member of a paid workspace isn't gated.
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
}

/**
 * Resolves the workspace's billed account and returns its subscription access
 * fields (rolled up over org memberships). Mirrors the flag derivation in
 * `getSimplifiedBillingSummary` so the result matches the viewer `/api/billing`
 * shape for the owner.
 */
export async function getWorkspaceOwnerSubscriptionAccess(
  workspaceId: string
): Promise<WorkspaceOwnerSubscriptionAccess> {
  const billedUserId = await getWorkspaceBilledAccountUserId(workspaceId)
  const subscription = billedUserId ? await getHighestPrioritySubscription(billedUserId) : null

  const plan = subscription?.plan ?? 'free'
  const hasPaidEntitlement = hasPaidSubscriptionStatus(subscription?.status)
  const orgScoped =
    subscription && billedUserId ? isOrgScopedSubscription(subscription, billedUserId) : false

  return {
    plan,
    status: subscription?.status ?? null,
    isPaid: hasPaidEntitlement && isPaid(plan),
    isPro: hasPaidEntitlement && isPro(plan),
    isTeam: hasPaidEntitlement && isTeam(plan),
    isEnterprise: hasPaidEntitlement && isEnterprise(plan),
    isOrgScoped: orgScoped,
    organizationId: orgScoped && subscription ? subscription.referenceId : null,
  }
}
