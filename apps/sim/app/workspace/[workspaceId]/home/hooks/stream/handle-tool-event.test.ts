import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/mothership/resources/extraction', () => ({
  isResourceToolName: vi.fn(() => false),
  extractResourcesFromToolResult: vi.fn(() => []),
}))
vi.mock('@/lib/mothership/tools/workflow-tools', () => ({
  isWorkflowToolName: vi.fn(() => false),
}))
vi.mock(
  '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry',
  () => ({ invalidateResourceQueries: vi.fn() })
)

import type { PersistedStreamEventEnvelope } from '@/lib/mothership/request/session/contract'
import { dispatchStreamEvent } from './dispatch-stream-event'
import { createStreamLoopContext, type StreamLoopContext } from './stream-context'
import { makeStreamLoopDeps, ref } from './stream-test-helpers'
import type { ToolNode } from './turn-model'

let seq = 0
function toolEnv(payload: Record<string, unknown>): PersistedStreamEventEnvelope {
  return {
    type: 'tool',
    v: 1,
    seq: ++seq,
    ts: '',
    stream: { streamId: 's', cursor: String(seq) },
    payload,
  } as unknown as PersistedStreamEventEnvelope
}

const toolCall = (id: string, name = 'my_tool') =>
  toolEnv({ phase: 'call', executor: 'go', mode: 'sync', toolCallId: id, toolName: name })

const toolResult = (id: string, success: boolean, name = 'my_tool') =>
  toolEnv({
    phase: 'result',
    executor: 'go',
    mode: 'sync',
    toolCallId: id,
    toolName: name,
    success,
    status: success ? 'success' : 'error',
  })

function toolNode(ctx: StreamLoopContext, id: string): ToolNode {
  const node = ctx.state.model.nodes.get(id)
  expect(node?.kind).toBe('tool')
  return node as ToolNode
}

describe('tool events (dispatch → model + side effects)', () => {
  it('buffers a result that arrives before its call, then applies it', () => {
    const ctx = createStreamLoopContext(makeStreamLoopDeps())
    dispatchStreamEvent(ctx, toolResult('tc-2', true))
    expect(ctx.state.model.nodes.has('tc-2')).toBe(false)

    dispatchStreamEvent(ctx, toolCall('tc-2'))
    expect(toolNode(ctx, 'tc-2').status).toBe('success')
  })

  // The client starts terminal/browser/workflow tools straight off the call
  // frame rather than waiting for the server to dispatch them, so a permission
  // gate that only held the server would let the command run behind the prompt.
  // The awaiting_approval status on the frame is what actually holds it here.
  it('does not start a gated terminal command until the user allows it', () => {
    const startClientTerminalTool = vi.fn()
    const ctx = createStreamLoopContext(makeStreamLoopDeps({ startClientTerminalTool }))

    const gatedCall = toolEnv({
      phase: 'call',
      executor: 'client',
      mode: 'async',
      toolCallId: 'term-1',
      toolName: 'terminal',
      arguments: { operation: 'run', args: { command: 'rm -rf build' } },
      status: 'awaiting_approval',
    })
    dispatchStreamEvent(ctx, gatedCall)

    expect(toolNode(ctx, 'term-1').status).toBe('awaiting_approval')
    expect(startClientTerminalTool).not.toHaveBeenCalled()

    // Sim re-emits the call frame as executing once the decision lands.
    dispatchStreamEvent(
      ctx,
      toolEnv({
        phase: 'call',
        executor: 'client',
        mode: 'async',
        toolCallId: 'term-1',
        toolName: 'terminal',
        arguments: { operation: 'run', args: { command: 'rm -rf build' } },
        status: 'executing',
      })
    )

    expect(toolNode(ctx, 'term-1').status).toBe('running')
    expect(startClientTerminalTool).toHaveBeenCalledWith(
      'term-1',
      'terminal',
      { operation: 'run', args: { command: 'rm -rf build' } },
      expect.anything()
    )
  })

  it('never starts a skipped terminal command', () => {
    const startClientTerminalTool = vi.fn()
    const ctx = createStreamLoopContext(makeStreamLoopDeps({ startClientTerminalTool }))

    dispatchStreamEvent(
      ctx,
      toolEnv({
        phase: 'call',
        executor: 'client',
        mode: 'async',
        toolCallId: 'term-2',
        toolName: 'terminal',
        arguments: { operation: 'run', args: { command: 'rm -rf build' } },
        status: 'awaiting_approval',
      })
    )
    dispatchStreamEvent(
      ctx,
      toolEnv({
        phase: 'result',
        executor: 'client',
        mode: 'async',
        toolCallId: 'term-2',
        toolName: 'terminal',
        success: true,
        status: 'skipped',
        output: { skipped: true, reason: 'user_declined' },
      })
    )

    expect(toolNode(ctx, 'term-2').status).toBe('skipped')
    expect(startClientTerminalTool).not.toHaveBeenCalled()
  })

  it('does not surface a resource when the agent merely reads one', () => {
    // Reading is navigation, not intent to show. Surfacing here made every
    // grep/read hop add a resource, switch the active one out from under the
    // user, and pop the collapsed panel open. Create/edit and the explicit
    // open_resource tool are the only things that should open the panel.
    const addResource = vi.fn(() => true)
    const onResourceEventRef = ref<((resourceId: string) => void) | undefined>(vi.fn())
    const ctx = createStreamLoopContext(makeStreamLoopDeps({ addResource, onResourceEventRef }))

    dispatchStreamEvent(
      ctx,
      toolEnv({
        phase: 'call',
        executor: 'sim',
        mode: 'async',
        toolCallId: 'read-1',
        toolName: 'read',
        arguments: { path: 'workflows/My%20Workflow/meta.json' },
      })
    )
    dispatchStreamEvent(
      ctx,
      toolEnv({
        phase: 'result',
        executor: 'sim',
        mode: 'async',
        toolCallId: 'read-1',
        toolName: 'read',
        success: true,
        status: 'success',
        result: { output: { id: 'wf-1', name: 'My Workflow' } },
      })
    )

    expect(addResource).not.toHaveBeenCalled()
    expect(onResourceEventRef.current).not.toHaveBeenCalled()
  })

  it('routes an ordinary read call to the desktop only for an explicit user-local path', () => {
    const startClientLocalFilesystemTool = vi.fn()
    const ctx = createStreamLoopContext(makeStreamLoopDeps({ startClientLocalFilesystemTool }))
    dispatchStreamEvent(
      ctx,
      toolEnv({
        phase: 'call',
        executor: 'client',
        mode: 'async',
        toolCallId: 'local-read',
        toolName: 'read',
        arguments: { path: 'user-local/Project--mount-1/README.md' },
      })
    )
    dispatchStreamEvent(
      ctx,
      toolEnv({
        phase: 'call',
        executor: 'sim',
        mode: 'async',
        toolCallId: 'workspace-read',
        toolName: 'read',
        arguments: { path: 'WORKSPACE.md' },
      })
    )

    expect(startClientLocalFilesystemTool).toHaveBeenCalledTimes(1)
    expect(startClientLocalFilesystemTool).toHaveBeenCalledWith('local-read', 'read', {
      path: 'user-local/Project--mount-1/README.md',
    })
  })
})
