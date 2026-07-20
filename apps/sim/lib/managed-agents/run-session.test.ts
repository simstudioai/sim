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
    getSession: vi.fn(),
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
  getSession: mocks.getSession,
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
const idle = (id: string, stop: string): AnthropicSessionEvent => ({
  id,
  type: 'session.status_idle',
  stop_reason: { type: stop },
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createSession.mockResolvedValue({ id: 'sess_1' })
  mocks.sendUserMessage.mockResolvedValue(undefined)
  mocks.openSessionStream.mockResolvedValue({})
  mocks.listSessionEvents.mockResolvedValue([])
  mocks.getSession.mockResolvedValue(null)
})

describe('runManagedAgentSession', () => {
  it('accumulates agent.message text and completes on end_turn (terminal event)', async () => {
    scriptStreamBatches([[msg('e1', 'Hello '), msg('e2', 'world'), idle('e3', 'end_turn')]])
    mocks.getSession.mockResolvedValue({
      status: 'idle',
      usage: { inputTokens: 12, outputTokens: 3 },
    })

    const result = await runManagedAgentSession({ ...BASE })

    expect(result).toEqual({
      ok: true,
      content: 'Hello world',
      sessionId: 'sess_1',
      inputTokens: 12,
      outputTokens: 3,
    })
    expect(mocks.listSessionEvents).not.toHaveBeenCalled()
  })

  it('completes via authoritative status when the stream goes quiet after progress', async () => {
    // Stream: some text, no terminal, then closes. Reconnect: nothing new.
    scriptStreamBatches([[msg('e1', 'partial')], []])
    // First getSession (quiet-reconnect check) → idle; final getSession → usage.
    mocks.getSession
      .mockResolvedValueOnce({ status: 'idle' })
      .mockResolvedValue({ status: 'idle', usage: { inputTokens: 5 } })

    const result = await runManagedAgentSession({ ...BASE })

    expect(result.ok).toBe(true)
    expect(result.content).toBe('partial')
    expect(result.inputTokens).toBe(5)
  })

  it('keeps waiting while status is running, then completes on a later terminal event', async () => {
    // Stream 1: text, closes (no terminal). Reconnect: nothing new, status running → backoff.
    // Stream 2: end_turn → complete.
    scriptStreamBatches([[msg('e1', 'thinking')], [idle('e2', 'end_turn')]])
    mocks.getSession
      .mockResolvedValueOnce({ status: 'running' })
      .mockResolvedValue({ status: 'idle' })

    const result = await runManagedAgentSession({ ...BASE })

    expect(result.ok).toBe(true)
    expect(result.content).toBe('thinking')
    expect(mocks.sleep).toHaveBeenCalled() // backed off while running
  })

  it('does not complete on a fresh idle before the agent has started', async () => {
    // Stream closes immediately with nothing; catch-up empty; status idle but no
    // activity yet → must NOT complete. Then it starts and finishes.
    scriptStreamBatches([[], [idle('e1', 'end_turn')]])
    mocks.getSession
      .mockResolvedValueOnce({ status: 'idle' }) // pre-start idle — must be ignored
      .mockResolvedValue({ status: 'idle' })

    const result = await runManagedAgentSession({ ...BASE })

    expect(result.ok).toBe(true)
    // Completed via the real end_turn on reopen, not the premature idle.
    expect(mocks.openSessionStream).toHaveBeenCalledTimes(2)
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
