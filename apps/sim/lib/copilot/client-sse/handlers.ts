import { createLogger } from '@sim/logger'
import { ClientToolCallState } from '@/lib/copilot/tools/client/tool-display-registry'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import type { CopilotStore, CopilotToolCall } from '@/stores/panel/copilot/types'
import {
  appendTextBlock,
  beginThinkingBlock,
  finalizeThinkingBlock,
} from './content-blocks'
import type { StreamingContext } from './types'
import {
  isBackgroundState,
  isRejectedState,
  isReviewState,
  resolveToolDisplay,
} from '@/lib/copilot/store-utils'

const logger = createLogger('CopilotClientSseHandlers')
const STREAM_STORAGE_KEY = 'copilot_active_stream'
const TEXT_BLOCK_TYPE = 'text'
const MAX_BATCH_INTERVAL = 50
const MIN_BATCH_INTERVAL = 16
const MAX_QUEUE_SIZE = 5

function writeActiveStreamToStorage(info: any): void {
  if (typeof window === 'undefined') return
  try {
    if (!info) {
      window.sessionStorage.removeItem(STREAM_STORAGE_KEY)
      return
    }
    window.sessionStorage.setItem(STREAM_STORAGE_KEY, JSON.stringify(info))
  } catch {}
}

export type SSEHandler = (
  data: any,
  context: StreamingContext,
  get: () => CopilotStore,
  set: any
) => Promise<void> | void

const streamingUpdateQueue = new Map<string, StreamingContext>()
let streamingUpdateRAF: number | null = null
let lastBatchTime = 0

export function stopStreamingUpdates() {
  if (streamingUpdateRAF !== null) {
    cancelAnimationFrame(streamingUpdateRAF)
    streamingUpdateRAF = null
  }
  streamingUpdateQueue.clear()
}

function createOptimizedContentBlocks(contentBlocks: any[]): any[] {
  const result: any[] = new Array(contentBlocks.length)
  for (let i = 0; i < contentBlocks.length; i++) {
    const block = contentBlocks[i]
    result[i] = { ...block }
  }
  return result
}

export function flushStreamingUpdates(set: any) {
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
              update.contentBlocks.length > 0 ? createOptimizedContentBlocks(update.contentBlocks) : [],
          }
        }
        return msg
      }),
    }
  })
}

export function updateStreamingMessage(set: any, context: StreamingContext) {
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

export function upsertToolCallBlock(context: StreamingContext, toolCall: CopilotToolCall) {
  let found = false
  for (let i = 0; i < context.contentBlocks.length; i++) {
    const b = context.contentBlocks[i] as any
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

function appendThinkingContent(context: StreamingContext, text: string) {
  if (!text) return
  const cleanedText = stripThinkingTags(text)
  if (!cleanedText) return
  if (context.currentThinkingBlock) {
    context.currentThinkingBlock.content += cleanedText
  } else {
    context.currentThinkingBlock = { type: '', content: '', timestamp: 0, toolCall: null }
    context.currentThinkingBlock.type = 'thinking'
    context.currentThinkingBlock.content = cleanedText
    context.currentThinkingBlock.timestamp = Date.now()
    context.currentThinkingBlock.startTime = Date.now()
    context.contentBlocks.push(context.currentThinkingBlock)
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
      const toolCallId: string | undefined = data?.toolCallId || data?.data?.id
      const success: boolean | undefined = data?.success
      const failedDependency: boolean = data?.failedDependency === true
      const skipped: boolean = data?.result?.skipped === true
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
          display: resolveToolDisplay(
            current.name,
            targetState,
            current.id,
            (current as any).params
          ),
        }
        set({ toolCallsById: updatedMap })

        if (targetState === ClientToolCallState.success && current.name === 'checkoff_todo') {
          try {
            const result = (data?.result || data?.data?.result) ?? {}
            const input = ((current as any).params || (current as any).input) ?? {}
            const todoId = input.id || input.todoId || result.id || result.todoId
            if (todoId) {
              get().updatePlanTodoStatus(todoId, 'completed')
            }
          } catch {}
        }

        if (
          targetState === ClientToolCallState.success &&
          current.name === 'mark_todo_in_progress'
        ) {
          try {
            const result = (data?.result || data?.data?.result) ?? {}
            const input = ((current as any).params || (current as any).input) ?? {}
            const todoId = input.id || input.todoId || result.id || result.todoId
            if (todoId) {
              get().updatePlanTodoStatus(todoId, 'executing')
            }
          } catch {}
        }

        if (current.name === 'edit_workflow') {
          try {
            const resultPayload =
              (data?.result || data?.data?.result || data?.data?.data || data?.data) ?? {}
            const workflowState = resultPayload?.workflowState
            logger.info('[SSE] edit_workflow result received', {
              hasWorkflowState: !!workflowState,
              blockCount: workflowState ? Object.keys(workflowState.blocks ?? {}).length : 0,
              edgeCount: workflowState?.edges?.length ?? 0,
            })
            if (workflowState) {
              const diffStore = useWorkflowDiffStore.getState()
              diffStore.setProposedChanges(workflowState).catch((err) => {
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
      }

      for (let i = 0; i < context.contentBlocks.length; i++) {
        const b = context.contentBlocks[i] as any
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
    } catch {}
  },
  tool_error: (data, context, get, set) => {
    try {
      const toolCallId: string | undefined = data?.toolCallId || data?.data?.id
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
          display: resolveToolDisplay(
            current.name,
            targetState,
            current.id,
            (current as any).params
          ),
        }
        set({ toolCallsById: updatedMap })
      }
      for (let i = 0; i < context.contentBlocks.length; i++) {
        const b = context.contentBlocks[i] as any
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
    } catch {}
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
    const toolData = data?.data ?? {}
    const id: string | undefined = toolData.id || data?.toolCallId
    const name: string | undefined = toolData.name || data?.toolName
    if (!id) return
    const args = toolData.arguments
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
