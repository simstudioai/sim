import { flushMacrotask } from '@sim/testing/helpers/async'
import { createDeferred } from '@sim/testing/helpers/deferred'
import {
  mothershipAsyncRunsMock,
  mothershipAsyncRunsMockFns,
} from '@sim/testing/mocks/mothership-async-runs.mock'
import {
  mothershipClientToolWaiterMock,
  mothershipClientToolWaiterMockFns,
} from '@sim/testing/mocks/mothership-client-tool-waiter.mock'
import { sleep } from '@sim/utils/helpers'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AsyncToolCallOwnershipError } from '@/lib/mothership/async-runs/errors'
import { restoreStreamingContext } from '@/lib/mothership/request/context/restore'
import { TraceCollector } from '@/lib/mothership/request/trace'

const { isSimExecuted, executeTool, ensureHandlersRegistered, toolRequiresApproval } = vi.hoisted(
  () => ({
    isSimExecuted: vi.fn().mockReturnValue(true),
    executeTool: vi.fn().mockResolvedValue({ success: true, output: { ok: true } }),
    ensureHandlersRegistered: vi.fn(),
    toolRequiresApproval: vi.fn().mockReturnValue(false),
  })
)

const {
  mockWaitForClientToolCompletion: waitForClientToolCompletion,
  mockWaitForToolCompletion: waitForToolCompletion,
  mockWaitForWorkflowToolCompletion: waitForWorkflowToolCompletion,
} = mothershipClientToolWaiterMockFns

const { sealClientToolContext } = vi.hoisted(() => ({
  sealClientToolContext: vi.fn(),
}))

vi.mock('@/lib/mothership/tool-executor', () => ({
  isSimExecuted,
  executeTool,
  ensureHandlersRegistered,
  getToolEntry: vi.fn().mockReturnValue(undefined),
  toolRequiresApproval,
}))

vi.mock('@/lib/mothership/async-runs/repository', () => mothershipAsyncRunsMock)

/** Table side effects are not exercised here, and the real module loads the table application layer. */
vi.mock('@/lib/mothership/request/tools/tables', () => ({
  maybeWriteOutputToTable: vi.fn(async (_toolName, _params, result) => result),
  maybeWriteReadCsvToTable: vi.fn(async (_toolName, _params, result) => result),
}))

vi.mock('@/lib/mothership/request/tools/client', () => mothershipClientToolWaiterMock)

vi.mock('@/lib/mothership/request/tools/client-completion-seal.server', () => ({
  sealClientToolContext,
}))

import {
  MothershipStreamV1AsyncToolRecordStatus,
  MothershipStreamV1CompletionStatus,
  MothershipStreamV1EventType,
  MothershipStreamV1ResourceOp,
  MothershipStreamV1RunKind,
  MothershipStreamV1TextChannel,
  MothershipStreamV1ToolExecutor,
  MothershipStreamV1ToolMode,
  MothershipStreamV1ToolOutcome,
  MothershipStreamV1ToolPhase,
} from '@/lib/mothership/generated/mothership-stream-v1'
import { TOOL_DEADLINE_SETTLE_MARGIN_MS } from '@/lib/mothership/generated/protocol'
import { Read as ReadTool, RunFunction } from '@/lib/mothership/generated/tool-catalog-v1'
import {
  applyStreamEvent,
  prePersistClientExecutableToolCall,
  sseHandlers,
  subAgentHandlers,
} from '@/lib/mothership/request/handlers'
import { createEvent } from '@/lib/mothership/request/session/event'
import { shouldSkipToolCallEvent } from '@/lib/mothership/request/sse-utils'
import {
  TOOL_DEADLINE_BEFORE_START_MESSAGE,
  TOOL_DEADLINE_EXCEEDED_MESSAGE,
} from '@/lib/mothership/request/tools/deadline'
import type {
  ExecutionContext,
  StreamEvent,
  StreamingContext,
} from '@/lib/mothership/request/types'
import {
  createTurnModel,
  reduceEvent,
} from '@/app/workspace/[workspaceId]/home/hooks/stream/turn-model'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const {
  mockUpsertAsyncToolCall: upsertAsyncToolCall,
  mockMarkAsyncToolRunning: markAsyncToolRunning,
  mockCompleteAsyncToolCall: completeAsyncToolCall,
  mockClaimWorkflowToolExecution: claimWorkflowToolExecution,
} = mothershipAsyncRunsMockFns
claimWorkflowToolExecution.mockResolvedValue(null)

describe('sse-handlers tool lifecycle', () => {
  let context: StreamingContext
  let execContext: ExecutionContext

  beforeEach(() => {
    isSimExecuted.mockReturnValue(true)
    upsertAsyncToolCall.mockResolvedValue(null)
    markAsyncToolRunning.mockResolvedValue(null)
    completeAsyncToolCall.mockResolvedValue(null)
    waitForToolCompletion.mockResolvedValue(null)
    waitForClientToolCompletion.mockResolvedValue(null)
    waitForWorkflowToolCompletion.mockResolvedValue(null)
    sealClientToolContext.mockResolvedValue({
      __sealedClientToolContextV1: 'sealed-context',
    })
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
      activeFileIntents: new Map(),
      filePreviewBudget: { contentBytes: 0 },
      seenToolCalls: new Set(),
      seenToolResults: new Set(),
      currentThinkingBlock: null,
      subagentThinkingBlocks: new Map(),
      isInThinkingBlock: false,
      subAgentContent: {},
      subAgentToolCalls: {},
      pendingContent: '',
      streamComplete: false,
      wasAborted: false,
      errors: [],
      toolPermissions: {
        enabled: false,
        autoAllowed: new Set(),
        autoAllowPermitted: true,
      },
    }
    execContext = {
      userId: 'user-1',
      workflowId: 'workflow-1',
      resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry([]),
    }
  })

  it('propagates an ownership conflict before a client call can be forwarded', async () => {
    isSimExecuted.mockReturnValue(false)
    context.runId = 'current-run'
    upsertAsyncToolCall.mockRejectedValueOnce(new AsyncToolCallOwnershipError())
    const event: StreamEvent = {
      type: 'tool',
      payload: {
        toolCallId: 'colliding-call',
        toolName: 'run_workflow',
        arguments: {},
        executor: 'client',
        mode: 'async',
        phase: 'call',
      },
    }
    await expect(
      prePersistClientExecutableToolCall(event, context, {}, execContext)
    ).rejects.toBeInstanceOf(AsyncToolCallOwnershipError)
  })

  it('replays completed child lanes once without reopening traces or losing errors', async () => {
    const start = vi.spyOn(context.trace, 'startSpan')
    const end = vi.spyOn(context.trace, 'endSpan')
    const emit = (lane: string, event: 'start' | 'end', data?: Record<string, unknown>) => {
      const scope = {
        lane: 'subagent' as const,
        agentId: 'task',
        parentToolCallId: lane,
        spanId: lane,
      }
      const frame: StreamEvent =
        event === 'start'
          ? {
              type: 'span',
              scope,
              payload: { kind: 'subagent', agent: 'task', event: 'start', data },
            }
          : {
              type: 'span',
              scope,
              payload: { kind: 'subagent', agent: 'task', event: 'end', data },
            }
      return sseHandlers.span(frame, context, execContext, { interactive: false })
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      await emit('A', 'start', { name: 'Inspect workflow' })
      await emit('B', 'start', { name: 'Check constraints' })
      await emit('B', 'end', { pending: true })
      if (attempt === 0)
        expect(
          context.contentBlocks.find((block) => block.parentToolCallId === 'B')?.endedAt
        ).toBeUndefined()
      await emit('B', 'end', { error: 'Check failed' })
      await emit('A', 'end')
    }
    expect(context.contentBlocks).toHaveLength(2)
    expect(context.contentBlocks.find((block) => block.parentToolCallId === 'B')).toMatchObject({
      subagentName: 'Check constraints',
      error: 'Check failed',
      endedAt: expect.any(Number),
    })
    expect(context.contentBlocks.find((block) => block.parentToolCallId === 'A')).toMatchObject({
      subagentName: 'Inspect workflow',
      endedAt: expect.any(Number),
    })
    expect(start).toHaveBeenCalledTimes(2)
    expect(end).toHaveBeenCalledTimes(2)
    expect(context.subAgentTraceSpans?.size).toBe(0)
  })

  it('counts the preview content already in the replay toward the restored turn budget', async () => {
    const preview = (content: string): StreamEvent => ({
      type: 'tool',
      payload: {
        toolCallId: 'file-edit',
        toolName: 'prepare_file_edit',
        previewPhase: 'file_preview_content',
        content,
        contentMode: 'delta',
        previewVersion: 1,
        fileName: 'notes.md',
      },
    })

    await restoreStreamingContext(
      [preview('é'.repeat(1_000)), preview('x'.repeat(500))],
      context,
      execContext
    )

    expect(context.filePreviewBudget.contentBytes).toBe(2_500)
  })

  it('restores a delivered prefix without executing its tools or consuming the next handoff', async () => {
    const call: StreamEvent = {
      type: 'tool',
      scope: { lane: 'subagent', parentToolCallId: 'child', agentId: 'task' },
      payload: {
        phase: 'call',
        toolCallId: 'pending-read',
        toolName: ReadTool.id,
        arguments: { path: '/workspace/report.txt' },
        executor: 'sim',
        mode: 'async',
      },
    }
    const receipt = { emitterId: 'original-worker', sequence: 8 }
    await restoreStreamingContext(
      [
        { type: 'text', payload: { channel: 'assistant', text: 'Saved prefix.', textOffset: 0 } },
        {
          type: 'span',
          scope: { lane: 'subagent', parentToolCallId: 'child', agentId: 'task', spanId: 'child' },
          payload: {
            kind: 'subagent',
            agent: 'task',
            event: 'start',
            data: { name: 'Read report' },
          },
        },
        call,
        {
          type: 'run',
          payload: {
            kind: 'checkpoint_pause',
            checkpointId: 'checkpoint',
            executionId: 'execution',
            runId: 'run',
            pendingToolCallIds: ['pending-read'],
            activityReceipt: receipt,
          },
        },
      ],
      context,
      execContext
    )

    expect(context.accumulatedContent).toBe('Saved prefix.')
    expect(context.receivedActivity).toEqual(receipt)
    expect(context.streamComplete).toBe(false)
    expect(context.awaitingAsyncContinuation).toBeUndefined()
    expect(context.toolCalls.get('pending-read')?.status).toBe('pending')
    expect(context.subAgentToolCalls.child.map((tool) => tool.id)).toEqual(['pending-read'])
    expect(context.pendingToolPromises.size).toBe(0)
    expect(upsertAsyncToolCall).not.toHaveBeenCalled()
    expect(executeTool).not.toHaveBeenCalled()
    expect(shouldSkipToolCallEvent(context, call)).toBe(false)
    await applyStreamEvent(call, context, execContext, { interactive: false, timeout: 1000 })
    await sleep(0)
    expect(executeTool).toHaveBeenCalledTimes(1)
    expect(shouldSkipToolCallEvent(context, call)).toBe(true)
  })

  it('pins the workflow target into the args it persists and forwards', async () => {
    // The browser resolved its own target from the open tab while the server
    // resolved the run's workflow; in a workspace chat those disagreed and every
    // omitted-argument call was rejected. One stamped field ends that.
    isSimExecuted.mockReturnValue(false)
    context.runId = 'run-1'
    const event = {
      type: MothershipStreamV1EventType.tool,
      payload: {
        toolCallId: 'run-workflow-1',
        toolName: 'run_workflow',
        arguments: {},
        executor: MothershipStreamV1ToolExecutor.client,
        mode: MothershipStreamV1ToolMode.async,
        phase: MothershipStreamV1ToolPhase.call,
      },
    } satisfies StreamEvent

    await prePersistClientExecutableToolCall(event, context, {}, execContext)

    // Forwarded frame — this is what the browser POSTs back with.
    expect((event.payload as { arguments?: Record<string, unknown> }).arguments).toEqual({
      workflowId: 'workflow-1',
    })
    expect(upsertAsyncToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ toolCallId: 'run-workflow-1', args: { workflowId: 'workflow-1' } })
    )
  })

  describe.each(['browser_list_tabs', 'terminal', 'import_local_files', 'computer'])(
    'native %s pre-persistence',
    (toolName) => {
      it.each([false, true])(
        'keeps the call pending for the desktop claim when approval gating is %s',
        async (gated) => {
          isSimExecuted.mockReturnValue(false)
          toolRequiresApproval.mockReturnValue(gated)
          context.runId = 'run-1'
          context.toolPermissions.enabled = gated
          const args =
            toolName === 'computer'
              ? { action: 'status' }
              : toolName === 'terminal'
                ? { operation: 'run', command: 'pwd' }
                : {}
          const event = {
            type: MothershipStreamV1EventType.tool,
            payload: {
              toolCallId: 'native-tool-1',
              toolName,
              arguments: args,
              executor: MothershipStreamV1ToolExecutor.client,
              mode: MothershipStreamV1ToolMode.async,
              phase: MothershipStreamV1ToolPhase.call,
            },
          } satisfies StreamEvent

          await prePersistClientExecutableToolCall(event, context, {}, execContext)

          expect(upsertAsyncToolCall).toHaveBeenCalledExactlyOnceWith({
            runId: 'run-1',
            toolCallId: 'native-tool-1',
            toolName,
            args,
            sealedContext: { __sealedClientToolContextV1: 'sealed-context' },
            status: MothershipStreamV1AsyncToolRecordStatus.pending,
            permissionRequested: gated,
          })
          expect(sealClientToolContext).toHaveBeenCalledWith({
            toolCallId: 'native-tool-1',
            runId: 'run-1',
            userId: 'user-1',
            registry: execContext.resolvedSecretTraceRegistry,
            toolInput: args,
          })
          expect(event.payload).toEqual({
            toolCallId: 'native-tool-1',
            toolName,
            arguments: args,
            executor: MothershipStreamV1ToolExecutor.client,
            mode: MothershipStreamV1ToolMode.async,
            phase: MothershipStreamV1ToolPhase.call,
            ...(gated ? { status: 'awaiting_approval' } : {}),
          })
        }
      )
    }
  )

  it('persists a gated sim tool and stamps the frame so a reload can still answer it', async () => {
    toolRequiresApproval.mockReturnValue(true)
    context.runId = 'run-1'
    context.toolPermissions = {
      enabled: true,
      autoAllowed: new Set(),
      autoAllowPermitted: true,
    }

    const event: StreamEvent = {
      type: MothershipStreamV1EventType.tool,
      payload: {
        toolCallId: 'deploy-1',
        toolName: 'deploy_as_api',
        arguments: { versionName: 'v2' },
        executor: MothershipStreamV1ToolExecutor.sim,
        mode: MothershipStreamV1ToolMode.async,
        phase: MothershipStreamV1ToolPhase.call,
      },
    } satisfies StreamEvent

    await prePersistClientExecutableToolCall(event, context, {})

    // A sim-routed tool normally gets no durable row at all; a gated one must,
    // because the decision is posted against it after a reload.
    expect(upsertAsyncToolCall).toHaveBeenCalledWith({
      runId: 'run-1',
      toolCallId: 'deploy-1',
      toolName: 'deploy_as_api',
      args: { versionName: 'v2' },
      status: MothershipStreamV1AsyncToolRecordStatus.pending,
      permissionRequested: true,
    })
    expect(event.payload.status).toBe('awaiting_approval')
  })

  it('clears a Go-stamped approval frame when the gate is off', async () => {
    // Go stamps integration calls regardless of Sim's feature flag. Forwarding
    // that stamp with nothing gating behind it would draw a card whose buttons
    // answer into a disabled endpoint.
    toolRequiresApproval.mockReturnValue(false)
    context.runId = 'run-1'
    context.toolPermissions = {
      enabled: false,
      autoAllowed: new Set(),
      autoAllowPermitted: true,
    }

    const event = {
      type: MothershipStreamV1EventType.tool,
      payload: {
        toolCallId: 'gmail-1',
        toolName: 'gmail_read_v2',
        arguments: {},
        executor: MothershipStreamV1ToolExecutor.sim,
        mode: MothershipStreamV1ToolMode.async,
        phase: MothershipStreamV1ToolPhase.call,
        status: 'awaiting_approval',
      },
    } as unknown as StreamEvent

    await prePersistClientExecutableToolCall(event, context, {})

    expect((event.payload as { status?: string }).status).toBeUndefined()
    expect(upsertAsyncToolCall).not.toHaveBeenCalled()
  })

  it('clears a Go-stamped approval frame on a partial call, which is never held', async () => {
    toolRequiresApproval.mockReturnValue(true)
    context.runId = 'run-1'
    context.toolPermissions = {
      enabled: true,
      autoAllowed: new Set(),
      autoAllowPermitted: true,
    }

    const event = {
      type: MothershipStreamV1EventType.tool,
      payload: {
        toolCallId: 'gmail-3',
        toolName: 'gmail_read_v2',
        arguments: {},
        executor: MothershipStreamV1ToolExecutor.sim,
        mode: MothershipStreamV1ToolMode.async,
        phase: MothershipStreamV1ToolPhase.call,
        status: 'awaiting_approval',
        partial: true,
      },
    } as unknown as StreamEvent

    await prePersistClientExecutableToolCall(event, context, {})

    expect((event.payload as { status?: string }).status).toBeUndefined()
  })

  it.each([
    ['a live', {}],
    ['a replayed', { replay: true }],
    ['a partial', { partial: true }],
  ])(
    'renders %s stamped call as an ordinary row when approvals are off',
    async (_label, variant) => {
      toolRequiresApproval.mockReturnValue(false)
      context.runId = 'run-1'
      context.toolPermissions = {
        enabled: false,
        autoAllowed: new Set(),
        autoAllowPermitted: true,
      }
      const event = {
        type: MothershipStreamV1EventType.tool,
        payload: {
          toolCallId: 'gmail-4',
          toolName: 'gmail_read_v2',
          arguments: {},
          executor: MothershipStreamV1ToolExecutor.sim,
          mode: MothershipStreamV1ToolMode.async,
          phase: MothershipStreamV1ToolPhase.call,
          status: 'awaiting_approval',
          ...variant,
        },
      } as unknown as StreamEvent

      await prePersistClientExecutableToolCall(event, context, {})
      const model = reduceEvent(
        createTurnModel(),
        createEvent({
          streamId: 'stream-1',
          cursor: '1',
          seq: 1,
          requestId: 'request-1',
          type: event.type,
          payload: event.payload,
        } as Parameters<typeof createEvent>[0])
      )

      expect(model.nodes.get('gmail-4')?.status).toBe('running')
    }
  )

  it('clears a Go-stamped approval frame on an internal tool', async () => {
    toolRequiresApproval.mockReturnValue(true)
    context.runId = 'run-1'
    context.toolPermissions = {
      enabled: true,
      autoAllowed: new Set(),
      autoAllowPermitted: true,
    }

    const event = {
      type: MothershipStreamV1EventType.tool,
      payload: {
        toolCallId: 'internal-1',
        toolName: 'deploy',
        arguments: {},
        executor: MothershipStreamV1ToolExecutor.sim,
        mode: MothershipStreamV1ToolMode.async,
        phase: MothershipStreamV1ToolPhase.call,
        status: 'awaiting_approval',
        ui: { internal: true },
      },
    } as unknown as StreamEvent

    await prePersistClientExecutableToolCall(event, context, {})

    // An internal tool draws no row at all, so it can never host a prompt.
    expect((event.payload as { status?: string }).status).toBeUndefined()
    expect(upsertAsyncToolCall).not.toHaveBeenCalled()
  })

  it('leaves an already always-allowed tool ungated', async () => {
    toolRequiresApproval.mockReturnValue(true)
    context.runId = 'run-1'
    context.toolPermissions = {
      enabled: true,
      autoAllowed: new Set(['deploy_as_api']),
      autoAllowPermitted: true,
    }

    const event: StreamEvent = {
      type: MothershipStreamV1EventType.tool,
      payload: {
        toolCallId: 'deploy-2',
        toolName: 'deploy_as_api',
        arguments: {},
        executor: MothershipStreamV1ToolExecutor.sim,
        mode: MothershipStreamV1ToolMode.async,
        phase: MothershipStreamV1ToolPhase.call,
      },
    } satisfies StreamEvent

    await prePersistClientExecutableToolCall(event, context, {})

    expect(event.payload.status).toBeUndefined()
    expect(upsertAsyncToolCall).not.toHaveBeenCalled()
  })

  it('keeps non-browser client tools in the established running state', async () => {
    isSimExecuted.mockReturnValue(false)
    context.runId = 'run-1'

    await prePersistClientExecutableToolCall(
      {
        type: MothershipStreamV1EventType.tool,
        payload: {
          toolCallId: 'client-tool-1',
          toolName: 'run_workflow',
          arguments: { workflowId: 'workflow-1' },
          executor: MothershipStreamV1ToolExecutor.client,
          mode: MothershipStreamV1ToolMode.async,
          phase: MothershipStreamV1ToolPhase.call,
        },
      } satisfies StreamEvent,
      context
    )

    expect(upsertAsyncToolCall).toHaveBeenCalledWith({
      runId: 'run-1',
      toolCallId: 'client-tool-1',
      toolName: 'run_workflow',
      args: { workflowId: 'workflow-1' },
      status: MothershipStreamV1AsyncToolRecordStatus.running,
      permissionRequested: false,
    })
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

  describe('the deadline a frame names', () => {
    /** A call frame naming `deadlineMs`; `client` makes it one a browser or desktop runs. */
    const deadlineFrame = (
      deadlineMs: number,
      call: { toolCallId?: string; toolName?: string; arguments?: Record<string, unknown> } = {},
      client = false
    ): StreamEvent => ({
      type: MothershipStreamV1EventType.tool,
      payload: {
        toolCallId: call.toolCallId ?? 'audio-1',
        toolName: call.toolName ?? 'generate_audio',
        arguments: call.arguments ?? { prompt: 'p' },
        executor: client
          ? MothershipStreamV1ToolExecutor.client
          : MothershipStreamV1ToolExecutor.sim,
        mode: MothershipStreamV1ToolMode.async,
        phase: MothershipStreamV1ToolPhase.call,
        ...(client ? {} : { ui: { simExecutable: true } }),
        deadlineMs,
      },
    })

    it('bounds the call from its receipt, less the settle margin', async () => {
      executeTool.mockResolvedValueOnce({ success: true, output: {} })
      const before = Date.now()
      await sseHandlers.tool(deadlineFrame(900_000), context, execContext, { interactive: false })
      const after = Date.now()
      const deadlineAt = context.toolCalls.get('audio-1')?.deadlineAt ?? 0
      expect(deadlineAt).toBeGreaterThanOrEqual(before + 900_000 - TOOL_DEADLINE_SETTLE_MARGIN_MS)
      expect(deadlineAt).toBeLessThanOrEqual(after + 900_000 - TOOL_DEADLINE_SETTLE_MARGIN_MS)
    })

    it('gives a client call only what remains of the deadline recorded at first hand-off', async () => {
      const recorded = new Date(Date.now() + 60_000)
      mothershipAsyncRunsMockFns.mockGetAsyncToolCall.mockResolvedValueOnce({
        executionDeadlineAt: recorded,
      })
      await sseHandlers.tool(
        deadlineFrame(900_000, { toolName: 'browser_click', arguments: {} }, true),
        context,
        execContext,
        { interactive: true }
      )
      expect(context.toolCalls.get('audio-1')?.deadlineAt).toBe(recorded.getTime())
    })

    it('counts the deadline as spent when the recorded one cannot be read', async () => {
      mothershipAsyncRunsMockFns.mockGetAsyncToolCall.mockRejectedValueOnce(new Error('db down'))
      const before = Date.now()
      await sseHandlers.tool(
        deadlineFrame(
          900_000,
          { toolCallId: 'takeover-1', toolName: 'browser_click', arguments: {} },
          true
        ),
        context,
        execContext,
        { interactive: true }
      )
      expect(context.toolCalls.get('takeover-1')?.deadlineAt).toBeLessThan(before + 60_000)
    })

    /** Runs a desktop-local read whose frame names `deadlineMs`, recording the emitted events. */
    async function runLocalRead(deadlineMs: number) {
      const onEvent = vi.fn()
      await sseHandlers.tool(
        deadlineFrame(
          deadlineMs,
          {
            toolCallId: 'local-read-1',
            toolName: 'read',
            arguments: { path: 'user-local/Project--mount/README.md' },
          },
          true
        ),
        context,
        execContext,
        { onEvent, interactive: true }
      )
      return onEvent
    }

    /** The call ended with `message`, and the client was sent a result naming it. */
    function expectFailedWith(onEvent: ReturnType<typeof vi.fn>, message: string) {
      expect(context.toolCalls.get('local-read-1')).toMatchObject({
        status: MothershipStreamV1ToolOutcome.error,
        error: message,
      })
      expect(onEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            phase: MothershipStreamV1ToolPhase.result,
            error: message,
          }),
        })
      )
    }

    it('never offers an unclaimed client call whose deadline already passed', async () => {
      mothershipAsyncRunsMockFns.mockCompletePendingAsyncToolCall.mockImplementationOnce(
        async (input) => ({ ...input })
      )
      const onEvent = await runLocalRead(TOOL_DEADLINE_SETTLE_MARGIN_MS)
      await Promise.allSettled(context.pendingToolPromises.values())

      expect(waitForClientToolCompletion).not.toHaveBeenCalled()
      expectFailedWith(onEvent, TOOL_DEADLINE_BEFORE_START_MESSAGE)
    })

    it('does not offer an unclaimed client call with less than a minute of its deadline left', async () => {
      mothershipAsyncRunsMockFns.mockCompletePendingAsyncToolCall.mockImplementationOnce(
        async (input) => ({ ...input })
      )
      const onEvent = await runLocalRead(TOOL_DEADLINE_SETTLE_MARGIN_MS + 30_000)
      await Promise.allSettled(context.pendingToolPromises.values())

      expect(waitForClientToolCompletion).not.toHaveBeenCalled()
      expectFailedWith(onEvent, TOOL_DEADLINE_BEFORE_START_MESSAGE)
    })

    it('settles a client call nothing claimed by its deadline as not run', async () => {
      vi.useFakeTimers()
      try {
        waitForClientToolCompletion.mockImplementationOnce(
          () => new Promise((resolve) => setTimeout(() => resolve(null), 65_000))
        )
        mothershipAsyncRunsMockFns.mockCompletePendingAsyncToolCall.mockImplementationOnce(
          async (input) => ({ ...input })
        )
        const onEvent = await runLocalRead(TOOL_DEADLINE_SETTLE_MARGIN_MS + 65_000)
        await vi.advanceTimersByTimeAsync(65_000)
        await Promise.allSettled(context.pendingToolPromises.values())

        expect(waitForClientToolCompletion).toHaveBeenCalledOnce()
        expectFailedWith(onEvent, TOOL_DEADLINE_BEFORE_START_MESSAGE)
      } finally {
        vi.useRealTimers()
      }
    })

    it('reads a claimed call past its deadline and reports its outcome as unknown', async () => {
      const onEvent = await runLocalRead(TOOL_DEADLINE_SETTLE_MARGIN_MS)
      await Promise.allSettled(context.pendingToolPromises.values())

      expect(waitForClientToolCompletion).toHaveBeenCalledOnce()
      expectFailedWith(onEvent, TOOL_DEADLINE_EXCEEDED_MESSAGE)
    })

    it('counts the deadline as spent when its lookup outlasts it', async () => {
      vi.useFakeTimers()
      try {
        mothershipAsyncRunsMockFns.mockGetAsyncToolCall.mockImplementationOnce(
          () => new Promise(() => {})
        )
        const handled = sseHandlers.tool(
          deadlineFrame(
            TOOL_DEADLINE_SETTLE_MARGIN_MS + 2_000,
            { toolCallId: 'stalled-1', toolName: 'browser_click', arguments: {} },
            true
          ),
          context,
          execContext,
          { interactive: true }
        )
        await vi.advanceTimersByTimeAsync(2_000)
        await handled

        expect(context.toolCalls.get('stalled-1')?.deadlineAt).toBeLessThanOrEqual(Date.now())
      } finally {
        vi.useRealTimers()
      }
    })

    it('fails a client call still unfinished at its deadline', async () => {
      vi.useFakeTimers()
      try {
        // The waiter gives up when its (deadline-capped) timeout ends, five seconds in.
        waitForClientToolCompletion.mockImplementationOnce(
          () => new Promise((resolve) => setTimeout(() => resolve(null), 5_000))
        )
        const onEvent = await runLocalRead(TOOL_DEADLINE_SETTLE_MARGIN_MS + 5_000)
        await vi.advanceTimersByTimeAsync(5_000)
        await Promise.allSettled(context.pendingToolPromises.values())

        expectFailedWith(onEvent, TOOL_DEADLINE_EXCEEDED_MESSAGE)
      } finally {
        vi.useRealTimers()
      }
    })

    it('leaves a call without one on Sim\u2019s own bounds', async () => {
      executeTool.mockResolvedValueOnce({ success: true, output: {} })
      await sseHandlers.tool(deadlineFrame(-1), context, execContext, { interactive: false })
      expect(context.toolCalls.get('audio-1')?.deadlineAt).toBeUndefined()
    })
  })

  it('executes a display-named frame by its execName (the worker CLI class)', async () => {
    // The worker wires sim_cli frames with toolName cli_* (display identity) and
    // execName sim_cli. Dispatching by the display name sent every CLI call into
    // the app registry as "Tool not found" — caught by the bench suite.
    executeTool.mockResolvedValueOnce({ success: true, output: { exitCode: 0, stdout: '[]' } })
    await sseHandlers.tool(
      {
        type: MothershipStreamV1EventType.tool,
        payload: {
          toolCallId: 'cli-1',
          toolName: 'cli_workflows_list',
          execName: 'sim_cli',
          arguments: { args: ['workflows', 'list'] },
          executor: MothershipStreamV1ToolExecutor.sim,
          mode: MothershipStreamV1ToolMode.async,
          phase: MothershipStreamV1ToolPhase.call,
          ui: { simExecutable: true },
        },
      } satisfies StreamEvent,
      context,
      execContext,
      { interactive: false, timeout: 1000 }
    )
    await sleep(0)
    expect(executeTool).toHaveBeenCalledTimes(1)
    expect(executeTool.mock.calls[0][0]).toBe('sim_cli')
    // Rendering and persistence keep the display identity.
    expect(context.toolCalls.get('cli-1')?.name).toBe('cli_workflows_list')
  })

  it.each(['main', 'subagent'] as const)(
    'renders %s CLI replay without execution, then accepts one parked handoff',
    async (lane) => {
      executeTool.mockResolvedValueOnce({ success: true, output: { id: 'created-once' } })
      const handler = lane === 'main' ? sseHandlers.tool : subAgentHandlers.tool
      context.finalAssistantContent = 'Already delivered answer'
      const event: StreamEvent = {
        type: MothershipStreamV1EventType.tool,
        ...(lane === 'subagent'
          ? {
              scope: {
                lane: 'subagent' as const,
                parentToolCallId: 'parent-replay',
                agentId: 'task',
              },
            }
          : {}),
        payload: {
          toolCallId: 'replayed-cli',
          toolName: 'cli_workflows_create',
          execName: 'sim_cli',
          arguments: {
            args: ['workflows', 'create', '--name', 'Draft'],
            request: {
              invocation: { kind: 'cli', argv: ['workflows', 'create', '--name', 'Draft'] },
            },
          },
          executor: MothershipStreamV1ToolExecutor.go,
          mode: MothershipStreamV1ToolMode.sync,
          phase: MothershipStreamV1ToolPhase.call,
          status: 'executing',
          replay: true,
        },
      }
      expect(shouldSkipToolCallEvent(context, event)).toBe(false)
      await prePersistClientExecutableToolCall(event, context, { interactive: false }, execContext)
      await handler(event, context, execContext, { interactive: false, timeout: 1000 })
      expect(context.finalAssistantContent).toBe('Already delivered answer')
      expect(upsertAsyncToolCall).not.toHaveBeenCalled()
      expect(executeTool).not.toHaveBeenCalled()
      expect(context.pendingToolPromises.size).toBe(0)
      expect(context.toolCalls.get('replayed-cli')?.status).toBe('pending')

      const handoff: StreamEvent = {
        ...event,
        payload: {
          ...event.payload,
          replay: undefined,
          executor: MothershipStreamV1ToolExecutor.sim,
          mode: MothershipStreamV1ToolMode.async,
          ui: { simExecutable: true },
        },
      }
      expect(shouldSkipToolCallEvent(context, handoff)).toBe(false)
      await handler(handoff, context, execContext, { interactive: false, timeout: 1000 })
      await sleep(0)
      expect(shouldSkipToolCallEvent(context, handoff)).toBe(true)
      expect(executeTool).toHaveBeenCalledTimes(1)
      expect(executeTool.mock.calls[0][0]).toBe('sim_cli')
      expect(context.toolCalls.get('replayed-cli')?.name).toBe('cli_workflows_create')
    }
  )

  it('registers but never dispatches an inband-owned sim tool call', async () => {
    // Go executes inband-owned calls itself via /api/copilot/tools/execute;
    // dispatching here too ran the tool twice, racing on mutations.
    await sseHandlers.tool(
      {
        type: MothershipStreamV1EventType.tool,
        payload: {
          toolCallId: 'tool-inband',
          toolName: ReadTool.id,
          arguments: { path: 'files/a.md' },
          executor: MothershipStreamV1ToolExecutor.sim,
          mode: MothershipStreamV1ToolMode.async,
          phase: MothershipStreamV1ToolPhase.call,
          ui: { inbandOwned: true },
        },
      } satisfies StreamEvent,
      context,
      execContext,
      { interactive: true }
    )
    await sleep(0)

    expect(context.toolCalls.get('tool-inband')).toBeDefined()
    expect(executeTool).not.toHaveBeenCalled()
    expect(context.pendingToolPromises.has('tool-inband')).toBe(false)
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

  it('projects resolved Function output while leaving resource metadata unchanged', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      {
        name: 'SECRET',
        plaintext: 'secret-value',
        encryptedValue: 'encrypted-secret-value',
      },
    ])
    registry.recordResolved('SECRET', 'secret-value')
    execContext.resolvedSecretTraceRegistry = registry
    execContext.chatId = 'chat-1'
    executeTool.mockImplementationOnce(async (_name, _params, toolContext) => {
      toolContext.resolvedSecretTraceRegistry?.recordResolved('SECRET', 'secret-value', {
        propagated: true,
      })
      return {
        success: true,
        output: {
          result: 'secret-value',
          stdout: 'prefix secret-value',
        },
        resources: [{ type: 'file', id: 'file-1', title: 'secret-value.txt' }],
      }
    })
    const onEvent = vi.fn()

    await sseHandlers.tool(
      {
        type: MothershipStreamV1EventType.tool,
        payload: {
          toolCallId: 'tool-function',
          toolName: RunFunction.id,
          arguments: { code: 'return {{SECRET}}' },
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

    const safeOutput = {
      result: '{{SECRET}}',
      stdout: 'prefix {{SECRET}}',
    }
    expect(completeAsyncToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: 'tool-function',
        result: safeOutput,
      })
    )
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          toolCallId: 'tool-function',
          output: safeOutput,
        }),
      })
    )
    expect(context.toolCalls.get('tool-function')?.result?.output).toEqual(safeOutput)
    expect(onEvent).toHaveBeenCalledWith({
      type: MothershipStreamV1EventType.resource,
      payload: {
        op: MothershipStreamV1ResourceOp.upsert,
        resource: {
          type: 'file',
          id: 'file-1',
          title: 'secret-value.txt',
        },
      },
    })
    expect(JSON.stringify(completeAsyncToolCall.mock.calls)).not.toContain('secret-value')
  })

  it('emits a structural result for a detached background workflow tool', async () => {
    waitForWorkflowToolCompletion.mockResolvedValueOnce({
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

    // The waiter always receives a signal now: the server fallback needs a
    // handle to cancel its own wait if it ends up running the tool itself.
    expect(waitForWorkflowToolCompletion).toHaveBeenCalledWith({
      toolCallId: 'tool-background',
      workflowId: 'workflow-1',
      timeoutMs: 1000,
      abortSignal: expect.any(AbortSignal),
      registry: execContext.resolvedSecretTraceRegistry,
    })
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

  it('settles an explicitly async workflow launch as successful', async () => {
    waitForWorkflowToolCompletion.mockResolvedValueOnce({
      status: 'background',
      data: { workflowId: 'workflow-1', executionId: 'execution-1' },
    })
    const onEvent = vi.fn()

    await sseHandlers.tool(
      {
        type: MothershipStreamV1EventType.tool,
        payload: {
          toolCallId: 'tool-async-workflow',
          toolName: 'run_workflow',
          arguments: { workflowId: 'workflow-1', async: true },
          executor: MothershipStreamV1ToolExecutor.client,
          mode: MothershipStreamV1ToolMode.async,
          phase: MothershipStreamV1ToolPhase.call,
        },
      } satisfies StreamEvent,
      context,
      execContext,
      { onEvent, interactive: true, timeout: 1000 }
    )

    await Promise.allSettled(context.pendingToolPromises.values())

    expect(context.toolCalls.get('tool-async-workflow')?.status).toBe(
      MothershipStreamV1ToolOutcome.success
    )
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MothershipStreamV1EventType.tool,
        payload: expect.objectContaining({
          toolCallId: 'tool-async-workflow',
          phase: MothershipStreamV1ToolPhase.result,
          status: MothershipStreamV1ToolOutcome.success,
          success: true,
        }),
      })
    )
  })

  it('runs a workflow tool server-side when no browser picks it up', async () => {
    // Nobody claims it, the wait expires, and the server wins the claim.
    waitForWorkflowToolCompletion.mockResolvedValue(null)
    claimWorkflowToolExecution.mockResolvedValueOnce({ toolCallId: 'tool-unclaimed' })
    executeTool.mockResolvedValueOnce({ success: true, output: { ran: 'on-server' } })
    const onEvent = vi.fn()

    await sseHandlers.tool(
      {
        type: MothershipStreamV1EventType.tool,
        payload: {
          toolCallId: 'tool-unclaimed',
          toolName: 'run_workflow',
          arguments: { workflowId: 'workflow-1' },
          executor: MothershipStreamV1ToolExecutor.client,
          mode: MothershipStreamV1ToolMode.async,
          phase: MothershipStreamV1ToolPhase.call,
        },
      } satisfies StreamEvent,
      context,
      execContext,
      { onEvent, interactive: true, timeout: 1 }
    )

    await Promise.allSettled(context.pendingToolPromises.values())

    // Regression guard: the wait sets the call to 'executing' before parking,
    // and executeToolAndReport short-circuits anything already 'executing'. If
    // the handoff stops resetting the status, executeTool is never reached and
    // the workflow silently does not run.
    expect(executeTool).toHaveBeenCalled()
    expect(executeTool.mock.calls.at(-1)?.[0]).toBe('run_workflow')
    // The claimed execution id must reach the handler so the run is attributable.
    expect(executeTool.mock.calls.at(-1)?.[2]?.boundWorkflowExecutionId).toBeTruthy()

    const workflowResults = onEvent.mock.calls
      .map(([event]) => event)
      .filter(
        (event) =>
          event?.type === MothershipStreamV1EventType.tool &&
          event.payload?.toolCallId === 'tool-unclaimed' &&
          event.payload?.phase === MothershipStreamV1ToolPhase.result
      )
    // Exactly one result, from the sim path — no client-flavored duplicate on top.
    expect(workflowResults).toHaveLength(1)
    expect(workflowResults[0].payload.executor).toBe(MothershipStreamV1ToolExecutor.sim)
  })

  it('claims and runs the same workflow when the call omits an explicit workflowId', async () => {
    // The waiter resolves the target via resolveWorkflowToolTargetId(args, ctx)
    // while the handler resolves it as params.workflowId || context.workflowId.
    // If those two ever diverge, the fallback would claim one workflow and run
    // another.
    waitForWorkflowToolCompletion.mockResolvedValue(null)
    claimWorkflowToolExecution.mockResolvedValueOnce({ toolCallId: 'tool-implicit-workflow' })
    executeTool.mockResolvedValueOnce({ success: true, output: {} })

    await sseHandlers.tool(
      {
        type: MothershipStreamV1EventType.tool,
        payload: {
          toolCallId: 'tool-implicit-workflow',
          toolName: 'run_workflow',
          arguments: {},
          executor: MothershipStreamV1ToolExecutor.client,
          mode: MothershipStreamV1ToolMode.async,
          phase: MothershipStreamV1ToolPhase.call,
        },
      } satisfies StreamEvent,
      context,
      execContext,
      { onEvent: vi.fn(), interactive: true, timeout: 1 }
    )

    await Promise.allSettled(context.pendingToolPromises.values())

    expect(waitForWorkflowToolCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: 'workflow-1' })
    )
    expect(executeTool.mock.calls.at(-1)?.[2]?.workflowId).toBe('workflow-1')
  })

  it('refuses a workflow tool call with no resolvable workflow target', async () => {
    // A workspace chat has no run-scoped workflow, so an omitted workflowId
    // cannot be resolved by anyone on this side. Dispatching would only buy a
    // rejection the model cannot read, so fail with something it can act on.
    const workspaceExecContext = { ...execContext, workflowId: '' }
    const onEvent = vi.fn()

    await sseHandlers.tool(
      {
        type: MothershipStreamV1EventType.tool,
        payload: {
          toolCallId: 'tool-unbound-workflow',
          toolName: 'run_workflow',
          arguments: {},
          executor: MothershipStreamV1ToolExecutor.client,
          mode: MothershipStreamV1ToolMode.async,
          phase: MothershipStreamV1ToolPhase.call,
        },
      } satisfies StreamEvent,
      context,
      workspaceExecContext,
      { onEvent, interactive: true, timeout: 1000 }
    )

    await Promise.allSettled(context.pendingToolPromises.values())

    // Never handed to a browser, and never claimed server-side.
    expect(waitForWorkflowToolCompletion).not.toHaveBeenCalled()
    expect(claimWorkflowToolExecution).not.toHaveBeenCalled()

    const results = onEvent.mock.calls
      .map(([event]) => event)
      .filter(
        (event) =>
          event?.type === MothershipStreamV1EventType.tool &&
          event.payload?.toolCallId === 'tool-unbound-workflow' &&
          event.payload?.phase === MothershipStreamV1ToolPhase.result
      )
    expect(results).toHaveLength(1)
    expect(results[0].payload.status).toBe(MothershipStreamV1ToolOutcome.error)
    // The message has to name the fix, or the model just retries identically.
    expect(results[0].payload.output?.error).toContain('workflowId')
    expect(context.toolCalls.get('tool-unbound-workflow')?.status).toBe(
      MothershipStreamV1ToolOutcome.error
    )
  })

  it('does not run a workflow tool server-side when a browser holds the claim', async () => {
    waitForWorkflowToolCompletion.mockResolvedValue(null)
    claimWorkflowToolExecution.mockResolvedValueOnce(null)
    executeTool.mockClear()
    const onEvent = vi.fn()

    await sseHandlers.tool(
      {
        type: MothershipStreamV1EventType.tool,
        payload: {
          toolCallId: 'tool-claimed-elsewhere',
          toolName: 'run_workflow',
          arguments: { workflowId: 'workflow-1' },
          executor: MothershipStreamV1ToolExecutor.client,
          mode: MothershipStreamV1ToolMode.async,
          phase: MothershipStreamV1ToolPhase.call,
        },
      } satisfies StreamEvent,
      context,
      execContext,
      { onEvent, interactive: true, timeout: 1 }
    )

    await Promise.allSettled(context.pendingToolPromises.values())

    expect(executeTool).not.toHaveBeenCalled()
  })

  it('waits for the desktop client when a static VFS read is explicitly user-local', async () => {
    waitForClientToolCompletion.mockResolvedValueOnce({
      status: 'success',
      message: 'Read {{SECRET}}',
      data: { content: '{{SECRET}}', totalLines: 1 },
    })
    const onEvent = vi.fn()

    await sseHandlers.tool(
      {
        type: MothershipStreamV1EventType.tool,
        payload: {
          toolCallId: 'tool-user-local-read',
          toolName: 'read',
          arguments: { path: 'user-local/Project--mount/README.md' },
          executor: MothershipStreamV1ToolExecutor.client,
          mode: MothershipStreamV1ToolMode.async,
          phase: MothershipStreamV1ToolPhase.call,
        },
      } satisfies StreamEvent,
      context,
      execContext,
      { onEvent, interactive: true, timeout: 1000 }
    )

    await Promise.allSettled(context.pendingToolPromises.values())

    expect(waitForClientToolCompletion).toHaveBeenCalledWith({
      toolCallId: 'tool-user-local-read',
      runId: context.runId,
      userId: 'user-1',
      timeoutMs: 1000,
      abortSignal: undefined,
      registry: execContext.resolvedSecretTraceRegistry,
    })
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MothershipStreamV1EventType.tool,
        payload: expect.objectContaining({
          phase: MothershipStreamV1ToolPhase.result,
          output: { content: '{{SECRET}}', totalLines: 1 },
        }),
      })
    )
    expect(JSON.stringify(context.toolCalls.get('tool-user-local-read'))).not.toContain(
      'resolved-secret'
    )
    expect(JSON.stringify(onEvent.mock.calls)).not.toContain('resolved-secret')
    expect(executeTool).not.toHaveBeenCalled()
  })

  it('keeps an ordinary static VFS read on the Sim executor', async () => {
    await sseHandlers.tool(
      {
        type: MothershipStreamV1EventType.tool,
        payload: {
          toolCallId: 'tool-workspace-read',
          toolName: 'read',
          arguments: { path: 'WORKSPACE.md' },
          executor: MothershipStreamV1ToolExecutor.client,
          mode: MothershipStreamV1ToolMode.async,
          phase: MothershipStreamV1ToolPhase.call,
        },
      } satisfies StreamEvent,
      context,
      execContext,
      { onEvent: vi.fn(), interactive: true, timeout: 1000 }
    )

    await Promise.allSettled(context.pendingToolPromises.values())

    expect(executeTool).toHaveBeenCalled()
    expect(waitForToolCompletion).not.toHaveBeenCalled()
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

  it('executes finalized main-tool arguments instead of a generating snapshot', async () => {
    executeTool.mockResolvedValueOnce({ success: true, output: { ok: true } })

    await sseHandlers.tool(
      {
        type: MothershipStreamV1EventType.tool,
        payload: {
          toolCallId: 'function-finalized-args',
          toolName: RunFunction.id,
          arguments: { language: 'javascript', code: 'return {{STALE_SECRET}}' },
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

    await sseHandlers.tool(
      {
        type: MothershipStreamV1EventType.tool,
        payload: {
          toolCallId: 'function-finalized-args',
          toolName: RunFunction.id,
          arguments: { language: 'javascript', code: 'return 1' },
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

    expect(executeTool).toHaveBeenCalledWith(
      RunFunction.id,
      { language: 'javascript', code: 'return 1' },
      expect.any(Object)
    )
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
          arguments: { name: 'Stale Workflow' },
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
    expect(context.toolCalls.get('sub-tool-1')?.agentId).toBe('workflow')
    expect(context.subAgentToolCalls['parent-1']?.[0]?.params).toEqual({
      name: 'Example Workflow',
    })
    expect(context.subAgentToolCalls['parent-1']?.[0]?.agentId).toBe('workflow')
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
    execContext.abortSignal = abortController.signal
    const started = createDeferred<void>()
    const result = createDeferred<{ success: boolean; output: { ok: boolean } }>()
    executeTool.mockImplementationOnce(() => {
      started.resolve()
      return result.promise
    })

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
      }
    )

    await started.promise
    const pending = context.pendingToolPromises.get('tool-cancel')
    expect(pending).toBeDefined()
    abortController.abort()
    result.resolve({ success: true, output: { ok: true } })
    await pending

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

    await sseHandlers.tool(
      {
        ...event,
        payload: {
          ...event.payload,
          arguments: { workflowId: 'workflow-2' },
        },
      } as StreamEvent,
      context,
      execContext,
      { interactive: false }
    )

    expect(executeTool).toHaveBeenCalledTimes(1)
    expect(context.pendingToolPromises.get('tool-inflight')).toBe(firstPromise)
    expect(context.toolCalls.get('tool-inflight')?.params).toEqual({ workflowId: 'workflow-1' })

    resolveTool?.({ success: true, output: { ok: true } })
    await sleep(0)

    expect(context.pendingToolPromises.has('tool-inflight')).toBe(false)
  })

  it('leaves a complete terminal state when a tool is cancelled before dispatch', async () => {
    // A tool cancelled because its stream was already aborted used to get a
    // status but no `result`. The subagent join requires one, so that single
    // half-finished tool call was turned into a thrown "missing result" that
    // killed the entire turn and blamed an unrelated tool.
    context.wasAborted = true

    await sseHandlers.tool(
      {
        type: MothershipStreamV1EventType.tool,
        payload: {
          toolCallId: 'tool-stream-dead',
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

    const toolCall = context.toolCalls.get('tool-stream-dead')
    expect(executeTool).not.toHaveBeenCalled()
    expect(toolCall?.status).toBe(MothershipStreamV1ToolOutcome.cancelled)
    // The part that was missing: a terminal tool must also be complete.
    expect(toolCall?.result).toEqual({ success: false })
    expect(toolCall?.error).toBeTruthy()
  })

  it('refuses the tool when its async execution record cannot be persisted', async () => {
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

    expect(executeTool).not.toHaveBeenCalled()
    expect(context.toolCalls.get('tool-upsert-fail')?.status).toBe(
      MothershipStreamV1ToolOutcome.error
    )
    expect(context.toolCalls.get('tool-upsert-fail')?.error).toContain(
      'execution record is unavailable'
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
          activityDescription: 'Reading the latest project updates',
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
    expect(context.toolCalls.get('tool-dynamic-sim')?.activityDescription).toBe(
      'Reading the latest project updates'
    )
  })

  it.each(['awaiting_approval', 'success'] as const)(
    'captures late activity metadata for a %s call without reopening or executing it',
    async (status) => {
      context.toolCalls.set('activity-late', { id: 'activity-late', name: 'read', status })
      const event: StreamEvent = {
        type: MothershipStreamV1EventType.tool,
        payload: {
          phase: MothershipStreamV1ToolPhase.call,
          executor: MothershipStreamV1ToolExecutor.go,
          mode: MothershipStreamV1ToolMode.sync,
          toolCallId: 'activity-late',
          toolName: 'read',
          arguments: { path: 'WORKSPACE.md' },
          activityDescription: 'Checking the project setup',
        },
      }
      await sseHandlers.tool(event, context, execContext, {})
      await sseHandlers.tool(
        { ...event, payload: { ...event.payload, activityDescription: 'Reading something else' } },
        context,
        execContext,
        {}
      )
      expect(context.toolCalls.get('activity-late')).toMatchObject({
        status,
        activityDescription: 'Checking the project setup',
        displayTitle: 'Checking the project setup',
      })
      expect(executeTool).not.toHaveBeenCalled()
    }
  )

  it('rebinds a gateway call to the resolved integration operation and branded activity', async () => {
    isSimExecuted.mockReturnValue(false)
    executeTool.mockResolvedValueOnce({ success: true, output: { emails: [] } })

    await sseHandlers.tool(
      {
        type: MothershipStreamV1EventType.tool,
        payload: {
          toolCallId: 'gateway-gmail',
          toolName: 'call_integration_tool',
          executor: MothershipStreamV1ToolExecutor.go,
          mode: MothershipStreamV1ToolMode.sync,
          phase: MothershipStreamV1ToolPhase.call,
          status: 'generating',
          partial: true,
        },
      } satisfies StreamEvent,
      context,
      execContext,
      { interactive: false, timeout: 1000 }
    )

    expect(context.toolCalls.get('gateway-gmail')).toEqual(
      expect.objectContaining({
        name: 'call_integration_tool',
        displayTitle: 'Calling integration',
      })
    )

    for (const argumentsDelta of [
      '{"toolId":"gmail_read_v2",',
      '"description":"Searching for invoice emails",',
    ]) {
      await sseHandlers.tool(
        {
          type: MothershipStreamV1EventType.tool,
          payload: {
            toolCallId: 'gateway-gmail',
            toolName: 'call_integration_tool',
            argumentsDelta,
            executor: MothershipStreamV1ToolExecutor.go,
            mode: MothershipStreamV1ToolMode.sync,
            phase: MothershipStreamV1ToolPhase.args_delta,
          },
        } satisfies StreamEvent,
        context,
        execContext,
        { interactive: false, timeout: 1000 }
      )
    }

    expect(context.toolCalls.get('gateway-gmail')).toEqual(
      expect.objectContaining({
        name: 'call_integration_tool',
        displayTitle: 'Searching for invoice emails',
        streamingArgs: '{"toolId":"gmail_read_v2","description":"Searching for invoice emails",',
      })
    )

    await sseHandlers.tool(
      {
        type: MothershipStreamV1EventType.tool,
        payload: {
          toolCallId: 'gateway-gmail',
          toolName: 'call_integration_tool',
          arguments: {
            toolId: 'gmail_read_v2',
            description: 'Searching for invoice emails',
            arguments: { maxResults: 10 },
          },
          executor: MothershipStreamV1ToolExecutor.go,
          mode: MothershipStreamV1ToolMode.sync,
          phase: MothershipStreamV1ToolPhase.call,
        },
      } satisfies StreamEvent,
      context,
      execContext,
      { interactive: false, timeout: 1000 }
    )

    expect(context.toolCalls.get('gateway-gmail')).toEqual(
      expect.objectContaining({
        name: 'call_integration_tool',
        displayTitle: 'Searching for invoice emails',
      })
    )

    await sseHandlers.tool(
      {
        type: MothershipStreamV1EventType.tool,
        payload: {
          toolCallId: 'gateway-gmail',
          toolName: 'gmail_read_v2',
          arguments: { maxResults: 10, credentialId: 'cred-gmail' },
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
    expect(executeTool).toHaveBeenCalledWith(
      'gmail_read_v2',
      { maxResults: 10, credentialId: 'cred-gmail' },
      expect.any(Object)
    )
    expect(context.toolCalls.get('gateway-gmail')).toEqual(
      expect.objectContaining({
        name: 'gmail_read_v2',
        displayTitle: 'Searching for invoice emails',
        params: { maxResults: 10, credentialId: 'cred-gmail' },
      })
    )
  })

  it('forwards workspace secret references unchanged to the resolved integration operation', async () => {
    isSimExecuted.mockReturnValue(false)
    executeTool.mockResolvedValueOnce({ success: true, output: { searchResults: [] } })

    await sseHandlers.tool(
      {
        type: MothershipStreamV1EventType.tool,
        payload: {
          toolCallId: 'gateway-serper',
          toolName: 'call_integration_tool',
          executor: MothershipStreamV1ToolExecutor.go,
          mode: MothershipStreamV1ToolMode.sync,
          phase: MothershipStreamV1ToolPhase.call,
          status: 'generating',
          partial: true,
        },
      } satisfies StreamEvent,
      context,
      execContext,
      { interactive: false, timeout: 1000 }
    )

    await sseHandlers.tool(
      {
        type: MothershipStreamV1EventType.tool,
        payload: {
          toolCallId: 'gateway-serper',
          toolName: 'serper_search',
          arguments: {
            query: 'invoice',
            apiKey: '{{SERPER_API_KEY}}',
          },
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

    expect(executeTool).toHaveBeenCalledOnce()
    expect(executeTool).toHaveBeenCalledWith(
      'serper_search',
      { query: 'invoice', apiKey: '{{SERPER_API_KEY}}' },
      expect.any(Object)
    )
  })

  it("executes a resolved MCP operation with its own arguments under the gateway's grouping", async () => {
    isSimExecuted.mockReturnValue(false)
    executeTool.mockResolvedValueOnce({ success: true, output: {} })
    const grouping = { id: 'gauge-read', title: 'Reading Gauge', completedTitle: 'Read Gauge' }

    await sseHandlers.tool(
      {
        type: MothershipStreamV1EventType.tool,
        payload: {
          toolCallId: 'gateway-mcp',
          toolName: 'call_integration_tool',
          arguments: {
            toolId: 'mcp-server-get_overview',
            description: 'Pulling the overview',
            activity: grouping,
            arguments: { category_id: null },
          },
          executor: MothershipStreamV1ToolExecutor.go,
          mode: MothershipStreamV1ToolMode.sync,
          phase: MothershipStreamV1ToolPhase.call,
        },
      } satisfies StreamEvent,
      context,
      execContext,
      { interactive: false, timeout: 1000 }
    )

    await sseHandlers.tool(
      {
        type: MothershipStreamV1EventType.tool,
        payload: {
          toolCallId: 'gateway-mcp',
          toolName: 'mcp-server-get_overview',
          arguments: { category_id: null },
          executor: MothershipStreamV1ToolExecutor.sim,
          mode: MothershipStreamV1ToolMode.async,
          phase: MothershipStreamV1ToolPhase.call,
        },
      } satisfies StreamEvent,
      context,
      execContext,
      { interactive: false, timeout: 1000 }
    )

    await flushMacrotask()

    expect(executeTool).toHaveBeenCalledWith(
      'mcp-server-get_overview',
      { category_id: null },
      expect.any(Object)
    )
    expect(context.toolCalls.get('gateway-mcp')?.activity).toEqual(grouping)
  })

  it.each([
    ['a value', 'Development'],
    ["shaped like the gateway's grouping", { id: 'filing' }],
    ['shaped like a grouping of its own', { id: 'case-42', completedTitle: 'Closed the case' }],
  ])(
    "keeps an integration operation's own activity argument as %s under the gateway's grouping",
    async (_case, ownActivity) => {
      isSimExecuted.mockReturnValue(false)
      executeTool.mockResolvedValueOnce({ success: true, output: {} })
      const grouping = { id: 'filing', title: 'Filing tasks', completedTitle: 'Filed tasks' }

      await sseHandlers.tool(
        {
          type: MothershipStreamV1EventType.tool,
          payload: {
            toolCallId: 'gateway-work-item',
            toolName: 'call_integration_tool',
            arguments: {
              toolId: 'azure_devops_create_work_item',
              description: 'Filing the task',
              activity: grouping,
              arguments: { title: 'Ship it', activity: ownActivity },
            },
            executor: MothershipStreamV1ToolExecutor.go,
            mode: MothershipStreamV1ToolMode.sync,
            phase: MothershipStreamV1ToolPhase.call,
          },
        } satisfies StreamEvent,
        context,
        execContext,
        { interactive: false, timeout: 1000 }
      )

      // A repeated frame for the rebound operation still carries the operation's own arguments.
      for (let frame = 0; frame < 2; frame++) {
        await sseHandlers.tool(
          {
            type: MothershipStreamV1EventType.tool,
            payload: {
              toolCallId: 'gateway-work-item',
              toolName: 'azure_devops_create_work_item',
              arguments: { title: 'Ship it', activity: ownActivity },
              executor: MothershipStreamV1ToolExecutor.sim,
              mode: MothershipStreamV1ToolMode.async,
              phase: MothershipStreamV1ToolPhase.call,
            },
          } satisfies StreamEvent,
          context,
          execContext,
          { interactive: false, timeout: 1000 }
        )
      }

      await flushMacrotask()

      expect(executeTool).toHaveBeenCalledWith(
        'azure_devops_create_work_item',
        { title: 'Ship it', activity: ownActivity },
        expect.any(Object)
      )
      expect(context.toolCalls.get('gateway-work-item')?.activity).toEqual(grouping)
    }
  )

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

  it('records the terminal completion status so a finished turn can outrank an in-band failure', async () => {
    context.errors.push('subagent build failed')

    await sseHandlers.complete(
      {
        type: MothershipStreamV1EventType.complete,
        payload: { status: MothershipStreamV1CompletionStatus.complete },
      } satisfies StreamEvent,
      context,
      execContext,
      { interactive: false, timeout: 1000 }
    )

    expect(context.completionStatus).toBe(MothershipStreamV1CompletionStatus.complete)
    expect(context.streamComplete).toBe(true)
    expect(context.errors).toEqual(['subagent build failed'])
  })

  it('records the worker error copy the live view showed, not its diagnostic message', async () => {
    await sseHandlers.error(
      {
        type: MothershipStreamV1EventType.error,
        payload: {
          code: 'incomplete_generation',
          message: 'provider finish reason: content-filter',
          displayMessage: 'Rephrase your last message or start a new chat.',
        },
      } satisfies StreamEvent,
      context,
      execContext,
      { interactive: false, timeout: 1000 }
    )

    expect(context.errors).toEqual(['Rephrase your last message or start a new chat.'])
    expect(context.streamComplete).toBe(true)
  })
})
