/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCreateSecureImapClient,
  mockDbSelect,
  mockHasImapEnvironmentReferences,
  mockLogger,
  mockMarkWebhookFailed,
  mockResolveImapConnectionForActor,
} = vi.hoisted(() => ({
  mockCreateSecureImapClient: vi.fn(),
  mockDbSelect: vi.fn(),
  mockHasImapEnvironmentReferences: vi.fn(),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  mockMarkWebhookFailed: vi.fn(),
  mockResolveImapConnectionForActor: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: { select: mockDbSelect },
}))

vi.mock('@/lib/core/idempotency/service', () => ({
  pollingIdempotency: { executeWithIdempotency: vi.fn() },
}))

vi.mock('@/lib/imap/connection.server', () => ({
  createSecureImapClient: mockCreateSecureImapClient,
  hasImapEnvironmentReferences: mockHasImapEnvironmentReferences,
  normalizeLiteralImapConnection: vi.fn(),
  resolveImapConnectionForActor: mockResolveImapConnectionForActor,
}))

vi.mock('@/lib/webhooks/polling/utils', () => ({
  markWebhookFailed: mockMarkWebhookFailed,
  markWebhookSuccess: vi.fn(),
  updateWebhookProviderConfig: vi.fn(),
}))

vi.mock('@/lib/webhooks/processor', () => ({
  processPolledWebhookEvent: vi.fn(),
}))

import { imapPollingHandler } from '@/lib/webhooks/polling/imap'

describe('IMAP runtime polling policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHasImapEnvironmentReferences.mockReturnValue(true)
    mockMarkWebhookFailed.mockResolvedValue(undefined)
  })

  it('fails closed before resolution, DNS, or ImapFlow when referenced auth has no deployment actor', async () => {
    const result = await imapPollingHandler.pollWebhook({
      webhookData: {
        id: 'webhook-1',
        deploymentVersionId: null,
        providerConfig: {
          host: '{{IMAP_HOST}}',
          username: 'literal-user',
          password: 'literal-password',
        },
      } as never,
      workflowData: { id: 'workflow-1', workspaceId: 'workspace-1' } as never,
      requestId: 'request-1',
      logger: mockLogger as never,
    })

    expect(result).toBe('failure')
    expect(mockMarkWebhookFailed).toHaveBeenCalledWith('webhook-1', mockLogger)
    expect(mockDbSelect).not.toHaveBeenCalled()
    expect(mockResolveImapConnectionForActor).not.toHaveBeenCalled()
    expect(mockCreateSecureImapClient).not.toHaveBeenCalled()

    const logged = JSON.stringify(mockLogger.error.mock.calls)
    expect(logged).not.toContain('literal-user')
    expect(logged).not.toContain('literal-password')
    expect(logged).not.toContain('Referenced IMAP authentication requires redeployment')
  })
})
