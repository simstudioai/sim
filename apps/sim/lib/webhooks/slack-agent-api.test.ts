/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  appendSlackAgentStream,
  setSlackAgentSessionStatus,
  startSlackAgentStream,
  stopSlackAgentStream,
} from '@/lib/webhooks/slack-agent-api'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Slack agent API transport', () => {
  it('starts a structured stream with the reply recipient and task display mode', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true, channel: 'C1', ts: '101.2' }), { status: 200 })
      )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      startSlackAgentStream(
        'xoxb-test',
        {
          channel: 'C1',
          threadTs: '100.1',
          recipientUserId: 'U1',
          recipientTeamId: 'T1',
        },
        [{ type: 'markdown_text', text: 'Hello' }],
        'plan'
      )
    ).resolves.toEqual({ channel: 'C1', ts: '101.2' })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://slack.com/api/chat.startStream',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          channel: 'C1',
          thread_ts: '100.1',
          chunks: [{ type: 'markdown_text', text: 'Hello' }],
          task_display_mode: 'plan',
          recipient_user_id: 'U1',
          recipient_team_id: 'T1',
        }),
      })
    )
  })

  it('uses the documented append, stop, and session status bodies', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(
        async () =>
          new Response(JSON.stringify({ ok: true, channel: 'D1', ts: '101.2' }), { status: 200 })
      )
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

  it('fails fast on Slack logical errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ ok: false, error: 'missing_scope' }), { status: 200 })
        )
    )

    await expect(
      setSlackAgentSessionStatus('xoxb-test', { channel: 'D1', threadTs: '100.1' }, 'processing')
    ).rejects.toThrow('missing_scope')
  })
})
