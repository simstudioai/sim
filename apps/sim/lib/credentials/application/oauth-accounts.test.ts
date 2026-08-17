/**
 * @vitest-environment node
 */
import { account, credential } from '@sim/db/schema'
import { auditMock, auditMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  deleteCredential: vi.fn(),
  capture: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/credentials/orchestration', () => ({
  deleteCredentialRecord: mocks.deleteCredential,
}))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mocks.capture }))

import { disconnectOAuthUseCase } from '@/lib/credentials/application/oauth-accounts'

const firstCredential = {
  id: 'credential-1',
  workspaceId: 'workspace-1',
  type: 'oauth' as const,
  displayName: 'First Google account',
  description: null,
  providerId: 'google-email',
  accountId: 'account-1',
  envKey: null,
  envOwnerUserId: null,
  encryptedServiceAccountKey: null,
  createdBy: 'user-1',
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-01T00:00:00.000Z'),
}

describe('OAuth account application operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('audits and captures committed deletions before rethrowing a later failure', async () => {
    const secondCredential = {
      ...firstCredential,
      id: 'credential-2',
      displayName: 'Second Google account',
      accountId: 'account-2',
    }
    queueTableRows(account, [{ id: 'account-1' }, { id: 'account-2' }])
    queueTableRows(credential, [firstCredential, secondCredential])
    mocks.deleteCredential
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error('Second credential delete failed'))

    await expect(
      disconnectOAuthUseCase.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { provider: 'google' },
      })
    ).rejects.toMatchObject({
      name: 'OAuthDisconnectPartialFailureError',
      credentials: [firstCredential],
    })

    expect(auditMockFns.mockRecordAudit).toHaveBeenCalledTimes(1)
    expect(auditMockFns.mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'credential.deleted',
        resourceId: firstCredential.id,
        metadata: expect.objectContaining({ reason: 'oauth_disconnect' }),
      })
    )
    expect(mocks.capture).toHaveBeenCalledWith(
      'user-1',
      'credential_deleted',
      expect.objectContaining({
        provider_id: 'google-email',
        workspace_id: 'workspace-1',
      }),
      { groups: { workspace: 'workspace-1' } }
    )
  })
})
