import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it } from 'vitest'
import { getUserEmailsByIds } from '@/lib/users/queries'

describe('getUserEmailsByIds', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  it('fails when a stored attribution cannot be resolved', async () => {
    dbChainMockFns.where.mockResolvedValue([{ id: 'user-1', email: 'ada@example.com' }])

    await expect(getUserEmailsByIds(['user-1', 'missing-user'])).rejects.toThrow(
      'Unable to resolve email for user IDs: missing-user'
    )
  })

  it('rejects an unbounded attribution batch before querying', async () => {
    const ids = Array.from({ length: 1001 }, (_, index) => `user-${index}`)

    await expect(getUserEmailsByIds(ids)).rejects.toThrow(
      'Cannot resolve more than 1000 user emails at once'
    )
    expect(dbChainMockFns.where).not.toHaveBeenCalled()
  })
})
