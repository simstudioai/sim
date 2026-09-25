import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ organizationLock: vi.fn(), groupLock: vi.fn(), regime: vi.fn() }))
vi.mock('@/lib/billing/organizations/membership', () => ({
  acquireOrganizationMutationLock: mocks.organizationLock,
}))
vi.mock('@/lib/permission-groups/locks', () => ({ acquirePermissionGroupOrgLock: mocks.groupLock }))
vi.mock('@/lib/permission-groups/resolve.server', () => ({
  isOrganizationPermissionRegimeActive: mocks.regime,
}))

import { withPermissionGroupMutation } from '@/lib/permission-groups/mutation'

beforeEach(() => {
  resetDbChainMock()
  mocks.regime.mockResolvedValue(true)
})

describe('permission group mutation entitlement', () => {
  it('rechecks live entitlement using the locked transaction before mutating', async () => {
    const mutate = vi.fn().mockResolvedValue('result')
    await expect(withPermissionGroupMutation('org-1', mutate)).resolves.toBe('result')
    const tx = mutate.mock.calls[0][0]
    expect(mocks.organizationLock).toHaveBeenCalledWith(tx, 'org-1')
    expect(mocks.groupLock).toHaveBeenCalledWith(tx, 'org-1', { lockTimeoutAlreadyBounded: true })
    expect(mocks.regime).toHaveBeenCalledWith('org-1', tx)
    expect(mocks.organizationLock.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.groupLock.mock.invocationCallOrder[0]
    )
    expect(mocks.groupLock.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.regime.mock.invocationCallOrder[0]
    )
    expect(mocks.regime.mock.invocationCallOrder[0]).toBeLessThan(
      mutate.mock.invocationCallOrder[0]
    )
    expect(dbChainMockFns.transaction).toHaveBeenCalledOnce()
  })

  it('refuses a mutation when entitlement changed while waiting for the lock', async () => {
    const gate = Promise.withResolvers<void>()
    mocks.organizationLock.mockImplementationOnce(() => gate.promise)
    const mutate = vi.fn()
    const result = withPermissionGroupMutation('org-1', mutate)
    expect(mocks.regime).not.toHaveBeenCalled()
    mocks.regime.mockResolvedValue(false)
    gate.resolve()
    await expect(result).rejects.toMatchObject({ detailCode: 'ENTERPRISE_PLAN_REQUIRED' })
    expect(mutate).not.toHaveBeenCalled()
  })
})
