/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveWorkspaceBilling: vi.fn(),
  resolveOrganizationBilling: vi.fn(),
  resolveSystemBilling: vi.fn(),
  checkUsage: vi.fn(),
}))

vi.mock('@/lib/billing/core/billing-attribution', () => ({
  resolveBillingAttribution: mocks.resolveWorkspaceBilling,
  resolveOrganizationBillingAttribution: mocks.resolveOrganizationBilling,
  resolveSystemBillingAttribution: mocks.resolveSystemBilling,
  checkAttributedUsageLimits: mocks.checkUsage,
}))

import {
  resolveKnowledgeAttributedUserId,
  resolveKnowledgeUsageAdmission,
} from '@/lib/knowledge/application/billing'

describe('knowledge billing attribution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.checkUsage.mockResolvedValue({ isExceeded: false })
  })

  it('admits organization work against its payer while retaining the acting member', async () => {
    const attribution = { actorUserId: 'member-1', organizationId: 'org-1', workspaceId: null }
    mocks.resolveOrganizationBilling.mockResolvedValue(attribution)
    const resolveWorkspaceOverride = vi.fn()

    const result = await resolveKnowledgeUsageAdmission(
      { kind: 'session', userId: 'member-1', sessionId: 'session-1' },
      { organizationId: 'org-1', workspaceId: undefined },
      resolveWorkspaceOverride
    )

    expect(mocks.resolveOrganizationBilling).toHaveBeenCalledWith({
      actorUserId: 'member-1',
      organizationId: 'org-1',
    })
    expect(mocks.checkUsage).toHaveBeenCalledWith(attribution)
    expect(result).toMatchObject({ userId: 'member-1', billingAttribution: attribution })
    expect(resolveWorkspaceOverride).not.toHaveBeenCalled()
    expect(mocks.resolveWorkspaceBilling).not.toHaveBeenCalled()
  })

  it('uses workspace billing for a workspace key without inventing a human subject', async () => {
    const attribution = { actorUserId: 'payer-1', workspaceId: 'workspace-1' }
    mocks.resolveSystemBilling.mockResolvedValue(attribution)

    const result = await resolveKnowledgeUsageAdmission(
      { kind: 'workspace_api_key', workspaceId: 'workspace-1', keyId: 'key-1' },
      {
        workspaceId: 'workspace-1',
        workspaceOrganizationId: null,
        billedAccountUserId: 'payer-1',
        allowPersonalApiKeys: true,
      }
    )

    expect(mocks.resolveSystemBilling).toHaveBeenCalledWith('workspace-1')
    expect(mocks.checkUsage).toHaveBeenCalledWith(attribution)
    expect(result.userId).toBe('payer-1')
    expect(mocks.resolveOrganizationBilling).not.toHaveBeenCalled()
  })

  it('refuses actorless organization attribution instead of substituting an owner', () => {
    expect(() =>
      resolveKnowledgeAttributedUserId(
        { kind: 'workspace_api_key', workspaceId: 'workspace-1', keyId: 'key-1' },
        { organizationId: 'org-1', workspaceId: undefined }
      )
    ).toThrow('Knowledge operations require a user subject or execution actor')
  })
})
