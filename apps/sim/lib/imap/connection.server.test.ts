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
  normalizeResolvedImapConnection,
  resolveImapConnectionForActor,
} from '@/lib/imap/connection.server'

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
    environmentUtilsMockFns.mockResolveEffectiveEnvironmentVariables.mockResolvedValue({
      PERSONAL_PASSWORD: {
        value: 'personal-password',
        scope: 'personal',
        visible: true,
      },
      SHARED_HOST: { value: 'imap.shared.example', scope: 'workspace', visible: false },
      SHARED_PORT: { value: '143', scope: 'workspace', visible: false },
      SHARED_SECURE: { value: 'false', scope: 'workspace', visible: false },
      SHARED_USERNAME: { value: 'shared-user', scope: 'workspace', visible: true },
    })

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
    expect(environmentUtilsMockFns.mockResolveEffectiveEnvironmentVariables).toHaveBeenCalledWith(
      'actor-1',
      'workspace-1',
      ['SHARED_HOST', 'SHARED_PORT', 'SHARED_SECURE', 'SHARED_USERNAME', 'PERSONAL_PASSWORD']
    )
    expect(environmentUtilsMockFns.mockGetEffectiveEnvironmentSnapshot).not.toHaveBeenCalled()
  })

  it('rejects hidden shared username and password references before DNS or ImapFlow', async () => {
    environmentUtilsMockFns.mockResolveEffectiveEnvironmentVariables.mockResolvedValue({
      HIDDEN_AUTH: { value: 'use-only-secret', scope: 'workspace', visible: false },
    })

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

  it('permits braces introduced by authorized resolution while keeping raw literals strict', () => {
    expect(
      normalizeResolvedImapConnection({
        host: 'imap.example.com',
        username: 'mailbox-user',
        password: 'literal{{brace}}secret',
      })
    ).toMatchObject({ password: 'literal{{brace}}secret' })

    expect(() =>
      normalizeLiteralImapConnection({
        host: 'imap.example.com',
        username: 'mailbox-user',
        password: 'literal{{brace}}secret',
      })
    ).toThrowError(
      expect.objectContaining<Partial<ImapConnectionPolicyError>>({
        name: 'ImapConnectionPolicyError',
        code: 'context',
      })
    )
  })

  it('reauthorizes requested references on every resolution and fails closed after revocation', async () => {
    environmentUtilsMockFns.mockResolveEffectiveEnvironmentVariables
      .mockResolvedValueOnce({
        PASSWORD: { value: 'visible-password', scope: 'workspace', visible: true },
      })
      .mockResolvedValueOnce({
        PASSWORD: { value: 'hidden-password', scope: 'workspace', visible: false },
      })
    const input = {
      connection: {
        host: 'imap.example.com',
        username: 'mailbox-user',
        password: '{{PASSWORD}}',
      },
      actorUserId: 'actor-1',
      workspaceId: 'workspace-1',
    }

    await expect(resolveImapConnectionForActor(input)).resolves.toMatchObject({
      password: 'visible-password',
    })
    await expect(resolveImapConnectionForActor(input)).rejects.toMatchObject<
      Partial<ImapConnectionPolicyError>
    >({
      name: 'ImapConnectionPolicyError',
      code: 'hidden_auth',
    })

    expect(environmentUtilsMockFns.mockResolveEffectiveEnvironmentVariables).toHaveBeenCalledTimes(
      2
    )
    expect(environmentUtilsMockFns.mockGetEffectiveEnvironmentSnapshot).not.toHaveBeenCalled()
  })
})
