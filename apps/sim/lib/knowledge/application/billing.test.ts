import {
  createSessionPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import {
  billingAttributionMock,
  billingAttributionMockFns,
} from '@sim/testing/mocks/billing-attribution.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/billing/core/billing-attribution', () => billingAttributionMock)

import {
  resolveKnowledgeAttributedUserId,
  resolveKnowledgeUsageAdmission,
} from '@/lib/knowledge/application/billing'

describe('knowledge billing attribution', () => {
  beforeEach(() => {
    billingAttributionMockFns.mockCheckAttributedUsageLimits.mockResolvedValue({
      isExceeded: false,
    })
  })

  it('admits organization work against its payer while retaining the acting member', async () => {
    const attribution = { actorUserId: 'member-1', organizationId: 'org-1', workspaceId: null }
    billingAttributionMockFns.mockResolveOrganizationBillingAttribution.mockResolvedValue(
      attribution
    )
    const resolveWorkspaceOverride = vi.fn()

    const result = await resolveKnowledgeUsageAdmission(
      createSessionPrincipal({ userId: 'member-1' }),
      { organizationId: 'org-1', workspaceId: undefined },
      resolveWorkspaceOverride
    )

    expect(
      billingAttributionMockFns.mockResolveOrganizationBillingAttribution
    ).toHaveBeenCalledWith({
      actorUserId: 'member-1',
      organizationId: 'org-1',
    })
    expect(billingAttributionMockFns.mockCheckAttributedUsageLimits).toHaveBeenCalledWith(
      attribution
    )
    expect(result).toMatchObject({ userId: 'member-1', billingAttribution: attribution })
    expect(resolveWorkspaceOverride).not.toHaveBeenCalled()
    expect(billingAttributionMockFns.mockResolveBillingAttribution).not.toHaveBeenCalled()
  })

  it('uses workspace billing for a workspace key without inventing a human subject', async () => {
    const attribution = { actorUserId: 'payer-1', workspaceId: 'workspace-1' }
    billingAttributionMockFns.mockResolveSystemBillingAttribution.mockResolvedValue(attribution)

    const result = await resolveKnowledgeUsageAdmission(createWorkspaceApiKeyPrincipal(), {
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      billedAccountUserId: 'payer-1',
      allowPersonalApiKeys: true,
    })

    expect(billingAttributionMockFns.mockResolveSystemBillingAttribution).toHaveBeenCalledWith(
      'workspace-1'
    )
    expect(billingAttributionMockFns.mockCheckAttributedUsageLimits).toHaveBeenCalledWith(
      attribution
    )
    expect(result.userId).toBe('payer-1')
    expect(
      billingAttributionMockFns.mockResolveOrganizationBillingAttribution
    ).not.toHaveBeenCalled()
  })

  it('refuses actorless organization attribution instead of substituting an owner', () => {
    expect(() =>
      resolveKnowledgeAttributedUserId(createWorkspaceApiKeyPrincipal(), {
        organizationId: 'org-1',
        workspaceId: undefined,
      })
    ).toThrow('Knowledge operations require a user subject or execution actor')
  })
})
