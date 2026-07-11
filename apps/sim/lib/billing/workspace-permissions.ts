import type { WorkspaceHostContext, WorkspaceUsageGate } from '@/lib/api/contracts/workspaces'

export type WorkspaceUsageLimitAction =
  | { type: 'manage-billing'; message: null }
  | { type: 'notify'; message: string }

/**
 * Returns whether the viewer can change the routed workspace's payer billing.
 */
export function canManageWorkspaceBilling(
  hostContext: WorkspaceHostContext,
  viewerUserId?: string | null
): boolean {
  if (hostContext.hostOrganizationId) {
    return hostContext.viewer.isHostOrganizationAdmin
  }

  return hostContext.workspace.billedAccountUserId === viewerUserId
}

/**
 * Resolves the workspace-safe action and copy for an exceeded usage gate.
 * Payer messages are intentionally replaced for viewers who cannot manage the
 * payer so they never receive a misleading personal upgrade instruction.
 */
export function getWorkspaceUsageLimitAction(
  hostContext: WorkspaceHostContext,
  viewerUserId: string | null | undefined,
  gate: Pick<WorkspaceUsageGate, 'message' | 'scope'>
): WorkspaceUsageLimitAction {
  if (gate.scope === 'payer' && canManageWorkspaceBilling(hostContext, viewerUserId)) {
    return { type: 'manage-billing', message: null }
  }

  if (gate.scope === 'payer') {
    return {
      type: 'notify',
      message: hostContext.hostOrganizationId
        ? 'This workspace’s pooled usage limit has been reached. Contact an organization administrator to increase it.'
        : 'This workspace’s usage limit has been reached. Contact the workspace owner to increase it.',
    }
  }

  if (gate.scope === 'member') {
    return {
      type: 'notify',
      message:
        gate.message ??
        'Your member credit limit has been reached. Contact an organization administrator to increase it.',
    }
  }

  return {
    type: 'notify',
    message: gate.message ?? 'This workspace’s usage limit has been reached.',
  }
}
