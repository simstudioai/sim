/**
 * @vitest-environment node
 */

import { sleep } from '@sim/utils/helpers'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AsyncToolCallOwnershipError } from '@/lib/copilot/async-runs/errors'
import { TraceCollector } from '@/lib/copilot/request/trace'

const { isSimExecuted, executeTool, ensureHandlersRegistered, toolRequiresApproval } = vi.hoisted(
  () => ({
    isSimExecuted: vi.fn().mockReturnValue(true),
    executeTool: vi.fn().mockResolvedValue({ success: true, output: { ok: true } }),
    ensureHandlersRegistered: vi.fn(),
    toolRequiresApproval: vi.fn().mockReturnValue(false),
  })
)

const {
  upsertAsyncToolCall,
  markAsyncToolRunning,
  completeAsyncToolCall,
  claimWorkflowToolExecution,
} = vi.hoisted(() => ({
  upsertAsyncToolCall: vi.fn(),
  markAsyncToolRunning: vi.fn(),
  completeAsyncToolCall: vi.fn(),
  claimWorkflowToolExecution: vi.fn().mockResolvedValue(null),
}))

const { waitForClientToolCompletion, waitForToolCompletion, waitForWorkflowToolCompletion } =
  vi.hoisted(() => ({
    waitForClientToolCompletion: vi.fn(),
    waitForToolCompletion: vi.fn(),
    waitForWorkflowToolCompletion: vi.fn(),
  }))

const { sealClientToolContext } = vi.hoisted(() => ({
  sealClientToolContext: vi.fn(),
}))

vi.mock('@/lib/copilot/tool-executor', () => ({
  isSimExecuted,
  executeTool,
  ensureHandlersRegistered,
  getToolEntry: vi.fn().mockReturnValue(undefined),
  toolRequiresApproval,
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
  completeAsyncToolCall,
  claimWorkflowToolExecution,
}))

/** Table side effects are not exercised here, and the real module loads the table application layer. */
vi.mock('@/lib/copilot/request/tools/tables', () => ({
  maybeWriteOutputToTable: vi.fn(async (_toolName, _params, result) => result),
  maybeWriteReadCsvToTable: vi.fn(async (_toolName, _params, result) => result),
}))

vi.mock('@/lib/copilot/request/tools/client', () => ({
  waitForClientToolCompletion,
  waitForToolCompletion,
  waitForWorkflowToolCompletion,
}))

vi.mock('@/lib/copilot/request/tools/client-completion-seal.server', () => ({
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
} from '@/lib/copilot/generated/mothership-stream-v1'
import { Read as ReadTool, RunFunction } from '@/lib/copilot/generated/tool-catalog-v1'
import {
  prePersistClientExecutableToolCall,
  sseHandlers,
  subAgentHandlers,
} from '@/lib/copilot/request/handlers'
import type { ExecutionContext, StreamEvent, StreamingContext } from '@/lib/copilot/request/types'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

describe('sse-handlers tool lifecycle', () => {
  let context: StreamingContext
  let execContext: ExecutionContext

  beforeEach(() => {
    vi.clearAllMocks()
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

  it('leaves an explicit workflow target untouched', async () => {
    isSimExecuted.mockReturnValue(false)
    context.runId = 'run-1'
    const event = {
      type: MothershipStreamV1EventType.tool,
      payload: {
        toolCallId: 'run-workflow-2',
        toolName: 'run_workflow',
        arguments: { workflowId: 'workflow-explicit' },
        executor: MothershipStreamV1ToolExecutor.client,
        mode: MothershipStreamV1ToolMode.async,
        phase: MothershipStreamV1ToolPhase.call,
      },
    } satisfies StreamEvent

    await prePersistClientExecutableToolCall(event, context, {}, execContext)

    expect(upsertAsyncToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ args: { workflowId: 'workflow-explicit' } })
    )
  })

  it('pre-persists browser tools as pending for the desktop authorization claim', async () => {
    isSimExecuted.mockReturnValue(false)
    context.runId = 'run-1'

    await prePersistClientExecutableToolCall(
      {
        type: MothershipStreamV1EventType.tool,
        payload: {
          toolCallId: 'browser-tool-1',
          toolName: 'browser_list_tabs',
          arguments: {},
          executor: MothershipStreamV1ToolExecutor.client,
          mode: MothershipStreamV1ToolMode.async,
          phase: MothershipStreamV1ToolPhase.call,
        },
      } satisfies StreamEvent,
      context,
      {},
      execContext
    )

    expect(upsertAsyncToolCall).toHaveBeenCalledWith({
      runId: 'run-1',
      toolCallId: 'browser-tool-1',
      toolName: 'browser_list_tabs',
      args: {},
      sealedContext: { __sealedClientToolContextV1: 'sealed-context' },
      status: MothershipStreamV1AsyncToolRecordStatus.pending,
    })
    expect(sealClientToolContext).toHaveBeenCalledWith({
      toolCallId: 'browser-tool-1',
      runId: 'run-1',
      userId: 'user-1',
      registry: execContext.resolvedSecretTraceRegistry,
      toolInput: {},
    })
  })

  it('persists a gated sim tool and stamps the frame so a reload can still answer it', async () => {
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

    const event = {
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
    expect(updated?.agentId).toBe('main')
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

  it('bounds a retired browser takeover that can no longer execute in the client', async () => {
    isSimExecuted.mockReturnValue(false)
    waitForClientToolCompletion.mockResolvedValueOnce({
      status: 'success',
      message: 'Browser hand-back completed',
      data: { completed: true },
    })

    await sseHandlers.tool(
      {
        type: MothershipStreamV1EventType.tool,
        payload: {
          toolCallId: 'tool-browser-takeover',
          toolName: 'browser_request_takeover',
          arguments: { reason: 'Please sign in' },
          executor: MothershipStreamV1ToolExecutor.client,
          mode: MothershipStreamV1ToolMode.async,
          phase: MothershipStreamV1ToolPhase.call,
        },
      } satisfies StreamEvent,
      context,
      execContext,
      { interactive: true, timeout: 1000 }
    )

    await Promise.allSettled(context.pendingToolPromises.values())

    expect(waitForClientToolCompletion).toHaveBeenCalledWith({
      toolCallId: 'tool-browser-takeover',
      runId: context.runId,
      userId: 'user-1',
      timeoutMs: 1000,
      abortSignal: undefined,
      registry: execContext.resolvedSecretTraceRegistry,
    })
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
    expect(context.toolCalls.get('sub-tool-scope-1')?.agentId).toBe('deploy')
  })

  it('retains the first agent attribution on replayed partial tool calls', async () => {
    context.toolCalls.set('replayed-read', {
      id: 'replayed-read',
      name: 'read',
      status: 'executing',
    })

    const replayPartial = (agentId: string) =>
      subAgentHandlers.tool(
        {
          type: MothershipStreamV1EventType.tool,
          scope: { lane: 'subagent', parentToolCallId: 'parent-1', agentId },
          payload: {
            toolCallId: 'replayed-read',
            toolName: 'read',
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

    await replayPartial('workflow')
    await replayPartial('deploy')

    expect(context.toolCalls.get('replayed-read')?.agentId).toBe('workflow')
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
