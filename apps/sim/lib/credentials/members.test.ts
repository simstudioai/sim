/**
 * @vitest-environment node
 */
import { dbChainMockFns, drizzleOrmMock, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it } from 'vitest'
import { listCredentialMembershipsForUser } from '@/lib/credentials/members'

describe('listCredentialMembershipsForUser', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  it('excludes managed OAuth credentials from ordinary memberships', async () => {
    dbChainMockFns.where.mockResolvedValue([])

    await listCredentialMembershipsForUser('user-1')

    expect(drizzleOrmMock.ne).toHaveBeenCalledWith(schemaMock.credential.type, 'managed_oauth')
  })
})
