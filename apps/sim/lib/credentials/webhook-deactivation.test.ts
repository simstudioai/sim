import { dbChainMockFns, drizzleOrmMock, resetDbChainMock, schemaMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { clearCredentialRefs, deleteConnectionCredential } from '@/lib/credentials/deletion'

describe('credential-bound webhook deactivation', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  afterAll(() => {
    resetDbChainMock()
  })

  it('deactivates QuickBooks, TikTok, and Slack webhook registrations when a credential is removed', async () => {
    await clearCredentialRefs('credential-1', 'workspace-1')

    expect(dbChainMockFns.update).toHaveBeenCalledWith(schemaMock.webhook)
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: false, updatedAt: expect.any(Date) })
    )
    expect(drizzleOrmMock.eq).toHaveBeenCalledWith(schemaMock.webhook.provider, 'tiktok')
    expect(drizzleOrmMock.eq).toHaveBeenCalledWith(schemaMock.webhook.provider, 'quickbooks')
    expect(drizzleOrmMock.eq).toHaveBeenCalledWith(schemaMock.webhook.provider, 'slack_app')
    expect(drizzleOrmMock.eq).toHaveBeenCalledWith(schemaMock.webhook.provider, 'slack')
  })
})

describe('deleteConnectionCredential', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  afterAll(() => {
    resetDbChainMock()
  })

  it('deletes exactly one credential within its canonical workspace scope', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'credential-1' }])

    const deleted = await deleteConnectionCredential({
      credentialId: 'credential-1',
      workspaceId: 'workspace-1',
      reason: 'user_delete',
    })

    expect(deleted).toBe(true)
    expect(dbChainMockFns.delete).toHaveBeenCalledWith(schemaMock.credential)
    expect(drizzleOrmMock.eq).toHaveBeenCalledWith(schemaMock.credential.id, 'credential-1')
    expect(drizzleOrmMock.eq).toHaveBeenCalledWith(schemaMock.credential.workspaceId, 'workspace-1')
  })
})
