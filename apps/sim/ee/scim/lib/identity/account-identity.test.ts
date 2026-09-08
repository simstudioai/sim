/**
 * @vitest-environment node
 */
import { db } from '@sim/db'
import { user } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { assertAvailable } = vi.hoisted(() => ({ assertAvailable: vi.fn() }))

vi.mock('@/ee/scim/lib/identity/resolve-user', () => ({
  assertEmailAvailable: assertAvailable,
}))

import { syncAccountIdentityTx } from '@/ee/scim/lib/identity/account-identity'

afterAll(resetDbChainMock)

describe('syncAccountIdentityTx', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    queueTableRows(user, [{ email: 'ada@acme.test' }])
  })

  it('reports an address change for session revocation and clears email verification', async () => {
    await expect(
      syncAccountIdentityTx(db, { userId: 'u-1', email: 'new@acme.test', name: 'Ada' })
    ).resolves.toBe(true)
    expect(assertAvailable).toHaveBeenCalledWith(db, 'new@acme.test', 'u-1')
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'new@acme.test',
        normalizedEmail: 'new@acme.test',
        emailVerified: false,
      })
    )
  })

  it('does not report a case-only address change or clear its verification', async () => {
    await expect(
      syncAccountIdentityTx(db, { userId: 'u-1', email: 'Ada@acme.test', name: 'Ada' })
    ).resolves.toBe(false)
    expect(assertAvailable).not.toHaveBeenCalled()
    expect(dbChainMockFns.set.mock.calls[0][0]).not.toHaveProperty('emailVerified')
  })
})
