/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadWorkspace: vi.fn(),
  resolvePermission: vi.fn(),
  getAccountBillingSnapshot: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) => {
    const rank = { read: 1, write: 2, admin: 3 } as const
    return (
      actual !== null && rank[actual as keyof typeof rank] >= rank[required as keyof typeof rank]
    )
  },
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  loadActiveWorkspaceApplicationContext: mocks.loadWorkspace,
}))

vi.mock('@/lib/billing/core/account-billing-snapshot', () => ({
  getAccountBillingSnapshot: mocks.getAccountBillingSnapshot,
}))

import type { ExecutionContext } from '@/lib/copilot/request/types'
import { executeGetAccountBilling } from '@/lib/copilot/tools/handlers/account'

const context = {
  userId: 'user-1',
  workflowId: '',
  workspaceId: 'workspace-1',
  chatId: 'chat-1',
  toolCallId: 'tool-call-1',
  copilotToolExecution: true,
  copilotInteractionMode: 'interactive',
} as const satisfies ExecutionContext

const snapshot = {
  plan: 'team',
  billingScope: 'organization' as const,
  organizationId: 'org-1',
  usage: {
    currentPeriodCost: 18.5,
    limit: 40,
    remaining: 21.5,
    percentUsed: 46.25,
    isExceeded: false,
    billingPeriodEnd: new Date('2026-09-01T00:00:00Z'),
  },
  credits: { balance: 25, scope: 'organization' as const },
}

describe('executeGetAccountBilling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadWorkspace.mockResolvedValue({
      workspaceId: 'workspace-1',
      workspaceOrganizationId: 'org-1',
      allowPersonalApiKeys: true,
      billedAccountUserId: 'owner-1',
    })
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.getAccountBillingSnapshot.mockResolvedValue(snapshot)
  })

  it('returns the existing account billing tool result shape after authorization', async () => {
    await expect(executeGetAccountBilling(context)).resolves.toEqual({
      success: true,
      output: snapshot,
    })
    expect(mocks.getAccountBillingSnapshot).toHaveBeenCalledWith('user-1')
  })

  it.each(['headless' as const, undefined])(
    'fails closed for a non-interactive lifecycle (%s) before protected lookup',
    async (copilotInteractionMode) => {
      const result = await executeGetAccountBilling({
        ...context,
        copilotInteractionMode,
      })

      expect(result).toEqual({
        success: false,
        error: 'Live platform context is available only in an interactive Copilot session.',
      })
      expect(mocks.loadWorkspace).not.toHaveBeenCalled()
      expect(mocks.resolvePermission).not.toHaveBeenCalled()
      expect(mocks.getAccountBillingSnapshot).not.toHaveBeenCalled()
    }
  )

  it('does not expose an underlying billing failure', async () => {
    mocks.getAccountBillingSnapshot.mockRejectedValue(
      new Error('connection secret from billing database')
    )

    await expect(executeGetAccountBilling(context)).resolves.toEqual({
      success: false,
      error: 'The operation failed due to a system error. Please retry.',
    })
  })
})
