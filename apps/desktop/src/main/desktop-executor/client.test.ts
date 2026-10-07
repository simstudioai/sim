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
})
