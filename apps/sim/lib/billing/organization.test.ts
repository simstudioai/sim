/**
 * @vitest-environment node
 */
import { schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDbState,
  mockCreateOrganizationWithOwner,
  mockAttachOwnedWorkspacesToOrganization,
  mockGetOrganizationIdForSubscriptionReference,
} = vi.hoisted(() => ({
  mockDbState: {
    selectResults: [] as any[],
  },
  mockCreateOrganizationWithOwner: vi.fn(),
  mockAttachOwnedWorkspacesToOrganization: vi.fn(),
  mockGetOrganizationIdForSubscriptionReference: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn().mockImplementation(() => {
      const chain: any = {}
      chain.from = vi.fn().mockReturnValue(chain)
      chain.where = vi.fn().mockReturnValue(chain)
      chain.limit = vi
        .fn()
        .mockImplementation(() => Promise.resolve(mockDbState.selectResults.shift() ?? []))
      chain.then = vi
        .fn()
        .mockImplementation((callback: (rows: any[]) => any) =>
          Promise.resolve(callback(mockDbState.selectResults.shift() ?? []))
        )
      return chain
    }),
    update: vi.fn(),
  },
}))

vi.mock('@sim/db/schema', () => schemaMock)

vi.mock('@/lib/billing', () => ({
  hasPaidSubscription: vi.fn(),
}))

vi.mock('@/lib/billing/core/billing', () => ({
  getPlanPricing: vi.fn(),
}))

vi.mock('@/lib/billing/core/subscription', () => ({
  getOrganizationIdForSubscriptionReference: mockGetOrganizationIdForSubscriptionReference,
}))

vi.mock('@/lib/billing/core/usage', () => ({
  syncUsageLimitsFromSubscription: vi.fn(),
}))

vi.mock('@/lib/billing/plan-helpers', () => ({
  isOrgPlan: (plan: string) => plan === 'team' || plan === 'enterprise',
  isTeam: (plan: string) => plan === 'team',
}))

vi.mock('@/lib/billing/organizations/create-organization', () => ({
  createOrganizationWithOwner: mockCreateOrganizationWithOwner,
}))

vi.mock('@/lib/workspaces/organization-workspaces', () => ({
  attachOwnedWorkspacesToOrganization: mockAttachOwnedWorkspacesToOrganization,
}))

import { ensureOrganizationForTeamSubscription } from '@/lib/billing/organization'

describe('ensureOrganizationForTeamSubscription', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbState.selectResults = []
    mockGetOrganizationIdForSubscriptionReference.mockResolvedValue(null)
  })

  it('treats existing legacy organization ids as organization references', async () => {
    mockGetOrganizationIdForSubscriptionReference.mockResolvedValue('legacy-org-id')

    const result = await ensureOrganizationForTeamSubscription({
      id: 'sub-1',
      plan: 'team',
      referenceId: 'legacy-org-id',
      status: 'active',
      seats: 5,
    })

    expect(result).toEqual({
      id: 'sub-1',
      plan: 'team',
      referenceId: 'legacy-org-id',
      status: 'active',
      seats: 5,
    })
    expect(mockCreateOrganizationWithOwner).not.toHaveBeenCalled()
    expect(mockAttachOwnedWorkspacesToOrganization).not.toHaveBeenCalled()
  })
})
