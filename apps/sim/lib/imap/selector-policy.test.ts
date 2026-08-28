/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

const { mockListImapMailboxes, mockNormalizeLiteralImapConnection } = vi.hoisted(() => ({
  mockListImapMailboxes: vi.fn(),
  mockNormalizeLiteralImapConnection: vi.fn(),
}))

vi.mock('@/lib/imap/connection.server', () => ({
  listImapMailboxes: mockListImapMailboxes,
  normalizeLiteralImapConnection: mockNormalizeLiteralImapConnection,
}))

import { SelectorConnectionUnavailableError } from '@/lib/selectors/server/errors'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { imapSelectorAttachments } from '@/lib/selectors/server/providers/imap'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

function selectorArgs(): ExecuteServerSelectorArgs {
  return {
    selectorKey: 'imap.mailboxes',
    context: {
      host: 'imap.example.com',
      username: 'resolved-use-only-user',
      password: 'resolved-use-only-password',
    },
    request: { kind: 'list' },
    scope: { kind: 'workflow', workflowId: 'workflow-1' },
    workspaceId: 'workspace-1',
    principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
    requesterUserId: 'user-1',
    references: new Map([
      [
        'password',
        {
          field: 'password',
          name: 'SHARED_IMAP_PASSWORD',
          scope: 'workspace',
          visible: false,
        },
      ],
    ]),
    protectedValues: createSelectorProtectedValues(),
  }
}

describe('IMAP selector policy', () => {
  it('rejects hidden shared authentication before normalizing or connecting', async () => {
    await expect(
      imapSelectorAttachments['imap.mailboxes'].execute(selectorArgs())
    ).rejects.toBeInstanceOf(SelectorConnectionUnavailableError)

    expect(mockNormalizeLiteralImapConnection).not.toHaveBeenCalled()
    expect(mockListImapMailboxes).not.toHaveBeenCalled()
  })
})
