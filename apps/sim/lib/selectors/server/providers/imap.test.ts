/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  MockImapConnectionPolicyError,
  mockListImapMailboxes,
  mockNormalizeResolvedImapConnection,
} = vi.hoisted(() => ({
  MockImapConnectionPolicyError: class extends Error {
    constructor(readonly code: 'context' | 'hidden_auth' | 'destination' | 'transport') {
      super('IMAP connection is unavailable')
    }
  },
  mockListImapMailboxes: vi.fn(),
  mockNormalizeResolvedImapConnection: vi.fn(),
}))

vi.mock('@/lib/imap/connection.server', () => ({
  ImapConnectionPolicyError: MockImapConnectionPolicyError,
  listImapMailboxes: mockListImapMailboxes,
  normalizeResolvedImapConnection: mockNormalizeResolvedImapConnection,
}))

import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
} from '@/lib/selectors/server/errors'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { imapSelectorAttachments } from '@/lib/selectors/server/providers/imap'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

function mailboxArgs(
  overrides: Partial<ExecuteServerSelectorArgs> = {}
): ExecuteServerSelectorArgs {
  return {
    selectorKey: 'imap.mailboxes',
    context: {
      host: 'imap.example.com',
      port: '993',
      secure: 'true',
      username: 'mailbox-user',
      password: 'secret{{literal}}value',
    },
    request: { kind: 'list' },
    scope: { kind: 'workspace', workspaceId: 'workspace-1' },
    workspaceId: 'workspace-1',
    principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
    requesterUserId: 'user-1',
    references: new Map(),
    protectedValues: createSelectorProtectedValues(),
    ...overrides,
  }
}

describe('IMAP server selector adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNormalizeResolvedImapConnection.mockReturnValue({
      host: 'imap.example.com',
      port: 993,
      secure: true,
      username: 'mailbox-user',
      password: 'secret{{literal}}value',
    })
    mockListImapMailboxes.mockResolvedValue([{ path: 'INBOX', name: 'Inbox', delimiter: '/' }])
  })

  it('normalizes authorized resolved values without treating their braces as templates', async () => {
    await expect(imapSelectorAttachments['imap.mailboxes'].execute(mailboxArgs())).resolves.toEqual(
      {
        kind: 'list',
        items: [{ id: 'INBOX', label: 'Inbox' }],
      }
    )

    expect(mockNormalizeResolvedImapConnection).toHaveBeenCalledWith({
      host: 'imap.example.com',
      port: '993',
      secure: 'true',
      username: 'mailbox-user',
      password: 'secret{{literal}}value',
    })
    expect(mockListImapMailboxes).toHaveBeenCalledOnce()
  })

  it('rejects hidden shared authentication before normalization or network access', async () => {
    await expect(
      imapSelectorAttachments['imap.mailboxes'].execute(
        mailboxArgs({
          references: new Map([
            [
              'password',
              {
                field: 'password',
                name: 'IMAP_PASSWORD',
                scope: 'workspace',
                visible: false,
              },
            ],
          ]),
        })
      )
    ).rejects.toBeInstanceOf(SelectorConnectionUnavailableError)

    expect(mockNormalizeResolvedImapConnection).not.toHaveBeenCalled()
    expect(mockListImapMailboxes).not.toHaveBeenCalled()
  })

  it('maps an invalid port to context unavailable before mailbox access', async () => {
    mockNormalizeResolvedImapConnection.mockImplementationOnce(() => {
      throw new MockImapConnectionPolicyError('context')
    })

    await expect(
      imapSelectorAttachments['imap.mailboxes'].execute(
        mailboxArgs({ context: { ...mailboxArgs().context, port: '-1' } })
      )
    ).rejects.toBeInstanceOf(SelectorContextUnavailableError)

    expect(mockListImapMailboxes).not.toHaveBeenCalled()
  })

  it('conceals destination policy failures as connection unavailable', async () => {
    mockListImapMailboxes.mockRejectedValueOnce(new MockImapConnectionPolicyError('destination'))

    await expect(
      imapSelectorAttachments['imap.mailboxes'].execute(mailboxArgs())
    ).rejects.toBeInstanceOf(SelectorConnectionUnavailableError)
  })

  it('preserves cancellation before mapping IMAP policy failures', async () => {
    const controller = new AbortController()
    const abortError = new DOMException('The operation was aborted', 'AbortError')
    controller.abort(abortError)
    mockListImapMailboxes.mockRejectedValueOnce(new MockImapConnectionPolicyError('destination'))

    await expect(
      imapSelectorAttachments['imap.mailboxes'].execute(
        mailboxArgs({ signal: controller.signal }),
        {
          host: 'imap.example.com',
          port: 993,
          secure: true,
          username: 'mailbox-user',
          password: 'secret{{literal}}value',
        }
      )
    ).rejects.toBe(abortError)
    expect(mockListImapMailboxes).toHaveBeenCalledOnce()
  })
})
