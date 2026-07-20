/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnthropicSessionEvent } from '@/lib/managed-agents/session-client'

const { mocks } = vi.hoisted(() => ({
  mocks: {
    createSession: vi.fn(),
    sendUserMessage: vi.fn(),
    sendSessionEvents: vi.fn(),
    openSessionStream: vi.fn(),
    listSessionEvents: vi.fn(),
    readSSEEvents: vi.fn(),
    sleep: vi.fn(),
  },
}))

vi.mock('@/lib/managed-agents/session-client', () => ({
  createSession: mocks.createSession,
  sendUserMessage: mocks.sendUserMessage,
  sendSessionEvents: mocks.sendSessionEvents,
  openSessionStream: mocks.openSessionStream,
  listSessionEvents: mocks.listSessionEvents,
}))
vi.mock('@/lib/core/utils/sse', () => ({ readSSEEvents: mocks.readSSEEvents }))
vi.mock('@sim/utils/helpers', () => ({ sleep: mocks.sleep }))

import { runManagedAgentSession } from '@/lib/managed-agents/run-session'

/** Drives `readSSEEvents`: each call replays the next scripted batch of events. */
function scriptStreamBatches(batches: AnthropicSessionEvent[][]): void {
  let call = 0
  mocks.readSSEEvents.mockImplementation(
    async (_resp: unknown, opts: { onEvent: (e: AnthropicSessionEvent) => Promise<unknown> }) => {
      const batch = batches[call++] ?? []
      for (const event of batch) {
        const stop = await opts.onEvent(event)
        if (stop === true) return
      }
    }
  )
}

const BASE = {
  apiKey: 'sk-ant-fake',
  agentId: 'agent_1',
  environmentId: 'env_1',
  userMessage: 'do a thing',
} as const

const msg = (id: string, text: string): AnthropicSessionEvent => ({
  id,
  type: 'agent.message',
  content: [{ type: 'text', text }],
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createSession.mockResolvedValue({ id: 'sess_1' })
  mocks.sendUserMessage.mockResolvedValue(undefined)
  mocks.openSessionStream.mockResolvedValue({})
})

describe('runManagedAgentSession', () => {
  it('accumulates agent.message text and completes on end_turn', async () => {
    scriptStreamBatches([
      [
        msg('e1', 'Hello '),
        msg('e2', 'world'),
        { id: 'e3', type: 'session.status_idle', stop_reason: { type: 'end_turn' } },
      ],
    ])

    const result = await runManagedAgentSession({ ...BASE })

    expect(result).toEqual({ ok: true, content: 'Hello world', sessionId: 'sess_1' })
    expect(mocks.listSessionEvents).not.toHaveBeenCalled()
  })

  it('does NOT false-timeout after requires_action followed by progress then a quiet reconnect', async () => {
    // Stream 1: only a requires_action idle (busy), then the stream closes.
    // Stream 2: closes immediately with nothing new.
    scriptStreamBatches([
      [{ id: 'r1', type: 'session.status_idle', stop_reason: { type: 'requires_action' } }],
      [],
    ])
    // Catch-up 1 surfaces real progress (m2); catch-up 2 has nothing unseen.
    mocks.listSessionEvents
      .mockResolvedValueOnce([
        { id: 'r1', type: 'session.status_idle', stop_reason: { type: 'requires_action' } },
        msg('m2', 'progress'),
      ])
      .mockResolvedValueOnce([
        { id: 'r1', type: 'session.status_idle', stop_reason: { type: 'requires_action' } },
        msg('m2', 'progress'),
      ])

    const result = await runManagedAgentSession({ ...BASE })

    expect(result).toEqual({ ok: true, content: 'progress', sessionId: 'sess_1' })
    // A false timeout would have slept on backoff and returned an error.
    expect(mocks.sleep).not.toHaveBeenCalled()
  })

  it('surfaces a session.error as a failure with the error message', async () => {
    scriptStreamBatches([[{ id: 'x1', type: 'session.error', error: { message: 'boom' } }]])

    const result = await runManagedAgentSession({ ...BASE })

    expect(result.ok).toBe(false)
    expect(result.error).toBe('boom')
    expect(result.sessionId).toBe('sess_1')
  })

  it('rejects an empty user message before creating a session', async () => {
    const result = await runManagedAgentSession({ ...BASE, userMessage: '   ' })

    expect(result.ok).toBe(false)
    expect(mocks.createSession).not.toHaveBeenCalled()
  })
})
