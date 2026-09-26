import { describe, expect, it } from 'vitest'
import { gmailHandler } from '@/lib/webhooks/providers/gmail'
import { gmailPollingTrigger } from '@/triggers/gmail'

const sampleEmail = {
  id: 'msg-123',
  threadId: 'thread-456',
  subject: 'Test subject',
  from: 'sender@example.com',
  to: 'recipient@example.com',
  cc: '',
  date: '2026-07-08T00:00:00.000Z',
  bodyText: 'plain text body',
  bodyHtml: '<p>html body</p>',
  labels: ['INBOX', 'UNREAD'],
  hasAttachments: false,
  attachments: [],
}

describe('Gmail webhook provider', () => {
  it('every key formatInput can deliver on `email` matches a declared trigger output key', async () => {
    const { input } = await gmailHandler.formatInput!({
      webhook: {},
      workflow: { id: 'wf', userId: 'u' },
      body: { email: sampleEmail, timestamp: '2026-07-08T00:00:05.000Z' },
      headers: {},
      requestId: 'test',
    })

    const declaredEmailKeys = Object.keys(gmailPollingTrigger.outputs.email)
    const deliveredEmailKeys = Object.keys((input as { email: object }).email)

    expect(deliveredEmailKeys.sort()).toEqual(declaredEmailKeys.sort())
  })
})
