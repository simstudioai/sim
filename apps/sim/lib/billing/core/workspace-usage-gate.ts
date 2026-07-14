import {
  checkAttributedUsageLimits,
  resolveBillingAttribution,
} from '@/lib/billing/core/billing-attribution'
import { getPooledCreditsRemaining } from '@/lib/billing/on-demand'

export interface WorkspaceUsageGateParams {
  actorUserId: string
  workspaceId: string
}

export interface WorkspaceUsageGateResult {
  isExceeded: boolean
  message: string | null
  scope: 'actor' | 'payer' | 'member' | null
}

export interface WorkspaceCreditAvailabilityParams extends WorkspaceUsageGateParams {
  canViewPayerPool: boolean
}

export interface WorkspaceCreditAvailabilityResult {
  remainingDollars: number | null
  scope: 'payer' | 'member' | 'effective'
}

/**
 * Resolves the routed workspace's effective credit availability without
 * consulting the actor's unrelated personal subscription.
 */
export async function getWorkspaceCreditAvailability({
  actorUserId,
  workspaceId,
  canViewPayerPool,
}: WorkspaceCreditAvailabilityParams): Promise<WorkspaceCreditAvailabilityResult> {
  const attribution = await resolveBillingAttribution({ actorUserId, workspaceId })
  const usage = await checkAttributedUsageLimits(attribution)
  const payerRemaining = usage.payerUsage
    ? getPooledCreditsRemaining(usage.payerUsage.limit, usage.payerUsage.currentUsage)
    : 0

  if (canViewPayerPool) {
    return { remainingDollars: payerRemaining, scope: 'payer' }
  }

  if (payerRemaining === 0) {
    return { remainingDollars: 0, scope: 'effective' }
  }

  if (!usage.memberUsage || usage.memberUsage.limit === null) {
    return { remainingDollars: null, scope: 'effective' }
  }

  const memberRemaining = Math.max(0, usage.memberUsage.limit - usage.memberUsage.currentUsage)
  return { remainingDollars: memberRemaining, scope: 'member' }
}

/**
 * Checks the routed workspace's payer pool before the acting member's cap.
 */
export async function checkWorkspaceUsageGate({
  actorUserId,
  workspaceId,
}: WorkspaceUsageGateParams): Promise<WorkspaceUsageGateResult> {
  const attribution = await resolveBillingAttribution({ actorUserId, workspaceId })
  const usage = await checkAttributedUsageLimits(attribution)
  if (usage.isExceeded) {
    const scope = usage.scope ?? 'payer'
    const fallbackMessage =
      scope === 'actor'
        ? 'Your account is blocked from running workflows.'
        : scope === 'member'
          ? 'Member usage limit exceeded.'
          : 'Workspace usage limit exceeded.'
    return {
      isExceeded: true,
      message: usage.message ?? fallbackMessage,
      scope,
    }
  }

  return { isExceeded: false, message: null, scope: null }
}
