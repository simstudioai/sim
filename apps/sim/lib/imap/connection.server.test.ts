/**
 * @vitest-environment node
 */
import { environmentUtilsMockFns, resetEnvironmentUtilsMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockImapFlow, mockValidateDatabaseHost } = vi.hoisted(() => ({
  mockImapFlow: vi.fn(),
  mockValidateDatabaseHost: vi.fn(),
}))

vi.mock('imapflow', () => ({
  ImapFlow: function MockImapFlow(options: unknown) {
    mockImapFlow(options)
  },
}))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  validateDatabaseHost: mockValidateDatabaseHost,
}))

import {
  createSecureImapClient,
  type ImapConnectionPolicyError,
  normalizeLiteralImapConnection,
  resolveImapConnectionForActor,
} from '@/lib/imap/connection.server'

function environmentSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    personalEncrypted: {},
    workspaceEncrypted: {},
    personalDecrypted: {},
    workspaceDecrypted: {},
    personalOwners: {},
    conflicts: [],
    decryptionFailures: [],
    workspaceUnredactedKeys: [],
    ...overrides,
  }
}

describe('IMAP connection policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetEnvironmentUtilsMock()
    mockValidateDatabaseHost.mockResolvedValue({
      isValid: true,
      sanitized: 'imap.example.com',
      resolvedIP: '203.0.113.10',
    })
  })

  afterAll(resetEnvironmentUtilsMock)

  it('accepts literal configuration while requiring TLS or STARTTLS on the pinned host', async () => {
    const secureConnection = normalizeLiteralImapConnection({
      host: ' imap.example.com ',
      username: 'mailbox-user',
      password: 'literal-password',
    })
    const startTlsConnection = normalizeLiteralImapConnection({
      host: 'imap.example.com',
      port: '143',
      secure: 'false',
      username: 'mailbox-user',
      password: 'literal-password',
    })

    await createSecureImapClient(secureConnection)
    await createSecureImapClient(startTlsConnection)

    expect(secureConnection).toEqual({
      host: 'imap.example.com',
      port: 993,
      secure: true,
      username: 'mailbox-user',
      password: 'literal-password',
    })
    expect(mockValidateDatabaseHost).toHaveBeenCalledTimes(2)
    expect(mockValidateDatabaseHost).toHaveBeenNthCalledWith(1, 'imap.example.com', 'host', {
      logDetails: false,
    })
    expect(mockValidateDatabaseHost).toHaveBeenNthCalledWith(2, 'imap.example.com', 'host', {
      logDetails: false,
    })
    expect(mockImapFlow).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        host: '203.0.113.10',
        servername: 'imap.example.com',
        port: 993,
        secure: true,
        auth: { user: 'mailbox-user', pass: 'literal-password' },
        tls: { rejectUnauthorized: true },
        logger: false,
      })
    )
    expect(mockImapFlow.mock.calls[0]?.[0]).not.toHaveProperty('doSTARTTLS')
    expect(mockImapFlow).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ secure: false, port: 143, doSTARTTLS: true })
    )
  })

  it('resolves exact personal and visible shared references for the deployment actor', async () => {
    environmentUtilsMockFns.mockGetEffectiveEnvironmentSnapshot.mockResolvedValue(
      environmentSnapshot({
        personalDecrypted: { PERSONAL_PASSWORD: 'personal-password' },
        workspaceDecrypted: {
          SHARED_HOST: 'imap.shared.example',
          SHARED_PORT: '143',
          SHARED_SECURE: 'false',
          SHARED_USERNAME: 'shared-user',
        },
        personalOwners: { PERSONAL_PASSWORD: 'actor-1' },
        workspaceUnredactedKeys: ['SHARED_USERNAME'],
      })
    )

    await expect(
      resolveImapConnectionForActor({
        connection: {
          host: '{{SHARED_HOST}}',
          port: '{{SHARED_PORT}}',
          secure: '{{SHARED_SECURE}}',
          username: '{{SHARED_USERNAME}}',
          password: '{{PERSONAL_PASSWORD}}',
        },
        actorUserId: 'actor-1',
        workspaceId: 'workspace-1',
      })
    ).resolves.toEqual({
      host: 'imap.shared.example',
      port: 143,
      secure: false,
      username: 'shared-user',
      password: 'personal-password',
    })
    expect(environmentUtilsMockFns.mockGetEffectiveEnvironmentSnapshot).toHaveBeenCalledWith(
      'actor-1',
      'workspace-1'
    )
  })

  it('rejects hidden shared username and password references before DNS or ImapFlow', async () => {
    environmentUtilsMockFns.mockGetEffectiveEnvironmentSnapshot.mockResolvedValue(
      environmentSnapshot({
        workspaceDecrypted: { HIDDEN_AUTH: 'use-only-secret' },
      })
    )

    for (const field of ['username', 'password'] as const) {
      const connection = {
        host: 'imap.example.com',
        username: 'literal-user',
        password: 'literal-password',
        [field]: '{{HIDDEN_AUTH}}',
      }
      await expect(
        resolveImapConnectionForActor({
          connection,
          actorUserId: 'actor-1',
          workspaceId: 'workspace-1',
        })
      ).rejects.toMatchObject<Partial<ImapConnectionPolicyError>>({
        name: 'ImapConnectionPolicyError',
        code: 'hidden_auth',
        message: 'IMAP connection is unavailable',
      })
    }

    expect(mockValidateDatabaseHost).not.toHaveBeenCalled()
    expect(mockImapFlow).not.toHaveBeenCalled()
  })
})
