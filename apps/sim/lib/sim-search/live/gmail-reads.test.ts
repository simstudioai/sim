import { describe, expect, it } from 'vitest'
import { readGmail } from '@/lib/sim-search/live/google'
import { NativeSearchError } from '@/lib/sim-search/live/http'
import { defaultLiveSearchPolicy } from '@/lib/sim-search/live/policy-schema'
import type { NativeClient } from '@/lib/sim-search/live/types'

function message(id: string, minute: number, labels = ['INBOX']) {
  return {
    id,
    threadId: 'conversation',
    labelIds: labels,
    internalDate: String(Date.UTC(2026, 8, 26, 12, minute)),
    snippet: `Preview ${id}`,
    payload: {
      mimeType: 'text/plain',
      headers: [
        { name: 'Subject', value: 'Planning discussion' },
        { name: 'From', value: `${id} <${id}@example.test>` },
      ],
      body: { data: Buffer.from(`Evidence from ${id}.`).toString('base64url') },
    },
  }
}

type Message = ReturnType<typeof message>

function mailbox(
  messages: Message[],
  options: {
    thread?: { id: string; messages: Message[] }
    fullMessages?: Record<string, Message | Error>
    bodyLimit?: number
  } = {}
): NativeClient {
  let bodies = 0
  const metadata = ({ payload, ...row }: Message) => ({
    ...row,
    payload: { headers: payload.headers },
  })
  return {
    async json(path, request) {
      if (path === '/gmail/v1/users/me/threads/conversation') {
        if (request?.query?.format !== 'metadata')
          throw new Error('A thread body request would read messages before authorization')
        const thread = options.thread ?? { id: 'conversation', messages }
        return { ...thread, messages: thread.messages.map(metadata) }
      }
      const row = messages.find((entry) => path === `/gmail/v1/users/me/messages/${entry.id}`)
      if (!row) throw new Error(`Unexpected Gmail resource: ${path}`)
      if (request?.query?.format !== 'full') return metadata(row)
      if (++bodies > (options.bodyLimit ?? 8)) throw new Error('Conversation body limit exceeded')
      const full = options.fullMessages?.[row.id] ?? row
      if (full instanceof Error) throw full
      return full
    },
    async bytes() {
      throw new Error('Unexpected binary request')
    },
    async text() {
      throw new Error('Gmail messages use the JSON wire format')
    },
  }
}

const readOptions = (verify = async (_reference: { id: string }) => true) => ({
  policy: defaultLiveSearchPolicy('gmail'),
  signal: new AbortController().signal,
  verify,
})

describe('Gmail conversation reads', () => {
  it('includes authorized replies with provenance without reading a denied sibling body', async () => {
    const client = mailbox([message('reply', 0), message('denied', 2), message('anchor', 1)], {
      fullMessages: { denied: new Error('Denied message body was fetched') },
    })
    const result = await readGmail(
      client,
      'anchor',
      readOptions(async ({ id }) => id !== 'denied')
    )

    expect(result.id).toBe('anchor')
    expect(result.accessDependencies).toEqual([{ id: 'reply' }])
    expect(result.content).toContain('Evidence from anchor.')
    expect(result.content).toContain('Evidence from reply.')
    expect(result.content).not.toContain('Evidence from denied.')
    expect(result.content).not.toContain('denied@example.test')
    expect(result.content).toContain('reply <reply@example.test>')
    expect(result.content).toContain('2026-09-26T12:00:00.000Z')
    expect(result.content).toContain('https://mail.google.com/mail/u/0/#all/reply')
    expect(result.content.indexOf('Evidence from reply.')).toBeLessThan(
      result.content.indexOf('Evidence from anchor.')
    )
  })

  it.each(['thread identity', 'missing anchor', 'message identity', 'message membership'] as const)(
    'rejects inconsistent provider evidence: %s',
    async (fault) => {
      const anchor = message('anchor', 0)
      const reply = message('reply', 1)
      const client = mailbox([anchor, reply], {
        ...(fault === 'thread identity'
          ? { thread: { id: 'other-conversation', messages: [anchor, reply] } }
          : fault === 'missing anchor'
            ? { thread: { id: 'conversation', messages: [reply] } }
            : {}),
        ...(fault === 'message identity'
          ? { fullMessages: { reply: { ...reply, id: 'unrelated' } } }
          : fault === 'message membership'
            ? { fullMessages: { reply: { ...reply, threadId: 'other-conversation' } } }
            : {}),
      })

      await expect(readGmail(client, 'anchor', readOptions())).rejects.toThrow()
    }
  )

  it('keeps the requested message when conversation context exceeds the body budget', async () => {
    const messages = Array.from({ length: 12 }, (_, index) => message(`mail${index}`, index))
    const result = await readGmail(mailbox(messages), 'mail11', readOptions())
    const included = messages.filter(({ id }) => result.content.includes(`Evidence from ${id}.`))

    expect(result.id).toBe('mail11')
    expect(result.content).toContain('Evidence from mail11.')
    expect(included).toHaveLength(8)
    expect(result.content).toMatch(/(?:incomplete|limited|omitted|truncated)/i)
  })

  it.each([
    new NativeSearchError('timeout', 'Conversation request timed out'),
    new NativeSearchError('rate_limited', 'Gmail quota reached', 45),
  ])(
    'preserves provider failure instead of returning a complete conversation: $status',
    async (failure) => {
      const client = mailbox([message('anchor', 0), message('reply', 1)], {
        fullMessages: { reply: failure },
      })

      await expect(readGmail(client, 'anchor', readOptions())).rejects.toBe(failure)
    }
  )
})
