import { describe, expect, it } from 'vitest'
import { agentmailGetMessageTool } from '@/tools/agentmail/get_message'
import { agentmailReplyMessageTool } from '@/tools/agentmail/reply_message'

const scope = { apiKey: 'key', inboxId: 'agent@agentmail.to' }

function buildUrl<P>(url: string | ((params: P) => string), params: P): string {
  return typeof url === 'function' ? url(params) : url
}

describe('agentmail request paths', () => {
  it('encodes RFC 5322 message IDs so their characters stay inside one path segment', () => {
    const url = buildUrl(agentmailGetMessageTool.request.url, {
      ...scope,
      messageId: '<a/b#c?d%e@mail.example.com>',
    })

    expect(new URL(url).pathname).toBe(
      '/v0/inboxes/agent%40agentmail.to/messages/%3Ca%2Fb%23c%3Fd%25e%40mail.example.com%3E'
    )
  })

  it('rejects a dot-segment message ID instead of addressing the parent path', () => {
    expect(() =>
      buildUrl(agentmailReplyMessageTool.request.url, { ...scope, messageId: '..' })
    ).toThrow(/messageId/)
  })
})
