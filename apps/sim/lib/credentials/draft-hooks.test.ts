/**
 * @vitest-environment node
 */
import {
  auditMock,
  auditMockFns,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  clearDeadFlag: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/oauth/terminal-errors', () => ({ clearDeadFlag: mocks.clearDeadFlag }))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: vi.fn() }))

import {
  handleCreateCredentialFromDraft,
  handleReconnectCredential,
} from '@/lib/credentials/draft-hooks'

describe('handleCreateCredentialFromDraft', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('treats a wrapped workspace-account conflict as an existing connection', async () => {
    const now = new Date('2026-08-14T18:00:00.000Z')
    const cause = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint_name: 'credential_workspace_account_unique',
    })
    dbChainMockFns.values.mockRejectedValueOnce(new Error('Failed query', { cause }))
    queueTableRows(schemaMock.credential, [
      { id: 'credential-existing', displayName: 'Existing Gmail' },
    ])

    await handleCreateCredentialFromDraft({
      draft: {
        workspaceId: 'workspace-1',
        displayName: 'New Gmail',
        description: null,
      },
      accountId: 'account-1',
      providerId: 'google-email',
      userId: 'user-1',
      now,
    })

    expect(dbChainMockFns.update).toHaveBeenCalledWith(schemaMock.credential)
    expect(dbChainMockFns.set).toHaveBeenCalledWith({ updatedAt: now })
    expect(mocks.clearDeadFlag).toHaveBeenCalledWith('account-1')
    expect(auditMockFns.mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'credential.reconnected',
        resourceId: 'credential-existing',
        resourceName: 'Existing Gmail',
      })
    )
  })

  it('rethrows a different unique constraint failure', async () => {
    const cause = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint_name: 'credential_display_name_unique',
    })
    const wrapped = new Error('Failed query', { cause })
    dbChainMockFns.values.mockRejectedValueOnce(wrapped)

    await expect(
      handleCreateCredentialFromDraft({
        draft: {
          workspaceId: 'workspace-1',
          displayName: 'New Gmail',
          description: null,
        },
        accountId: 'account-1',
        providerId: 'google-email',
        userId: 'user-1',
        now: new Date('2026-08-14T18:00:00.000Z'),
      })
    ).rejects.toBe(wrapped)
  })
})

describe('handleReconnectCredential', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('audits a reconnect with the credential current name instead of draft presentation', async () => {
    queueTableRows(schemaMock.credential, [
      { id: 'credential-1', accountId: null, displayName: 'Renamed Gmail' },
    ])
    queueTableRows(schemaMock.credential, [])

    await handleReconnectCredential({
      draft: { credentialId: 'credential-1' },
      newAccountId: 'account-new',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      now: new Date('2026-08-14T18:00:00.000Z'),
    })

    expect(auditMockFns.mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceId: 'credential-1',
        resourceName: 'Renamed Gmail',
        description: 'Reconnected OAuth credential "Renamed Gmail" to a new account',
      })
    )
  })
})
