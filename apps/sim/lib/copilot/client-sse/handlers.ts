import { createLogger } from '@sim/logger'
import { STREAM_STORAGE_KEY } from '@/lib/copilot/constants'
import { asRecord } from '@/lib/copilot/orchestrator/sse-utils'
import type { SSEEvent } from '@/lib/copilot/orchestrator/types'
import {
  humanizedFallback,
  isBackgroundState,
  isRejectedState,
  isReviewState,
  resolveToolDisplay,
} from '@/lib/copilot/store-utils'
import { ClientToolCallState } from '@/lib/copilot/tools/client/tool-display-registry'
import type { CopilotStore, CopilotStreamInfo, CopilotToolCall } from '@/stores/panel/copilot/types'
import { appendTextBlock, beginThinkingBlock, finalizeThinkingBlock } from './content-blocks'
import { CLIENT_EXECUTABLE_RUN_TOOLS, executeRunToolOnClient } from './run-tool-execution'
import { applyToolEffects } from './tool-effects'
import type { ClientContentBlock, ClientStreamingContext } from './types'

const logger = createLogger('CopilotClientSseHandlers')
const TEXT_BLOCK_TYPE = 'text'

const MAX_BATCH_INTERVAL = 50
const MIN_BATCH_INTERVAL = 16
const MAX_QUEUE_SIZE = 5

function isClientRunCapability(toolCall: CopilotToolCall): boolean {
  if (toolCall.execution?.target === 'sim_client_capability') {
    return toolCall.execution.capabilityId === 'workflow.run' || !toolCall.execution.capabilityId
  }
  return CLIENT_EXECUTABLE_RUN_TOOLS.has(toolCall.name)
}

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

function displayVerb(state: ClientToolCallState): string {
  switch (state) {
    case ClientToolCallState.success:
      return 'Completed'
    case ClientToolCallState.error:
      return 'Failed'
    case ClientToolCallState.rejected:
      return 'Skipped'
    case ClientToolCallState.aborted:
      return 'Aborted'
    case ClientToolCallState.generating:
      return 'Preparing'
    case ClientToolCallState.pending:
      return 'Waiting'
    default:
      return 'Running'
  }
}

function resolveDisplayFromServerUi(
  toolName: string,
  state: ClientToolCallState,
  toolCallId: string,
  params: Record<string, unknown> | undefined,
  ui?: CopilotToolCall['ui']
) {
  const fallback =
    resolveToolDisplay(toolName, state, toolCallId, params) ||
    humanizedFallback(toolName, state)
  if (!fallback) return undefined
  if (ui?.phaseLabel) {
    return { text: ui.phaseLabel, icon: fallback.icon }
  }
  if (ui?.title) {
    return { text: `${displayVerb(state)} ${ui.title}`, icon: fallback.icon }
  }
  return fallback
}

function isWorkflowChangeApplyCall(toolName?: string, params?: Record<string, unknown>): boolean {
  if (toolName !== 'workflow_change') return false
  const mode = typeof params?.mode === 'string' ? params.mode.toLowerCase() : ''
  if (mode === 'apply') return true
  return typeof params?.proposalId === 'string' && params.proposalId.length > 0
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

function writeActiveStreamToStorage(info: CopilotStreamInfo | null): void {
  if (typeof window === 'undefined') return
  try {
    if (!info) {
      window.sessionStorage.removeItem(STREAM_STORAGE_KEY)
      return
    }
    window.sessionStorage.setItem(STREAM_STORAGE_KEY, JSON.stringify(info))
  } catch (error) {
    logger.warn('Failed to write active stream to storage', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

type StoreSet = (
  partial: Partial<CopilotStore> | ((state: CopilotStore) => Partial<CopilotStore>)
) => void

export type SSEHandler = (
  data: SSEEvent,
  context: ClientStreamingContext,
  get: () => CopilotStore,
  set: StoreSet
) => Promise<void> | void

const streamingUpdateQueue = new Map<string, ClientStreamingContext>()
let streamingUpdateRAF: number | null = null
let lastBatchTime = 0

export function stopStreamingUpdates() {
  if (streamingUpdateRAF !== null) {
    cancelAnimationFrame(streamingUpdateRAF)
    streamingUpdateRAF = null
  }
  streamingUpdateQueue.clear()
}

function createOptimizedContentBlocks(contentBlocks: ClientContentBlock[]): ClientContentBlock[] {
  const result: ClientContentBlock[] = new Array(contentBlocks.length)
  for (let i = 0; i < contentBlocks.length; i++) {
    const block = contentBlocks[i]
    result[i] = { ...block }
  }
  return result
}

export function flushStreamingUpdates(set: StoreSet) {
  if (streamingUpdateRAF !== null) {
    cancelAnimationFrame(streamingUpdateRAF)
    streamingUpdateRAF = null
  }
  if (streamingUpdateQueue.size === 0) return

  const updates = new Map(streamingUpdateQueue)
  streamingUpdateQueue.clear()

  set((state: CopilotStore) => {
    if (updates.size === 0) return state
    return {
      messages: state.messages.map((msg) => {
        const update = updates.get(msg.id)
        if (update) {
          return {
            ...msg,
            content: '',
            contentBlocks:
              update.contentBlocks.length > 0
                ? createOptimizedContentBlocks(update.contentBlocks)
                : [],
          }
        }
        return msg
      }),
    }
  })
}

export function updateStreamingMessage(set: StoreSet, context: ClientStreamingContext) {
  if (context.suppressStreamingUpdates) return
  const now = performance.now()
  streamingUpdateQueue.set(context.messageId, context)
  const timeSinceLastBatch = now - lastBatchTime
  const shouldFlushImmediately =
    streamingUpdateQueue.size >= MAX_QUEUE_SIZE || timeSinceLastBatch > MAX_BATCH_INTERVAL

  if (streamingUpdateRAF === null) {
    const scheduleUpdate = () => {
      streamingUpdateRAF = requestAnimationFrame(() => {
        const updates = new Map(streamingUpdateQueue)
        streamingUpdateQueue.clear()
        streamingUpdateRAF = null
        lastBatchTime = performance.now()
        set((state: CopilotStore) => {
          if (updates.size === 0) return state
          const messages = state.messages
          const lastMessage = messages[messages.length - 1]
          const lastMessageUpdate = lastMessage ? updates.get(lastMessage.id) : null
          if (updates.size === 1 && lastMessageUpdate) {
            const newMessages = [...messages]
            newMessages[messages.length - 1] = {
              ...lastMessage,
              content: '',
              contentBlocks:
                lastMessageUpdate.contentBlocks.length > 0
                  ? createOptimizedContentBlocks(lastMessageUpdate.contentBlocks)
                  : [],
            }
            return { messages: newMessages }
          }
          return {
            messages: messages.map((msg) => {
              const update = updates.get(msg.id)
              if (update) {
                return {
                  ...msg,
                  content: '',
                  contentBlocks:
                    update.contentBlocks.length > 0
                      ? createOptimizedContentBlocks(update.contentBlocks)
                      : [],
                }
              }
              return msg
            }),
          }
        })
      })
    }
    if (shouldFlushImmediately) scheduleUpdate()
    else setTimeout(scheduleUpdate, Math.max(0, MIN_BATCH_INTERVAL - timeSinceLastBatch))
  }
}

export function upsertToolCallBlock(context: ClientStreamingContext, toolCall: CopilotToolCall) {
  let found = false
  for (let i = 0; i < context.contentBlocks.length; i++) {
    const b = context.contentBlocks[i]
    if (b.type === 'tool_call' && b.toolCall?.id === toolCall.id) {
      context.contentBlocks[i] = { ...b, toolCall }
      found = true
      break
    }
  }
  if (!found) {
    context.contentBlocks.push({ type: 'tool_call', toolCall, timestamp: Date.now() })
  }
}

function stripThinkingTags(text: string): string {
  return text.replace(/<\/?thinking[^>]*>/gi, '').replace(/&lt;\/?thinking[^&]*&gt;/gi, '')
}

function appendThinkingContent(context: ClientStreamingContext, text: string) {
  if (!text) return
  const cleanedText = stripThinkingTags(text)
  if (!cleanedText) return
  if (context.currentThinkingBlock) {
    context.currentThinkingBlock.content += cleanedText
  } else {
    const newBlock: ClientContentBlock = {
      type: 'thinking',
      content: cleanedText,
      timestamp: Date.now(),
      startTime: Date.now(),
    }
    context.currentThinkingBlock = newBlock
    context.contentBlocks.push(newBlock)
  }
  context.isInThinkingBlock = true
  context.currentTextBlock = null
}

export const sseHandlers: Record<string, SSEHandler> = {
  chat_id: async (data, context, get, set) => {
    context.newChatId = data.chatId
    const { currentChat, activeStream } = get()
    if (!currentChat && context.newChatId) {
      await get().handleNewChatCreation(context.newChatId)
    }
    if (activeStream && context.newChatId && !activeStream.chatId) {
      const updatedStream = { ...activeStream, chatId: context.newChatId }
      set({ activeStream: updatedStream })
      writeActiveStreamToStorage(updatedStream)
    }
  },
  title_updated: (_data, _context, get, set) => {
    const title = _data.title
    if (!title) return
    const { currentChat, chats } = get()
    if (currentChat) {
      set({
        currentChat: { ...currentChat, title },
        chats: chats.map((c) => (c.id === currentChat.id ? { ...c, title } : c)),
      })
    }
  },
  tool_result: (data, context, get, set) => {
    try {
      const eventData = asRecord(data?.data)
      const toolCallId: string | undefined =
        data?.toolCallId ||
        (eventData.id as string | undefined) ||
        (eventData.callId as string | undefined)
      const success: boolean | undefined = data?.success
      const failedDependency: boolean = data?.failedDependency === true
      const resultObj = asRecord(data?.result)
      const skipped: boolean = resultObj.skipped === true
      if (!toolCallId) return
      const uiMetadata = extractToolUiMetadata(eventData)
      const executionMetadata = extractToolExecutionMetadata(eventData)
      const serverState = (eventData.state as string | undefined) || undefined
      const targetState = serverState
        ? mapServerStateToClientState(serverState)
        : success
          ? ClientToolCallState.success
          : failedDependency || skipped
            ? ClientToolCallState.rejected
            : ClientToolCallState.error
      const resultPayload = asRecord(data?.result || eventData.result || eventData.data || data?.data)
      const { toolCallsById } = get()
      const current = toolCallsById[toolCallId]
      let paramsForCurrentToolCall: Record<string, unknown> | undefined = current?.params
      if (current) {
        if (
          isRejectedState(current.state) ||
          isReviewState(current.state) ||
          isBackgroundState(current.state)
        ) {
          return
        }
        if (
          targetState === ClientToolCallState.success &&
          isWorkflowChangeApplyCall(current.name, paramsForCurrentToolCall)
        ) {
          const operations = extractOperationListFromResultPayload(resultPayload || {})
          if (operations && operations.length > 0) {
            paramsForCurrentToolCall = {
              ...(current.params || {}),
              operations,
            }
          }
        }

        const updatedMap = { ...toolCallsById }
        updatedMap[toolCallId] = {
          ...current,
          ui: uiMetadata || current.ui,
          execution: executionMetadata || current.execution,
          params: paramsForCurrentToolCall,
          state: targetState,
          display: resolveDisplayFromServerUi(
            current.name,
            targetState,
            current.id,
            paramsForCurrentToolCall,
            uiMetadata || current.ui
          ),
        }
        set({ toolCallsById: updatedMap })

        if (targetState === ClientToolCallState.success && current.name === 'checkoff_todo') {
          try {
            const result = asRecord(data?.result) || asRecord(eventData.result)
            const input = asRecord(current.params || current.input)
            const todoId = (input.id || input.todoId || result.id || result.todoId) as
              | string
              | undefined
            if (todoId) {
              get().updatePlanTodoStatus(todoId, 'completed')
            }
          } catch (error) {
            logger.warn('Failed to process checkoff_todo tool result', {
              error: error instanceof Error ? error.message : String(error),
              toolCallId,
            })
          }
        }

        if (
          targetState === ClientToolCallState.success &&
          current.name === 'mark_todo_in_progress'
        ) {
          try {
            const result = asRecord(data?.result) || asRecord(eventData.result)
            const input = asRecord(current.params || current.input)
            const todoId = (input.id || input.todoId || result.id || result.todoId) as
              | string
              | undefined
            if (todoId) {
              get().updatePlanTodoStatus(todoId, 'executing')
            }
          } catch (error) {
            logger.warn('Failed to process mark_todo_in_progress tool result', {
              error: error instanceof Error ? error.message : String(error),
              toolCallId,
            })
          }
        }

        if (targetState === ClientToolCallState.success) {
          applyToolEffects({
            effectsRaw: eventData.effects,
            toolCall: updatedMap[toolCallId],
            resultPayload,
          })
        }
      }

      for (let i = 0; i < context.contentBlocks.length; i++) {
        const b = context.contentBlocks[i]
        if (b?.type === 'tool_call' && b?.toolCall?.id === toolCallId) {
          if (
            isRejectedState(b.toolCall?.state) ||
            isReviewState(b.toolCall?.state) ||
            isBackgroundState(b.toolCall?.state)
          )
            break
          const targetState = success
            ? ClientToolCallState.success
            : failedDependency || skipped
              ? ClientToolCallState.rejected
              : ClientToolCallState.error
          const paramsForBlock =
            b.toolCall?.id === toolCallId
              ? paramsForCurrentToolCall || b.toolCall?.params
              : b.toolCall?.params
          context.contentBlocks[i] = {
            ...b,
            toolCall: {
              ...b.toolCall,
              params: paramsForBlock,
              ui: uiMetadata || b.toolCall?.ui,
              execution: executionMetadata || b.toolCall?.execution,
              state: targetState,
              display: resolveDisplayFromServerUi(
                b.toolCall?.name,
                targetState,
                toolCallId,
                paramsForBlock,
                uiMetadata || b.toolCall?.ui
              ),
            },
          }
          break
        }
      }
      updateStreamingMessage(set, context)
    } catch (error) {
      logger.warn('Failed to process tool_result SSE event', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  },
  tool_error: (data, context, get, set) => {
    try {
      const errorData = asRecord(data?.data)
      const toolCallId: string | undefined =
        data?.toolCallId ||
        (errorData.id as string | undefined) ||
        (errorData.callId as string | undefined)
      const failedDependency: boolean = data?.failedDependency === true
      if (!toolCallId) return
      const { toolCallsById } = get()
      const current = toolCallsById[toolCallId]
      if (current) {
        if (
          isRejectedState(current.state) ||
          isReviewState(current.state) ||
          isBackgroundState(current.state)
        ) {
          return
        }
        const targetState = errorData.state
          ? mapServerStateToClientState(errorData.state)
          : failedDependency
            ? ClientToolCallState.rejected
            : ClientToolCallState.error
        const uiMetadata = extractToolUiMetadata(errorData)
        const executionMetadata = extractToolExecutionMetadata(errorData)
        const updatedMap = { ...toolCallsById }
        updatedMap[toolCallId] = {
          ...current,
          ui: uiMetadata || current.ui,
          execution: executionMetadata || current.execution,
          state: targetState,
          display: resolveDisplayFromServerUi(
            current.name,
            targetState,
            current.id,
            current.params,
            uiMetadata || current.ui
          ),
        }
        set({ toolCallsById: updatedMap })
      }
      for (let i = 0; i < context.contentBlocks.length; i++) {
        const b = context.contentBlocks[i]
        if (b?.type === 'tool_call' && b?.toolCall?.id === toolCallId) {
          if (
            isRejectedState(b.toolCall?.state) ||
            isReviewState(b.toolCall?.state) ||
            isBackgroundState(b.toolCall?.state)
          )
            break
          const targetState = errorData.state
            ? mapServerStateToClientState(errorData.state)
            : failedDependency
              ? ClientToolCallState.rejected
              : ClientToolCallState.error
          const uiMetadata = extractToolUiMetadata(errorData)
          const executionMetadata = extractToolExecutionMetadata(errorData)
          context.contentBlocks[i] = {
            ...b,
            toolCall: {
              ...b.toolCall,
              ui: uiMetadata || b.toolCall?.ui,
              execution: executionMetadata || b.toolCall?.execution,
              state: targetState,
              display: resolveDisplayFromServerUi(
                b.toolCall?.name,
                targetState,
                toolCallId,
                b.toolCall?.params,
                uiMetadata || b.toolCall?.ui
              ),
            },
          }
          break
        }
      }
      updateStreamingMessage(set, context)
    } catch (error) {
      logger.warn('Failed to process tool_error SSE event', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  },
  tool_generating: (data, context, get, set) => {
    const eventData = asRecord(data?.data)
    const toolCallId =
      data?.toolCallId ||
      (eventData.id as string | undefined) ||
      (eventData.callId as string | undefined)
    const toolName =
      data?.toolName ||
      (eventData.name as string | undefined) ||
      (eventData.toolName as string | undefined)
    if (!toolCallId || !toolName) return
    const { toolCallsById } = get()

    if (!toolCallsById[toolCallId]) {
      const initialState = ClientToolCallState.generating
      const uiMetadata = extractToolUiMetadata(eventData)
      const tc: CopilotToolCall = {
        id: toolCallId,
        name: toolName,
        state: initialState,
        ui: uiMetadata,
        execution: extractToolExecutionMetadata(eventData),
        display: resolveDisplayFromServerUi(toolName, initialState, toolCallId, undefined, uiMetadata),
      }
      const updated = { ...toolCallsById, [toolCallId]: tc }
      set({ toolCallsById: updated })
      logger.info('[toolCallsById] map updated', updated)

      upsertToolCallBlock(context, tc)
      updateStreamingMessage(set, context)
    }
  },
  tool_call: (data, context, get, set) => {
    const toolData = asRecord(data?.data)
    const id: string | undefined =
      (toolData.id as string | undefined) ||
      (toolData.callId as string | undefined) ||
      data?.toolCallId
    const name: string | undefined =
      (toolData.name as string | undefined) ||
      (toolData.toolName as string | undefined) ||
      data?.toolName
    if (!id) return
    const args = toolData.arguments as Record<string, unknown> | undefined
    const isPartial = toolData.partial === true
    const uiMetadata = extractToolUiMetadata(toolData)
    const executionMetadata = extractToolExecutionMetadata(toolData)
    const serverState = toolData.state
    const { toolCallsById } = get()

    const existing = toolCallsById[id]
    const toolName = name || existing?.name || 'unknown_tool'
    let initialState = serverState
      ? mapServerStateToClientState(serverState)
      : ClientToolCallState.pending

    // Avoid flickering back to pending on partial/duplicate events once a tool is executing.
    if (
      existing?.state === ClientToolCallState.executing &&
      initialState === ClientToolCallState.pending
    ) {
      initialState = ClientToolCallState.executing
    }

    const next: CopilotToolCall = existing
      ? {
          ...existing,
          name: toolName,
          state: initialState,
          ui: uiMetadata || existing.ui,
          execution: executionMetadata || existing.execution,
          ...(args ? { params: args } : {}),
          display: resolveDisplayFromServerUi(
            toolName,
            initialState,
            id,
            args || existing.params,
            uiMetadata || existing.ui
          ),
        }
      : {
          id,
          name: toolName,
          state: initialState,
          ui: uiMetadata,
          execution: executionMetadata,
          ...(args ? { params: args } : {}),
          display: resolveDisplayFromServerUi(toolName, initialState, id, args, uiMetadata),
        }
    const updated = { ...toolCallsById, [id]: next }
    set({ toolCallsById: updated })
    logger.info(`[toolCallsById] → ${initialState}`, { id, name: toolName, params: args })

    upsertToolCallBlock(context, next)
    updateStreamingMessage(set, context)

    if (isPartial) {
      return
    }

    const shouldInterrupt = next.ui?.showInterrupt === true

    // Client-run capability: execution is delegated to the browser.
    // We run immediately only when no interrupt is required.
    if (isClientRunCapability(next) && !shouldInterrupt) {
      executeRunToolOnClient(id, toolName, args || next.params || {})
    }

    // OAuth: dispatch event to open the OAuth connect modal
    if (toolName === 'oauth_request_access' && args && typeof window !== 'undefined') {
      try {
        window.dispatchEvent(
          new CustomEvent('open-oauth-connect', {
            detail: {
              providerName: (args.providerName || args.provider_name || '') as string,
              serviceId: (args.serviceId || args.service_id || '') as string,
              providerId: (args.providerId || args.provider_id || '') as string,
              requiredScopes: (args.requiredScopes || args.required_scopes || []) as string[],
              newScopes: (args.newScopes || args.new_scopes || []) as string[],
            },
          })
        )
        logger.info('[SSE] Dispatched OAuth connect event', {
          providerId: args.providerId || args.provider_id,
          providerName: args.providerName || args.provider_name,
        })
      } catch (err) {
        logger.warn('[SSE] Failed to dispatch OAuth connect event', {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    return
  },
  reasoning: (data, context, _get, set) => {
    const phase = (data && (data.phase || data?.data?.phase)) as string | undefined
    if (phase === 'start') {
      beginThinkingBlock(context)
      updateStreamingMessage(set, context)
      return
    }
    if (phase === 'end') {
      finalizeThinkingBlock(context)
      updateStreamingMessage(set, context)
      return
    }
    const chunk: string = typeof data?.data === 'string' ? data.data : data?.content || ''
    if (!chunk) return
    appendThinkingContent(context, chunk)
    updateStreamingMessage(set, context)
  },
  content: (data, context, get, set) => {
    if (!data.data) return
    context.pendingContent += data.data

    let contentToProcess = context.pendingContent
    let hasProcessedContent = false

    const thinkingStartRegex = /<thinking>/
    const thinkingEndRegex = /<\/thinking>/
    const designWorkflowStartRegex = /<design_workflow>/
    const designWorkflowEndRegex = /<\/design_workflow>/

    const splitTrailingPartialTag = (
      text: string,
      tags: string[]
    ): { text: string; remaining: string } => {
      const partialIndex = text.lastIndexOf('<')
      if (partialIndex < 0) {
        return { text, remaining: '' }
      }
      const possibleTag = text.substring(partialIndex)
      const matchesTagStart = tags.some((tag) => tag.startsWith(possibleTag))
      if (!matchesTagStart) {
        return { text, remaining: '' }
      }
      return {
        text: text.substring(0, partialIndex),
        remaining: possibleTag,
      }
    }

    while (contentToProcess.length > 0) {
      if (context.isInDesignWorkflowBlock) {
        const endMatch = designWorkflowEndRegex.exec(contentToProcess)
        if (endMatch) {
          const designContent = contentToProcess.substring(0, endMatch.index)
          context.designWorkflowContent += designContent
          context.isInDesignWorkflowBlock = false

          logger.info('[design_workflow] Tag complete, setting plan content', {
            contentLength: context.designWorkflowContent.length,
          })
          set({ streamingPlanContent: context.designWorkflowContent })

          contentToProcess = contentToProcess.substring(endMatch.index + endMatch[0].length)
          hasProcessedContent = true
        } else {
          const { text, remaining } = splitTrailingPartialTag(contentToProcess, [
            '</design_workflow>',
          ])
          context.designWorkflowContent += text

          set({ streamingPlanContent: context.designWorkflowContent })

          contentToProcess = remaining
          hasProcessedContent = true
          if (remaining) {
            break
          }
        }
        continue
      }

      if (!context.isInThinkingBlock && !context.isInDesignWorkflowBlock) {
        const designStartMatch = designWorkflowStartRegex.exec(contentToProcess)
        if (designStartMatch) {
          const textBeforeDesign = contentToProcess.substring(0, designStartMatch.index)
          if (textBeforeDesign) {
            appendTextBlock(context, textBeforeDesign)
            hasProcessedContent = true
          }
          context.isInDesignWorkflowBlock = true
          context.designWorkflowContent = ''
          contentToProcess = contentToProcess.substring(
            designStartMatch.index + designStartMatch[0].length
          )
          hasProcessedContent = true
          continue
        }

        const nextMarkIndex = contentToProcess.indexOf('<marktodo>')
        const nextCheckIndex = contentToProcess.indexOf('<checkofftodo>')
        const hasMark = nextMarkIndex >= 0
        const hasCheck = nextCheckIndex >= 0

        const nextTagIndex =
          hasMark && hasCheck
            ? Math.min(nextMarkIndex, nextCheckIndex)
            : hasMark
              ? nextMarkIndex
              : hasCheck
                ? nextCheckIndex
                : -1

        if (nextTagIndex >= 0) {
          const isMarkTodo = hasMark && nextMarkIndex === nextTagIndex
          const tagStart = isMarkTodo ? '<marktodo>' : '<checkofftodo>'
          const tagEnd = isMarkTodo ? '</marktodo>' : '</checkofftodo>'
          const closingIndex = contentToProcess.indexOf(tagEnd, nextTagIndex + tagStart.length)

          if (closingIndex === -1) {
            break
          }

          const todoId = contentToProcess
            .substring(nextTagIndex + tagStart.length, closingIndex)
            .trim()
          logger.info(
            isMarkTodo ? '[TODO] Detected marktodo tag' : '[TODO] Detected checkofftodo tag',
            { todoId }
          )

          if (todoId) {
            try {
              get().updatePlanTodoStatus(todoId, isMarkTodo ? 'executing' : 'completed')
              logger.info(
                isMarkTodo
                  ? '[TODO] Successfully marked todo in progress'
                  : '[TODO] Successfully checked off todo',
                { todoId }
              )
            } catch (e) {
              logger.error(
                isMarkTodo
                  ? '[TODO] Failed to mark todo in progress'
                  : '[TODO] Failed to checkoff todo',
                { todoId, error: e }
              )
            }
          } else {
            logger.warn('[TODO] Empty todoId extracted from todo tag', { tagType: tagStart })
          }

          let beforeTag = contentToProcess.substring(0, nextTagIndex)
          let afterTag = contentToProcess.substring(closingIndex + tagEnd.length)

          const hadNewlineBefore = /(\r?\n)+$/.test(beforeTag)
          const hadNewlineAfter = /^(\r?\n)+/.test(afterTag)

          beforeTag = beforeTag.replace(/(\r?\n)+$/, '')
          afterTag = afterTag.replace(/^(\r?\n)+/, '')

          contentToProcess =
            beforeTag + (hadNewlineBefore && hadNewlineAfter ? '\n' : '') + afterTag
          context.currentTextBlock = null
          hasProcessedContent = true
          continue
        }
      }

      if (context.isInThinkingBlock) {
        const endMatch = thinkingEndRegex.exec(contentToProcess)
        if (endMatch) {
          const thinkingContent = contentToProcess.substring(0, endMatch.index)
          appendThinkingContent(context, thinkingContent)
          finalizeThinkingBlock(context)
          contentToProcess = contentToProcess.substring(endMatch.index + endMatch[0].length)
          hasProcessedContent = true
        } else {
          const { text, remaining } = splitTrailingPartialTag(contentToProcess, ['</thinking>'])
          if (text) {
            appendThinkingContent(context, text)
            hasProcessedContent = true
          }
          contentToProcess = remaining
          if (remaining) {
            break
          }
        }
      } else {
        const startMatch = thinkingStartRegex.exec(contentToProcess)
        if (startMatch) {
          const textBeforeThinking = contentToProcess.substring(0, startMatch.index)
          if (textBeforeThinking) {
            appendTextBlock(context, textBeforeThinking)
            hasProcessedContent = true
          }
          context.isInThinkingBlock = true
          context.currentTextBlock = null
          contentToProcess = contentToProcess.substring(startMatch.index + startMatch[0].length)
          hasProcessedContent = true
        } else {
          let partialTagIndex = contentToProcess.lastIndexOf('<')

          const partialMarkTodo = contentToProcess.lastIndexOf('<marktodo')
          const partialCheckoffTodo = contentToProcess.lastIndexOf('<checkofftodo')

          if (partialMarkTodo > partialTagIndex) {
            partialTagIndex = partialMarkTodo
          }
          if (partialCheckoffTodo > partialTagIndex) {
            partialTagIndex = partialCheckoffTodo
          }

          let textToAdd = contentToProcess
          let remaining = ''
          if (partialTagIndex >= 0 && partialTagIndex > contentToProcess.length - 50) {
            textToAdd = contentToProcess.substring(0, partialTagIndex)
            remaining = contentToProcess.substring(partialTagIndex)
          }
          if (textToAdd) {
            appendTextBlock(context, textToAdd)
            hasProcessedContent = true
          }
          contentToProcess = remaining
          break
        }
      }
    }

    context.pendingContent = contentToProcess
    if (hasProcessedContent) {
      updateStreamingMessage(set, context)
    }
  },
  done: (_data, context) => {
    logger.info('[SSE] DONE EVENT RECEIVED', {
      doneEventCount: context.doneEventCount,
      data: _data,
    })
    context.doneEventCount++
    if (context.doneEventCount >= 1) {
      logger.info('[SSE] Setting streamComplete = true, stream will terminate')
      context.streamComplete = true
    }
  },
  error: (data, context, _get, set) => {
    logger.error('Stream error:', data.error)
    set((state: CopilotStore) => ({
      messages: state.messages.map((msg) =>
        msg.id === context.messageId
          ? {
              ...msg,
              content: context.accumulatedContent || 'An error occurred.',
              error: data.error,
            }
          : msg
      ),
    }))
    context.streamComplete = true
  },
  stream_end: (_data, context, _get, set) => {
    if (context.pendingContent) {
      if (context.isInThinkingBlock && context.currentThinkingBlock) {
        appendThinkingContent(context, context.pendingContent)
      } else if (context.pendingContent.trim()) {
        appendTextBlock(context, context.pendingContent)
      }
      context.pendingContent = ''
    }
    finalizeThinkingBlock(context)
    updateStreamingMessage(set, context)
  },
  default: () => {},
}
