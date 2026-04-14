import { createLogger } from '@sim/logger'
import { upsertAsyncToolCall } from '@/lib/copilot/async-runs/repository'
import { STREAM_TIMEOUT_MS } from '@/lib/copilot/constants'
import {
  MothershipStreamV1AsyncToolRecordStatus,
  type MothershipStreamV1ToolCallDescriptor,
  MothershipStreamV1ToolOutcome,
  type MothershipStreamV1ToolResultPayload,
} from '@/lib/copilot/generated/mothership-stream-v1'
import {
  isToolArgsDeltaStreamEvent,
  isToolCallStreamEvent,
  isToolResultStreamEvent,
  TOOL_CALL_STATUS,
} from '@/lib/copilot/request/session'
import { markToolResultSeen, wasToolResultSeen } from '@/lib/copilot/request/sse-utils'
import { setTerminalToolCallState } from '@/lib/copilot/request/tool-call-state'
import { executeToolAndReport, waitForToolCompletion } from '@/lib/copilot/request/tools/executor'
import type {
  ExecutionContext,
  OrchestratorOptions,
  StreamEvent,
  StreamingContext,
  ToolCallState,
} from '@/lib/copilot/request/types'
import { getToolEntry, isSimExecuted } from '@/lib/copilot/tool-executor'
import { isToolHiddenInUi } from '@/lib/copilot/tools/client/hidden-tools'
import { isWorkflowToolName } from '@/lib/copilot/tools/workflow-tools'
import type { ToolScope } from './types'
import {
  abortPendingToolIfStreamDead,
  addContentBlock,
  emitSyntheticToolResult,
  ensureTerminalToolCallState,
  getScopedParentToolCallId,
  getToolCallUI,
  getToolResultErrorMessage,
  handleClientCompletion,
  inferToolSuccess,
  registerPendingToolPromise,
} from './types'

const logger = createLogger('CopilotToolHandler')

function applyToolDisplay(
  toolCall: ToolCallState | undefined,
  ui: { title?: string; phaseLabel?: string }
): void {
  if (!toolCall) return
  const displayTitle = ui.title || ui.phaseLabel
  if (displayTitle) toolCall.displayTitle = displayTitle
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

  if (isSubagent && !parentToolCallId) return

  if (event.type !== 'tool') {
    return
  }

  if (isToolArgsDeltaStreamEvent(event)) {
    return
  }

  if (isToolResultStreamEvent(event)) {
    handleResultPhase(event.payload, context, parentToolCallId)
    return
  }

  if (!isToolCallStreamEvent(event)) {
    return
  }

  await handleCallPhase(event.payload, context, execContext, options, parentToolCallId, scope)
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
  markToolResultSeen(toolCallId)
}

async function handleCallPhase(
  data: MothershipStreamV1ToolCallDescriptor,
  context: StreamingContext,
  execContext: ExecutionContext,
  options: OrchestratorOptions,
  parentToolCallId: string | undefined,
  scope: ToolScope
): Promise<void> {
  const { toolCallId, toolName } = data
  const args = data.arguments
  const isGenerating = data.status === TOOL_CALL_STATUS.generating
  const isPartial = data.partial === true || isGenerating
  const existing = context.toolCalls.get(toolCallId)
  const isSubagent = scope === 'subagent'
  const ui = getToolCallUI(data)

  if (isSubagent) {
    if (wasToolResultSeen(toolCallId) || existing?.endTime) {
      if (existing && !existing.name && toolName) existing.name = toolName
      if (existing && !existing.params && args) existing.params = args
      applyToolDisplay(existing, ui)
      return
    }
  } else {
    if (
      existing?.endTime ||
      (existing && existing.status !== 'pending' && existing.status !== 'executing')
    ) {
      if (!existing.name && toolName) existing.name = toolName
      if (!existing.params && args) existing.params = args
      applyToolDisplay(existing, ui)
      return
    }
  }

  if (isSubagent) {
    registerSubagentToolCall(context, toolCallId, toolName, args, parentToolCallId!, ui)
  } else {
    registerMainToolCall(context, toolCallId, toolName, args, existing, ui)
  }

  if (isPartial) return
  if (!isSubagent && wasToolResultSeen(toolCallId)) return
  if (context.pendingToolPromises.has(toolCallId) || existing?.status === 'executing') {
    return
  }

  const toolCall = context.toolCalls.get(toolCallId)
  if (!toolCall) return

  const readPath = typeof args?.path === 'string' ? args.path : undefined
  if (toolName === 'read' && readPath?.startsWith('internal/')) return

  const { clientExecutable, simExecutable, internal } = ui
  const catalogEntry = getToolEntry(toolName)
  const isInternal = internal || catalogEntry?.internal === true
  const staticSimExecuted = isSimExecuted(toolName)
  const willDispatch = !isInternal && (staticSimExecuted || simExecutable || clientExecutable)
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
    scope
  )
}

function registerSubagentToolCall(
  context: StreamingContext,
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown> | undefined,
  parentToolCallId: string,
  ui: { title?: string; phaseLabel?: string }
): void {
  if (!context.subAgentToolCalls[parentToolCallId]) {
    context.subAgentToolCalls[parentToolCallId] = []
  }
  const hideFromUi = isToolHiddenInUi(toolName)
  let toolCall = context.toolCalls.get(toolCallId)
  if (toolCall) {
    if (!toolCall.name && toolName) toolCall.name = toolName
    if (args && !toolCall.params) toolCall.params = args
    applyToolDisplay(toolCall, ui)
  } else {
    toolCall = {
      id: toolCallId,
      name: toolName,
      status: 'pending',
      params: args,
      startTime: Date.now(),
    }
    applyToolDisplay(toolCall, ui)
    context.toolCalls.set(toolCallId, toolCall)
    const parentToolCall = context.toolCalls.get(parentToolCallId)
    if (!hideFromUi) {
      addContentBlock(context, {
        type: 'tool_call',
        toolCall,
        calledBy: parentToolCall?.name,
      })
    }
  }

  const subagentToolCalls = context.subAgentToolCalls[parentToolCallId]
  const existingSubagentToolCall = subagentToolCalls.find((tc) => tc.id === toolCallId)
  if (existingSubagentToolCall) {
    if (!existingSubagentToolCall.name && toolName) existingSubagentToolCall.name = toolName
    if (args && !existingSubagentToolCall.params) existingSubagentToolCall.params = args
    applyToolDisplay(existingSubagentToolCall, ui)
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
  ui: { title?: string; phaseLabel?: string }
): void {
  const hideFromUi = isToolHiddenInUi(toolName)
  if (existing) {
    if (args && !existing.params) existing.params = args
    applyToolDisplay(existing, ui)
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
      params: args,
      startTime: Date.now(),
    }
    applyToolDisplay(created, ui)
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
  scope: ToolScope
): Promise<void> {
  const scopeLabel = scope === 'subagent' ? 'subagent ' : ''

  const fireToolExecution = () => {
    const pendingPromise = (async () => {
      return executeToolAndReport(toolCallId, context, execContext, options)
    })().catch((err) => {
      logger.error(`Parallel ${scopeLabel}tool execution failed`, {
        toolCallId,
        toolName,
        error: err instanceof Error ? err.message : String(err),
      })
      return {
        status: MothershipStreamV1ToolOutcome.error,
        message: 'Tool execution failed',
        data: { error: 'Tool execution failed' },
      }
    })
    registerPendingToolPromise(context, toolCallId, pendingPromise)
  }

  if (options.interactive === false) {
    if (options.autoExecuteTools !== false) {
      if (!abortPendingToolIfStreamDead(toolCall, toolCallId, options, context)) {
        fireToolExecution()
      }
    }
    return
  }

  if (clientExecutable) {
    const delegateWorkflowRunToClient = isWorkflowToolName(toolName)
    if (isSimExecuted(toolName) && !delegateWorkflowRunToClient) {
      if (!abortPendingToolIfStreamDead(toolCall, toolCallId, options, context)) {
        fireToolExecution()
      }
    } else {
      toolCall.status = 'executing'
      const pendingPromise = (async () => {
        await upsertAsyncToolCall({
          runId: context.runId,
          toolCallId,
          toolName,
          args,
          status: MothershipStreamV1AsyncToolRecordStatus.running,
        }).catch((err) => {
          logger.warn(`Failed to persist async tool row for client-executable ${scopeLabel}tool`, {
            toolCallId,
            toolName,
            error: err instanceof Error ? err.message : String(err),
          })
        })
        const completion = await waitForToolCompletion(
          toolCallId,
          options.timeout || STREAM_TIMEOUT_MS,
          options.abortSignal
        )
        handleClientCompletion(toolCall, toolCallId, completion)
        await emitSyntheticToolResult(toolCallId, toolCall.name, completion, options)
        return (
          completion ?? {
            status: MothershipStreamV1ToolOutcome.error,
            message: 'Tool completion missing',
            data: { error: 'Tool completion missing' },
          }
        )
      })().catch((err) => {
        logger.error(`Client-executable ${scopeLabel}tool wait failed`, {
          toolCallId,
          toolName,
          error: err instanceof Error ? err.message : String(err),
        })
        return {
          status: MothershipStreamV1ToolOutcome.error,
          message: 'Tool wait failed',
          data: { error: 'Tool wait failed' },
        }
      })
      registerPendingToolPromise(context, toolCallId, pendingPromise)
    }
    return
  }

  if (options.autoExecuteTools !== false) {
    if (!abortPendingToolIfStreamDead(toolCall, toolCallId, options, context)) {
      fireToolExecution()
    }
  }
}
