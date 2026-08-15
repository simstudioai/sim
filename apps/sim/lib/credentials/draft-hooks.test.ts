/**
 * @vitest-environment node
 */
import { auditMock, auditMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  clearDeadFlag: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/oauth/terminal-errors', () => ({ clearDeadFlag: mocks.clearDeadFlag }))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: vi.fn() }))

import { handleReconnectCredential } from '@/lib/credentials/draft-hooks'

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
