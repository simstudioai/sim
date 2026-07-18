/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/copilot/resources/extraction', () => ({
  isResourceToolName: vi.fn(() => false),
  extractResourcesFromToolResult: vi.fn(() => []),
}))
vi.mock('@/lib/copilot/tools/workflow-tools', () => ({
  isWorkflowToolName: vi.fn(() => false),
}))
vi.mock(
  '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry',
  () => ({ invalidateResourceQueries: vi.fn() })
)

import type { PersistedStreamEventEnvelope } from '@/lib/copilot/request/session/contract'
import type { FilePreviewSession } from '@/lib/copilot/request/session/file-preview-session-contract'
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

const workspaceFileCall = (id: string) =>
  toolEnv({
    phase: 'call',
    executor: 'sim',
    mode: 'async',
    toolCallId: id,
    toolName: 'workspace_file',
    arguments: { operation: 'append', target: { kind: 'file_id', fileId: 'f1' } },
  })

const filePreviewComplete = (id: string) =>
  toolEnv({ previewPhase: 'file_preview_complete', toolCallId: id, toolName: 'workspace_file' })

function streamingSession(toolCallId: string): FilePreviewSession {
  return {
    schemaVersion: 1,
    id: toolCallId,
    streamId: 's',
    toolCallId,
    status: 'streaming',
    fileName: 'doc.md',
    previewText: 'hello',
    previewVersion: 1,
    updatedAt: '',
  }
}

function toolNode(ctx: StreamLoopContext, id: string): ToolNode {
  const node = ctx.state.model.nodes.get(id)
  expect(node?.kind).toBe('tool')
  return node as ToolNode
}

describe('tool events (dispatch → model + side effects)', () => {
  it('runs a tool then settles success, firing the onToolResult side effect', () => {
    const onToolResult = vi.fn()
    const ctx = createStreamLoopContext(makeStreamLoopDeps({ onToolResultRef: ref(onToolResult) }))
    dispatchStreamEvent(ctx, toolCall('tc-1'))
    expect(toolNode(ctx, 'tc-1').status).toBe('running')

    dispatchStreamEvent(ctx, toolResult('tc-1', true))
    expect(toolNode(ctx, 'tc-1').status).toBe('success')
    expect(onToolResult).toHaveBeenCalledWith('my_tool', true, undefined)
  })

  it('buffers a result that arrives before its call, then applies it', () => {
    const ctx = createStreamLoopContext(makeStreamLoopDeps())
    dispatchStreamEvent(ctx, toolResult('tc-2', true))
    expect(ctx.state.model.nodes.has('tc-2')).toBe(false)

    dispatchStreamEvent(ctx, toolCall('tc-2'))
    expect(toolNode(ctx, 'tc-2').status).toBe('success')
  })

  it('marks an unsuccessful result as error', () => {
    const ctx = createStreamLoopContext(makeStreamLoopDeps())
    dispatchStreamEvent(ctx, toolCall('tc-3'))
    dispatchStreamEvent(ctx, toolResult('tc-3', false))
    expect(toolNode(ctx, 'tc-3').status).toBe('error')
  })

  it('starts a desktop local filesystem tool once its complete call arrives', () => {
    const startClientLocalFilesystemTool = vi.fn()
    const ctx = createStreamLoopContext(makeStreamLoopDeps({ startClientLocalFilesystemTool }))
    dispatchStreamEvent(ctx, toolCall('local-1', 'local_list_mounts'))

    expect(startClientLocalFilesystemTool).toHaveBeenCalledWith('local-1', 'local_list_mounts', {})
  })

  it('settles a file-write row on its own result, independent of a streaming preview session', () => {
    const previewSessionsRef = ref<Record<string, FilePreviewSession>>({})
    const ctx = createStreamLoopContext(makeStreamLoopDeps({ previewSessionsRef }))
    dispatchStreamEvent(ctx, workspaceFileCall('wf-1'))
    expect(toolNode(ctx, 'wf-1').status).toBe('running')

    previewSessionsRef.current['wf-1'] = streamingSession('wf-1')
    dispatchStreamEvent(ctx, toolResult('wf-1', true, 'workspace_file'))
    expect(toolNode(ctx, 'wf-1').status).toBe('success')

    // A later file_preview_complete is a preview-only signal; the tool row stays settled.
    dispatchStreamEvent(ctx, filePreviewComplete('wf-1'))
    expect(toolNode(ctx, 'wf-1').status).toBe('success')
  })
})
