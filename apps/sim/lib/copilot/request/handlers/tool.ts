import { createLogger } from '@sim/logger'
import { upsertAsyncToolCall } from '@/lib/copilot/async-runs/repository'
import { STREAM_TIMEOUT_MS } from '@/lib/copilot/constants'
import {
  MothershipStreamV1AsyncToolRecordStatus,
  MothershipStreamV1ToolOutcome,
  MothershipStreamV1ToolPhase,
} from '@/lib/copilot/generated/mothership-stream-v1'
import { TOOL_CALL_STATUS } from '@/lib/copilot/request/session'
import {
  asRecord,
  getEventData,
  markToolResultSeen,
  wasToolResultSeen,
} from '@/lib/copilot/request/sse-utils'
import { executeToolAndReport, waitForToolCompletion } from '@/lib/copilot/request/tools/executor'
import type {
  ExecutionContext,
  OrchestratorOptions,
  StreamEvent,
  StreamingContext,
  ToolCallState,
} from '@/lib/copilot/request/types'
import { isSimExecuted } from '@/lib/copilot/tool-executor'
import { isWorkflowToolName } from '@/lib/copilot/tools/workflow-tools'
import type { ToolScope } from './types'
import {
  abortPendingToolIfStreamDead,
  addContentBlock,
  emitSyntheticToolResult,
  ensureTerminalToolCallState,
  getEventUI,
  getScopedParentToolCallId,
  handleClientCompletion,
  inferToolSuccess,
  registerPendingToolPromise,
} from './types'

const logger = createLogger('CopilotToolHandler')

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

  const data = getEventData(event)
  const phase = data?.phase as string | undefined
  const toolCallId = (data?.toolCallId as string | undefined) || (data?.id as string | undefined)
  if (!toolCallId) return
  const toolName =
    (data?.toolName as string | undefined) ||
    (data?.name as string | undefined) ||
    context.toolCalls.get(toolCallId)?.name ||
    ''

  if (phase === MothershipStreamV1ToolPhase.args_delta) {
    return
  }

  if (phase === MothershipStreamV1ToolPhase.result) {
    handleResultPhase(context, data, toolCallId, toolName, isSubagent, parentToolCallId)
    return
  }

  handleCallPhase(
    event,
    context,
    execContext,
    options,
    data,
    toolCallId,
    toolName,
    isSubagent,
    parentToolCallId,
    scope
  )
}

function handleResultPhase(
  context: StreamingContext,
  data: Record<string, unknown> | undefined,
  toolCallId: string,
  toolName: string,
  isSubagent: boolean,
  parentToolCallId: string | undefined
): void {
  const mainToolCall = ensureTerminalToolCallState(context, toolCallId, toolName)
  const { success, hasResultData, hasError } = inferToolSuccess(data)
  const status =
    data?.status === MothershipStreamV1ToolOutcome.cancelled
      ? MothershipStreamV1ToolOutcome.cancelled
      : success
        ? MothershipStreamV1ToolOutcome.success
        : MothershipStreamV1ToolOutcome.error
  const endTime = Date.now()
  const result = hasResultData ? { success, output: data?.result || data?.data } : undefined

  if (isSubagent && parentToolCallId) {
    const toolCalls = context.subAgentToolCalls[parentToolCallId] || []
    const subAgentToolCall = toolCalls.find((tc) => tc.id === toolCallId)
    if (subAgentToolCall) {
      subAgentToolCall.status = status
      subAgentToolCall.endTime = endTime
      if (result) subAgentToolCall.result = result
      if (hasError) {
        const resultObj = asRecord(data?.result)
        subAgentToolCall.error = (data?.error || resultObj.error) as string | undefined
      }
    }
  }

  mainToolCall.status = status
  mainToolCall.endTime = endTime
  if (result) mainToolCall.result = result
  if (hasError) {
    const resultObj = asRecord(data?.result)
    mainToolCall.error = (data?.error || resultObj.error) as string | undefined
  }
  markToolResultSeen(toolCallId)
}

async function handleCallPhase(
  event: StreamEvent,
  context: StreamingContext,
  execContext: ExecutionContext,
  options: OrchestratorOptions,
  data: Record<string, unknown> | undefined,
  toolCallId: string,
  toolName: string,
  isSubagent: boolean,
  parentToolCallId: string | undefined,
  scope: ToolScope
): Promise<void> {
  const args = (data?.arguments || data?.input) as Record<string, unknown> | undefined
  const isGenerating = data?.status === TOOL_CALL_STATUS.generating
  const isPartial = data?.partial === true || isGenerating
  const existing = context.toolCalls.get(toolCallId)

  if (isSubagent) {
    if (wasToolResultSeen(toolCallId) || existing?.endTime) {
      if (existing && !existing.name && toolName) existing.name = toolName
      if (existing && !existing.params && args) existing.params = args
      return
    }
  } else {
    if (
      existing?.endTime ||
      (existing && existing.status !== 'pending' && existing.status !== 'executing')
    ) {
      if (!existing.name && toolName) existing.name = toolName
      if (!existing.params && args) existing.params = args
      return
    }
  }

  if (isSubagent) {
    registerSubagentToolCall(context, toolCallId, toolName, args, parentToolCallId!)
  } else {
    registerMainToolCall(context, toolCallId, toolName, args, existing)
  }

  if (isPartial) return
  if (!isSubagent && wasToolResultSeen(toolCallId)) return
  if (context.pendingToolPromises.has(toolCallId) || existing?.status === 'executing') {
    return
  }

  const toolCall = context.toolCalls.get(toolCallId)
  if (!toolCall) return

  const isGoHandledInternalRead =
    toolName === 'read' &&
    typeof args?.path === 'string' &&
    (args.path as string).startsWith('internal/')
  if (isGoHandledInternalRead) return

  const { clientExecutable, simExecutable, internal } = getEventUI(event)
  const staticSimExecuted = isSimExecuted(toolName)
  const willDispatch = !internal && (staticSimExecuted || simExecutable || clientExecutable)
  logger.info('Tool call routing decision', {
    toolCallId,
    toolName,
    scope,
    isSubagent,
    parentToolCallId,
    executor: data?.executor,
    clientExecutable,
    simExecutable,
    staticSimExecuted,
    internal,
    hasPendingPromise: context.pendingToolPromises.has(toolCallId),
    existingStatus: existing?.status,
    willDispatch,
  })
  if (internal) return
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
  parentToolCallId: string
): void {
  if (!context.subAgentToolCalls[parentToolCallId]) {
    context.subAgentToolCalls[parentToolCallId] = []
  }
  let toolCall = context.toolCalls.get(toolCallId)
  if (toolCall) {
    if (!toolCall.name && toolName) toolCall.name = toolName
    if (args && !toolCall.params) toolCall.params = args
  } else {
    toolCall = {
      id: toolCallId,
      name: toolName,
      status: 'pending',
      params: args,
      startTime: Date.now(),
    }
    context.toolCalls.set(toolCallId, toolCall)
    const parentToolCall = context.toolCalls.get(parentToolCallId)
    addContentBlock(context, {
      type: 'tool_call',
      toolCall,
      calledBy: parentToolCall?.name,
    })
  }

  const subagentToolCalls = context.subAgentToolCalls[parentToolCallId]
  const existingSubagentToolCall = subagentToolCalls.find((tc) => tc.id === toolCallId)
  if (existingSubagentToolCall) {
    if (!existingSubagentToolCall.name && toolName) existingSubagentToolCall.name = toolName
    if (args && !existingSubagentToolCall.params) existingSubagentToolCall.params = args
  } else {
    subagentToolCalls.push(toolCall)
  }
}

function registerMainToolCall(
  context: StreamingContext,
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown> | undefined,
  existing: ToolCallState | undefined
): void {
  if (existing) {
    if (args && !existing.params) existing.params = args
    if (
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
    context.toolCalls.set(toolCallId, created)
    addContentBlock(context, { type: 'tool_call', toolCall: created })
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
          runId: context.runId || crypto.randomUUID(),
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
