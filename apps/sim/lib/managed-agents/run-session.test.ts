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
    interruptSession: vi.fn(),
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
  interruptSession: mocks.interruptSession,
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
  mocks.sendSessionEvents.mockResolvedValue(undefined)
  mocks.openSessionStream.mockResolvedValue({})
  mocks.listSessionEvents.mockResolvedValue([])
  mocks.getSession.mockResolvedValue(null)
  mocks.interruptSession.mockResolvedValue(undefined)
})

const customToolUse = (id: string, name: string): AnthropicSessionEvent => ({
  id,
  type: 'agent.custom_tool_use',
  name,
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

  it('does not complete on idle status while a requires_action is outstanding', async () => {
    // Stream 1: text then a requires_action idle (pending), then closes.
    // Reconnect: nothing new, status idle — but must NOT complete (pending).
    // Stream 2: end_turn → complete.
    scriptStreamBatches([
      [msg('e1', 'partial'), idle('r1', 'requires_action')],
      [idle('e2', 'end_turn')],
    ])
    mocks.getSession.mockResolvedValue({ status: 'idle' })

    const result = await runManagedAgentSession({ ...BASE })

    expect(result.ok).toBe(true)
    expect(result.content).toBe('partial')
    expect(mocks.openSessionStream).toHaveBeenCalledTimes(2) // reopened rather than completing early
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

  it('keeps requires_action pending when catch-up recovers an older message (ordering)', async () => {
    // Live stream sees a message then a requires_action pause. Catch-up then
    // recovers an EARLIER, unseen agent.message — processing it would clear the
    // pending flag, but the history's latest lifecycle event is still
    // requires_action, so the session must NOT be reported complete.
    scriptStreamBatches([
      [msg('e1', 'hi '), idle('r1', 'requires_action')],
      [idle('e2', 'end_turn')],
    ])
    mocks.listSessionEvents.mockResolvedValueOnce([
      msg('e0', 'earlier'), // unseen, older than r1
      idle('r1', 'requires_action'), // latest lifecycle event in history
    ])
    mocks.getSession.mockResolvedValue({ status: 'idle' })

    const result = await runManagedAgentSession({ ...BASE })

    expect(result.ok).toBe(true)
    // Reopened rather than completing early on the idle snapshot.
    expect(mocks.openSessionStream).toHaveBeenCalledTimes(2)
  })

  it('preserves live requires_action when catch-up has an older message but no lifecycle event', async () => {
    // Live stream sees a message + requires_action pause. Catch-up recovers an
    // older, unseen agent.message but NO lifecycle event — processing it clears
    // the pending flag, and with no lifecycle evidence in history the live
    // pending state must be restored (not completed on the idle snapshot).
    scriptStreamBatches([
      [msg('e1', 'hi '), idle('r1', 'requires_action')],
      [idle('e2', 'end_turn')],
    ])
    mocks.listSessionEvents.mockResolvedValueOnce([msg('e0', 'earlier')]) // no lifecycle event
    mocks.getSession.mockResolvedValue({ status: 'idle' })

    const result = await runManagedAgentSession({ ...BASE })

    expect(result.ok).toBe(true)
    expect(mocks.openSessionStream).toHaveBeenCalledTimes(2) // did not complete on the idle snapshot
  })

  it('completes on an idless terminal event delivered only on the live stream', async () => {
    // An idless session.status_idle(end_turn) must still register as terminal —
    // idless events are processed (only text accumulation is id-gated).
    scriptStreamBatches([[{ type: 'session.status_idle', stop_reason: { type: 'end_turn' } }]])
    mocks.getSession.mockResolvedValue({ status: 'idle' })

    const result = await runManagedAgentSession({ ...BASE })

    expect(result.ok).toBe(true)
    expect(mocks.openSessionStream).toHaveBeenCalledTimes(1) // completed, not dropped
  })

  it('does not double-count text from an idless preview of a persisted message', async () => {
    scriptStreamBatches([
      [
        { type: 'agent.message', content: [{ type: 'text', text: 'hi' }] }, // idless preview
        msg('e1', 'hi'), // persisted copy of the same text
        idle('e2', 'end_turn'),
      ],
    ])
    mocks.getSession.mockResolvedValue({ status: 'idle' })

    const result = await runManagedAgentSession({ ...BASE })

    expect(result.content).toBe('hi') // not 'hihi'
  })

  it('retries a custom-tool reply that failed to send instead of stranding the session', async () => {
    // Stream 1: a custom tool call whose error reply fails to send — the event
    // must stay unseen. Reconnect (status running) → reopen. Stream 2: the same
    // tool call is retried (reply succeeds), then end_turn completes.
    scriptStreamBatches([
      [customToolUse('t1', 'foo')],
      [customToolUse('t1', 'foo'), idle('e2', 'end_turn')],
    ])
    mocks.sendSessionEvents.mockRejectedValueOnce(new Error('network')).mockResolvedValue(undefined)
    mocks.getSession
      .mockResolvedValueOnce({ status: 'running' })
      .mockResolvedValue({ status: 'idle' })

    const result = await runManagedAgentSession({ ...BASE })

    expect(result.ok).toBe(true)
    // Reply attempted twice: the failed send was retried on reconnect.
    expect(mocks.sendSessionEvents).toHaveBeenCalledTimes(2)
  })

  it('does not complete on a session_idle event that carries no stop_reason', async () => {
    // An idle event with no stop_reason (e.g. pre-first-turn) must NOT be
    // treated as complete via the event path — defer to the status gate, which
    // honors sawActivity. Then a real end_turn on reopen completes it.
    scriptStreamBatches([
      [{ id: 'i1', type: 'session.status_idle' }],
      [msg('e2', 'done'), idle('e3', 'end_turn')],
    ])
    mocks.getSession.mockResolvedValue({ status: 'idle' })

    const result = await runManagedAgentSession({ ...BASE })

    expect(result.ok).toBe(true)
    expect(result.content).toBe('done')
    expect(mocks.openSessionStream).toHaveBeenCalledTimes(2) // reopened, not completed on i1
  })

  it('backs off (does not hot-loop) when catch-up only surfaces a failing tool reply', async () => {
    // Stream closes empty; catch-up surfaces an unseen custom-tool call whose
    // reply fails to send — it stays unseen (retry), so it must NOT count as
    // progress and reset the backoff. Session still running → we must sleep.
    scriptStreamBatches([[], [idle('e2', 'end_turn')]])
    mocks.listSessionEvents
      .mockResolvedValueOnce([customToolUse('t1', 'foo')])
      .mockResolvedValue([])
    mocks.sendSessionEvents.mockRejectedValue(new Error('network'))
    mocks.getSession
      .mockResolvedValueOnce({ status: 'running' })
      .mockResolvedValue({ status: 'idle' })

    const result = await runManagedAgentSession({ ...BASE })

    expect(result.ok).toBe(true)
    expect(mocks.sleep).toHaveBeenCalled() // backed off instead of resetting on the retry event
  })

  it('interrupts the session when a mid-run stream failure ends the loop', async () => {
    mocks.openSessionStream.mockRejectedValue(new Error('stream 502'))

    const result = await runManagedAgentSession({ ...BASE })

    expect(result.ok).toBe(false)
    expect(mocks.interruptSession).toHaveBeenCalledWith({
      apiKey: BASE.apiKey,
      sessionId: 'sess_1',
    })
  })

  it('interrupts the session and reports aborted when the workflow is cancelled', async () => {
    const controller = new AbortController()
    // Cancel right after the session is created, before the stream loop runs.
    mocks.sendUserMessage.mockImplementation(async () => {
      controller.abort()
    })
    scriptStreamBatches([[]])

    const result = await runManagedAgentSession({ ...BASE, signal: controller.signal })

    expect(result.ok).toBe(false)
    expect(result.error).toBe('aborted')
    expect(mocks.interruptSession).toHaveBeenCalledWith({
      apiKey: BASE.apiKey,
      sessionId: 'sess_1',
    })
  })

  it('rejects an empty user message before creating a session', async () => {
    const result = await runManagedAgentSession({ ...BASE, userMessage: '   ' })
    expect(result.ok).toBe(false)
    expect(mocks.createSession).not.toHaveBeenCalled()
  })
})
