/** @vitest-environment node */
import { account, credential } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { eq, ne } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { enrolled } = vi.hoisted(() => ({ enrolled: vi.fn() }))
vi.mock('@/lib/credentials/environment', () => ({ getEnrolledManagedOAuthCredentials: enrolled }))

import { getPersonalOAuthCredentials } from '@/lib/credentials/personal'

describe('personal OAuth queries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    enrolled.mockResolvedValue([])
  })

  it('looks up one credential in SQL while preserving personal ownership and provider binding', async () => {
    queueTableRows(credential, [{ id: 'mine', providerId: 'google-drive', displayName: 'Drive' }])
    expect(await getPersonalOAuthCredentials('workspace', 'person', 'mine')).toEqual([
      expect.objectContaining({ id: 'mine', type: 'oauth' }),
    ])
    expect(eq).toHaveBeenCalledWith(credential.id, 'mine')
    expect(eq).toHaveBeenCalledWith(credential.workspaceId, 'workspace')
    expect(eq).toHaveBeenCalledWith(credential.type, 'oauth')
    expect(eq).toHaveBeenCalledWith(account.userId, 'person')
    expect(eq).toHaveBeenCalledWith(account.providerId, credential.providerId)
    expect(ne).toHaveBeenCalledWith(credential.providerId, 'slack')
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(1)
    expect(enrolled).toHaveBeenCalledWith('workspace', 'person', 'mine')
  })

  it('does not fall back to listing accounts when the requested ID is empty', async () => {
    await getPersonalOAuthCredentials('workspace', 'person', '')
    expect(eq).toHaveBeenCalledWith(credential.id, '')
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(1)
    expect(enrolled).toHaveBeenCalledWith('workspace', 'person', '')
  })
})
