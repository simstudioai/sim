/**
 * @vitest-environment node
 */
import { db } from '@sim/db'
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ForbiddenOperationError } from '@/lib/core/application'

const { mockDeploymentEnabled, mockEntitled } = vi.hoisted(() => ({
  mockDeploymentEnabled: vi.fn(),
  mockEntitled: vi.fn(),
}))
vi.mock('@/ee/scim/lib/entitlement', () => ({
  isScimDeploymentEnabled: mockDeploymentEnabled,
  isScimEntitledForOrganization: mockEntitled,
}))

import {
  assertInviteeNotScimManaged,
  assertMembershipNotScimManaged,
} from '@/ee/scim/lib/managed-membership'

const params = { organizationId: 'org-1', userId: 'user-1', executor: db }

function queueProbe(managed: boolean) {
  dbChainMockFns.from.mockResolvedValueOnce([{ managed }])
}

describe('assertMembershipNotScimManaged', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockDeploymentEnabled.mockReturnValue(true)
    mockEntitled.mockResolvedValue(true)
  })

  it('refuses a change to a member the directory manages', async () => {
    queueProbe(true)
    const failure = await assertMembershipNotScimManaged(params).catch((error) => error)
    expect(failure).toBeInstanceOf(ForbiddenOperationError)
    expect(failure.detailCode).toBe('SCIM_MANAGED_MEMBERSHIP')
  })

  it('lets the change through once the organization can no longer sync', async () => {
    queueProbe(true)
    mockEntitled.mockResolvedValue(false)
    await expect(assertMembershipNotScimManaged(params)).resolves.toBeUndefined()
    expect(mockEntitled).toHaveBeenCalledWith('org-1')
  })

  it('never reads the plan for a member the directory does not manage', async () => {
    queueProbe(false)
    await expect(assertMembershipNotScimManaged(params)).resolves.toBeUndefined()
    expect(mockEntitled).not.toHaveBeenCalled()
  })

  it('does not query at all on a deployment without provisioning', async () => {
    mockDeploymentEnabled.mockReturnValue(false)
    await expect(assertMembershipNotScimManaged(params)).resolves.toBeUndefined()
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })
})

describe('assertInviteeNotScimManaged', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEntitled.mockResolvedValue(true)
  })

  it('refuses an invitation to someone the directory provisions', async () => {
    await expect(
      assertInviteeNotScimManaged({ organizationId: 'org-1', managed: true })
    ).rejects.toMatchObject({ detailCode: 'SCIM_MANAGED_MEMBERSHIP' })
  })

  it('allows the invitation once the directory can no longer sync', async () => {
    mockEntitled.mockResolvedValue(false)
    await expect(
      assertInviteeNotScimManaged({ organizationId: 'org-1', managed: true })
    ).resolves.toBeUndefined()
  })

  it('costs no plan read for an ordinary invitee', async () => {
    await expect(
      assertInviteeNotScimManaged({ organizationId: 'org-1', managed: false })
    ).resolves.toBeUndefined()
    expect(mockEntitled).not.toHaveBeenCalled()
  })
})
