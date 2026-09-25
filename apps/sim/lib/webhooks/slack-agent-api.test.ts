import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  appendSlackAgentStream,
  setSlackAgentSessionStatus,
  stopSlackAgentStream,
} from '@/lib/webhooks/slack-agent-api'
import { SlackDeliveryError } from '@/lib/webhooks/slack-delivery-error'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Slack agent API transport', () => {
  it('uses the documented append, stop, and session status bodies', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      const body = url.endsWith('agents.sessions.setStatus')
        ? { ok: true, status: 'processing', agent_status: 'active' }
        : { ok: true, channel: 'D1', ts: '101.2' }
      return new Response(JSON.stringify(body), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await appendSlackAgentStream('xoxb-test', 'D1', '101.2', [
      { type: 'markdown_text', text: 'More' },
    ])
    await stopSlackAgentStream('xoxb-test', 'D1', '101.2', 'processing')
    await setSlackAgentSessionStatus('xoxb-test', { channel: 'D1', threadTs: '100.1' }, 'active')

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      channel: 'D1',
      ts: '101.2',
      chunks: [{ type: 'markdown_text', text: 'More' }],
    })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      channel: 'D1',
      ts: '101.2',
      session_status: 'processing',
    })
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({
      channel_id: 'D1',
      thread_ts: '100.1',
      status: 'active',
    })
  })

  it('finishes task updates in the same stop request as the final blocks', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })))
    vi.stubGlobal('fetch', fetchMock)
    const chunks = [
      {
        type: 'task_update' as const,
        id: 'task-1',
        title: 'Searching documents…',
        status: 'error' as const,
      },
    ]
    const blocks = [{ type: 'section', text: { type: 'plain_text', text: 'Please try again.' } }]
    await stopSlackAgentStream('xoxb-test', 'D1', '101.2', 'active', undefined, blocks, chunks)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      channel: 'D1',
      ts: '101.2',
      session_status: 'active',
      blocks,
      chunks,
    })
  })

  it('accepts an acknowledgment larger than 64 KB without losing the delivery receipt', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: true,
            message: { text: 'x'.repeat(150_000) },
          })
        )
      )
    )
    await expect(
      appendSlackAgentStream('token', 'C1', '1.2', [{ type: 'markdown_text', text: 'last part' }])
    ).resolves.toBeUndefined()
  })

  it.each([
    () => new Response('not json', { status: 200 }),
    () => new Response(JSON.stringify({ ok: true, text: 'x'.repeat(4 * 1024 * 1024) })),
  ])('classifies an unreadable acknowledgment as uncertain without a retry', async (response) => {
    const fetchMock = vi.fn().mockResolvedValue(response())
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      appendSlackAgentStream('token', 'C1', '1.2', [{ type: 'markdown_text', text: 'answer' }])
    ).rejects.toMatchObject({
      method: 'chat.appendStream',
      outcome: 'uncertain',
      code: 'unreadable_acknowledgment',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('fails fast on Slack logical errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: false, error: 'missing_scope' }), {
          status: 200,
        })
      )
    )

    await expect(
      setSlackAgentSessionStatus(
        'xoxb-test',
        { channel: 'D1', threadTs: '100.1', initiatorUserId: 'U1' },
        'processing'
      )
    ).rejects.toThrow('missing_scope')
  })

  it('exposes an explicit size rejection to the delivery controller without a transport retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: false, error: 'msg_too_long' }), { status: 200 })
      )
    vi.stubGlobal('fetch', fetchMock)
    const appended = appendSlackAgentStream('token', 'C1', '1.2', [
      { type: 'markdown_text', text: 'undelivered suffix' },
    ])
    await expect(appended).rejects.toBeInstanceOf(SlackDeliveryError)
    await expect(appended).rejects.toMatchObject({
      method: 'chat.appendStream',
      outcome: 'rejected',
      code: 'msg_too_long',
      httpStatus: 200,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
