/**
 * @vitest-environment node
 */

import { sleep } from '@sim/utils/helpers'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TraceCollector } from '@/lib/copilot/request/trace'

const { isSimExecuted, executeTool, ensureHandlersRegistered } = vi.hoisted(() => ({
  isSimExecuted: vi.fn().mockReturnValue(true),
  executeTool: vi.fn().mockResolvedValue({ success: true, output: { ok: true } }),
  ensureHandlersRegistered: vi.fn(),
}))

const { upsertAsyncToolCall, markAsyncToolRunning, completeAsyncToolCall, markAsyncToolDelivered } =
  vi.hoisted(() => ({
    upsertAsyncToolCall: vi.fn(),
    markAsyncToolRunning: vi.fn(),
    completeAsyncToolCall: vi.fn(),
    markAsyncToolDelivered: vi.fn(),
  }))

const { waitForToolCompletion } = vi.hoisted(() => ({
  waitForToolCompletion: vi.fn(),
}))

vi.mock('@/lib/copilot/tool-executor', () => ({
  isSimExecuted,
  executeTool,
  ensureHandlersRegistered,
  getToolEntry: vi.fn().mockReturnValue(undefined),
}))

vi.mock('@/lib/copilot/async-runs/repository', () => ({
  createRunSegment: vi.fn(),
  updateRunStatus: vi.fn(),
  getLatestRunForExecution: vi.fn(),
  getLatestRunForStream: vi.fn(),
  getRunSegment: vi.fn(),
  createRunCheckpoint: vi.fn(),
  getAsyncToolCall: vi.fn(),
  markAsyncToolStatus: vi.fn(),
  listAsyncToolCallsForRun: vi.fn(),
  getAsyncToolCalls: vi.fn(),
  claimCompletedAsyncToolCall: vi.fn(),
  releaseCompletedAsyncToolClaim: vi.fn(),
  upsertAsyncToolCall,
  markAsyncToolRunning,
  markAsyncToolDelivered,
  completeAsyncToolCall,
}))

vi.mock('@/lib/copilot/request/tools/client', () => ({
  waitForToolCompletion,
}))

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
    markAsyncToolDelivered.mockResolvedValue(null)
    waitForToolCompletion.mockResolvedValue(null)
    context = {
      chatId: undefined,
      messageId: 'msg-1',
      accumulatedContent: '',
      finalAssistantContent: '',
      sawMainToolCall: false,
      trace: new TraceCollector(),
      contentBlocks: [],
      toolCalls: new Map(),
      pendingToolPromises: new Map(),
      currentThinkingBlock: null,
      subagentThinkingBlocks: new Map(),
      isInThinkingBlock: false,
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

  it('keeps only the latest post-tool assistant text for headless final content', async () => {
    await sseHandlers.text(
      {
        type: MothershipStreamV1EventType.text,
        payload: {
          channel: MothershipStreamV1TextChannel.assistant,
          text: 'I will check that.',
        },
      } satisfies StreamEvent,
      context,
      execContext,
      { interactive: false }
    )

    await sseHandlers.tool(
      {
        type: MothershipStreamV1EventType.tool,
        payload: {
          toolCallId: 'tool-1',
          toolName: ReadTool.id,
          arguments: { path: 'foo.txt' },
          executor: MothershipStreamV1ToolExecutor.sim,
          mode: MothershipStreamV1ToolMode.async,
          phase: MothershipStreamV1ToolPhase.call,
        },
      } satisfies StreamEvent,
      context,
      execContext,
      { interactive: false, autoExecuteTools: false }
    )

    await sseHandlers.text(
      {
        type: MothershipStreamV1EventType.text,
        payload: {
          channel: MothershipStreamV1TextChannel.assistant,
          text: 'Final answer only.',
        },
      } satisfies StreamEvent,
      context,
      execContext,
      { interactive: false }
    )

    expect(context.accumulatedContent).toBe('I will check that.Final answer only.')
    expect(context.finalAssistantContent).toBe('Final answer only.')
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
          ui: {},
        },
      } satisfies StreamEvent,
      context,
      execContext,
      { onEvent, interactive: false, timeout: 1000 }
    )

    // tool_call fires execution without awaiting (fire-and-forget for parallel execution),
    // so we flush pending microtasks before asserting
    await sleep(0)

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
    // Display titles are derived client-side from the tool name (+args), not the
    // stream; read with no path resolves to the static "Reading file".
    expect(updated?.displayTitle).toBe('Reading file')
    expect(updated?.result?.output).toEqual({ ok: true })
    expect(context.contentBlocks.at(0)).toEqual(
      expect.objectContaining({
        type: 'tool_call',
        toolCall: expect.objectContaining({
          id: 'tool-1',
          displayTitle: 'Reading file',
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

    await sleep(0)

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

  it('marks background client workflow tools delivered after synthetic result emission', async () => {
    waitForToolCompletion.mockResolvedValueOnce({
      status: 'background',
      data: { detached: true },
    })
    const onEvent = vi.fn()

    await sseHandlers.tool(
      {
        type: MothershipStreamV1EventType.tool,
        payload: {
          toolCallId: 'tool-background',
          toolName: 'run_workflow',
          arguments: { workflowId: 'workflow-1' },
          executor: MothershipStreamV1ToolExecutor.client,
          mode: MothershipStreamV1ToolMode.async,
          phase: MothershipStreamV1ToolPhase.call,
        },
      } satisfies StreamEvent,
      context,
      execContext,
      { onEvent, interactive: true, timeout: 1000 }
    )

    await sleep(0)
    await Promise.allSettled(context.pendingToolPromises.values())

    expect(markAsyncToolDelivered).toHaveBeenCalledWith('tool-background')
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MothershipStreamV1EventType.tool,
        payload: expect.objectContaining({
          toolCallId: 'tool-background',
          phase: MothershipStreamV1ToolPhase.result,
          status: MothershipStreamV1ToolOutcome.skipped,
          success: true,
          output: { detached: true },
        }),
      })
    )
    expect(context.toolCalls.get('tool-background')?.status).toBe(
      MothershipStreamV1ToolOutcome.skipped
    )
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

    await sleep(0)

    expect(executeTool).toHaveBeenCalledTimes(1)
    expect(context.contentBlocks).toEqual([])
    expect(context.toolCalls.get('tool-hidden')?.name).toBe('load_agent_skill')
  })

  it('does not add ui-hidden tool calls to content blocks', async () => {
    await sseHandlers.tool(
      {
        type: MothershipStreamV1EventType.tool,
        payload: {
          toolCallId: 'tool-ui-hidden',
          toolName: 'read',
          arguments: { path: 'components/integrations/slack/README.md' },
          executor: MothershipStreamV1ToolExecutor.go,
          mode: MothershipStreamV1ToolMode.sync,
          phase: MothershipStreamV1ToolPhase.call,
          ui: { hidden: true },
        },
      } satisfies StreamEvent,
      context,
      execContext,
      { interactive: false, timeout: 1000 }
    )

    expect(context.contentBlocks).toEqual([])
    expect(context.toolCalls.get('tool-ui-hidden')?.name).toBe('read')
  })

  it('removes an existing content block when a later frame marks the tool hidden', async () => {
    await sseHandlers.tool(
      {
        type: MothershipStreamV1EventType.tool,
        payload: {
          toolCallId: 'tool-hidden-after-partial',
          toolName: 'read',
          executor: MothershipStreamV1ToolExecutor.go,
          mode: MothershipStreamV1ToolMode.sync,
          phase: MothershipStreamV1ToolPhase.call,
          status: 'generating',
          arguments: { path: 'components/integrations' },
        },
      } satisfies StreamEvent,
      context,
      execContext,
      { interactive: false, timeout: 1000 }
    )
    expect(context.contentBlocks).toHaveLength(1)

    await sseHandlers.tool(
      {
        type: MothershipStreamV1EventType.tool,
        payload: {
          toolCallId: 'tool-hidden-after-partial',
          toolName: 'read',
          executor: MothershipStreamV1ToolExecutor.go,
          mode: MothershipStreamV1ToolMode.sync,
          phase: MothershipStreamV1ToolPhase.call,
          arguments: { path: 'components/integrations/slack/README.md' },
          ui: { hidden: true },
        },
      } satisfies StreamEvent,
      context,
      execContext,
      { interactive: false, timeout: 1000 }
    )

    expect(context.contentBlocks).toEqual([])
  })

  it('does not show pathless read or glob generating placeholders', async () => {
    for (const toolName of ['read', 'glob'] as const) {
      await sseHandlers.tool(
        {
          type: MothershipStreamV1EventType.tool,
          payload: {
            toolCallId: `${toolName}-generating`,
            toolName,
            executor: MothershipStreamV1ToolExecutor.go,
            mode: MothershipStreamV1ToolMode.sync,
            phase: MothershipStreamV1ToolPhase.call,
            status: 'generating',
          },
        } satisfies StreamEvent,
        context,
        execContext,
        { interactive: false, timeout: 1000 }
      )
    }

    expect(context.contentBlocks).toEqual([])
    expect(context.toolCalls.has('read-generating')).toBe(false)
    expect(context.toolCalls.has('glob-generating')).toBe(false)
  })

  it('updates stored params when a subagent generating event is followed by the final tool call', async () => {
    executeTool.mockResolvedValueOnce({ success: true, output: { ok: true } })
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

    await sleep(0)

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

    await sleep(0)

    expect(context.subAgentToolCalls['parent-1']?.[0]?.id).toBe('sub-tool-scope-1')
  })

  it('pairs compaction lifecycle events within each scoped subagent lane', async () => {
    context.toolCalls.set('parent-A', {
      id: 'parent-A',
      name: 'workflow',
      status: 'executing',
    })
    context.toolCalls.set('parent-B', {
      id: 'parent-B',
      name: 'workflow',
      status: 'executing',
    })
    const sendCompaction = async (
      kind: 'compaction_start' | 'compaction_done',
      parentToolCallId: string,
      spanId: string
    ) => {
      await subAgentHandlers.run(
        {
          type: MothershipStreamV1EventType.run,
          scope: {
            lane: 'subagent',
            parentToolCallId,
            spanId,
            parentSpanId: 'main',
            agentId: 'superagent',
          },
          payload: { kind },
        } as StreamEvent,
        context,
        execContext,
        { interactive: false, timeout: 1000 }
      )
    }

    await sendCompaction(MothershipStreamV1RunKind.compaction_start, 'parent-A', 'span-A')
    await sendCompaction(MothershipStreamV1RunKind.compaction_start, 'parent-B', 'span-B')
    await sendCompaction(MothershipStreamV1RunKind.compaction_done, 'parent-A', 'span-A')

    const compactions = context.contentBlocks.filter(
      (block) => block.type === 'tool_call' && block.toolCall?.name === 'context_compaction'
    )
    expect(compactions).toHaveLength(2)

    const laneA = compactions.find((block) => block.spanId === 'span-A')
    const laneB = compactions.find((block) => block.spanId === 'span-B')
    expect(laneA).toEqual(
      expect.objectContaining({
        calledBy: 'workflow',
        parentToolCallId: 'parent-A',
        parentSpanId: 'main',
        endedAt: expect.any(Number),
        toolCall: expect.objectContaining({ status: MothershipStreamV1ToolOutcome.success }),
      })
    )
    expect(laneB?.toolCall?.status).toBe('executing')

    await sendCompaction(MothershipStreamV1RunKind.compaction_done, 'parent-B', 'span-B')

    expect(context.contentBlocks).toHaveLength(2)
    expect(laneB?.toolCall?.status).toBe(MothershipStreamV1ToolOutcome.success)
  })

  it('pairs main-lane compaction start and done into one completed block', async () => {
    await sseHandlers.run(
      {
        type: MothershipStreamV1EventType.run,
        payload: { kind: MothershipStreamV1RunKind.compaction_start },
      } satisfies StreamEvent,
      context,
      execContext,
      { interactive: false }
    )
    const compactionId = context.contentBlocks[0]?.toolCall?.id

    await sseHandlers.run(
      {
        type: MothershipStreamV1EventType.run,
        payload: { kind: MothershipStreamV1RunKind.compaction_done },
      } satisfies StreamEvent,
      context,
      execContext,
      { interactive: false }
    )

    expect(context.contentBlocks).toHaveLength(1)
    expect(context.contentBlocks[0]).toEqual(
      expect.objectContaining({
        endedAt: expect.any(Number),
        toolCall: expect.objectContaining({
          id: compactionId,
          name: 'context_compaction',
          status: MothershipStreamV1ToolOutcome.success,
        }),
      })
    )
  })

  it('keeps two concurrent subagent lanes separate for text and thinking', async () => {
    const send = (parent: string, channel: MothershipStreamV1TextChannel, text: string) =>
      subAgentHandlers.text(
        {
          type: MothershipStreamV1EventType.text,
          scope: {
            lane: 'subagent',
            parentToolCallId: parent,
            spanId: `span-${parent}`,
            agentId: 'research',
          },
          payload: { channel, text },
        } satisfies StreamEvent,
        context,
        execContext,
        { interactive: false, timeout: 1000 }
      )

    // Interleaved thinking across two concurrent lanes.
    await send('A', MothershipStreamV1TextChannel.thinking, 'A-think-1 ')
    await send('B', MothershipStreamV1TextChannel.thinking, 'B-think-1 ')
    await send('A', MothershipStreamV1TextChannel.thinking, 'A-think-2')

    // Each lane accumulates its own thinking block — no cross-contamination.
    expect(context.subagentThinkingBlocks.get('A')?.content).toBe('A-think-1 A-think-2')
    expect(context.subagentThinkingBlocks.get('B')?.content).toBe('B-think-1 ')

    // Interleaved assistant text across the two lanes.
    await send('A', MothershipStreamV1TextChannel.assistant, 'A-text')
    await send('B', MothershipStreamV1TextChannel.assistant, 'B-text')

    expect(context.subAgentContent.A).toBe('A-text')
    expect(context.subAgentContent.B).toBe('B-text')

    // Assistant text flushed each lane's thinking into contentBlocks, attributed
    // to the correct parent (not whichever subagent streamed most recently).
    const thinking = context.contentBlocks.filter((b) => b.type === 'subagent_thinking')
    expect(thinking.find((b) => b.parentToolCallId === 'A')?.content).toBe('A-think-1 A-think-2')
    expect(thinking.find((b) => b.parentToolCallId === 'B')?.content).toBe('B-think-1 ')
  })

  it('drops a subagent text event that is missing its parent tool call id', async () => {
    const before = context.contentBlocks.length
    await subAgentHandlers.text(
      {
        type: MothershipStreamV1EventType.text,
        scope: { lane: 'subagent', agentId: 'research' },
        payload: { channel: MothershipStreamV1TextChannel.assistant, text: 'orphan' },
      } satisfies StreamEvent,
      context,
      execContext,
      { interactive: false, timeout: 1000 }
    )

    // No lane to attribute to — nothing is added rather than mis-attributed.
    expect(context.contentBlocks.length).toBe(before)
    expect(Object.keys(context.subAgentContent)).not.toContain('undefined')
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
    await sleep(0)
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
    await sleep(10)

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
    await sleep(0)

    const firstPromise = context.pendingToolPromises.get('tool-inflight')
    expect(firstPromise).toBeDefined()

    await sseHandlers.tool(event as StreamEvent, context, execContext, { interactive: false })

    expect(executeTool).toHaveBeenCalledTimes(1)
    expect(context.pendingToolPromises.get('tool-inflight')).toBe(firstPromise)

    resolveTool?.({ success: true, output: { ok: true } })
    await sleep(0)

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

    await sleep(0)

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
    await sleep(0)

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

    await sleep(0)

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

    await sleep(0)

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
