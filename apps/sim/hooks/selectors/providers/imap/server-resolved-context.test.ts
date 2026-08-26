/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ requestJson: vi.fn() }))

vi.mock('@/lib/api/client/request', () => ({ requestJson: mocks.requestJson }))

import { imapSelectors } from '@/hooks/selectors/providers/imap/selectors'

describe('IMAP server-resolved selector context', () => {
  beforeEach(() => vi.clearAllMocks())

  it('opts every connection field into server resolution', () => {
    expect(imapSelectors['imap.mailboxes']?.serverResolvedContextFields).toEqual([
      'host',
      'port',
      'secure',
      'username',
      'password',
    ])
  })

  it('forwards raw references and maps mailbox options', async () => {
    const definition = imapSelectors['imap.mailboxes']!
    const context = {
      workflowId: 'workflow-1',
      host: '{{IMAP_HOST}}',
      port: '{{IMAP_PORT}}',
      secure: '{{IMAP_TLS}}',
      username: '{{IMAP_USERNAME}}',
      password: '{{IMAP_PASSWORD}}',
    }
    mocks.requestJson.mockResolvedValue({
      success: true,
      mailboxes: [{ path: 'INBOX', name: 'Inbox', delimiter: '/' }],
    })

    expect(await definition.fetchList!({ key: 'imap.mailboxes', context })).toEqual([
      { id: 'INBOX', label: 'Inbox' },
    ])
    expect(mocks.requestJson.mock.calls[0][1].body).toEqual(context)
  })

  it('requires a workflow and keeps connection plaintext out of base query keys', () => {
    const definition = imapSelectors['imap.mailboxes']!
    const context = {
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      host: 'private-imap.example.com',
      port: '993',
      secure: 'true',
      username: 'private-user@example.com',
      password: 'imap-literal-secret',
    }
    const key = definition.getQueryKey!({ key: 'imap.mailboxes', context })

    expect(definition.enabled?.({ key: 'imap.mailboxes', context })).toBe(true)
    expect(
      definition.enabled?.({
        key: 'imap.mailboxes',
        context: { ...context, workflowId: undefined },
      })
    ).toBe(false)
    for (const secret of [
      'private-imap.example.com',
      'private-user@example.com',
      'imap-literal-secret',
    ]) {
      expect(JSON.stringify(key)).not.toContain(secret)
    }
  })
})
