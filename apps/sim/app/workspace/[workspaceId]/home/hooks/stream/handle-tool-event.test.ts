/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/copilot/resources/extraction', () => ({
  isResourceToolName: vi.fn(() => false),
  extractResourcesFromToolResult: vi.fn(() => []),
}))
vi.mock('@/lib/copilot/tools/client/hidden-tools', () => ({
  isToolHiddenInUi: vi.fn(() => false),
}))
vi.mock('@/lib/copilot/tools/workflow-tools', () => ({
  isWorkflowToolName: vi.fn(() => false),
}))
vi.mock(
  '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry',
  () => ({ invalidateResourceQueries: vi.fn() })
)

import { handleToolEvent } from './handle-tool-event'
import { createStreamLoopContext, type StreamEventScope } from './stream-context'
import { makeStreamLoopDeps } from './stream-test-helpers'

const SCOPE: StreamEventScope = {
  scopedSubagent: undefined,
  scopedParentToolCallId: undefined,
  scopedAgentId: undefined,
  scopedSpanId: undefined,
  scopedParentSpanId: undefined,
  spanIdentity: {},
}

type ToolEvent = Parameters<typeof handleToolEvent>[1]

function toolCall(id: string, name = 'my_tool'): ToolEvent {
  return {
    type: 'tool',
    v: 1,
    seq: 1,
    ts: '2026-01-01T00:00:00Z',
    stream: { streamId: 's' },
    payload: { phase: 'call', executor: 'go', mode: 'sync', toolCallId: id, toolName: name },
  } as unknown as ToolEvent
}

function toolResult(id: string, success: boolean, name = 'my_tool'): ToolEvent {
  return {
    type: 'tool',
    v: 1,
    seq: 2,
    ts: '2026-01-01T00:00:01Z',
    stream: { streamId: 's' },
    payload: {
      phase: 'result',
      executor: 'go',
      mode: 'sync',
      toolCallId: id,
      toolName: name,
      success,
      status: success ? 'success' : 'error',
    },
  } as unknown as ToolEvent
}

describe('handleToolEvent', () => {
  it('adds an executing tool_call block on a new call and resolves it on the result', () => {
    const ctx = createStreamLoopContext(makeStreamLoopDeps())
    handleToolEvent(ctx, toolCall('tc-1'), SCOPE)
    expect(ctx.state.blocks).toHaveLength(1)
    expect(ctx.state.blocks[0].toolCall?.id).toBe('tc-1')
    expect(ctx.state.blocks[0].toolCall?.status).toBe('executing')

    handleToolEvent(ctx, toolResult('tc-1', true), SCOPE)
    expect(ctx.state.blocks[0].toolCall?.status).toBe('success')
    expect(ctx.state.blocks[0].endedAt).toBeTypeOf('number')
  })

  it('buffers a result that arrives before its call, then applies it when the call lands', () => {
    const ctx = createStreamLoopContext(makeStreamLoopDeps())
    handleToolEvent(ctx, toolResult('tc-2', true), SCOPE)
    expect(ctx.state.blocks).toHaveLength(0)
    expect(ctx.state.pendingToolResults.has('tc-2')).toBe(true)

    handleToolEvent(ctx, toolCall('tc-2'), SCOPE)
    expect(ctx.state.blocks).toHaveLength(1)
    expect(ctx.state.blocks[0].toolCall?.status).toBe('success')
    expect(ctx.state.pendingToolResults.has('tc-2')).toBe(false)
  })

  it('marks an unsuccessful result as error', () => {
    const ctx = createStreamLoopContext(makeStreamLoopDeps())
    handleToolEvent(ctx, toolCall('tc-3'), SCOPE)
    handleToolEvent(ctx, toolResult('tc-3', false), SCOPE)
    expect(ctx.state.blocks[0].toolCall?.status).toBe('error')
  })
})
