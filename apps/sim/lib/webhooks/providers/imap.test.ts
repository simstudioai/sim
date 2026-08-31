/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockClose,
  mockCreateSecureImapClient,
  mockDbLimit,
  mockDbSelect,
  mockDbUpdate,
  mockHasImapEnvironmentReferences,
  mockLogger,
  mockNormalizeLiteralImapConnection,
  mockResolveImapConnectionForActor,
} = vi.hoisted(() => ({
  mockClose: vi.fn(),
  mockCreateSecureImapClient: vi.fn(),
  mockDbLimit: vi.fn(),
  mockDbSelect: vi.fn(),
  mockDbUpdate: vi.fn(),
  mockHasImapEnvironmentReferences: vi.fn(),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  mockNormalizeLiteralImapConnection: vi.fn(),
  mockResolveImapConnectionForActor: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: { select: mockDbSelect, update: mockDbUpdate },
}))

vi.mock('@sim/logger', () => ({
  createLogger: () => mockLogger,
}))

vi.mock('@/lib/imap/connection.server', () => ({
  createSecureImapClient: mockCreateSecureImapClient,
  hasImapEnvironmentReferences: mockHasImapEnvironmentReferences,
  normalizeLiteralImapConnection: mockNormalizeLiteralImapConnection,
  resolveImapConnectionForActor: mockResolveImapConnectionForActor,
}))

import { imapHandler } from '@/lib/webhooks/providers/imap'

const referenceConfig = {
  host: '{{IMAP_HOST}}',
  port: '{{IMAP_PORT}}',
  secure: '{{IMAP_SECURE}}',
  username: '{{IMAP_USERNAME}}',
  password: '{{IMAP_PASSWORD}}',
  mailbox: 'INBOX',
}

describe('IMAP polling deployment policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHasImapEnvironmentReferences.mockImplementation((connection: object) =>
      Object.values(connection).some(
        (value) => typeof value === 'string' && /^\{\{[^{}]+\}\}$/.test(value)
      )
    )
    mockNormalizeLiteralImapConnection.mockImplementation((connection) => ({
      ...connection,
      port: 993,
      secure: true,
    }))
    mockResolveImapConnectionForActor.mockResolvedValue({
      host: 'imap.example.com',
      port: 143,
      secure: false,
      username: 'resolved-user',
      password: 'resolved-password',
    })
    mockCreateSecureImapClient.mockResolvedValue({ close: mockClose })
    mockDbLimit.mockResolvedValue([{ createdBy: 'deployment-actor' }])
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: mockDbLimit }),
      }),
    })
  })

  it('validates references JIT but persists the unresolved reference expressions', async () => {
    const persistProviderConfig = vi.fn().mockResolvedValue(true)

    await expect(
      imapHandler.configurePolling!({
        webhook: { id: 'webhook-1', providerConfig: referenceConfig },
        requestId: 'request-1',
        userId: 'actor-1',
        workspaceId: 'workspace-1',
        deploymentVersionId: 'deployment-1',
        persistProviderConfig,
      })
    ).resolves.toBe(true)

    expect(mockResolveImapConnectionForActor).toHaveBeenCalledWith({
      connection: referenceConfig,
      actorUserId: 'deployment-actor',
      workspaceId: 'workspace-1',
    })
    expect(mockCreateSecureImapClient).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'resolved-user', password: 'resolved-password' })
    )
    expect(mockClose).toHaveBeenCalledOnce()

    const persisted = persistProviderConfig.mock.calls[0]?.[0]
    expect(persisted).toMatchObject(referenceConfig)
    expect(persisted.secure).toBe('{{IMAP_SECURE}}')
    expect(persisted.port).toBe('{{IMAP_PORT}}')
    expect(JSON.stringify(persisted)).not.toContain('resolved-password')
    expect(mockDbUpdate).not.toHaveBeenCalled()
  })

  it('rejects reference-backed legacy setup without a deployment actor', async () => {
    await expect(
      imapHandler.configurePolling!({
        webhook: { id: 'webhook-1', providerConfig: referenceConfig },
        requestId: 'request-1',
        userId: 'actor-1',
        workspaceId: 'workspace-1',
        deploymentVersionId: null,
      })
    ).resolves.toBe(false)

    expect(mockDbSelect).not.toHaveBeenCalled()
    expect(mockResolveImapConnectionForActor).not.toHaveBeenCalled()
    expect(mockCreateSecureImapClient).not.toHaveBeenCalled()
  })

  it('persists legacy defaults when nullable port and secure values are supplied', async () => {
    const persistProviderConfig = vi.fn().mockResolvedValue(true)

    await expect(
      imapHandler.configurePolling!({
        webhook: {
          id: 'webhook-1',
          providerConfig: {
            host: 'imap.example.com',
            port: null,
            secure: null,
            username: 'literal-user',
            password: 'literal-password',
          },
        },
        requestId: 'request-1',
        userId: 'actor-1',
        workspaceId: 'workspace-1',
        persistProviderConfig,
      })
    ).resolves.toBe(true)

    expect(persistProviderConfig).toHaveBeenCalledWith(
      expect.objectContaining({ port: '993', secure: true })
    )
    expect(mockDbSelect).not.toHaveBeenCalled()
  })

  it('fails closed without logging raw connection errors or authentication values', async () => {
    mockCreateSecureImapClient.mockRejectedValue(
      new Error('provider echoed literal-user and literal-password')
    )

    await expect(
      imapHandler.configurePolling!({
        webhook: {
          id: 'webhook-1',
          providerConfig: {
            host: 'imap.example.com',
            username: 'literal-user',
            password: 'literal-password',
          },
        },
        requestId: 'request-1',
        userId: 'actor-1',
        workspaceId: 'workspace-1',
      })
    ).resolves.toBe(false)

    const logged = JSON.stringify(mockLogger.error.mock.calls)
    expect(logged).not.toContain('literal-user')
    expect(logged).not.toContain('literal-password')
    expect(logged).not.toContain('provider echoed')
    expect(mockNormalizeLiteralImapConnection).toHaveBeenCalledOnce()
    expect(mockCreateSecureImapClient).toHaveBeenCalledOnce()
    expect(mockDbUpdate).not.toHaveBeenCalled()
  })
})
