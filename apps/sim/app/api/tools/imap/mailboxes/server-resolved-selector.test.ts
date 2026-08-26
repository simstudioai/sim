/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  resolveContext: vi.fn(),
  validateDatabaseHost: vi.fn(),
  imapConstruct: vi.fn(),
  imapConnect: vi.fn(),
  imapList: vi.fn(),
  imapLogout: vi.fn(),
}))

vi.mock('@/lib/selectors/server/resolve-authorized-context', () => ({
  authenticateSelectorRequest: mocks.authenticate,
  resolveAuthorizedSelectorContext: mocks.resolveContext,
}))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  validateDatabaseHost: mocks.validateDatabaseHost,
}))

vi.mock('imapflow', () => ({
  ImapFlow: class MockImapFlow {
    constructor(config: unknown) {
      mocks.imapConstruct(config)
    }

    connect = mocks.imapConnect
    list = mocks.imapList
    logout = mocks.imapLogout
  },
}))

import { POST as listMailboxes } from '@/app/api/tools/imap/mailboxes/route'

function request(body: unknown) {
  return createMockRequest('POST', body, {}, 'http://localhost:3000/api/tools/imap/mailboxes')
}

const wireBody = {
  workflowId: 'workflow-1',
  host: '{{IMAP_HOST}}',
  port: '{{IMAP_PORT}}',
  secure: '{{IMAP_TLS}}',
  username: '{{IMAP_USERNAME}}',
  password: '{{IMAP_PASSWORD}}',
}

describe('server-resolved IMAP mailbox selector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticate.mockResolvedValue({
      ok: true,
      principal: { kind: 'session', userId: 'viewer-1', sessionId: 'session-1' },
    })
    mocks.resolveContext.mockResolvedValue({
      ok: true,
      context: {
        host: 'imap.example.com',
        port: '993',
        secure: 'true',
        username: 'mailbox@example.com',
        password: 'resolved-password',
      },
      requesterUserId: 'viewer-1',
      workspaceId: 'workspace-1',
    })
    mocks.validateDatabaseHost.mockResolvedValue({
      isValid: true,
      resolvedIP: '203.0.113.10',
    })
    mocks.imapConnect.mockResolvedValue(undefined)
    mocks.imapList.mockResolvedValue([
      { path: 'Archive', name: 'Archive', delimiter: '/' },
      { path: 'INBOX', name: 'INBOX', delimiter: '/' },
    ])
    mocks.imapLogout.mockResolvedValue(undefined)
  })

  it('authenticates before parsing malformed requests', async () => {
    mocks.authenticate.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' })

    const response = await listMailboxes(request({}))

    expect(response.status).toBe(401)
    expect(mocks.resolveContext).not.toHaveBeenCalled()
  })

  it('passes every raw connection field to the resolver and maps sorted mailboxes', async () => {
    const response = await listMailboxes(request(wireBody))

    expect(await response.json()).toEqual({
      success: true,
      mailboxes: [
        { path: 'INBOX', name: 'INBOX', delimiter: '/' },
        { path: 'Archive', name: 'Archive', delimiter: '/' },
      ],
    })
    expect(mocks.resolveContext).toHaveBeenCalledWith(expect.anything(), {
      workflowId: 'workflow-1',
      context: {
        host: '{{IMAP_HOST}}',
        port: '{{IMAP_PORT}}',
        secure: '{{IMAP_TLS}}',
        username: '{{IMAP_USERNAME}}',
        password: '{{IMAP_PASSWORD}}',
      },
    })
    expect(mocks.validateDatabaseHost).toHaveBeenCalledWith('imap.example.com', 'host', {
      logFailureDetails: false,
    })
    expect(mocks.imapConstruct).toHaveBeenCalledWith(
      expect.objectContaining({
        host: '203.0.113.10',
        servername: 'imap.example.com',
        port: 993,
        secure: true,
        auth: { user: 'mailbox@example.com', pass: 'resolved-password' },
      })
    )
    expect(mocks.imapLogout).toHaveBeenCalledOnce()
  })

  it('short-circuits inaccessible references before DNS or provider access', async () => {
    mocks.resolveContext.mockResolvedValue({
      ok: false,
      status: 400,
      error: 'Unable to resolve selector configuration',
    })

    const response = await listMailboxes(request(wireBody))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      success: false,
      message: 'Unable to resolve selector configuration',
    })
    expect(mocks.validateDatabaseHost).not.toHaveBeenCalled()
    expect(mocks.imapConstruct).not.toHaveBeenCalled()
  })

  it('rejects invalid resolved port/TLS values before DNS or provider access', async () => {
    mocks.resolveContext.mockResolvedValue({
      ok: true,
      context: {
        host: 'imap.example.com',
        port: 'invalid',
        secure: 'invalid',
        username: 'mailbox@example.com',
        password: 'resolved-password',
      },
      requesterUserId: 'viewer-1',
      workspaceId: 'workspace-1',
    })

    const response = await listMailboxes(request(wireBody))

    expect(response.status).toBe(400)
    expect(mocks.validateDatabaseHost).not.toHaveBeenCalled()
    expect(mocks.imapConstruct).not.toHaveBeenCalled()
  })

  it('sanitizes provider connection failures and logs out best-effort', async () => {
    mocks.imapConnect.mockRejectedValue(
      new Error('connection failed with resolved-password and imap.example.com')
    )

    const response = await listMailboxes(request(wireBody))
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({
      success: false,
      message: 'Failed to connect to IMAP server. Please check your connection settings.',
    })
    expect(mocks.imapLogout).toHaveBeenCalledOnce()
  })
})
