import { createLogger } from '@sim/logger'
import {
  asRecord,
  normalizeSseEvent,
  shouldSkipToolCallEvent,
  shouldSkipToolResultEvent,
} from '@/lib/copilot/orchestrator/sse-utils'
import type { SSEEvent } from '@/lib/copilot/orchestrator/types'
import { resolveToolDisplay } from '@/lib/copilot/store-utils'
import { ClientToolCallState } from '@/lib/copilot/tools/client/tool-display-registry'
import type { CopilotStore, CopilotToolCall } from '@/stores/panel/copilot/types'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import {
  type SSEHandler,
  sseHandlers,
  updateStreamingMessage,
} from './handlers'
import { CLIENT_EXECUTABLE_RUN_TOOLS, executeRunToolOnClient } from './run-tool-execution'
import type { ClientStreamingContext } from './types'

const logger = createLogger('CopilotClientSubagentHandlers')

type StoreSet = (
  partial: Partial<CopilotStore> | ((state: CopilotStore) => Partial<CopilotStore>)
) => void

function mapServerStateToClientState(state: unknown): ClientToolCallState {
  switch (String(state || '')) {
    case 'generating':
      return ClientToolCallState.generating
    case 'pending':
    case 'awaiting_approval':
      return ClientToolCallState.pending
    case 'executing':
      return ClientToolCallState.executing
    case 'success':
      return ClientToolCallState.success
    case 'rejected':
    case 'skipped':
      return ClientToolCallState.rejected
    case 'aborted':
      return ClientToolCallState.aborted
    case 'error':
    case 'failed':
      return ClientToolCallState.error
    default:
      return ClientToolCallState.pending
  }
}

function extractToolUiMetadata(data: Record<string, unknown>): CopilotToolCall['ui'] | undefined {
  const ui = asRecord(data.ui)
  if (!ui || Object.keys(ui).length === 0) return undefined
  const autoAllowedFromUi = ui.autoAllowed === true
  const autoAllowedFromData = data.autoAllowed === true
  return {
    title: typeof ui.title === 'string' ? ui.title : undefined,
    phaseLabel: typeof ui.phaseLabel === 'string' ? ui.phaseLabel : undefined,
    icon: typeof ui.icon === 'string' ? ui.icon : undefined,
    showInterrupt: ui.showInterrupt === true,
    showRemember: ui.showRemember === true,
    autoAllowed: autoAllowedFromUi || autoAllowedFromData,
    actions: Array.isArray(ui.actions)
      ? ui.actions
          .map((action) => {
            const a = asRecord(action)
            const id = typeof a.id === 'string' ? a.id : undefined
            const label = typeof a.label === 'string' ? a.label : undefined
            const kind: 'accept' | 'reject' = a.kind === 'reject' ? 'reject' : 'accept'
            if (!id || !label) return null
            return {
              id,
              label,
              kind,
              remember: a.remember === true,
            }
          })
          .filter((a): a is NonNullable<typeof a> => !!a)
      : undefined,
  }
}

function extractToolExecutionMetadata(
  data: Record<string, unknown>
): CopilotToolCall['execution'] | undefined {
  const execution = asRecord(data.execution)
  if (!execution || Object.keys(execution).length === 0) return undefined
  return {
    target: typeof execution.target === 'string' ? execution.target : undefined,
    capabilityId: typeof execution.capabilityId === 'string' ? execution.capabilityId : undefined,
  }
}

function isClientRunCapability(toolCall: CopilotToolCall): boolean {
  if (toolCall.execution?.target === 'sim_client_capability') {
    return toolCall.execution.capabilityId === 'workflow.run' || !toolCall.execution.capabilityId
  }
  return CLIENT_EXECUTABLE_RUN_TOOLS.has(toolCall.name)
}

function isWorkflowChangeApplyCall(toolCall: CopilotToolCall): boolean {
  if (toolCall.name !== 'workflow_change') return false
  const params = (toolCall.params || {}) as Record<string, unknown>
  const mode = typeof params.mode === 'string' ? params.mode.toLowerCase() : ''
  if (mode === 'apply') return true
  return typeof params.proposalId === 'string' && params.proposalId.length > 0
}

function extractWorkflowStateFromResultPayload(
  resultPayload: Record<string, unknown>
): WorkflowState | null {
  const directState = asRecord(resultPayload.workflowState)
  if (directState) return directState as unknown as WorkflowState

  const editResult = asRecord(resultPayload.editResult)
  const nestedState = asRecord(editResult?.workflowState)
  if (nestedState) return nestedState as unknown as WorkflowState

  return null
}

function extractOperationListFromResultPayload(
  resultPayload: Record<string, unknown>
): Array<Record<string, unknown>> | undefined {
  const operations = resultPayload.operations
  if (Array.isArray(operations)) return operations as Array<Record<string, unknown>>

  const compiled = resultPayload.compiledOperations
  if (Array.isArray(compiled)) return compiled as Array<Record<string, unknown>>

  return undefined
}

export function appendSubAgentContent(
  context: ClientStreamingContext,
  parentToolCallId: string,
  text: string
) {
  if (!context.subAgentContent[parentToolCallId]) {
    context.subAgentContent[parentToolCallId] = ''
  }
  if (!context.subAgentBlocks[parentToolCallId]) {
    context.subAgentBlocks[parentToolCallId] = []
  }
  context.subAgentContent[parentToolCallId] += text
  const blocks = context.subAgentBlocks[parentToolCallId]
  const lastBlock = blocks[blocks.length - 1]
  if (lastBlock && lastBlock.type === 'subagent_text') {
    lastBlock.content = (lastBlock.content || '') + text
  } else {
    blocks.push({
      type: 'subagent_text',
      content: text,
      timestamp: Date.now(),
    })
  }
}

export function updateToolCallWithSubAgentData(
  context: ClientStreamingContext,
  get: () => CopilotStore,
  set: StoreSet,
  parentToolCallId: string
) {
  const { toolCallsById } = get()
  const parentToolCall = toolCallsById[parentToolCallId]
  if (!parentToolCall) {
    logger.warn('[SubAgent] updateToolCallWithSubAgentData: parent tool call not found', {
      parentToolCallId,
      availableToolCallIds: Object.keys(toolCallsById),
    })
    return
  }

  const blocks = context.subAgentBlocks[parentToolCallId] ?? []

  const updatedToolCall: CopilotToolCall = {
    ...parentToolCall,
    subAgentContent: context.subAgentContent[parentToolCallId] || '',
    subAgentToolCalls: context.subAgentToolCalls[parentToolCallId] ?? [],
    subAgentBlocks: blocks,
    subAgentStreaming: true,
  }

  logger.info('[SubAgent] Updating tool call with subagent data', {
    parentToolCallId,
    parentToolName: parentToolCall.name,
    subAgentContentLength: updatedToolCall.subAgentContent?.length,
    subAgentBlocksCount: updatedToolCall.subAgentBlocks?.length,
    subAgentToolCallsCount: updatedToolCall.subAgentToolCalls?.length,
  })

  const updatedMap = { ...toolCallsById, [parentToolCallId]: updatedToolCall }
  set({ toolCallsById: updatedMap })

  let foundInContentBlocks = false
  for (let i = 0; i < context.contentBlocks.length; i++) {
    const b = context.contentBlocks[i]
    if (b.type === 'tool_call' && b.toolCall?.id === parentToolCallId) {
      context.contentBlocks[i] = { ...b, toolCall: updatedToolCall }
      foundInContentBlocks = true
      break
    }
  }

  if (!foundInContentBlocks) {
    logger.warn('[SubAgent] Parent tool call not found in contentBlocks', {
      parentToolCallId,
      contentBlocksCount: context.contentBlocks.length,
      toolCallBlockIds: context.contentBlocks
        .filter((b) => b.type === 'tool_call')
        .map((b) => b.toolCall?.id),
    })
  }

  updateStreamingMessage(set, context)
}

export const subAgentSSEHandlers: Record<string, SSEHandler> = {
  start: () => {
    // Subagent start event - no action needed, parent is already tracked from subagent_start
  },

  content: (data, context, get, set) => {
    const parentToolCallId = context.subAgentParentToolCallId
    const contentStr = typeof data.data === 'string' ? data.data : data.content || ''
    logger.info('[SubAgent] content event', {
      parentToolCallId,
      hasData: !!contentStr,
      dataPreview: contentStr ? contentStr.substring(0, 50) : null,
    })
    if (!parentToolCallId || !contentStr) {
      logger.warn('[SubAgent] content missing parentToolCallId or data', {
        parentToolCallId,
        hasData: !!contentStr,
      })
      return
    }

    appendSubAgentContent(context, parentToolCallId, contentStr)

    updateToolCallWithSubAgentData(context, get, set, parentToolCallId)
  },

  reasoning: (data, context, get, set) => {
    const parentToolCallId = context.subAgentParentToolCallId
    const dataObj = asRecord(data?.data)
    const phase = data?.phase || (dataObj.phase as string | undefined)
    if (!parentToolCallId) return

    if (phase === 'start' || phase === 'end') return

    const chunk = typeof data?.data === 'string' ? data.data : data?.content || ''
    if (!chunk) return

    appendSubAgentContent(context, parentToolCallId, chunk)

    updateToolCallWithSubAgentData(context, get, set, parentToolCallId)
  },

  tool_generating: () => {
    // Tool generating event - no action needed, we'll handle the actual tool_call
  },

  tool_call: async (data, context, get, set) => {
    const parentToolCallId = context.subAgentParentToolCallId
    if (!parentToolCallId) return

    const toolData = asRecord(data?.data)
    const id: string | undefined = (toolData.id as string | undefined) || data?.toolCallId
    const name: string | undefined = (toolData.name as string | undefined) || data?.toolName
    if (!id || !name) return
    const isPartial = toolData.partial === true
    const uiMetadata = extractToolUiMetadata(toolData)
    const executionMetadata = extractToolExecutionMetadata(toolData)

    let args: Record<string, unknown> | undefined = (toolData.arguments || toolData.input) as
      | Record<string, unknown>
      | undefined

    if (typeof args === 'string') {
      try {
        args = JSON.parse(args) as Record<string, unknown>
      } catch {
        logger.warn('[SubAgent] Failed to parse arguments string', { args })
      }
    }

    logger.info('[SubAgent] tool_call received', {
      id,
      name,
      hasArgs: !!args,
      argsKeys: args ? Object.keys(args) : [],
      toolDataKeys: Object.keys(toolData),
      dataKeys: Object.keys(data ?? {}),
    })

    if (!context.subAgentToolCalls[parentToolCallId]) {
      context.subAgentToolCalls[parentToolCallId] = []
    }
    if (!context.subAgentBlocks[parentToolCallId]) {
      context.subAgentBlocks[parentToolCallId] = []
    }

    const existingIndex = context.subAgentToolCalls[parentToolCallId].findIndex(
      (tc: CopilotToolCall) => tc.id === id
    )
    const existingToolCall =
      existingIndex >= 0 ? context.subAgentToolCalls[parentToolCallId][existingIndex] : undefined

    const serverState = toolData.state
    let initialState = serverState
      ? mapServerStateToClientState(serverState)
      : ClientToolCallState.pending

    // Avoid flickering back to pending on partial/duplicate events once a tool is executing.
    if (
      existingToolCall?.state === ClientToolCallState.executing &&
      initialState === ClientToolCallState.pending
    ) {
      initialState = ClientToolCallState.executing
    }

    const subAgentToolCall: CopilotToolCall = {
      id,
      name,
      state: initialState,
      ui: uiMetadata,
      execution: executionMetadata,
      ...(args ? { params: args } : {}),
      display: resolveToolDisplay(name, initialState, id, args),
    }

    if (existingIndex >= 0) {
      context.subAgentToolCalls[parentToolCallId][existingIndex] = subAgentToolCall
    } else {
      context.subAgentToolCalls[parentToolCallId].push(subAgentToolCall)

      context.subAgentBlocks[parentToolCallId].push({
        type: 'subagent_tool_call',
        toolCall: subAgentToolCall,
        timestamp: Date.now(),
      })
    }

    const { toolCallsById } = get()
    const updated = { ...toolCallsById, [id]: subAgentToolCall }
    set({ toolCallsById: updated })

    updateToolCallWithSubAgentData(context, get, set, parentToolCallId)

    if (isPartial) {
      return
    }

    const shouldInterrupt = subAgentToolCall.ui?.showInterrupt === true

    // Client-run capability: execution is delegated to the browser.
    // Execute immediately only for non-interrupting calls.
    if (isClientRunCapability(subAgentToolCall) && !shouldInterrupt) {
      executeRunToolOnClient(id, name, args || {})
    }
  },

  tool_result: (data, context, get, set) => {
    const parentToolCallId = context.subAgentParentToolCallId
    if (!parentToolCallId) return

    const resultData = asRecord(data?.data)
    const toolCallId: string | undefined = data?.toolCallId || (resultData.id as string | undefined)
    // Determine success: explicit `success` field takes priority; otherwise
    // infer from presence of result data vs error (same logic as server-side
    // inferToolSuccess).  The Go backend uses `*bool` with omitempty so
    // `success` is present when explicitly set, and absent for non-tool events.
    const hasExplicitSuccess = data?.success !== undefined || resultData.success !== undefined
    const explicitSuccess = data?.success ?? resultData.success
    const hasResultData = data?.result !== undefined || resultData.result !== undefined
    const hasError = !!data?.error || !!resultData.error
    const success: boolean = hasExplicitSuccess ? !!explicitSuccess : hasResultData && !hasError
    if (!toolCallId) return

    if (!context.subAgentToolCalls[parentToolCallId]) return
    if (!context.subAgentBlocks[parentToolCallId]) return

    const serverState = resultData.state
    const targetState = serverState
      ? mapServerStateToClientState(serverState)
      : success
        ? ClientToolCallState.success
        : ClientToolCallState.error
    const uiMetadata = extractToolUiMetadata(resultData)
    const executionMetadata = extractToolExecutionMetadata(resultData)
    const existingIndex = context.subAgentToolCalls[parentToolCallId].findIndex(
      (tc: CopilotToolCall) => tc.id === toolCallId
    )

    if (existingIndex >= 0) {
      const existing = context.subAgentToolCalls[parentToolCallId][existingIndex]
      let nextParams = existing.params
      const resultPayload = asRecord(
        data?.result || resultData.result || resultData.data || data?.data
      )
      if (
        targetState === ClientToolCallState.success &&
        isWorkflowChangeApplyCall(existing) &&
        resultPayload
      ) {
        const operations = extractOperationListFromResultPayload(resultPayload)
        if (operations && operations.length > 0) {
          nextParams = {
            ...(existing.params || {}),
            operations,
          }
        }
      }

      const updatedSubAgentToolCall = {
        ...existing,
        params: nextParams,
        ui: uiMetadata || existing.ui,
        execution: executionMetadata || existing.execution,
        state: targetState,
        display: resolveToolDisplay(existing.name, targetState, toolCallId, nextParams),
      }
      context.subAgentToolCalls[parentToolCallId][existingIndex] = updatedSubAgentToolCall

      for (const block of context.subAgentBlocks[parentToolCallId]) {
        if (block.type === 'subagent_tool_call' && block.toolCall?.id === toolCallId) {
          block.toolCall = updatedSubAgentToolCall
          break
        }
      }

      const { toolCallsById } = get()
      if (toolCallsById[toolCallId]) {
        const updatedMap = {
          ...toolCallsById,
          [toolCallId]: updatedSubAgentToolCall,
        }
        set({ toolCallsById: updatedMap })
        logger.info('[SubAgent] Updated subagent tool call state in toolCallsById', {
          toolCallId,
          name: existing.name,
          state: targetState,
        })
      }

      if (
        targetState === ClientToolCallState.success &&
        resultPayload &&
        isWorkflowChangeApplyCall(updatedSubAgentToolCall)
      ) {
        const workflowState = extractWorkflowStateFromResultPayload(resultPayload)
        if (workflowState) {
          const diffStore = useWorkflowDiffStore.getState()
          diffStore.setProposedChanges(workflowState).catch((error) => {
            logger.error('[SubAgent] Failed to apply workflow_change diff', {
              error: error instanceof Error ? error.message : String(error),
              toolCallId,
            })
          })
        }
      }
    }

    updateToolCallWithSubAgentData(context, get, set, parentToolCallId)
  },

  done: (_data, context, get, set) => {
    const parentToolCallId = context.subAgentParentToolCallId
    if (!parentToolCallId) return

    updateToolCallWithSubAgentData(context, get, set, parentToolCallId)
  },
}

export async function applySseEvent(
  rawData: SSEEvent,
  context: ClientStreamingContext,
  get: () => CopilotStore,
  set: (next: Partial<CopilotStore> | ((state: CopilotStore) => Partial<CopilotStore>)) => void
): Promise<boolean> {
  const normalizedEvent = normalizeSseEvent(rawData)
  if (shouldSkipToolCallEvent(normalizedEvent) || shouldSkipToolResultEvent(normalizedEvent)) {
    return true
  }
  const data = normalizedEvent

  if (data.type === 'subagent_start') {
    const startData = asRecord(data.data)
    const toolCallId = startData.tool_call_id as string | undefined
    if (toolCallId) {
      context.subAgentParentToolCallId = toolCallId
      const { toolCallsById } = get()
      const parentToolCall = toolCallsById[toolCallId]
      if (parentToolCall) {
        const updatedToolCall: CopilotToolCall = {
          ...parentToolCall,
          subAgentStreaming: true,
        }
        const updatedMap = { ...toolCallsById, [toolCallId]: updatedToolCall }
        set({ toolCallsById: updatedMap })
      }
      logger.info('[SSE] Subagent session started', {
        subagent: data.subagent,
        parentToolCallId: toolCallId,
      })
    }
    return true
  }

  if (data.type === 'subagent_end') {
    const parentToolCallId = context.subAgentParentToolCallId
    if (parentToolCallId) {
      const { toolCallsById } = get()
      const parentToolCall = toolCallsById[parentToolCallId]
      if (parentToolCall) {
        const updatedToolCall: CopilotToolCall = {
          ...parentToolCall,
          subAgentContent: context.subAgentContent[parentToolCallId] || '',
          subAgentToolCalls: context.subAgentToolCalls[parentToolCallId] ?? [],
          subAgentBlocks: context.subAgentBlocks[parentToolCallId] ?? [],
          subAgentStreaming: false,
        }
        const updatedMap = { ...toolCallsById, [parentToolCallId]: updatedToolCall }
        set({ toolCallsById: updatedMap })
        logger.info('[SSE] Subagent session ended', {
          subagent: data.subagent,
          parentToolCallId,
          contentLength: context.subAgentContent[parentToolCallId]?.length || 0,
          toolCallCount: context.subAgentToolCalls[parentToolCallId]?.length || 0,
        })
      }
    }
    context.subAgentParentToolCallId = undefined
    return true
  }

  if (data.subagent) {
    const parentToolCallId = context.subAgentParentToolCallId
    if (!parentToolCallId) {
      logger.warn('[SSE] Subagent event without parent tool call ID', {
        type: data.type,
        subagent: data.subagent,
      })
      return true
    }

    logger.info('[SSE] Processing subagent event', {
      type: data.type,
      subagent: data.subagent,
      parentToolCallId,
      hasHandler: !!subAgentSSEHandlers[data.type],
    })

    const subAgentHandler = subAgentSSEHandlers[data.type]
    if (subAgentHandler) {
      await subAgentHandler(data, context, get, set)
    } else {
      logger.warn('[SSE] No handler for subagent event type', { type: data.type })
    }
    return !context.streamComplete
  }

  const handler = sseHandlers[data.type] || sseHandlers.default
  await handler(data, context, get, set)
  return !context.streamComplete
}
