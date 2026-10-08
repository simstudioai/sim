import { DESKTOP_IMPORT_TOKEN_HEADER } from '@sim/desktop-bridge'
import { describe, expect, it } from 'vitest'
import { createDesktopExecutorClient, UnsendableRequestError } from '@/main/desktop-executor/client'

describe('desktop executor client', () => {
  it('refuses a request it cannot encode without sending anything', async () => {
    let sent = 0
    const client = createDesktopExecutorClient({
      origin: () => 'https://sim.test',
      fetch: async () => {
        sent += 1
        return Response.json({ outcome: 'recorded', status: 'completed' })
      },
      deviceId: '00000000-0000-4000-8000-000000000000',
    })
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic

    await expect(
      client.complete({
        toolCallId: 'call-1',
        executionToken: 'token-1',
        completion: { status: 'success', message: 'done', data: cyclic },
      })
    ).rejects.toBeInstanceOf(UnsendableRequestError)
    expect(sent).toBe(0)
  })

  it('never splits a character when it shortens a long completion message', async () => {
    const sent: string[] = []
    const client = createDesktopExecutorClient({
      origin: () => 'https://sim.test',
      fetch: async (_url, init) => {
        sent.push(String(init.body))
        return Response.json({ outcome: 'recorded', status: 'completed' })
      },
      deviceId: '00000000-0000-4000-8000-000000000000',
    })
    // An emoji straddles the cut point, so a cut by code units would leave half of it behind.
    const message = `${'a'.repeat(9_996)}😀${'b'.repeat(10)}`

    await client.complete({
      toolCallId: 'call-1',
      executionToken: 'token-1',
      completion: { status: 'success', message },
    })

    const sentMessage: string = JSON.parse(sent[0] ?? '{}').message
    const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
    expect(loneSurrogate.test(sentMessage)).toBe(false)
  })

  it('sends an import entry with its execution token in a header, never in the URL', async () => {
    const received: Array<{ url: string; token: string | null }> = []
    const client = createDesktopExecutorClient({
      origin: () => 'https://sim.test',
      fetch: async (url, init) => {
        received.push({ url, token: new Headers(init.headers).get(DESKTOP_IMPORT_TOKEN_HEADER) })
        return Response.json({ id: 'file-1', name: 'notes.txt' })
      },
      deviceId: '00000000-0000-4000-8000-000000000000',
    })

    await client.importEntry(
      {
        call: {
          toolCallId: 'call-1',
          toolName: 'import_local_files',
          args: {},
          chatId: 'chat-1',
          workspaceId: 'ws-1',
          executionToken: 'secret-token-1',
        },
        kind: 'file',
        sourceName: 'notes.txt',
        relativePath: '',
        content: new Blob(['hello']),
      },
      new AbortController().signal
    )

    expect(received).toHaveLength(1)
    expect(received[0]?.token).toBe('secret-token-1')
    expect(decodeURIComponent(received[0]?.url ?? '')).not.toContain('secret-token-1')
  })
})
