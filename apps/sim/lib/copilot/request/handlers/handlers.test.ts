/**
 * @vitest-environment node
 */

import { loggerMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TraceCollector } from '@/lib/copilot/request/trace'

vi.mock('@sim/logger', () => loggerMock)

const { isSimExecuted, executeTool, ensureHandlersRegistered } = vi.hoisted(() => ({
  isSimExecuted: vi.fn().mockReturnValue(true),
  executeTool: vi.fn().mockResolvedValue({ success: true, output: { ok: true } }),
  ensureHandlersRegistered: vi.fn(),
}))

const { upsertAsyncToolCall, markAsyncToolRunning, completeAsyncToolCall } = vi.hoisted(() => ({
  upsertAsyncToolCall: vi.fn(),
  markAsyncToolRunning: vi.fn(),
  completeAsyncToolCall: vi.fn(),
}))

vi.mock('@/lib/copilot/tool-executor', () => ({
  isSimExecuted,
  executeTool,
  ensureHandlersRegistered,
  getToolEntry: vi.fn().mockReturnValue(undefined),
}))

vi.mock('@/lib/copilot/async-runs/repository', async () => {
  const actual = await vi.importActual<typeof import('@/lib/copilot/async-runs/repository')>(
    '@/lib/copilot/async-runs/repository'
  )
  return {
    ...actual,
    upsertAsyncToolCall,
    markAsyncToolRunning,
    completeAsyncToolCall,
  }
})

import {
  MothershipStreamV1AsyncToolRecordStatus,
  MothershipStreamV1EventType,
  MothershipStreamV1ResourceOp,
  MothershipStreamV1RunKind,
  MothershipStreamV1TextChannel,
  MothershipStreamV1ToolExecutor,
  MothershipStreamV1ToolMode,
  MothershipStreamV1ToolOutcome,
  MothershipStreamV1ToolPhase,
} from '@/lib/copilot/generated/mothership-stream-v1'
import { Read as ReadTool } from '@/lib/copilot/generated/tool-catalog-v1'
import { sseHandlers, subAgentHandlers } from '@/lib/copilot/request/handlers'
import type { ExecutionContext, StreamEvent, StreamingContext } from '@/lib/copilot/request/types'

describe('sse-handlers tool lifecycle', () => {
  let context: StreamingContext
  let execContext: ExecutionContext

  beforeEach(() => {
    vi.clearAllMocks()
    upsertAsyncToolCall.mockResolvedValue(null)
    markAsyncToolRunning.mockResolvedValue(null)
    completeAsyncToolCall.mockResolvedValue(null)
    context = {
      chatId: undefined,
      messageId: 'msg-1',
      accumulatedContent: '',
      trace: new TraceCollector(),
      contentBlocks: [],
      toolCalls: new Map(),
      pendingToolPromises: new Map(),
      currentThinkingBlock: null,
      isInThinkingBlock: false,
      subAgentParentToolCallId: undefined,
      subAgentParentStack: [],
      subAgentContent: {},
      subAgentToolCalls: {},
      pendingContent: '',
      streamComplete: false,
      wasAborted: false,
      errors: [],
    }
    execContext = {
      userId: 'user-1',
      workflowId: 'workflow-1',
    }
  })

  it('executes tool_call and emits tool_result', async () => {
    executeTool.mockResolvedValueOnce({ success: true, output: { ok: true } })
    const onEvent = vi.fn()

    await sseHandlers.tool(
      {
        type: MothershipStreamV1EventType.tool,
        payload: {
          toolCallId: 'tool-1',
          toolName: ReadTool.id,
          arguments: { workflowId: 'workflow-1' },
          executor: MothershipStreamV1ToolExecutor.sim,
          mode: MothershipStreamV1ToolMode.async,
          phase: MothershipStreamV1ToolPhase.call,
          ui: {
            title: 'Reading foo.txt',
            phaseLabel: 'Workspace',
          },
        },
      } satisfies StreamEvent,
      context,
      execContext,
      { onEvent, interactive: false, timeout: 1000 }
    )

    // tool_call fires execution without awaiting (fire-and-forget for parallel execution),
    // so we flush pending microtasks before asserting
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(executeTool).toHaveBeenCalledTimes(1)
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MothershipStreamV1EventType.tool,
        payload: expect.objectContaining({
          toolCallId: 'tool-1',
          success: true,
          phase: MothershipStreamV1ToolPhase.result,
        }),
      })
    )

    const updated = context.toolCalls.get('tool-1')
    expect(updated?.status).toBe(MothershipStreamV1ToolOutcome.success)
    expect(updated?.displayTitle).toBe('Reading foo.txt')
    expect(updated?.result?.output).toEqual({ ok: true })
    expect(context.contentBlocks.at(0)).toEqual(
      expect.objectContaining({
        type: 'tool_call',
        toolCall: expect.objectContaining({
          id: 'tool-1',
          displayTitle: 'Reading foo.txt',
        }),
      })
    )
  })

  it('uses phaseLabel as a display title fallback when no title is provided', async () => {
    executeTool.mockResolvedValueOnce({ success: true, output: { ok: true } })
    const onEvent = vi.fn()

    await sseHandlers.tool(
      {
        type: MothershipStreamV1EventType.tool,
        payload: {
          toolCallId: 'tool-phase-label',
          toolName: ReadTool.id,
          arguments: { workflowId: 'workflow-1' },
          executor: MothershipStreamV1ToolExecutor.sim,
          mode: MothershipStreamV1ToolMode.async,
          phase: MothershipStreamV1ToolPhase.call,
          ui: {
            phaseLabel: 'Workspace',
          },
        },
      } satisfies StreamEvent,
      context,
      execContext,
      { onEvent, interactive: false, timeout: 1000 }
    )

    await new Promise((resolve) => setTimeout(resolve, 0))

    const updated = context.toolCalls.get('tool-phase-label')
    expect(updated?.displayTitle).toBe('Workspace')
    expect(context.contentBlocks.at(0)).toEqual(
      expect.objectContaining({
        type: 'tool_call',
        toolCall: expect.objectContaining({
          id: 'tool-phase-label',
          displayTitle: 'Workspace',
        }),
      })
    )
  })

  it('preserves primitive tool outputs through async completion persistence', async () => {
    executeTool.mockResolvedValueOnce({ success: true, output: 'done' })
    const onEvent = vi.fn()

    await sseHandlers.tool(
      {
        type: MothershipStreamV1EventType.tool,
        payload: {
          toolCallId: 'tool-primitive',
          toolName: ReadTool.id,
          arguments: { workflowId: 'workflow-1' },
          executor: MothershipStreamV1ToolExecutor.sim,
          mode: MothershipStreamV1ToolMode.async,
          phase: MothershipStreamV1ToolPhase.call,
        },
      } satisfies StreamEvent,
      context,
      execContext,
      { onEvent, interactive: false, timeout: 1000 }
    )

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(completeAsyncToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: 'tool-primitive',
        status: MothershipStreamV1AsyncToolRecordStatus.completed,
        result: 'done',
        error: null,
      })
    )
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MothershipStreamV1EventType.tool,
        payload: expect.objectContaining({
          toolCallId: 'tool-primitive',
          phase: MothershipStreamV1ToolPhase.result,
          success: true,
          output: 'done',
        }),
      })
    )

    const updated = context.toolCalls.get('tool-primitive')
    expect(updated?.status).toBe(MothershipStreamV1ToolOutcome.success)
    expect(updated?.result?.output).toBe('done')
  })

  it('does not add hidden tool calls to content blocks', async () => {
    executeTool.mockResolvedValueOnce({ success: true, output: { skill: 'ok' } })

    await sseHandlers.tool(
      {
        type: MothershipStreamV1EventType.tool,
        payload: {
          toolCallId: 'tool-hidden',
          toolName: 'load_agent_skill',
          arguments: { skill_name: 'markdown-writing' },
          executor: MothershipStreamV1ToolExecutor.sim,
          mode: MothershipStreamV1ToolMode.async,
          phase: MothershipStreamV1ToolPhase.call,
        },
      } satisfies StreamEvent,
      context,
      execContext,
      { interactive: false, timeout: 1000 }
    )

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(executeTool).toHaveBeenCalledTimes(1)
    expect(context.contentBlocks).toEqual([])
    expect(context.toolCalls.get('tool-hidden')?.name).toBe('load_agent_skill')
  })

  it('updates stored params when a subagent generating event is followed by the final tool call', async () => {
    executeTool.mockResolvedValueOnce({ success: true, output: { ok: true } })
    context.subAgentParentToolCallId = 'parent-1'
    context.subAgentParentStack = ['parent-1']
    context.toolCalls.set('parent-1', {
      id: 'parent-1',
      name: 'workflow',
      status: 'pending',
      startTime: Date.now(),
    })

    await subAgentHandlers.tool(
      {
        type: MothershipStreamV1EventType.tool,
        scope: { lane: 'subagent', parentToolCallId: 'parent-1', agentId: 'workflow' },
        payload: {
          toolCallId: 'sub-tool-1',
          toolName: 'create_workflow',
          executor: MothershipStreamV1ToolExecutor.sim,
          mode: MothershipStreamV1ToolMode.async,
          phase: MothershipStreamV1ToolPhase.call,
          status: 'generating',
        },
      } satisfies StreamEvent,
      context,
      execContext,
      { interactive: false, timeout: 1000 }
    )

    await subAgentHandlers.tool(
      {
        type: MothershipStreamV1EventType.tool,
        scope: { lane: 'subagent', parentToolCallId: 'parent-1', agentId: 'workflow' },
        payload: {
          toolCallId: 'sub-tool-1',
          toolName: 'create_workflow',
          arguments: { name: 'Example Workflow' },
          executor: MothershipStreamV1ToolExecutor.sim,
          mode: MothershipStreamV1ToolMode.async,
          phase: MothershipStreamV1ToolPhase.call,
          status: 'executing',
        },
      } satisfies StreamEvent,
      context,
      execContext,
      { interactive: false, timeout: 1000 }
    )

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(executeTool).toHaveBeenCalledWith(
      'create_workflow',
      { name: 'Example Workflow' },
      expect.any(Object)
    )
    expect(context.toolCalls.get('sub-tool-1')?.params).toEqual({ name: 'Example Workflow' })
    expect(context.subAgentToolCalls['parent-1']?.[0]?.params).toEqual({
      name: 'Example Workflow',
    })
  })

  it('routes subagent text using the event scope parent tool call id', async () => {
    context.subAgentParentToolCallId = 'wrong-parent'
    context.subAgentContent['parent-1'] = ''

    await subAgentHandlers.text(
      {
        type: MothershipStreamV1EventType.text,
        scope: { lane: 'subagent', parentToolCallId: 'parent-1', agentId: 'deploy' },
        payload: {
          channel: MothershipStreamV1TextChannel.assistant,
          text: 'hello from deploy',
        },
      } satisfies StreamEvent,
      context,
      execContext,
      { interactive: false, timeout: 1000 }
    )

    expect(context.subAgentContent['parent-1']).toBe('hello from deploy')
    expect(context.contentBlocks.at(-1)).toEqual(
      expect.objectContaining({
        type: 'subagent_text',
        content: 'hello from deploy',
      })
    )
  })

  it('routes main assistant text with no scope into accumulatedContent', async () => {
    await sseHandlers.text(
      {
        type: MothershipStreamV1EventType.text,
        payload: {
          channel: MothershipStreamV1TextChannel.assistant,
          text: 'hello from main',
        },
      } satisfies StreamEvent,
      context,
      execContext,
      { interactive: false, timeout: 1000 }
    )

    expect(context.accumulatedContent).toBe('hello from main')
    expect(context.contentBlocks.at(-1)).toEqual(
      expect.objectContaining({
        type: 'text',
        content: 'hello from main',
      })
    )
  })

  it('routes subagent tool calls using the event scope parent tool call id', async () => {
    executeTool.mockResolvedValueOnce({ success: true, output: { ok: true } })
    context.subAgentParentToolCallId = 'wrong-parent'
    context.toolCalls.set('parent-1', {
      id: 'parent-1',
      name: 'deploy',
      status: 'pending',
      startTime: Date.now(),
    })

    await subAgentHandlers.tool(
      {
        type: MothershipStreamV1EventType.tool,
        scope: { lane: 'subagent', parentToolCallId: 'parent-1', agentId: 'deploy' },
        payload: {
          toolCallId: 'sub-tool-scope-1',
          toolName: 'read',
          arguments: { path: 'workflow.json' },
          executor: MothershipStreamV1ToolExecutor.sim,
          mode: MothershipStreamV1ToolMode.async,
          phase: MothershipStreamV1ToolPhase.call,
        },
      } satisfies StreamEvent,
      context,
      execContext,
      { interactive: false, timeout: 1000 }
    )

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(context.subAgentToolCalls['parent-1']?.[0]?.id).toBe('sub-tool-scope-1')
  })

  it('skips duplicate tool_call after result', async () => {
    executeTool.mockResolvedValueOnce({ success: true, output: { ok: true } })

    const event = {
      type: MothershipStreamV1EventType.tool,
      payload: {
        toolCallId: 'tool-dup',
        toolName: ReadTool.id,
        arguments: { workflowId: 'workflow-1' },
        executor: MothershipStreamV1ToolExecutor.sim,
        mode: MothershipStreamV1ToolMode.async,
        phase: MothershipStreamV1ToolPhase.call,
      },
    }

    await sseHandlers.tool(event as StreamEvent, context, execContext, { interactive: false })
    await new Promise((resolve) => setTimeout(resolve, 0))
    await sseHandlers.tool(event as StreamEvent, context, execContext, { interactive: false })

    expect(executeTool).toHaveBeenCalledTimes(1)
  })

  it('marks an in-flight tool as cancelled when aborted mid-execution', async () => {
    const abortController = new AbortController()
    const userStopController = new AbortController()
    execContext.abortSignal = abortController.signal
    execContext.userStopSignal = userStopController.signal

    executeTool.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ success: true, output: { ok: true } }), 0)
        })
    )

    await sseHandlers.tool(
      {
        type: MothershipStreamV1EventType.tool,
        payload: {
          toolCallId: 'tool-cancel',
          toolName: ReadTool.id,
          arguments: { workflowId: 'workflow-1' },
          executor: MothershipStreamV1ToolExecutor.sim,
          mode: MothershipStreamV1ToolMode.async,
          phase: MothershipStreamV1ToolPhase.call,
        },
      } satisfies StreamEvent,
      context,
      execContext,
      {
        interactive: false,
        timeout: 1000,
        abortSignal: abortController.signal,
        userStopSignal: userStopController.signal,
      }
    )

    userStopController.abort()
    abortController.abort()
    await new Promise((resolve) => setTimeout(resolve, 10))

    const updated = context.toolCalls.get('tool-cancel')
    expect(updated?.status).toBe(MothershipStreamV1ToolOutcome.cancelled)
    expect(updated?.result).toEqual({ success: false })
    expect(updated?.error).toBe('Request aborted during tool execution')
  })

  it('does not replace an in-flight pending promise on duplicate tool_call', async () => {
    let resolveTool: ((value: { success: boolean; output: { ok: boolean } }) => void) | undefined
    executeTool.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveTool = resolve
        })
    )

    const event = {
      type: MothershipStreamV1EventType.tool,
      payload: {
        toolCallId: 'tool-inflight',
        toolName: ReadTool.id,
        arguments: { workflowId: 'workflow-1' },
        executor: MothershipStreamV1ToolExecutor.sim,
        mode: MothershipStreamV1ToolMode.async,
        phase: MothershipStreamV1ToolPhase.call,
      },
    }

    await sseHandlers.tool(event as StreamEvent, context, execContext, { interactive: false })
    await new Promise((resolve) => setTimeout(resolve, 0))

    const firstPromise = context.pendingToolPromises.get('tool-inflight')
    expect(firstPromise).toBeDefined()

    await sseHandlers.tool(event as StreamEvent, context, execContext, { interactive: false })

    expect(executeTool).toHaveBeenCalledTimes(1)
    expect(context.pendingToolPromises.get('tool-inflight')).toBe(firstPromise)

    resolveTool?.({ success: true, output: { ok: true } })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(context.pendingToolPromises.has('tool-inflight')).toBe(false)
  })

  it('still executes the tool when async row upsert fails', async () => {
    upsertAsyncToolCall.mockRejectedValueOnce(new Error('db down'))
    executeTool.mockResolvedValueOnce({ success: true, output: { ok: true } })

    await sseHandlers.tool(
      {
        type: MothershipStreamV1EventType.tool,
        payload: {
          toolCallId: 'tool-upsert-fail',
          toolName: ReadTool.id,
          arguments: { workflowId: 'workflow-1' },
          executor: MothershipStreamV1ToolExecutor.sim,
          mode: MothershipStreamV1ToolMode.async,
          phase: MothershipStreamV1ToolPhase.call,
        },
      } satisfies StreamEvent,
      context,
      execContext,
      { onEvent: vi.fn(), interactive: false, timeout: 1000 }
    )

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(executeTool).toHaveBeenCalledTimes(1)
    expect(context.toolCalls.get('tool-upsert-fail')?.status).toBe(
      MothershipStreamV1ToolOutcome.success
    )
  })

  it('does not execute a tool if a terminal tool_result arrives before local execution starts', async () => {
    let resolveUpsert: ((value: null) => void) | undefined
    upsertAsyncToolCall.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveUpsert = resolve
        })
    )
    const onEvent = vi.fn()

    await sseHandlers.tool(
      {
        type: MothershipStreamV1EventType.tool,
        payload: {
          toolCallId: 'tool-race',
          toolName: ReadTool.id,
          arguments: { workflowId: 'workflow-1' },
          executor: MothershipStreamV1ToolExecutor.sim,
          mode: MothershipStreamV1ToolMode.async,
          phase: MothershipStreamV1ToolPhase.call,
        },
      } satisfies StreamEvent,
      context,
      execContext,
      { onEvent, interactive: false, timeout: 1000 }
    )

    await sseHandlers.tool(
      {
        type: MothershipStreamV1EventType.tool,
        payload: {
          toolCallId: 'tool-race',
          toolName: ReadTool.id,
          executor: MothershipStreamV1ToolExecutor.sim,
          mode: MothershipStreamV1ToolMode.async,
          phase: MothershipStreamV1ToolPhase.result,
          success: true,
          output: { ok: true },
        },
      } satisfies StreamEvent,
      context,
      execContext,
      { onEvent, interactive: false, timeout: 1000 }
    )

    resolveUpsert?.(null)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(executeTool).not.toHaveBeenCalled()
    expect(context.toolCalls.get('tool-race')?.status).toBe(MothershipStreamV1ToolOutcome.success)
    expect(context.toolCalls.get('tool-race')?.result?.output).toEqual({ ok: true })
  })

  it('does not execute a tool if a tool_result arrives before the tool_call event', async () => {
    const onEvent = vi.fn()

    await sseHandlers.tool(
      {
        type: MothershipStreamV1EventType.tool,
        payload: {
          toolCallId: 'tool-early-result',
          toolName: ReadTool.id,
          executor: MothershipStreamV1ToolExecutor.sim,
          mode: MothershipStreamV1ToolMode.async,
          phase: MothershipStreamV1ToolPhase.result,
          success: true,
          output: { ok: true },
        },
      } satisfies StreamEvent,
      context,
      execContext,
      { onEvent, interactive: false, timeout: 1000 }
    )

    await sseHandlers.tool(
      {
        type: MothershipStreamV1EventType.tool,
        payload: {
          toolCallId: 'tool-early-result',
          toolName: ReadTool.id,
          arguments: { workflowId: 'workflow-1' },
          executor: MothershipStreamV1ToolExecutor.sim,
          mode: MothershipStreamV1ToolMode.async,
          phase: MothershipStreamV1ToolPhase.call,
        },
      } satisfies StreamEvent,
      context,
      execContext,
      { onEvent, interactive: false, timeout: 1000 }
    )

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(executeTool).not.toHaveBeenCalled()
    expect(context.toolCalls.get('tool-early-result')?.status).toBe(
      MothershipStreamV1ToolOutcome.success
    )
  })

  it('reads canonical tool result errors from the error field', async () => {
    await sseHandlers.tool(
      {
        type: MothershipStreamV1EventType.tool,
        payload: {
          toolCallId: 'tool-output-only',
          toolName: ReadTool.id,
          executor: MothershipStreamV1ToolExecutor.sim,
          mode: MothershipStreamV1ToolMode.async,
          phase: MothershipStreamV1ToolPhase.result,
          success: false,
          error: 'output-failure',
          output: { detail: 'extra-context' },
        },
      } satisfies StreamEvent,
      context,
      execContext,
      { onEvent: vi.fn(), interactive: false, timeout: 1000 }
    )

    const updated = context.toolCalls.get('tool-output-only')
    expect(updated?.status).toBe(MothershipStreamV1ToolOutcome.error)
    expect(updated?.result?.output).toEqual({ detail: 'extra-context' })
    expect(updated?.error).toBe('output-failure')
  })

  it('preserves skipped tool results from the stream contract', async () => {
    await sseHandlers.tool(
      {
        type: MothershipStreamV1EventType.tool,
        payload: {
          toolCallId: 'tool-skipped',
          toolName: ReadTool.id,
          executor: MothershipStreamV1ToolExecutor.sim,
          mode: MothershipStreamV1ToolMode.async,
          phase: MothershipStreamV1ToolPhase.result,
          status: MothershipStreamV1ToolOutcome.skipped,
          success: true,
          output: { detached: true },
        },
      } satisfies StreamEvent,
      context,
      execContext,
      { onEvent: vi.fn(), interactive: false, timeout: 1000 }
    )

    const updated = context.toolCalls.get('tool-skipped')
    expect(updated?.status).toBe(MothershipStreamV1ToolOutcome.skipped)
    expect(updated?.result?.output).toEqual({ detached: true })
    expect(updated?.error).toBeUndefined()
  })

  it('executes dynamic sim tools based on payload executor', async () => {
    isSimExecuted.mockReturnValueOnce(false)
    executeTool.mockResolvedValueOnce({ success: true, output: { emails: [] } })

    await sseHandlers.tool(
      {
        type: MothershipStreamV1EventType.tool,
        payload: {
          toolCallId: 'tool-dynamic-sim',
          toolName: 'gmail_read',
          arguments: { maxResults: 10 },
          executor: MothershipStreamV1ToolExecutor.sim,
          mode: MothershipStreamV1ToolMode.async,
          phase: MothershipStreamV1ToolPhase.call,
        },
      } satisfies StreamEvent,
      context,
      execContext,
      { interactive: false, timeout: 1000 }
    )

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(executeTool).toHaveBeenCalledWith('gmail_read', { maxResults: 10 }, expect.any(Object))
    expect(context.toolCalls.get('tool-dynamic-sim')?.status).toBe(
      MothershipStreamV1ToolOutcome.success
    )
  })

  it('clears pending continuation state when a run resumes', async () => {
    context.awaitingAsyncContinuation = {
      checkpointId: 'cp-1',
      executionId: 'exec-1',
      runId: 'run-1',
      pendingToolCallIds: ['tool-1'],
    }
    context.streamComplete = true

    await sseHandlers.run(
      {
        type: MothershipStreamV1EventType.run,
        payload: {
          kind: MothershipStreamV1RunKind.resumed,
        },
      } satisfies StreamEvent,
      context,
      execContext,
      { interactive: false, timeout: 1000 }
    )

    expect(context.awaitingAsyncContinuation).toBeUndefined()
    expect(context.streamComplete).toBe(false)
  })

  it('routes resource events through an explicit main-lane handler', async () => {
    expect(() =>
      sseHandlers.resource(
        {
          type: MothershipStreamV1EventType.resource,
          payload: {
            op: MothershipStreamV1ResourceOp.upsert,
            resource: {
              type: 'file',
              id: 'file-1',
              title: 'Document',
            },
          },
        } satisfies StreamEvent,
        context,
        execContext,
        { interactive: false, timeout: 1000 }
      )
    ).not.toThrow()
  })
})
