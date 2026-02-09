import { createLogger } from '@sim/logger'
import { STREAM_STORAGE_KEY } from '@/lib/copilot/constants'
import { asRecord } from '@/lib/copilot/orchestrator/sse-utils'
import type { SSEEvent } from '@/lib/copilot/orchestrator/types'
import {
  isBackgroundState,
  isRejectedState,
  isReviewState,
  resolveToolDisplay,
} from '@/lib/copilot/store-utils'
import { ClientToolCallState } from '@/lib/copilot/tools/client/tool-display-registry'
import type { CopilotStore, CopilotStreamInfo, CopilotToolCall } from '@/stores/panel/copilot/types'
import { useEnvironmentStore } from '@/stores/settings/environment/store'
import { useVariablesStore } from '@/stores/panel/variables/store'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import { appendTextBlock, beginThinkingBlock, finalizeThinkingBlock } from './content-blocks'
import type { ClientContentBlock, ClientStreamingContext } from './types'

const logger = createLogger('CopilotClientSseHandlers')
const TEXT_BLOCK_TYPE = 'text'
const MAX_BATCH_INTERVAL = 50
const MIN_BATCH_INTERVAL = 16
const MAX_QUEUE_SIZE = 5

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
        data?.toolCallId || (eventData.id as string | undefined)
      const success: boolean | undefined = data?.success
      const failedDependency: boolean = data?.failedDependency === true
      const resultObj = asRecord(data?.result)
      const skipped: boolean = resultObj.skipped === true
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
        const targetState = success
          ? ClientToolCallState.success
          : failedDependency || skipped
            ? ClientToolCallState.rejected
            : ClientToolCallState.error
        const updatedMap = { ...toolCallsById }
        updatedMap[toolCallId] = {
          ...current,
          state: targetState,
          display: resolveToolDisplay(current.name, targetState, current.id, current.params),
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

        if (current.name === 'edit_workflow') {
          try {
            const resultPayload = asRecord(
              data?.result || eventData.result || eventData.data || data?.data
            )
            const workflowState = asRecord(resultPayload?.workflowState)
            const hasWorkflowState = !!resultPayload?.workflowState
            logger.info('[SSE] edit_workflow result received', {
              hasWorkflowState,
              blockCount: hasWorkflowState ? Object.keys(workflowState.blocks ?? {}).length : 0,
              edgeCount: Array.isArray(workflowState.edges) ? workflowState.edges.length : 0,
            })
            if (hasWorkflowState) {
              const diffStore = useWorkflowDiffStore.getState()
              diffStore
                .setProposedChanges(resultPayload.workflowState as WorkflowState)
                .catch((err) => {
                  logger.error('[SSE] Failed to apply edit_workflow diff', {
                    error: err instanceof Error ? err.message : String(err),
                  })
                })
            }
          } catch (err) {
            logger.error('[SSE] edit_workflow result handling failed', {
              error: err instanceof Error ? err.message : String(err),
            })
          }
        }

        // Deploy tools: update deployment status in workflow registry
        if (
          targetState === ClientToolCallState.success &&
          (current.name === 'deploy_api' ||
            current.name === 'deploy_chat' ||
            current.name === 'deploy_mcp' ||
            current.name === 'redeploy')
        ) {
          try {
            const resultPayload = asRecord(
              data?.result || eventData.result || eventData.data || data?.data
            )
            const input = asRecord(current.params)
            const workflowId =
              (resultPayload?.workflowId as string) ||
              (input?.workflowId as string) ||
              useWorkflowRegistry.getState().activeWorkflowId
            const isDeployed = resultPayload?.isDeployed !== false
            if (workflowId) {
              useWorkflowRegistry
                .getState()
                .setDeploymentStatus(workflowId, isDeployed, isDeployed ? new Date() : undefined)
              logger.info('[SSE] Updated deployment status from tool result', {
                toolName: current.name,
                workflowId,
                isDeployed,
              })
            }
          } catch (err) {
            logger.warn('[SSE] Failed to hydrate deployment status', {
              error: err instanceof Error ? err.message : String(err),
            })
          }
        }

        // Environment variables: reload store after successful set
        if (
          targetState === ClientToolCallState.success &&
          current.name === 'set_environment_variables'
        ) {
          try {
            useEnvironmentStore.getState().loadEnvironmentVariables()
            logger.info('[SSE] Triggered environment variables reload')
          } catch (err) {
            logger.warn('[SSE] Failed to reload environment variables', {
              error: err instanceof Error ? err.message : String(err),
            })
          }
        }

        // Workflow variables: reload store after successful set
        if (
          targetState === ClientToolCallState.success &&
          current.name === 'set_global_workflow_variables'
        ) {
          try {
            const input = asRecord(current.params)
            const workflowId =
              (input?.workflowId as string) || useWorkflowRegistry.getState().activeWorkflowId
            if (workflowId) {
              useVariablesStore.getState().loadForWorkflow(workflowId)
              logger.info('[SSE] Triggered workflow variables reload', { workflowId })
            }
          } catch (err) {
            logger.warn('[SSE] Failed to reload workflow variables', {
              error: err instanceof Error ? err.message : String(err),
            })
          }
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
          context.contentBlocks[i] = {
            ...b,
            toolCall: {
              ...b.toolCall,
              state: targetState,
              display: resolveToolDisplay(
                b.toolCall?.name,
                targetState,
                toolCallId,
                b.toolCall?.params
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
        data?.toolCallId || (errorData.id as string | undefined)
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
        const targetState = failedDependency
          ? ClientToolCallState.rejected
          : ClientToolCallState.error
        const updatedMap = { ...toolCallsById }
        updatedMap[toolCallId] = {
          ...current,
          state: targetState,
          display: resolveToolDisplay(current.name, targetState, current.id, current.params),
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
          const targetState = failedDependency
            ? ClientToolCallState.rejected
            : ClientToolCallState.error
          context.contentBlocks[i] = {
            ...b,
            toolCall: {
              ...b.toolCall,
              state: targetState,
              display: resolveToolDisplay(
                b.toolCall?.name,
                targetState,
                toolCallId,
                b.toolCall?.params
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
    const { toolCallId, toolName } = data
    if (!toolCallId || !toolName) return
    const { toolCallsById } = get()

    if (!toolCallsById[toolCallId]) {
      const initialState = ClientToolCallState.pending
      const tc: CopilotToolCall = {
        id: toolCallId,
        name: toolName,
        state: initialState,
        display: resolveToolDisplay(toolName, initialState, toolCallId),
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
    const id: string | undefined = (toolData.id as string | undefined) || data?.toolCallId
    const name: string | undefined = (toolData.name as string | undefined) || data?.toolName
    if (!id) return
    const args = toolData.arguments as Record<string, unknown> | undefined
    const isPartial = toolData.partial === true
    const { toolCallsById } = get()

    const existing = toolCallsById[id]
    const next: CopilotToolCall = existing
      ? {
          ...existing,
          state: ClientToolCallState.pending,
          ...(args ? { params: args } : {}),
          display: resolveToolDisplay(name, ClientToolCallState.pending, id, args),
        }
      : {
          id,
          name: name || 'unknown_tool',
          state: ClientToolCallState.pending,
          ...(args ? { params: args } : {}),
          display: resolveToolDisplay(name, ClientToolCallState.pending, id, args),
        }
    const updated = { ...toolCallsById, [id]: next }
    set({ toolCallsById: updated })
    logger.info('[toolCallsById] → pending', { id, name, params: args })

    upsertToolCallBlock(context, next)
    updateStreamingMessage(set, context)

    if (isPartial) {
      return
    }

    // OAuth: dispatch event to open the OAuth connect modal
    if (name === 'oauth_request_access' && args && typeof window !== 'undefined') {
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
