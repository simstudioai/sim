/**
 * @vitest-environment node
 */
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resumeConnectorsAfterCredentialReconnect } from '@/lib/knowledge/connectors/credential-recovery'
import { CREDENTIAL_REVOKED_SYNC_ERROR } from '@/lib/knowledge/connectors/sync-limits'

const RESUMED = {
  status: 'active',
  lastSyncError: null,
  consecutiveFailures: 0,
}

describe('resumeConnectorsAfterCredentialReconnect', () => {
  const now = new Date('2026-09-22T20:00:00.000Z')

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('resumes the connectors of every credential on the reconnected account', async () => {
    queueTableRows(schemaMock.account, [
      { providerId: 'confluence', providerAccountId: 'subject-1' },
    ])
    await resumeConnectorsAfterCredentialReconnect('account-1', now)
    expect(dbChainMockFns.set).toHaveBeenCalledWith({ ...RESUMED, nextSyncAt: now, updatedAt: now })
    const guard = JSON.stringify(dbChainMockFns.where.mock.calls.at(-1))
    expect(guard).toContain('knowledgeConnector.credentialId')
    expect(guard).toContain(CREDENTIAL_REVOKED_SYNC_ERROR)
    const credentials = JSON.stringify(dbChainMockFns.where.mock.calls)
    expect(credentials).toContain('"left":"credential.accountId","right":"account-1"')
  })

  it('resumes across the Slack installation, whose sibling accounts share the repaired chain', async () => {
    queueTableRows(schemaMock.account, [
      { providerId: 'slack', providerAccountId: 'TEXAMPLE-usr_U1' },
    ])
    await resumeConnectorsAfterCredentialReconnect('account-1', now)
    expect(dbChainMockFns.set).toHaveBeenCalledWith({ ...RESUMED, nextSyncAt: now, updatedAt: now })
    const conditions = JSON.stringify(dbChainMockFns.where.mock.calls)
    expect(conditions).toContain('"pattern":"TEXAMPLE-%"')
    expect(conditions).not.toContain('"left":"credential.accountId","right":"account-1"')
  })

  it('does nothing for an account that no longer exists', async () => {
    queueTableRows(schemaMock.account, [])
    await resumeConnectorsAfterCredentialReconnect('account-gone', now)
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
})
