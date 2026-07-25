/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockResolveWorkspaceBillingPayer } = vi.hoisted(() => ({
  mockResolveWorkspaceBillingPayer: vi.fn(),
}))

vi.mock('@/lib/billing/core/billing-attribution', () => ({
  resolveWorkspaceBillingPayer: mockResolveWorkspaceBillingPayer,
}))

import { resolveStorageBillingContext } from '@/lib/billing/storage/context'

describe('resolveStorageBillingContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('routes an external collaborator upload to the workspace organization payer', async () => {
    mockResolveWorkspaceBillingPayer.mockResolvedValue({
      billedAccountUserId: 'workspace-owner',
      organizationId: 'workspace-org',
      payerSubscription: {
        plan: 'team_25000',
        referenceId: 'workspace-org',
        metadata: { customStorageLimitGB: 75 },
      },
    })

    const context = await resolveStorageBillingContext('workspace-1')

    expect(context).toEqual({
      workspaceId: 'workspace-1',
      billedAccountUserId: 'workspace-owner',
      billingEntity: { type: 'organization', id: 'workspace-org' },
      plan: 'team_25000',
      customStorageLimitGB: 75,
    })
    expect(Object.isFrozen(context)).toBe(true)
    expect(Object.isFrozen(context.billingEntity)).toBe(true)
  })

  it('routes a personal-key upload to the workspace personal payer, not the key owner', async () => {
    mockResolveWorkspaceBillingPayer.mockResolvedValue({
      billedAccountUserId: 'workspace-payer',
      organizationId: null,
      payerSubscription: {
        plan: 'pro_4000',
        referenceId: 'workspace-payer',
        metadata: null,
      },
    })

    await expect(resolveStorageBillingContext('workspace-2')).resolves.toEqual({
      workspaceId: 'workspace-2',
      billedAccountUserId: 'workspace-payer',
      billingEntity: { type: 'user', id: 'workspace-payer' },
      plan: 'pro_4000',
      customStorageLimitGB: null,
    })
  })
})
