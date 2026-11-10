import {
  checkAttributedUsageLimits,
  resolveBillingAttribution,
} from '@/lib/billing/core/attribution'

export interface WorkspaceUsageGateParams {
  actorUserId: string
  workspaceId: string
}

export interface WorkspaceUsageGateResult {
  isExceeded: boolean
  message: string | null
  scope: 'actor' | 'payer' | 'member' | null
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
