/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resumeConnectorsAfterCredentialReconnect } from '@/lib/knowledge/connectors/credential-recovery'
import { CREDENTIAL_REVOKED_SYNC_ERROR } from '@/lib/knowledge/connectors/sync-limits'

describe('resumeConnectorsAfterCredentialReconnect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('puts only the connectors the rejected credential unscheduled back on schedule', async () => {
    const now = new Date('2026-09-22T20:00:00.000Z')
    await resumeConnectorsAfterCredentialReconnect('credential-1', now)
    expect(dbChainMockFns.set).toHaveBeenCalledWith({
      status: 'active',
      lastSyncError: null,
      consecutiveFailures: 0,
      nextSyncAt: now,
      updatedAt: now,
    })
    const guard = JSON.stringify(dbChainMockFns.where.mock.calls.at(-1))
    expect(guard).toContain('knowledgeConnector.credentialId')
    expect(guard).toContain('credential-1')
    expect(guard).toContain('knowledgeConnector.status')
    expect(guard).toContain(CREDENTIAL_REVOKED_SYNC_ERROR)
  })
})
