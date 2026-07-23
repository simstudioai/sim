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
import { contentBlocksToModel, modelToContentBlocks } from './turn-model-serialize'

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

describe('integration gateway (full wire sequence → published snapshot)', () => {
  const GATEWAY = 'call_integration_tool'
  const CALL_ID = 'ig-1'

  const generating = () =>
    toolEnv({
      phase: 'call',
      executor: 'go',
      mode: 'sync',
      toolCallId: CALL_ID,
      toolName: GATEWAY,
      status: 'generating',
    })

  const argsDelta = (argumentsDelta: string) =>
    toolEnv({
      phase: 'args_delta',
      executor: 'go',
      mode: 'sync',
      toolCallId: CALL_ID,
      toolName: GATEWAY,
      argumentsDelta,
    })

  const gatewayFinalCall = () =>
    toolEnv({
      phase: 'call',
      executor: 'go',
      mode: 'sync',
      toolCallId: CALL_ID,
      toolName: GATEWAY,
      arguments: {
        toolId: 'gmail_read_v2',
        description: 'Read recent emails',
        arguments: { maxResults: 5 },
      },
    })

  const resolvedOperationCall = () =>
    toolEnv({
      phase: 'call',
      executor: 'sim',
      mode: 'async',
      toolCallId: CALL_ID,
      toolName: 'gmail_read_v2',
      arguments: { maxResults: 5, credentialId: 'cred-1' },
    })

  /** The exact toolCall snapshot the browser publishes for this row. */
  function publishedToolCall(ctx: StreamLoopContext) {
    const blocks = modelToContentBlocks(ctx.state.model)
    const block = blocks.find((b) => b.type === 'tool_call' && b.toolCall?.id === CALL_ID)
    expect(block?.toolCall).toBeDefined()
    return block!.toolCall!
  }

  it('brands the row from streamed args while generating, then rebinds to the resolved operation', () => {
    const ctx = createStreamLoopContext(makeStreamLoopDeps())

    // Provisional frame: neutral label, never the humanized gateway name.
    dispatchStreamEvent(ctx, generating())
    expect(publishedToolCall(ctx).displayTitle).toBe('Calling integration')

    // toolId alone brands only the icon (row component); text stays neutral.
    dispatchStreamEvent(ctx, argsDelta('{"toolId":"gmail_read_v2",'))
    expect(publishedToolCall(ctx).displayTitle).toBe('Calling integration')
    expect(publishedToolCall(ctx).streamingArgs).toContain('"toolId":"gmail_read_v2"')

    // The model-authored activity phrase becomes the row text as it completes.
    dispatchStreamEvent(ctx, argsDelta('"description":"Read recent emails",'))
    expect(publishedToolCall(ctx).displayTitle).toBe('Read recent emails')

    dispatchStreamEvent(ctx, argsDelta('"arguments":{"maxResults":5}}'))
    dispatchStreamEvent(ctx, gatewayFinalCall())
    expect(publishedToolCall(ctx)).toEqual(
      expect.objectContaining({
        name: GATEWAY,
        displayTitle: 'Read recent emails',
      })
    )

    // Second authoritative frame (same call id): rebind to the exact operation.
    dispatchStreamEvent(ctx, resolvedOperationCall())
    const rebound = publishedToolCall(ctx)
    expect(rebound).toEqual(
      expect.objectContaining({
        name: 'gmail_read_v2',
        displayTitle: 'Read recent emails',
        integrationDescription: 'Read recent emails',
        params: { maxResults: 5, credentialId: 'cred-1' },
      })
    )
    expect(rebound.streamingArgs).toBeUndefined()

    dispatchStreamEvent(ctx, toolResult(CALL_ID, true, 'gmail_read_v2'))
    expect(publishedToolCall(ctx)).toEqual(
      expect.objectContaining({
        name: 'gmail_read_v2',
        status: 'success',
        displayTitle: 'Read recent emails',
      })
    )
  })

  it('keeps the rebound branding across a snapshot rebuild (reconnect round-trip)', () => {
    const ctx = createStreamLoopContext(makeStreamLoopDeps())
    dispatchStreamEvent(ctx, generating())
    dispatchStreamEvent(ctx, gatewayFinalCall())
    dispatchStreamEvent(ctx, resolvedOperationCall())
    dispatchStreamEvent(ctx, toolResult(CALL_ID, true, 'gmail_read_v2'))

    const rebuilt = contentBlocksToModel(modelToContentBlocks(ctx.state.model))
    const blocks = modelToContentBlocks(rebuilt)
    const block = blocks.find((b) => b.type === 'tool_call' && b.toolCall?.id === CALL_ID)
    expect(block?.toolCall).toEqual(
      expect.objectContaining({
        name: 'gmail_read_v2',
        status: 'success',
        displayTitle: 'Read recent emails',
      })
    )
  })
})
