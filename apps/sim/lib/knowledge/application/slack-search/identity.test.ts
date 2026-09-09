/** @vitest-environment node */
import { db } from '@sim/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/credential-groups/credentials', () => ({
  LIVE_ENROLLMENT_STATUSES: ['active', 'partial'],
}))

import { resolveSlackSearchMember } from '@/lib/knowledge/application/slack-search/identity'

const limit = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  const query = { from: vi.fn(), innerJoin: vi.fn(), where: vi.fn(), limit }
  query.from.mockReturnValue(query)
  query.innerJoin.mockReturnValue(query)
  query.where.mockReturnValue(query)
  vi.mocked(db.select).mockReturnValue(query as ReturnType<typeof db.select>)
})

describe('Slack email to Sim member resolution', () => {
  it('accepts a verified current member without personal Slack enrollment', async () => {
    limit
      .mockResolvedValueOnce([{ id: 'u1', emailVerified: true }])
      .mockResolvedValueOnce([{ id: 'm1' }])
      .mockResolvedValueOnce([])
    await expect(resolveSlackSearchMember('org1', 'T1', 'U1', 'alice@example.com')).resolves.toBe(
      'u1'
    )
  })
  it.each([
    { users: [] },
    { users: [{ id: 'u1', emailVerified: false }] },
    {
      users: [
        { id: 'u1', emailVerified: true },
        { id: 'u2', emailVerified: true },
      ],
    },
  ])('refuses missing, unverified, or ambiguous accounts', async ({ users }) => {
    limit.mockResolvedValueOnce(users)
    await expect(resolveSlackSearchMember('org1', 'T1', 'U1', 'alice@example.com')).rejects.toThrow(
      'verified Sim account'
    )
    expect(limit).toHaveBeenCalledOnce()
  })
  it('refuses a user removed from the organization', async () => {
    limit.mockResolvedValueOnce([{ id: 'u1', emailVerified: true }]).mockResolvedValueOnce([])
    await expect(resolveSlackSearchMember('org1', 'T1', 'U1', 'alice@example.com')).rejects.toThrow(
      'verified Sim account'
    )
  })
  it('refuses a contradictory active Slack identity', async () => {
    limit
      .mockResolvedValueOnce([{ id: 'u1', emailVerified: true }])
      .mockResolvedValueOnce([{ id: 'm1' }])
      .mockResolvedValueOnce([{ id: 'conflict' }])
    await expect(resolveSlackSearchMember('org1', 'T1', 'U1', 'alice@example.com')).rejects.toThrow(
      'verified Sim account'
    )
  })
  it('propagates a database failure without guessing an identity', async () => {
    limit.mockRejectedValueOnce(new Error('database unavailable'))
    await expect(resolveSlackSearchMember('org1', 'T1', 'U1', 'alice@example.com')).rejects.toThrow(
      'database unavailable'
    )
  })
})
