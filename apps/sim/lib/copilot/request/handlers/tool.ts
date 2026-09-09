import { isCurrentBrowserToolName } from '@sim/browser-protocol'
import { createLogger } from '@sim/logger'
import { isTerminalToolName } from '@sim/terminal-protocol'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { AsyncToolCallOwnershipError } from '@/lib/copilot/async-runs/errors'
import type {
  AsyncCompletionSignal,
  AsyncTerminalCompletionSnapshot,
} from '@/lib/copilot/async-runs/lifecycle'
import { upsertAsyncToolCall } from '@/lib/copilot/async-runs/repository'
import { COPILOT_WORKFLOW_TOOL_CLIENT_GRACE_MS, STREAM_TIMEOUT_MS } from '@/lib/copilot/constants'
import {
  MothershipStreamV1AsyncToolRecordStatus,
  type MothershipStreamV1ToolCallDescriptor,
  MothershipStreamV1ToolExecutor,
  MothershipStreamV1ToolOutcome,
  type MothershipStreamV1ToolResultPayload,
} from '@/lib/copilot/generated/mothership-stream-v1'
import { TraceAttr } from '@/lib/copilot/generated/trace-attributes-v1'
import { TraceSpan } from '@/lib/copilot/generated/trace-spans-v1'
import { withCopilotSpan } from '@/lib/copilot/request/otel'
import {
  isToolArgsDeltaStreamEvent,
  isToolCallStreamEvent,
  isToolResultStreamEvent,
  TOOL_CALL_STATUS,
} from '@/lib/copilot/request/session'
import { markToolResultSeen, wasToolResultSeen } from '@/lib/copilot/request/sse-utils'
import { setTerminalToolCallState } from '@/lib/copilot/request/tool-call-state'
import { waitForClientToolCompletion } from '@/lib/copilot/request/tools/client'
import { sealClientToolContext } from '@/lib/copilot/request/tools/client-completion-seal.server'
import { executeToolAndReport } from '@/lib/copilot/request/tools/executor'
import {
  runGatedToolExecution,
  TOOL_AWAITING_APPROVAL_STATUS,
  toolCallNeedsApproval,
} from '@/lib/copilot/request/tools/permission'
import { raceWorkflowToolClientPickup } from '@/lib/copilot/request/tools/workflow-client-fallback'
import type {
  ExecutionContext,
  OrchestratorOptions,
  StreamEvent,
  StreamingContext,
  ToolCallState,
} from '@/lib/copilot/request/types'
import { getToolEntry, isSimExecuted } from '@/lib/copilot/tool-executor'
import { isToolHiddenInUi } from '@/lib/copilot/tools/client/hidden-tools'
import { isUserLocalVfsToolCall } from '@/lib/copilot/tools/local-filesystem'
import { extractStreamingStringArgument } from '@/lib/copilot/tools/streaming-args'
import { getToolDisplayTitle } from '@/lib/copilot/tools/tool-display'
import { isWorkflowToolName, resolveWorkflowToolTargetId } from '@/lib/copilot/tools/workflow-tools'
import { getBlockByToolName } from '@/blocks/registry'
import type { ToolScope } from './types'
import {
  abortPendingToolIfStreamDead,
  addContentBlock,
  emitSyntheticToolResult,
  ensureTerminalToolCallState,
  flushSubagentThinkingBlock,
  flushThinkingBlock,
  getScopedParentToolCallId,
  getScopedSpanIdentity,
  getToolCallUI,
  getToolResultErrorMessage,
  handleClientCompletion,
  inferToolSuccess,
  registerPendingToolPromise,
} from './types'

const logger = createLogger('CopilotToolHandler')

function applyToolDisplay(toolCall: ToolCallState | undefined): void {
  if (!toolCall?.name) return
  // Integration rows show only the model-authored activity phrase; the trusted
  // integration branding is the icon, derived client-side from the operation
  // name (or streamed toolId) via the block registry. With no description yet,
  // fall back to the integration name so the humanized gateway name never
  // renders.
  if (toolCall.name === INTEGRATION_GATEWAY_TOOL) {
    const toolId = toolCall.params?.toolId
    const description = toolCall.params?.description
    if (typeof description === 'string' && description.trim()) {
      toolCall.displayTitle = description.trim()
      return
    }
    if (typeof toolId === 'string') {
      const integration = getBlockByToolName(toolId)
      if (integration) {
        toolCall.displayTitle = integration.name
        return
      }
    }
  }
  if (toolCall.integrationDescription) {
    toolCall.displayTitle = toolCall.integrationDescription
    return
  }
  toolCall.displayTitle = getToolDisplayTitle(
    toolCall.name,
    toolCall.params as Record<string, unknown> | undefined
  )
}

const INTEGRATION_GATEWAY_TOOL = 'call_integration_tool'

function handleToolArgsDelta(
  data: { argumentsDelta: string; toolCallId: string; toolName: string },
  context: StreamingContext
): void {
  const toolCall = context.toolCalls.get(data.toolCallId)
  if (!toolCall) return
  toolCall.streamingArgs = `${toolCall.streamingArgs ?? ''}${data.argumentsDelta}`
  if (toolCall.name !== INTEGRATION_GATEWAY_TOOL) return

  const toolId = extractStreamingStringArgument(toolCall.streamingArgs, 'toolId')
  const description = extractStreamingStringArgument(toolCall.streamingArgs, 'description')
  if (toolId || description) {
    toolCall.params = {
      ...toolCall.params,
      ...(toolId ? { toolId } : {}),
      ...(description ? { description } : {}),
    }
    applyToolDisplay(toolCall)
  }
}

/**
 * The model first streams the stable gateway call. Once Go resolves its exact
 * server-owned operation, a second authoritative frame with the same call id
 * carries the real executable tool name and arguments. Rebind atomically so
 * execution, persistence, branding, and results all use that operation while
 * retaining only the model-authored activity description for presentation.
 */
function rebindResolvedIntegrationCall(
  toolCall: ToolCallState | undefined,
  toolName: string,
  args: Record<string, unknown> | undefined
): boolean {
  if (!toolCall || toolCall.name !== INTEGRATION_GATEWAY_TOOL) {
    return false
  }
  // Gateway arguments may arrive over several generating/final frames. Keep
  // the newest complete snapshot so the eventual authoritative operation frame
  // can retain the model-authored presentation description.
  if (toolName === INTEGRATION_GATEWAY_TOOL) {
    if (args) toolCall.params = args
    return true
  }
  const description = toolCall.params?.description
  if (typeof description === 'string' && description.trim()) {
    toolCall.integrationDescription = description.trim()
  }
  toolCall.name = toolName
  toolCall.params = args
  applyToolDisplay(toolCall)
  return true
}

/**
 * Upsert the durable `async_tool_calls` row before the authoritative tool-call
 * SSE frame is forwarded to the client, so `/api/copilot/confirm` and
 * `/api/copilot/tool-permission` can never race ahead of the row that
 * identifies the call. This is the sole persistence point for client-executable
 * tools; gating mirrors the client-wait branch in `dispatchToolExecution`.
 *
 * A tool awaiting user approval is also persisted here whatever its route,
 * because the prompt has to outlive the page: the row is what a reloaded tab's
 * decision posts against.
 *
 * Also stamps `awaiting_approval` onto the outgoing frame so the browser and
 * the persisted content block both record that the call is gated.
 */
export async function prePersistClientExecutableToolCall(
  event: StreamEvent,
  context: StreamingContext,
  options?: OrchestratorOptions,
  execContext?: ExecutionContext
): Promise<void> {
  if (event.type !== 'tool') return
  if (!isToolCallStreamEvent(event)) return

  const data = event.payload
  const isGenerating = data.status === TOOL_CALL_STATUS.generating
  const isPartial = data.partial === true || isGenerating
  if (isPartial) return

  const ui = getToolCallUI(data)
  const catalogEntry = getToolEntry(data.toolName)
  const isInternal = ui.internal === true || catalogEntry?.internal === true

  // Go stamps this for resolved integration operations; Sim stamps it below for
  // catalog-declared tools. Normalizing here means the dispatch path only ever
  // has to read the frame.
  //
  // Resolved before the internal short-circuit on purpose: a stamp that
  // survives to the client with nothing gating it behind renders a card whose
  // buttons answer into the void.
  const frameRequestsApproval = data.status === TOOL_AWAITING_APPROVAL_STATUS
  const gated =
    !isInternal &&
    toolCallNeedsApproval(
      data.toolName,
      context,
      options ?? {},
      frameRequestsApproval,
      data.arguments
    )
  if (gated) {
    data.status = TOOL_AWAITING_APPROVAL_STATUS
  } else if (frameRequestsApproval) {
    // Go asked for a prompt this surface will not hold — the feature is off,
    // the tool is internal, or the user already allowed it for good. Clear the
    // stamp so the row renders as an ordinary call.
    data.status = undefined
  }

  if (isInternal) return

  if (!gated) {
    if (!ui.clientExecutable) return

    const delegateWorkflowRunToClient = isWorkflowToolName(data.toolName)
    const userLocalVfsCall = isUserLocalVfsToolCall(data.toolName, data.arguments)
    if (isSimExecuted(data.toolName) && !delegateWorkflowRunToClient && !userLocalVfsCall) return
  }

  if (!context.runId) return

  // Pin the workflow target into the arguments before they are sealed, persisted,
  // and forwarded, so the row, the browser, and the completion waiter all read one
  // explicit field.
  //
  // They used to disagree: the server resolved `args.workflowId ?? run.workflowId`
  // while the browser resolved `args.workflowId ?? activeWorkflowId`. In a
  // workspace chat `copilot_runs.workflow_id` is NULL, so every call that omitted
  // the (optional) argument resolved to nothing server-side and to the open tab
  // client-side — a guaranteed rejection at the execute endpoint.
  if (isWorkflowToolName(data.toolName)) {
    const targetWorkflowId = resolveWorkflowToolTargetId(data.arguments, execContext?.workflowId)
    if (targetWorkflowId) {
      data.arguments = { ...(data.arguments ?? {}), workflowId: targetWorkflowId }
    }
  }

  let sealedContext: Awaited<ReturnType<typeof sealClientToolContext>> | undefined
  if (execContext?.resolvedSecretTraceRegistry) {
    try {
      sealedContext = await sealClientToolContext({
        toolCallId: data.toolCallId,
        runId: context.runId,
        userId: execContext.userId,
        registry: execContext.resolvedSecretTraceRegistry,
        toolInput: data.arguments,
      })
    } catch (error) {
      execContext.resolvedSecretTraceRegistry.markIncomplete('client-tool-seal-failed')
      logger.warn('Failed to seal client tool provenance', {
        toolCallId: data.toolCallId,
        error: getErrorMessage(error),
      })
    }
  }

  await upsertAsyncToolCall({
    runId: context.runId,
    toolCallId: data.toolCallId,
    toolName: data.toolName,
    args: data.arguments,
    sealedContext,
    // Browser and terminal actions cross a second, native authorization
    // boundary. Leave those rows pending until Electron atomically claims
    // them — the authorize endpoint only hands over a pending call, so a row
    // that arrives already running can never be executed natively. All other
    // client tools retain the established "already dispatched" running state.
    // A gated tool is likewise pending: nothing has been dispatched yet.
    status:
      gated || isCurrentBrowserToolName(data.toolName) || isTerminalToolName(data.toolName)
        ? MothershipStreamV1AsyncToolRecordStatus.pending
        : MothershipStreamV1AsyncToolRecordStatus.running,
  }).catch((err) => {
    if (err instanceof AsyncToolCallOwnershipError) throw err
    logger.warn('Failed to pre-persist async tool row before forwarding call frame', {
      toolCallId: data.toolCallId,
      toolName: data.toolName,
      error: getErrorMessage(err),
    })
  })
}

/**
 * Unified tool event handler for both main and subagent scopes.
 *
 * The main vs subagent differences are:
 * - Subagent requires a parentToolCallId and tracks tool calls in subAgentToolCalls
 * - Subagent result phase also updates the subAgentToolCalls record
 * - Subagent call phase stores in both subAgentToolCalls and context.toolCalls
 * - Main call phase only stores in context.toolCalls
 */
export async function handleToolEvent(
  event: StreamEvent,
  context: StreamingContext,
  execContext: ExecutionContext,
  options: OrchestratorOptions,
  scope: ToolScope
): Promise<void> {
  const isSubagent = scope === 'subagent'
  const parentToolCallId = isSubagent ? getScopedParentToolCallId(event, context) : undefined
  const agentId = event.scope?.agentId ?? 'main'

  if (isSubagent && !parentToolCallId) return

  if (event.type !== 'tool') {
    return
  }

  if (isToolArgsDeltaStreamEvent(event)) {
    handleToolArgsDelta(event.payload, context)
    return
  }

  // A tool event breaks the thinking stream. Flush any open thinking
  // block into contentBlocks BEFORE we add the tool_call block, or
  // contentBlocks will end up with tool_call before thinking — which
  // re-renders on reload in the wrong order (Mothership group above
  // the Thinking block, even though thinking happened first). A subagent
  // tool event flushes only its OWN lane so a concurrent sibling's thinking
  // is left intact; a main tool event flushes all subagent lanes.
  if (isSubagent && parentToolCallId) {
    flushSubagentThinkingBlock(context, parentToolCallId)
  } else {
    flushSubagentThinkingBlock(context)
  }
  flushThinkingBlock(context)

  if (isToolResultStreamEvent(event)) {
    handleResultPhase(event.payload, context, parentToolCallId)
    return
  }

  if (!isToolCallStreamEvent(event)) {
    return
  }

  if (!parentToolCallId) {
    context.sawMainToolCall = true
    context.finalAssistantContent = ''
  }

  await handleCallPhase(
    event.payload,
    context,
    execContext,
    options,
    parentToolCallId,
    scope,
    agentId,
    getScopedSpanIdentity(event)
  )
}

function handleResultPhase(
  data: MothershipStreamV1ToolResultPayload,
  context: StreamingContext,
  parentToolCallId: string | undefined
): void {
  const { toolCallId, toolName } = data
  const mainToolCall = ensureTerminalToolCallState(context, toolCallId, toolName)
  const { success, hasResultData } = inferToolSuccess(data)
  let status: MothershipStreamV1ToolOutcome
  if (data.status === MothershipStreamV1ToolOutcome.cancelled) {
    status = MothershipStreamV1ToolOutcome.cancelled
  } else if (data.status === MothershipStreamV1ToolOutcome.skipped) {
    status = MothershipStreamV1ToolOutcome.skipped
  } else if (data.status === MothershipStreamV1ToolOutcome.rejected) {
    status = MothershipStreamV1ToolOutcome.rejected
  } else {
    status = success ? MothershipStreamV1ToolOutcome.success : MothershipStreamV1ToolOutcome.error
  }
  const endTime = Date.now()
  const errorMessage =
    !success && status !== MothershipStreamV1ToolOutcome.skipped
      ? getToolResultErrorMessage(data) ||
        (status === MothershipStreamV1ToolOutcome.cancelled
          ? 'Tool cancelled'
          : status === MothershipStreamV1ToolOutcome.rejected
            ? 'Tool rejected'
            : 'Tool failed')
      : undefined

  if (parentToolCallId) {
    const toolCalls = context.subAgentToolCalls[parentToolCallId] || []
    const subAgentToolCall = toolCalls.find((tc) => tc.id === toolCallId)
    if (subAgentToolCall) {
      setTerminalToolCallState(subAgentToolCall, {
        status,
        ...(hasResultData ? { output: data.output } : {}),
        ...(errorMessage ? { error: errorMessage } : {}),
        endTime,
      })
    }
  }

  setTerminalToolCallState(mainToolCall, {
    status,
    ...(hasResultData ? { output: data.output } : {}),
    ...(errorMessage ? { error: errorMessage } : {}),
    endTime,
  })
  stampToolCallBlockEnd(context, toolCallId, endTime)
  markToolResultSeen(toolCallId)
}

function stampToolCallBlockEnd(
  context: StreamingContext,
  toolCallId: string,
  endTime: number
): void {
  for (let i = context.contentBlocks.length - 1; i >= 0; i--) {
    const block = context.contentBlocks[i]
    if (block.type === 'tool_call' && block.toolCall?.id === toolCallId) {
      if (block.endedAt === undefined) block.endedAt = endTime
      return
    }
  }
}

async function handleCallPhase(
  data: MothershipStreamV1ToolCallDescriptor,
  context: StreamingContext,
  execContext: ExecutionContext,
  options: OrchestratorOptions,
  parentToolCallId: string | undefined,
  scope: ToolScope,
  agentId: string,
  spanIdentity: { spanId?: string; parentSpanId?: string }
): Promise<void> {
  const { toolCallId, toolName } = data
  const args = data.arguments
  const isGenerating = data.status === TOOL_CALL_STATUS.generating
  const isPartial = data.partial === true || isGenerating
  const existing = context.toolCalls.get(toolCallId)
  if (existing) existing.agentId ??= agentId
  const isSubagent = scope === 'subagent'
  const ui = getToolCallUI(data)

  if (isPartial && shouldDelayVfsPlaceholder(toolName, args)) return

  if (
    existing &&
    (context.pendingToolPromises.has(toolCallId) ||
      existing.status === 'awaiting_approval' ||
      existing.status === 'executing')
  ) {
    applyToolDisplay(existing)
    return
  }

  if (isSubagent) {
    if (wasToolResultSeen(toolCallId) || existing?.endTime) {
      if (!rebindResolvedIntegrationCall(existing, toolName, args)) {
        if (existing) updateToolCallFromFrame(existing, toolName, args, !isPartial)
      }
      applyToolDisplay(existing)
      return
    }
  } else {
    if (
      existing?.endTime ||
      (existing && existing.status !== 'pending' && existing.status !== 'executing')
    ) {
      if (!rebindResolvedIntegrationCall(existing, toolName, args)) {
        updateToolCallFromFrame(existing, toolName, args, !isPartial)
      }
      applyToolDisplay(existing)
      return
    }
  }

  if (isSubagent) {
    registerSubagentToolCall(
      context,
      toolCallId,
      toolName,
      args,
      parentToolCallId!,
      agentId,
      ui,
      spanIdentity,
      !isPartial
    )
  } else {
    registerMainToolCall(context, toolCallId, toolName, args, existing, agentId, ui, !isPartial)
  }

  if (isPartial) return
  if (!isSubagent && wasToolResultSeen(toolCallId)) return
  if (context.pendingToolPromises.has(toolCallId) || existing?.status === 'executing') {
    return
  }

  const toolCall = context.toolCalls.get(toolCallId)
  if (!toolCall) return

  // Capture the invoking subagent's channel id so the executor can thread it
  // into the server tool context — this is what scopes the prepare_file_edit ->
  // apply_file_edit intent handoff to one file subagent under concurrency.
  if (parentToolCallId) toolCall.parentToolCallId = parentToolCallId

  const readPath = typeof args?.path === 'string' ? args.path : undefined
  if (toolName === 'read' && readPath?.startsWith('internal/')) return

  const { clientExecutable, simExecutable, internal, inbandOwned } = ui
  const catalogEntry = getToolEntry(toolName)
  const isInternal = internal || catalogEntry?.internal === true
  const staticSimExecuted = isSimExecuted(toolName)
  // Go executes inband-owned calls itself via /api/copilot/tools/execute
  // (background lanes, and the main lane while background agents run); the
  // event exists only to draw the row. Dispatching it here would run the
  // tool a second time, racing the in-band execution on mutations.
  const willDispatch =
    !isInternal && !inbandOwned && (staticSimExecuted || simExecutable || clientExecutable)
  logger.info('Tool call routing decision', {
    toolCallId,
    toolName,
    scope,
    isSubagent,
    parentToolCallId,
    executor: data.executor,
    clientExecutable,
    simExecutable,
    staticSimExecuted,
    internal: isInternal,
    inbandOwned,
    hasPendingPromise: context.pendingToolPromises.has(toolCallId),
    existingStatus: existing?.status,
    willDispatch,
  })
  if (isInternal) return
  if (!willDispatch) return

  await dispatchToolExecution(
    toolCall,
    toolCallId,
    toolName,
    args,
    context,
    execContext,
    options,
    clientExecutable,
    scope,
    isToolHiddenInUi(toolName) || ui.hidden === true,
    data.status === TOOL_AWAITING_APPROVAL_STATUS
  )
}

function shouldDelayVfsPlaceholder(
  toolName: string,
  args: Record<string, unknown> | undefined
): boolean {
  return (toolName === 'read' || toolName === 'glob') && !args
}

function removeToolCallContentBlock(context: StreamingContext, toolCallId: string): void {
  for (let i = context.contentBlocks.length - 1; i >= 0; i--) {
    const block = context.contentBlocks[i]
    if (block.type === 'tool_call' && block.toolCall?.id === toolCallId) {
      context.contentBlocks.splice(i, 1)
    }
  }
}

function updateToolCallFromFrame(
  toolCall: ToolCallState,
  toolName: string,
  args: Record<string, unknown> | undefined,
  finalized: boolean
): void {
  if (!toolCall.name && toolName) toolCall.name = toolName
  if (finalized || args !== undefined) toolCall.params = args
}

function registerSubagentToolCall(
  context: StreamingContext,
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown> | undefined,
  parentToolCallId: string,
  agentId: string,
  ui: { title?: string; phaseLabel?: string; hidden?: boolean },
  spanIdentity: { spanId?: string; parentSpanId?: string },
  finalized: boolean
): void {
  if (!context.subAgentToolCalls[parentToolCallId]) {
    context.subAgentToolCalls[parentToolCallId] = []
  }
  const hideFromUi = isToolHiddenInUi(toolName) || ui.hidden === true
  let toolCall = context.toolCalls.get(toolCallId)
  if (toolCall) {
    if (!rebindResolvedIntegrationCall(toolCall, toolName, args)) {
      updateToolCallFromFrame(toolCall, toolName, args, finalized)
    }
    applyToolDisplay(toolCall)
    if (hideFromUi) removeToolCallContentBlock(context, toolCallId)
  } else {
    toolCall = {
      id: toolCallId,
      name: toolName,
      status: 'pending',
      agentId,
      params: args,
      startTime: Date.now(),
    }
    applyToolDisplay(toolCall)
    context.toolCalls.set(toolCallId, toolCall)
    const parentToolCall = context.toolCalls.get(parentToolCallId)
    if (!hideFromUi) {
      addContentBlock(context, {
        type: 'tool_call',
        toolCall,
        calledBy: parentToolCall?.name,
        parentToolCallId,
        ...spanIdentity,
      })
    }
  }

  const subagentToolCalls = context.subAgentToolCalls[parentToolCallId]
  const existingSubagentToolCall = subagentToolCalls.find((tc) => tc.id === toolCallId)
  if (existingSubagentToolCall) {
    existingSubagentToolCall.agentId ??= agentId
    if (!rebindResolvedIntegrationCall(existingSubagentToolCall, toolName, args)) {
      updateToolCallFromFrame(existingSubagentToolCall, toolName, args, finalized)
    }
    applyToolDisplay(existingSubagentToolCall)
  } else {
    subagentToolCalls.push(toolCall)
  }
}

function registerMainToolCall(
  context: StreamingContext,
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown> | undefined,
  existing: ToolCallState | undefined,
  agentId: string,
  ui: { title?: string; phaseLabel?: string; hidden?: boolean },
  finalized: boolean
): void {
  const hideFromUi = isToolHiddenInUi(toolName) || ui.hidden === true
  if (existing) {
    if (!rebindResolvedIntegrationCall(existing, toolName, args)) {
      updateToolCallFromFrame(existing, toolName, args, finalized)
    }
    applyToolDisplay(existing)
    if (hideFromUi) {
      removeToolCallContentBlock(context, toolCallId)
      return
    }
    if (
      !hideFromUi &&
      !context.contentBlocks.some((b) => b.type === 'tool_call' && b.toolCall?.id === toolCallId)
    ) {
      addContentBlock(context, { type: 'tool_call', toolCall: existing })
    }
  } else {
    const created: ToolCallState = {
      id: toolCallId,
      name: toolName,
      status: 'pending',
      agentId,
      params: args,
      startTime: Date.now(),
    }
    applyToolDisplay(created)
    context.toolCalls.set(toolCallId, created)
    if (!hideFromUi) {
      addContentBlock(context, { type: 'tool_call', toolCall: created })
    }
  }
}

async function dispatchToolExecution(
  toolCall: ToolCallState,
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown> | undefined,
  context: StreamingContext,
  execContext: ExecutionContext,
  options: OrchestratorOptions,
  clientExecutable: boolean,
  scope: ToolScope,
  hiddenInUi = false,
  frameRequestsApproval = false
): Promise<void> {
  const scopeLabel = scope === 'subagent' ? 'subagent ' : ''

  const fireToolExecution = (
    execContextOverride?: ExecutionContext
  ): Promise<AsyncCompletionSignal> => {
    return (async () => {
      return executeToolAndReport(toolCallId, context, execContextOverride ?? execContext, options)
    })().catch((err) => {
      logger.error(`Parallel ${scopeLabel}tool execution failed`, {
        toolCallId,
        toolName,
        error: toError(err).message,
      })
      return {
        status: MothershipStreamV1ToolOutcome.error,
        message: 'Tool execution failed',
        data: { error: 'Tool execution failed' },
      }
    })
  }

  /**
   * Refuse a workflow tool call whose target this side cannot name.
   *
   * The execute endpoint validates the run against the tool call's bound
   * workflow, so dispatching an unbound call only buys a rejection the model
   * cannot interpret. Failing here instead tells it exactly what to send back,
   * and never guesses a workflow on the user's behalf.
   */
  const refuseUnboundWorkflowTool = async (): Promise<AsyncCompletionSignal> => {
    const error = `${toolName} requires an explicit workflowId. This chat is not scoped to a workflow, so there is no current workflow to fall back to — pass the id of the workflow to run.`
    logger.warn('Refusing workflow tool call with no resolvable workflow target', {
      toolCallId,
      toolName,
    })
    setTerminalToolCallState(toolCall, {
      status: MothershipStreamV1ToolOutcome.error,
      output: { error },
      error,
    })
    markToolResultSeen(toolCallId)
    await emitSyntheticToolResult(
      toolCallId,
      toolCall.name,
      {
        status: MothershipStreamV1ToolOutcome.error,
        message: error,
        data: { error },
      },
      options
    )
    return { status: MothershipStreamV1ToolOutcome.error, message: error, data: { error } }
  }

  // Returns the promise instead of registering it, so the permission gate can
  // wrap the whole thing in one pending promise that stays unsettled until the
  // tool has actually run. Null means nothing was dispatched.
  const startExecution = (): Promise<AsyncCompletionSignal> | null => {
    if (options.interactive === false) {
      if (options.autoExecuteTools === false) return null
      if (abortPendingToolIfStreamDead(toolCall, toolCallId, options, context)) return null
      return fireToolExecution()
    }

    if (clientExecutable) {
      const delegateWorkflowRunToClient = isWorkflowToolName(toolName)
      const userLocalVfsCall = isUserLocalVfsToolCall(toolName, args)
      if (isSimExecuted(toolName) && !delegateWorkflowRunToClient && !userLocalVfsCall) {
        if (abortPendingToolIfStreamDead(toolCall, toolCallId, options, context)) return null
        return fireToolExecution()
      }
      if (
        delegateWorkflowRunToClient &&
        !resolveWorkflowToolTargetId(args, execContext.workflowId)
      ) {
        return refuseUnboundWorkflowTool()
      }
      return waitForClientExecution()
    }

    if (options.autoExecuteTools === false) return null
    if (abortPendingToolIfStreamDead(toolCall, toolCallId, options, context)) return null
    return fireToolExecution()
  }

  if (toolCallNeedsApproval(toolName, context, options, frameRequestsApproval, args)) {
    registerPendingToolPromise(
      context,
      toolCallId,
      runGatedToolExecution(
        toolCall,
        toolCallId,
        toolName,
        args,
        clientExecutable
          ? MothershipStreamV1ToolExecutor.client
          : MothershipStreamV1ToolExecutor.sim,
        context,
        options,
        startExecution,
        !hiddenInUi
      )
    )
    return
  }

  const pending = startExecution()
  if (pending) registerPendingToolPromise(context, toolCallId, pending)

  /**
   * A client-executed tool runs in the browser or desktop app; this side only
   * waits for it to report back through `/api/copilot/confirm`.
   */
  function waitForClientExecution(): Promise<AsyncCompletionSignal> {
    toolCall.status = 'executing'
    const timeoutMs = options.timeout || STREAM_TIMEOUT_MS
    return withCopilotSpan(
      TraceSpan.CopilotToolWaitForClientResult,
      {
        [TraceAttr.ToolName]: toolName,
        [TraceAttr.ToolCallId]: toolCallId,
        [TraceAttr.ToolTimeoutMs]: timeoutMs,
        ...(context.runId ? { [TraceAttr.RunId]: context.runId } : {}),
      },
      async (span) => {
        let completion: AsyncTerminalCompletionSnapshot | null
        if (isWorkflowToolName(toolName)) {
          const race = await raceWorkflowToolClientPickup({
            toolCallId,
            workflowId: resolveWorkflowToolTargetId(args, execContext.workflowId),
            timeoutMs,
            graceMs: COPILOT_WORKFLOW_TOOL_CLIENT_GRACE_MS,
            abortSignal: options.abortSignal,
            registry: execContext.resolvedSecretTraceRegistry,
            runOnServer: (boundExecutionId) => {
              // `executeToolAndReportInner` short-circuits a call that is
              // already 'executing' — which is exactly what this wait set it to
              // before parking. Hand it back the state it dispatches from.
              toolCall.status = 'pending'
              return fireToolExecution({
                ...execContext,
                boundWorkflowExecutionId: boundExecutionId,
              })
            },
          })

          if (race.winner === 'sim') {
            // `executeToolAndReport` already emitted its own `executor: sim`
            // result and marked it seen, so the client-completion bookkeeping
            // below must not run again on top of it.
            span.setAttribute(TraceAttr.ToolExecutor, MothershipStreamV1ToolExecutor.sim)
            if (race.signal) {
              span.setAttribute(TraceAttr.ToolOutcome, race.signal.status)
            }
            return (
              race.signal ?? {
                status: MothershipStreamV1ToolOutcome.error,
                message: 'Tool completion missing',
                data: { error: 'Tool completion missing' },
              }
            )
          }
          completion = race.completion ?? null
        } else {
          completion = await waitForClientToolCompletion({
            toolCallId,
            runId: context.runId,
            userId: execContext.userId,
            timeoutMs,
            abortSignal: options.abortSignal,
            registry: execContext.resolvedSecretTraceRegistry,
          })
        }
        span.setAttribute(TraceAttr.ToolExecutor, MothershipStreamV1ToolExecutor.client)
        // Both waiters resolve `T | null`, never undefined — comparing against
        // undefined made this a constant `true` and hid every timeout.
        span.setAttribute(TraceAttr.ToolCompletionReceived, completion !== null)
        if (completion) {
          span.setAttribute(TraceAttr.ToolOutcome, completion.status)
        }
        const backgroundIsSuccess = toolName === 'run_workflow' && args?.async === true
        handleClientCompletion(toolCall, toolCallId, completion, backgroundIsSuccess)
        await emitSyntheticToolResult(
          toolCallId,
          toolCall.name,
          completion,
          options,
          backgroundIsSuccess
        )
        return (
          completion ?? {
            status: MothershipStreamV1ToolOutcome.error,
            message: 'Tool completion missing',
            data: { error: 'Tool completion missing' },
          }
        )
      }
    ).catch((err) => {
      logger.error(`Client-executable ${scopeLabel}tool wait failed`, {
        toolCallId,
        toolName,
        error: toError(err).message,
      })
      return {
        status: MothershipStreamV1ToolOutcome.error,
        message: 'Tool wait failed',
        data: { error: 'Tool wait failed' },
      }
    })
  }
}
