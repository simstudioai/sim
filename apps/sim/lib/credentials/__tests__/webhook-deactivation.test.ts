/**
 * @vitest-environment node
 */

import { dbChainMockFns, drizzleOrmMock, resetDbChainMock, schemaMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearCredentialRefs } from '@/lib/credentials/deletion'

describe('credential-bound webhook deactivation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  afterAll(resetDbChainMock)

  it('deactivates QuickBooks and Slack webhook registrations when a credential is removed', async () => {
    await clearCredentialRefs('credential-1', 'workspace-1')

    expect(dbChainMockFns.update).toHaveBeenCalledWith(schemaMock.webhook)
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: false, updatedAt: expect.any(Date) })
    )
    expect(drizzleOrmMock.eq).toHaveBeenCalledWith(schemaMock.webhook.provider, 'quickbooks')
    expect(drizzleOrmMock.eq).toHaveBeenCalledWith(schemaMock.webhook.provider, 'slack_app')
    expect(drizzleOrmMock.eq).toHaveBeenCalledWith(schemaMock.webhook.provider, 'slack')
  })
})
