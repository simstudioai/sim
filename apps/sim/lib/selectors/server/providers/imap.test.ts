/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockListImapMailboxes, mockNormalizeResolvedImapConnection } = vi.hoisted(() => ({
  mockListImapMailboxes: vi.fn(),
  mockNormalizeResolvedImapConnection: vi.fn(),
}))

vi.mock('@/lib/imap/connection.server', () => ({
  listImapMailboxes: mockListImapMailboxes,
  normalizeResolvedImapConnection: mockNormalizeResolvedImapConnection,
}))

import { SelectorConnectionUnavailableError } from '@/lib/selectors/server/errors'
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
})
