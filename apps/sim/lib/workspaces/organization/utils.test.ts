import { describe, expect, it } from 'vitest'
import { calculateSeatUsage } from '@/lib/workspaces/organization/utils'

describe('calculateSeatUsage', () => {
  it('does not count external pending workspace invitations as occupied seats', () => {
    const seats = calculateSeatUsage({
      id: 'org-1',
      name: 'Acme',
      slug: 'acme',
      createdAt: new Date(),
      members: [
        { id: 'member-1', role: 'owner' },
        { id: 'member-2', role: 'member' },
      ],
      invitations: [
        {
          id: 'inv-1',
          email: 'internal@example.com',
          status: 'pending',
          membershipIntent: 'internal',
        },
        {
          id: 'inv-2',
          email: 'external@example.com',
          status: 'pending',
          membershipIntent: 'external',
        },
      ],
    })

    expect(seats).toEqual({ used: 3, members: 2, pending: 1 })
  })
})
