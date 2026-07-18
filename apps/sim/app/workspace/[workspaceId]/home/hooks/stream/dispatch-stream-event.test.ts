/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MothershipStreamV1EventType } from '@/lib/copilot/generated/mothership-stream-v1'
import type { PersistedStreamEventEnvelope } from '@/lib/copilot/request/session/contract'
import type { StreamLoopContext } from './stream-context'

const handlers = vi.hoisted(() => ({
  handleSessionEvent: vi.fn(),
  handleTextEvent: vi.fn(),
  handleToolEvent: vi.fn(),
  handleAppEvent: vi.fn(),
  handleResourceEvent: vi.fn(),
  handleRunEvent: vi.fn(),
  handleSpanEvent: vi.fn(),
  handleErrorEvent: vi.fn(),
  handleCompleteEvent: vi.fn(),
}))

vi.mock('@/app/workspace/[workspaceId]/home/hooks/stream/handle-session-event', () => ({
  handleSessionEvent: handlers.handleSessionEvent,
}))
vi.mock('@/app/workspace/[workspaceId]/home/hooks/stream/handle-text-event', () => ({
  handleTextEvent: handlers.handleTextEvent,
}))
vi.mock('@/app/workspace/[workspaceId]/home/hooks/stream/handle-tool-event', () => ({
  handleToolEvent: handlers.handleToolEvent,
}))
vi.mock('@/app/workspace/[workspaceId]/home/hooks/stream/handle-app-event', () => ({
  handleAppEvent: handlers.handleAppEvent,
}))
vi.mock('@/app/workspace/[workspaceId]/home/hooks/stream/handle-resource-event', () => ({
  handleResourceEvent: handlers.handleResourceEvent,
}))
vi.mock('@/app/workspace/[workspaceId]/home/hooks/stream/handle-run-event', () => ({
  handleRunEvent: handlers.handleRunEvent,
}))
vi.mock('@/app/workspace/[workspaceId]/home/hooks/stream/handle-span-event', () => ({
  handleSpanEvent: handlers.handleSpanEvent,
}))
vi.mock('@/app/workspace/[workspaceId]/home/hooks/stream/handle-error-event', () => ({
  handleErrorEvent: handlers.handleErrorEvent,
}))
vi.mock('@/app/workspace/[workspaceId]/home/hooks/stream/handle-complete-event', () => ({
  handleCompleteEvent: handlers.handleCompleteEvent,
}))

import { dispatchStreamEvent } from './dispatch-stream-event'
import { createTurnModel } from './turn-model'

function makeCtx(): StreamLoopContext {
  return {
    state: { model: createTurnModel() } as StreamLoopContext['state'],
    deps: {} as StreamLoopContext['deps'],
    ops: {} as unknown as StreamLoopContext['ops'],
  }
}

function event(type: string, scope?: Record<string, unknown>): PersistedStreamEventEnvelope {
  return {
    type,
    payload: {},
    scope,
    seq: 1,
    stream: { streamId: 's' },
    ts: '2026-01-01T00:00:00Z',
    v: 1,
  } as unknown as PersistedStreamEventEnvelope
}

describe('dispatchStreamEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('routes every event type to exactly its handler', () => {
    const ctx = makeCtx()
    dispatchStreamEvent(ctx, event(MothershipStreamV1EventType.session))
    dispatchStreamEvent(ctx, event(MothershipStreamV1EventType.text))
    dispatchStreamEvent(ctx, event(MothershipStreamV1EventType.tool))
    dispatchStreamEvent(ctx, event(MothershipStreamV1EventType.app))
    dispatchStreamEvent(ctx, event(MothershipStreamV1EventType.resource))
    dispatchStreamEvent(ctx, event(MothershipStreamV1EventType.run))
    dispatchStreamEvent(ctx, event(MothershipStreamV1EventType.span))
    dispatchStreamEvent(ctx, event(MothershipStreamV1EventType.error))
    dispatchStreamEvent(ctx, event(MothershipStreamV1EventType.complete))

    expect(handlers.handleSessionEvent).toHaveBeenCalledTimes(1)
    expect(handlers.handleTextEvent).toHaveBeenCalledTimes(1)
    expect(handlers.handleToolEvent).toHaveBeenCalledTimes(1)
    expect(handlers.handleAppEvent).toHaveBeenCalledTimes(1)
    expect(handlers.handleResourceEvent).toHaveBeenCalledTimes(1)
    expect(handlers.handleRunEvent).toHaveBeenCalledTimes(1)
    expect(handlers.handleSpanEvent).toHaveBeenCalledTimes(1)
    expect(handlers.handleErrorEvent).toHaveBeenCalledTimes(1)
    expect(handlers.handleCompleteEvent).toHaveBeenCalledTimes(1)
  })

  it('computes and passes per-event scope to the span handler', () => {
    const ctx = makeCtx()
    dispatchStreamEvent(
      ctx,
      event(MothershipStreamV1EventType.span, { spanId: 'span-9', agentId: 'agent-x' })
    )
    const call = handlers.handleSpanEvent.mock.calls[0]
    expect(call[0]).toBe(ctx)
    const scope = call[2]
    expect(scope.scopedSpanId).toBe('span-9')
    expect(scope.scopedAgentId).toBe('agent-x')
  })

  it('invokes ctx-only handlers (session/run/complete) without a scope argument', () => {
    const ctx = makeCtx()
    const sessionEvent = event(MothershipStreamV1EventType.session)
    dispatchStreamEvent(ctx, sessionEvent)
    expect(handlers.handleSessionEvent).toHaveBeenCalledWith(ctx, sessionEvent)
    expect(handlers.handleSessionEvent.mock.calls[0]).toHaveLength(2)
  })

  it('ignores unknown event types without throwing', () => {
    const ctx = makeCtx()
    expect(() => dispatchStreamEvent(ctx, event('totally-unknown'))).not.toThrow()
    expect(handlers.handleSessionEvent).not.toHaveBeenCalled()
  })
})
