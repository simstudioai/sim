'use client'

import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { createLogger } from '@/lib/logs/console/logger'
import { sendStreamingMessage, type CopilotChat } from '@/lib/copilot-new/api'
import type {
  CopilotMessage,
  CopilotStore,
  MessageFileAttachment,
  CopilotMode,
} from '@/stores/copilot/types'
import { ClientToolCallState } from '@/lib/copilot-new/tools/client/base-tool'
import type { CopilotToolCall } from '@/stores/copilot/types'
import { getClientTool, registerClientTool } from '@/lib/copilot-new/tools/client/manager'
import { getTool, createExecutionContext, registerTool } from '@/lib/copilot-new/tools/client/registry'
import { GetUserWorkflowTool } from '@/lib/copilot-new/tools/client/workflow/get-user-workflow'
import type { ClientToolDisplay } from '@/lib/copilot-new/tools/client/base-tool'
import { RunWorkflowClientTool } from '@/lib/copilot-new/tools/client/workflow/run-workflow'

const logger = createLogger('CopilotStore')

// Register interface-based client tools needed for auto-execution
try {
  registerTool(GetUserWorkflowTool)
  logger.info('[registry] Registered get_user_workflow tool')
} catch {}

// Constants
const TEXT_BLOCK_TYPE = 'text'
const THINKING_BLOCK_TYPE = 'thinking'
const DATA_PREFIX = 'data: '
const DATA_PREFIX_LENGTH = 6

// Resolve display text/icon for a tool based on its state
function resolveToolDisplay(
  toolName: string | undefined,
  state: ClientToolCallState,
  toolCallId?: string,
  params?: Record<string, any>
): ClientToolDisplay | undefined {
  try {
    if (toolName) {
      const def = getTool(toolName) as any
      const byState = def?.metadata?.displayNames?.[state]
      if (byState?.text || byState?.icon) {
        return { text: byState.text, icon: byState.icon }
      }
    }
  } catch {}
  try {
    if (toolCallId) {
      const instance = getClientTool(toolCallId) as any
      const display = instance?.getDisplayState?.()
      if (display?.text || display?.icon) return display
    }
  } catch {}
  return undefined
}

// Simple object pool for content blocks
class ObjectPool<T> {
  private pool: T[] = []
  private createFn: () => T
  private resetFn: (obj: T) => void

  constructor(createFn: () => T, resetFn: (obj: T) => void, initialSize = 5) {
    this.createFn = createFn
    this.resetFn = resetFn
    for (let i = 0; i < initialSize; i++) this.pool.push(createFn())
  }
  get(): T {
    const obj = this.pool.pop()
    if (obj) {
      this.resetFn(obj)
      return obj
    }
    return this.createFn()
  }
  release(obj: T): void {
    if (this.pool.length < 20) this.pool.push(obj)
  }
}

const contentBlockPool = new ObjectPool(
  () => ({ type: '', content: '', timestamp: 0, toolCall: null as any }),
  (obj) => {
    obj.type = ''
    obj.content = ''
    obj.timestamp = 0
    ;(obj as any).toolCall = null
    ;(obj as any).startTime = undefined
    ;(obj as any).duration = undefined
  }
)

// Efficient string builder
class StringBuilder {
  private parts: string[] = []
  private length = 0
  append(str: string): void {
    this.parts.push(str)
    this.length += str.length
  }
  toString(): string {
    const result = this.parts.join('')
    this.clear()
    return result
  }
  clear(): void {
    this.parts.length = 0
    this.length = 0
  }
  get size(): number {
    return this.length
  }
}

// Helpers
function createUserMessage(content: string, fileAttachments?: MessageFileAttachment[]): CopilotMessage {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content,
    timestamp: new Date().toISOString(),
    ...(fileAttachments && fileAttachments.length > 0 && { fileAttachments }),
  }
}

function createStreamingMessage(): CopilotMessage {
  return {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: '',
    timestamp: new Date().toISOString(),
  }
}

function createErrorMessage(messageId: string, content: string): CopilotMessage {
  return {
    id: messageId,
    role: 'assistant',
    content,
    timestamp: new Date().toISOString(),
    contentBlocks: [
      {
        type: 'text',
        content,
        timestamp: Date.now(),
      },
    ],
  }
}

function validateMessagesForLLM(messages: CopilotMessage[]): any[] {
  return messages.map((msg) => ({
    id: msg.id,
    role: msg.role,
    content: (msg.content || '').replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim(),
    timestamp: msg.timestamp,
    ...(msg.fileAttachments && msg.fileAttachments.length > 0 && { fileAttachments: msg.fileAttachments }),
  }))
}

// Streaming context and SSE parsing
interface StreamingContext {
  messageId: string
  accumulatedContent: StringBuilder
  contentBlocks: any[]
  currentTextBlock: any | null
  isInThinkingBlock: boolean
  currentThinkingBlock: any | null
  pendingContent: string
  newChatId?: string
  doneEventCount: number
  streamComplete?: boolean
}

type SSEHandler = (
  data: any,
  context: StreamingContext,
  get: () => CopilotStore,
  set: any
) => Promise<void> | void

const sseHandlers: Record<string, SSEHandler> = {
  chat_id: async (data, context, get) => {
    context.newChatId = data.chatId
    const { currentChat } = get()
    if (!currentChat && context.newChatId) {
      await get().handleNewChatCreation(context.newChatId)
    }
  },
  tool_generating: (data, context, get, set) => {
    const { toolCallId, toolName } = data
    if (!toolCallId || !toolName) return
    const { toolCallsById } = get()

    // Ensure class-based client tool instances are registered (for interrupts/display)
    try {
      if (toolName === 'run_workflow' && !getClientTool(toolCallId)) {
        const inst = new RunWorkflowClientTool(toolCallId)
        registerClientTool(toolCallId, inst)
      }
    } catch {}

    if (!toolCallsById[toolCallId]) {
      const tc: CopilotToolCall = {
        id: toolCallId,
        name: toolName,
        state: ClientToolCallState.generating,
        display: resolveToolDisplay(toolName, ClientToolCallState.generating, toolCallId),
      }
      const updated = { ...toolCallsById, [toolCallId]: tc }
      set({ toolCallsById: updated })
      logger.info('[toolCallsById] map updated', updated)

      // Add inline content block for this tool call so it renders in the message
      context.contentBlocks.push({ type: 'tool_call', toolCall: tc, timestamp: Date.now() })
      updateStreamingMessage(set, context)
    }
  },
  tool_call: (data, context, get, set) => {
    const toolData = data?.data || {}
    const id: string | undefined = toolData.id || data?.toolCallId
    const name: string | undefined = toolData.name || data?.toolName
    if (!id) return
    const args = toolData.arguments
    const { toolCallsById } = get()

    // Ensure class-based client tool instances are registered (for interrupts/display)
    try {
      if (name === 'run_workflow' && !getClientTool(id)) {
        const inst = new RunWorkflowClientTool(id)
        registerClientTool(id, inst)
      }
    } catch {}

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

    // Ensure an inline content block exists/updated for this tool call
    let found = false
    for (let i = 0; i < context.contentBlocks.length; i++) {
      const b = context.contentBlocks[i] as any
      if (b.type === 'tool_call' && b.toolCall?.id === id) {
        context.contentBlocks[i] = { ...b, toolCall: next }
        found = true
        break
      }
    }
    if (!found) {
      context.contentBlocks.push({ type: 'tool_call', toolCall: next, timestamp: Date.now() })
    }
    updateStreamingMessage(set, context)

    // Prefer interface-based registry to determine interrupt and execute
    try {
      const def = name ? getTool(name) : undefined
      if (def) {
        const hasInterrupt = typeof def.hasInterrupt === 'function' ? !!def.hasInterrupt(args || {}) : !!def.hasInterrupt
        if (!hasInterrupt && typeof def.execute === 'function') {
          const ctx = createExecutionContext({ toolCallId: id, toolName: name || 'unknown_tool' })
          // Defer executing transition by a tick to let pending render
          setTimeout(() => {
            const executingMap = { ...get().toolCallsById }
            executingMap[id] = {
              ...executingMap[id],
              state: ClientToolCallState.executing,
              display: resolveToolDisplay(name, ClientToolCallState.executing, id, args),
            }
            set({ toolCallsById: executingMap })
            logger.info('[toolCallsById] pending → executing (registry)', { id, name })

            // Update inline content block to executing
            for (let i = 0; i < context.contentBlocks.length; i++) {
              const b = context.contentBlocks[i] as any
              if (b.type === 'tool_call' && b.toolCall?.id === id) {
                context.contentBlocks[i] = {
                  ...b,
                  toolCall: { ...b.toolCall, state: ClientToolCallState.executing },
                }
                break
              }
            }
            updateStreamingMessage(set, context)

            Promise.resolve()
              .then(async () => {
                const result = await def.execute(ctx, args || {})
                const success = result && typeof result.status === 'number' ? result.status >= 200 && result.status < 300 : true
                const completeMap = { ...get().toolCallsById }
                completeMap[id] = {
                  ...completeMap[id],
                  state: success ? ClientToolCallState.success : ClientToolCallState.error,
                  display: resolveToolDisplay(
                    name,
                    success ? ClientToolCallState.success : ClientToolCallState.error,
                    id,
                    args
                  ),
                }
                set({ toolCallsById: completeMap })
                logger.info('[toolCallsById] executing → ' + (success ? 'success' : 'error') + ' (registry)', { id, name })

                // Update inline content block to terminal state
                for (let i = 0; i < context.contentBlocks.length; i++) {
                  const b = context.contentBlocks[i] as any
                  if (b.type === 'tool_call' && b.toolCall?.id === id) {
                    context.contentBlocks[i] = {
                      ...b,
                      toolCall: { ...b.toolCall, state: success ? ClientToolCallState.success : ClientToolCallState.error },
                    }
                    break
                  }
                }
                updateStreamingMessage(set, context)

                // Notify backend tool mark-complete endpoint
                try {
                  await fetch('/api/copilot/tools/mark-complete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      id,
                      name: name || 'unknown_tool',
                      status: typeof result?.status === 'number' ? result.status : success ? 200 : 500,
                      message: result?.message,
                      data: result?.data,
                    }),
                  })
                } catch {}
              })
              .catch((e) => {
                const errorMap = { ...get().toolCallsById }
                errorMap[id] = {
                  ...errorMap[id],
                  state: ClientToolCallState.error,
                  display: resolveToolDisplay(name, ClientToolCallState.error, id, args),
                }
                set({ toolCallsById: errorMap })
                logger.error('Registry auto-execute tool failed', { id, name, error: e })

                // Update inline content block to error
                for (let i = 0; i < context.contentBlocks.length; i++) {
                  const b = context.contentBlocks[i] as any
                  if (b.type === 'tool_call' && b.toolCall?.id === id) {
                    context.contentBlocks[i] = {
                      ...b,
                      toolCall: { ...b.toolCall, state: ClientToolCallState.error },
                    }
                    break
                  }
                }
                updateStreamingMessage(set, context)
              })
          }, 0)
          return
        }
      }
    } catch (e) {
      logger.warn('tool_call registry auto-exec check failed', { id, name, error: e })
    }

    // Fallback to legacy instance-based flow if available
    try {
      const instance = getClientTool(id) as any
      const hasInterrupt = !!instance?.getInterruptDisplays?.()
      if (!hasInterrupt && instance?.execute) {
        setTimeout(() => {
          const executingMap = { ...get().toolCallsById }
          executingMap[id] = {
            ...executingMap[id],
            state: ClientToolCallState.executing,
            display: resolveToolDisplay(name, ClientToolCallState.executing, id, args),
          }
          set({ toolCallsById: executingMap })
          logger.info('[toolCallsById] pending → executing (instance)', { id, name })

          // Update inline block
          for (let i = 0; i < context.contentBlocks.length; i++) {
            const b = context.contentBlocks[i] as any
            if (b.type === 'tool_call' && b.toolCall?.id === id) {
              context.contentBlocks[i] = {
                ...b,
                toolCall: { ...b.toolCall, state: ClientToolCallState.executing },
              }
              break
            }
          }
          updateStreamingMessage(set, context)

          Promise.resolve()
            .then(async () => {
              await instance.execute(args || {})
              const successMap = { ...get().toolCallsById }
              successMap[id] = {
                ...successMap[id],
                state: ClientToolCallState.success,
                display: resolveToolDisplay(name, ClientToolCallState.success, id, args),
              }
              set({ toolCallsById: successMap })
              logger.info('[toolCallsById] executing → success (instance)', { id, name })

              for (let i = 0; i < context.contentBlocks.length; i++) {
                const b = context.contentBlocks[i] as any
                if (b.type === 'tool_call' && b.toolCall?.id === id) {
                  context.contentBlocks[i] = {
                    ...b,
                    toolCall: { ...b.toolCall, state: ClientToolCallState.success },
                  }
                  break
                }
              }
              updateStreamingMessage(set, context)
            })
            .catch((e) => {
              const errorMap = { ...get().toolCallsById }
              errorMap[id] = {
                ...errorMap[id],
                state: ClientToolCallState.error,
                display: resolveToolDisplay(name, ClientToolCallState.error, id, args),
              }
              set({ toolCallsById: errorMap })
              logger.error('Instance auto-execute tool failed', { id, name, error: e })

              for (let i = 0; i < context.contentBlocks.length; i++) {
                const b = context.contentBlocks[i] as any
                if (b.type === 'tool_call' && b.toolCall?.id === id) {
                  context.contentBlocks[i] = {
                    ...b,
                    toolCall: { ...b.toolCall, state: ClientToolCallState.error },
                  }
                  break
                }
              }
              updateStreamingMessage(set, context)
            })
        }, 0)
      }
    } catch (e) {
      logger.warn('tool_call instance auto-exec check failed', { id, name, error: e })
    }
  },
  reasoning: (data, context, _get, set) => {
    const phase = (data && (data.phase || data?.data?.phase)) as string | undefined
    if (phase === 'start') {
      if (!context.currentThinkingBlock) {
        context.currentThinkingBlock = contentBlockPool.get()
        context.currentThinkingBlock.type = THINKING_BLOCK_TYPE
        context.currentThinkingBlock.content = ''
        context.currentThinkingBlock.timestamp = Date.now()
        ;(context.currentThinkingBlock as any).startTime = Date.now()
        context.contentBlocks.push(context.currentThinkingBlock)
      }
      context.isInThinkingBlock = true
      context.currentTextBlock = null
      updateStreamingMessage(set, context)
      return
    }
    if (phase === 'end') {
      if (context.currentThinkingBlock) {
        ;(context.currentThinkingBlock as any).duration =
          Date.now() - ((context.currentThinkingBlock as any).startTime || Date.now())
      }
      context.isInThinkingBlock = false
      context.currentThinkingBlock = null
      context.currentTextBlock = null
      updateStreamingMessage(set, context)
      return
    }
    const chunk: string = typeof data?.data === 'string' ? data.data : data?.content || ''
    if (!chunk) return
    if (context.currentThinkingBlock) {
      context.currentThinkingBlock.content += chunk
    } else {
      context.currentThinkingBlock = contentBlockPool.get()
      context.currentThinkingBlock.type = THINKING_BLOCK_TYPE
      context.currentThinkingBlock.content = chunk
      context.currentThinkingBlock.timestamp = Date.now()
      ;(context.currentThinkingBlock as any).startTime = Date.now()
      context.contentBlocks.push(context.currentThinkingBlock)
    }
    context.isInThinkingBlock = true
    context.currentTextBlock = null
    updateStreamingMessage(set, context)
  },
  content: (data, context, _get, set) => {
    if (!data.data) return
    context.pendingContent += data.data

    let contentToProcess = context.pendingContent
    let hasProcessedContent = false

    const thinkingStartRegex = /<thinking>/
    const thinkingEndRegex = /<\/thinking>/

    while (contentToProcess.length > 0) {
      if (context.isInThinkingBlock) {
        const endMatch = thinkingEndRegex.exec(contentToProcess)
        if (endMatch) {
          const thinkingContent = contentToProcess.substring(0, endMatch.index)
          if (context.currentThinkingBlock) {
            context.currentThinkingBlock.content += thinkingContent
          } else {
            context.currentThinkingBlock = contentBlockPool.get()
            context.currentThinkingBlock.type = THINKING_BLOCK_TYPE
            context.currentThinkingBlock.content = thinkingContent
            context.currentThinkingBlock.timestamp = Date.now()
            context.currentThinkingBlock.startTime = Date.now()
            context.contentBlocks.push(context.currentThinkingBlock)
          }
          context.isInThinkingBlock = false
          if (context.currentThinkingBlock) {
            context.currentThinkingBlock.duration =
              Date.now() - (context.currentThinkingBlock.startTime || Date.now())
          }
          context.currentThinkingBlock = null
          context.currentTextBlock = null
          contentToProcess = contentToProcess.substring(endMatch.index + endMatch[0].length)
          hasProcessedContent = true
        } else {
          if (context.currentThinkingBlock) {
            context.currentThinkingBlock.content += contentToProcess
          } else {
            context.currentThinkingBlock = contentBlockPool.get()
            context.currentThinkingBlock.type = THINKING_BLOCK_TYPE
            context.currentThinkingBlock.content = contentToProcess
            context.currentThinkingBlock.timestamp = Date.now()
            context.currentThinkingBlock.startTime = Date.now()
            context.contentBlocks.push(context.currentThinkingBlock)
          }
          contentToProcess = ''
          hasProcessedContent = true
        }
      } else {
        const startMatch = thinkingStartRegex.exec(contentToProcess)
        if (startMatch) {
          const textBeforeThinking = contentToProcess.substring(0, startMatch.index)
          if (textBeforeThinking) {
            context.accumulatedContent.append(textBeforeThinking)
            if (context.currentTextBlock && context.contentBlocks.length > 0) {
              const lastBlock = context.contentBlocks[context.contentBlocks.length - 1]
              if (lastBlock.type === TEXT_BLOCK_TYPE && lastBlock === context.currentTextBlock) {
                lastBlock.content += textBeforeThinking
              } else {
                context.currentTextBlock = contentBlockPool.get()
                context.currentTextBlock.type = TEXT_BLOCK_TYPE
                context.currentTextBlock.content = textBeforeThinking
                context.currentTextBlock.timestamp = Date.now()
                context.contentBlocks.push(context.currentTextBlock)
              }
            } else {
              context.currentTextBlock = contentBlockPool.get()
              context.currentTextBlock.type = TEXT_BLOCK_TYPE
              context.currentTextBlock.content = textBeforeThinking
              context.currentTextBlock.timestamp = Date.now()
              context.contentBlocks.push(context.currentTextBlock)
            }
            hasProcessedContent = true
          }
          context.isInThinkingBlock = true
          context.currentTextBlock = null
          contentToProcess = contentToProcess.substring(startMatch.index + startMatch[0].length)
          hasProcessedContent = true
        } else {
          const partialTagIndex = contentToProcess.lastIndexOf('<')
          let textToAdd = contentToProcess
          let remaining = ''
          if (partialTagIndex >= 0 && partialTagIndex > contentToProcess.length - 10) {
            textToAdd = contentToProcess.substring(0, partialTagIndex)
            remaining = contentToProcess.substring(partialTagIndex)
          }
          if (textToAdd) {
            context.accumulatedContent.append(textToAdd)
            if (context.currentTextBlock && context.contentBlocks.length > 0) {
              const lastBlock = context.contentBlocks[context.contentBlocks.length - 1]
              if (lastBlock.type === TEXT_BLOCK_TYPE && lastBlock === context.currentTextBlock) {
                lastBlock.content += textToAdd
              } else {
                context.currentTextBlock = contentBlockPool.get()
                context.currentTextBlock.type = TEXT_BLOCK_TYPE
                context.currentTextBlock.content = textToAdd
                context.currentTextBlock.timestamp = Date.now()
                context.contentBlocks.push(context.currentTextBlock)
              }
            } else {
              context.currentTextBlock = contentBlockPool.get()
              context.currentTextBlock.type = TEXT_BLOCK_TYPE
              context.currentTextBlock.content = textToAdd
              context.currentTextBlock.timestamp = Date.now()
              context.contentBlocks.push(context.currentTextBlock)
            }
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
    context.doneEventCount++
    if (context.doneEventCount >= 1) {
      context.streamComplete = true
    }
  },
  error: (data, context, _get, set) => {
    logger.error('Stream error:', data.error)
    set((state: CopilotStore) => ({
      messages: state.messages.map((msg) =>
        msg.id === context.messageId
          ? { ...msg, content: context.accumulatedContent || 'An error occurred.', error: data.error }
          : msg
      ),
    }))
    context.streamComplete = true
  },
  stream_end: (_data, context, _get, set) => {
    if (context.pendingContent) {
      if (context.isInThinkingBlock && context.currentThinkingBlock) {
        context.currentThinkingBlock.content += context.pendingContent
      } else if (context.pendingContent.trim()) {
        context.accumulatedContent.append(context.pendingContent)
        if (context.currentTextBlock && context.contentBlocks.length > 0) {
          const lastBlock = context.contentBlocks[context.contentBlocks.length - 1]
          if (lastBlock.type === TEXT_BLOCK_TYPE && lastBlock === context.currentTextBlock) {
            lastBlock.content += context.pendingContent
          } else {
            context.currentTextBlock = contentBlockPool.get()
            context.currentTextBlock.type = TEXT_BLOCK_TYPE
            context.currentTextBlock.content = context.pendingContent
            context.currentTextBlock.timestamp = Date.now()
            context.contentBlocks.push(context.currentTextBlock)
          }
        } else {
          context.currentTextBlock = contentBlockPool.get()
          context.currentTextBlock.type = TEXT_BLOCK_TYPE
          context.currentTextBlock.content = context.pendingContent
          context.currentTextBlock.timestamp = Date.now()
          context.contentBlocks.push(context.currentTextBlock)
        }
      }
      context.pendingContent = ''
    }
    if (context.currentThinkingBlock) {
      context.currentThinkingBlock.duration =
        Date.now() - (context.currentThinkingBlock.startTime || Date.now())
    }
    context.isInThinkingBlock = false
    context.currentThinkingBlock = null
    context.currentTextBlock = null
    updateStreamingMessage(set, context)
  },
  default: () => {},
}

// Debounced UI update queue for smoother streaming
const streamingUpdateQueue = new Map<string, StreamingContext>()
let streamingUpdateRAF: number | null = null
let lastBatchTime = 0
const MIN_BATCH_INTERVAL = 16
const MAX_BATCH_INTERVAL = 50
const MAX_QUEUE_SIZE = 5

function createOptimizedContentBlocks(contentBlocks: any[]): any[] {
  const result: any[] = new Array(contentBlocks.length)
  for (let i = 0; i < contentBlocks.length; i++) {
    const block = contentBlocks[i]
    result[i] = { ...block }
  }
  return result
}

function updateStreamingMessage(set: any, context: StreamingContext) {
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

async function* parseSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder
) {
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value, { stream: true })
    buffer += chunk
    const lastNewlineIndex = buffer.lastIndexOf('\n')
    if (lastNewlineIndex !== -1) {
      const linesToProcess = buffer.substring(0, lastNewlineIndex)
      buffer = buffer.substring(lastNewlineIndex + 1)
      const lines = linesToProcess.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (line.length === 0) continue
        if (line.charCodeAt(0) === 100 && line.startsWith(DATA_PREFIX)) {
          try {
            const jsonStr = line.substring(DATA_PREFIX_LENGTH)
            yield JSON.parse(jsonStr)
          } catch (error) {
            logger.warn('Failed to parse SSE data:', error)
          }
        }
      }
    }
  }
}

// Initial state (subset required for UI/streaming)
const initialState = {
  mode: 'agent' as const,
  agentDepth: 0 as 0 | 1 | 2 | 3,
  agentPrefetch: true,
  currentChat: null as CopilotChat | null,
  chats: [] as CopilotChat[],
  messages: [] as CopilotMessage[],
  checkpoints: [] as any[],
  messageCheckpoints: {} as Record<string, any[]>,
  isLoading: false,
  isLoadingChats: false,
  isLoadingCheckpoints: false,
  isSendingMessage: false,
  isSaving: false,
  isRevertingCheckpoint: false,
  isAborting: false,
  error: null as string | null,
  saveError: null as string | null,
  checkpointError: null as string | null,
  workflowId: null as string | null,
  abortController: null as AbortController | null,
  chatsLastLoadedAt: null as Date | null,
  chatsLoadedForWorkflow: null as string | null,
  revertState: null as { messageId: string; messageContent: string } | null,
  inputValue: '',
  planTodos: [] as Array<{ id: string; content: string; completed?: boolean; executing?: boolean }>,
  showPlanTodos: false,
  toolCallsById: {} as Record<string, CopilotToolCall>,
}

export const useCopilotStore = create<CopilotStore>()(
  devtools((set, get) => ({
    ...initialState,

    // Basic mode controls
    setMode: (mode) => set({ mode }),

    // Clear messages
    clearMessages: () => set({ messages: [] }),

    // Workflow selection
    setWorkflowId: async (workflowId: string | null) => {
      const currentWorkflowId = get().workflowId
      if (currentWorkflowId === workflowId) return
      const { isSendingMessage } = get()
      if (isSendingMessage) get().abortMessage()
      set({
        ...initialState,
        workflowId,
        mode: get().mode,
        agentDepth: get().agentDepth,
        agentPrefetch: get().agentPrefetch,
      })
    },

    // Chats (minimal implementation for visibility)
    validateCurrentChat: () => {
      const { currentChat, workflowId, chats } = get()
      if (!currentChat || !workflowId) return false
      const chatExists = chats.some((c) => c.id === currentChat.id)
      if (!chatExists) {
        set({ currentChat: null, messages: [] })
        return false
      }
      return true
    },

    selectChat: async (chat: CopilotChat) => {
      const { isSendingMessage, currentChat } = get()
      if (currentChat && currentChat.id !== chat.id && isSendingMessage) get().abortMessage()
      set({ currentChat: chat, messages: chat.messages || [], planTodos: [], showPlanTodos: false })
    },

    createNewChat: async () => {
      const { isSendingMessage } = get()
      if (isSendingMessage) get().abortMessage()
      set({
        currentChat: null,
        messages: [],
        messageCheckpoints: {},
        planTodos: [],
        showPlanTodos: false,
      })
    },

    deleteChat: async (_chatId: string) => {
      // no-op for now
    },

    areChatsFresh: (_workflowId: string) => false,

    loadChats: async (_forceRefresh = false) => {
      const { workflowId } = get()
      if (!workflowId) {
        set({ chats: [], isLoadingChats: false })
        return
      }

      // For now always fetch fresh
      set({ isLoadingChats: true })
      try {
        const response = await fetch(`/api/copilot/chat?workflowId=${workflowId}`)
        if (!response.ok) {
          throw new Error(`Failed to fetch chats: ${response.status}`)
        }
        const data = await response.json()
        if (data.success && Array.isArray(data.chats)) {
          const now = new Date()
          set({
            chats: data.chats,
            isLoadingChats: false,
            chatsLastLoadedAt: now,
            chatsLoadedForWorkflow: workflowId,
          })

          if (data.chats.length > 0) {
            const { currentChat, isSendingMessage } = get()
            const currentChatStillExists =
              currentChat && data.chats.some((c: CopilotChat) => c.id === currentChat.id)

            if (currentChatStillExists) {
              const updatedCurrentChat = data.chats.find((c: CopilotChat) => c.id === currentChat!.id)!
              if (isSendingMessage) {
                set({ currentChat: { ...updatedCurrentChat, messages: get().messages } })
              } else {
                set({ currentChat: updatedCurrentChat, messages: updatedCurrentChat.messages || [] })
              }
              try { await get().loadMessageCheckpoints(updatedCurrentChat.id) } catch {}
            } else if (!isSendingMessage) {
              const mostRecentChat: CopilotChat = data.chats[0]
              set({ currentChat: mostRecentChat, messages: mostRecentChat.messages || [] })
              try { await get().loadMessageCheckpoints(mostRecentChat.id) } catch {}
            }
          } else {
            set({ currentChat: null, messages: [] })
          }
        } else {
          throw new Error('Invalid response format')
        }
      } catch (error) {
        set({
          chats: [],
          isLoadingChats: false,
          error: error instanceof Error ? error.message : 'Failed to load chats',
        })
      }
    },

    // Send a message (streaming only)
    sendMessage: async (message: string, options = {}) => {
      const { workflowId, currentChat, mode, revertState } = get()
      const { stream = true, fileAttachments } = options as { stream?: boolean; fileAttachments?: MessageFileAttachment[] }
      if (!workflowId) return

      const abortController = new AbortController()
      set({ isSendingMessage: true, error: null, abortController })

      const userMessage = createUserMessage(message, fileAttachments)
      const streamingMessage = createStreamingMessage()

      let newMessages: CopilotMessage[]
      if (revertState) {
        const currentMessages = get().messages
        newMessages = [...currentMessages, userMessage, streamingMessage]
        set({ revertState: null, inputValue: '' })
      } else {
        newMessages = [...get().messages, userMessage, streamingMessage]
      }

      const isFirstMessage = get().messages.length === 0 && !currentChat?.title
      set({ messages: newMessages })

      if (isFirstMessage) {
        const optimisticTitle = message.length > 50 ? `${message.substring(0, 47)}...` : message
        set((state) => ({
          currentChat: state.currentChat ? { ...state.currentChat, title: optimisticTitle } : state.currentChat,
        }))
      }

      try {
        const result = await sendStreamingMessage({
          message,
          userMessageId: userMessage.id,
          chatId: currentChat?.id,
          workflowId,
          mode: mode === 'ask' ? 'ask' : 'agent',
          depth: get().agentDepth,
          prefetch: get().agentPrefetch,
          createNewChat: !currentChat,
          stream,
          fileAttachments,
          abortSignal: abortController.signal,
        })

        if (result.success && result.stream) {
          await get().handleStreamingResponse(result.stream, streamingMessage.id)
          set({ chatsLastLoadedAt: null, chatsLoadedForWorkflow: null })
        } else {
          if (result.error === 'Request was aborted') {
            return
          }
          const errorMessage = createErrorMessage(
            streamingMessage.id,
            result.error || 'Failed to send message'
          )
          set((state) => ({
            messages: state.messages.map((m) => (m.id === streamingMessage.id ? errorMessage : m)),
            error: result.error || 'Failed to send message',
            isSendingMessage: false,
            abortController: null,
          }))
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return
        const errorMessage = createErrorMessage(
          streamingMessage.id,
          'Sorry, I encountered an error while processing your message. Please try again.'
        )
        set((state) => ({
          messages: state.messages.map((m) => (m.id === streamingMessage.id ? errorMessage : m)),
          error: error instanceof Error ? error.message : 'Failed to send message',
          isSendingMessage: false,
          abortController: null,
        }))
      }
    },

    // Abort streaming
    abortMessage: () => {
      const { abortController, isSendingMessage, messages } = get()
      if (!isSendingMessage || !abortController) return
      set({ isAborting: true })
      try {
        abortController.abort()
        const lastMessage = messages[messages.length - 1]
        if (lastMessage && lastMessage.role === 'assistant') {
          const textContent =
            lastMessage.contentBlocks?.filter((b) => b.type === 'text').map((b: any) => b.content).join('') || ''
          set((state) => ({
            messages: state.messages.map((msg) =>
              msg.id === lastMessage.id
                ? { ...msg, content: textContent.trim() || 'Message was aborted' }
                : msg
            ),
            isSendingMessage: false,
            isAborting: false,
            abortController: null,
          }))
        } else {
          set({ isSendingMessage: false, isAborting: false, abortController: null })
        }

        const { currentChat } = get()
        if (currentChat) {
          try {
            const currentMessages = get().messages
            const dbMessages = validateMessagesForLLM(currentMessages)
            fetch('/api/copilot/chat/update-messages', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chatId: currentChat.id, messages: dbMessages }),
            }).catch(() => {})
          } catch {}
        }
      } catch {
        set({ isSendingMessage: false, isAborting: false, abortController: null })
      }
    },

    // Implicit feedback (send a continuation) - minimal
    sendImplicitFeedback: async (implicitFeedback: string) => {
      const { workflowId, currentChat, mode, agentDepth } = get()
      if (!workflowId) return
      const abortController = new AbortController()
      set({ isSendingMessage: true, error: null, abortController })
      const newAssistantMessage = createStreamingMessage()
      set((state) => ({ messages: [...state.messages, newAssistantMessage] }))
      try {
        const result = await sendStreamingMessage({
          message: 'Please continue your response.',
          chatId: currentChat?.id,
          workflowId,
          mode: mode === 'ask' ? 'ask' : 'agent',
          depth: agentDepth,
          prefetch: get().agentPrefetch,
          createNewChat: !currentChat,
          stream: true,
          implicitFeedback,
          abortSignal: abortController.signal,
        })
        if (result.success && result.stream) {
          await get().handleStreamingResponse(result.stream, newAssistantMessage.id, false)
        } else {
          if (result.error === 'Request was aborted') return
          const errorMessage = createErrorMessage(newAssistantMessage.id, result.error || 'Failed to send implicit feedback')
          set((state) => ({
            messages: state.messages.map((msg) => (msg.id === newAssistantMessage.id ? errorMessage : msg)),
            error: result.error || 'Failed to send implicit feedback',
            isSendingMessage: false,
            abortController: null,
          }))
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return
        const errorMessage = createErrorMessage(
          newAssistantMessage.id,
          'Sorry, I encountered an error while processing your feedback. Please try again.'
        )
        set((state) => ({
          messages: state.messages.map((msg) => (msg.id === newAssistantMessage.id ? errorMessage : msg)),
          error: error instanceof Error ? error.message : 'Failed to send implicit feedback',
          isSendingMessage: false,
          abortController: null,
        }))
      }
    },

    // Tool-call related APIs are stubbed for now
    setToolCallState: (toolCall: any, newState: any) => {
      try {
        const id: string | undefined = toolCall?.id
        if (!id) return
        const map = { ...get().toolCallsById }
        const current = map[id]
        if (!current) return
        let norm: ClientToolCallState = current.state
        if (newState === 'executing') norm = ClientToolCallState.executing
        else if (newState === 'errored' || newState === 'error') norm = ClientToolCallState.error
        else if (newState === 'rejected') norm = ClientToolCallState.rejected
        else if (newState === 'pending') norm = ClientToolCallState.pending
        else if (newState === 'success' || newState === 'accepted') norm = ClientToolCallState.success
        else if (newState === 'aborted') norm = ClientToolCallState.aborted
        else if (typeof newState === 'number') norm = (newState as unknown) as ClientToolCallState
        map[id] = {
          ...current,
          state: norm,
          display: resolveToolDisplay(current.name, norm, id, current.params),
        }
        set({ toolCallsById: map })
      } catch {}
    },
    updatePreviewToolCallState: () => {},

    sendDocsMessage: async (query: string) => {
      await get().sendMessage(query)
    },

    saveChatMessages: async (_chatId: string) => {},

    loadCheckpoints: async (_chatId: string) => set({ checkpoints: [] }),

    loadMessageCheckpoints: async (chatId: string) => {
      const { workflowId } = get()
      if (!workflowId) return
      set({ isLoadingCheckpoints: true, checkpointError: null })
      try {
        const response = await fetch(`/api/copilot/checkpoints?chatId=${chatId}`)
        if (!response.ok) throw new Error(`Failed to load checkpoints: ${response.statusText}`)
        const data = await response.json()
        if (data.success && Array.isArray(data.checkpoints)) {
          const grouped = data.checkpoints.reduce((acc: Record<string, any[]>, cp: any) => {
            const key = cp.messageId || '__no_message__'
            acc[key] = acc[key] || []
            acc[key].push(cp)
            return acc
          }, {})
          set({ messageCheckpoints: grouped, isLoadingCheckpoints: false })
        } else {
          throw new Error('Invalid checkpoints response')
        }
      } catch (error) {
        set({
          isLoadingCheckpoints: false,
          checkpointError: error instanceof Error ? error.message : 'Failed to load checkpoints',
        })
      }
    },

    // Revert checkpoints (minimal: not implemented)
    revertToCheckpoint: async (_checkpointId: string) => {},
    getCheckpointsForMessage: (_messageId: string) => [],

    // Preview YAML (stubbed/no-op)
    setPreviewYaml: async (_yamlContent: string) => {},
    clearPreviewYaml: async () => {
      set((state) => ({
        currentChat: state.currentChat ? { ...state.currentChat, previewYaml: null } : null,
      }))
    },

    // Handle streaming response
    handleStreamingResponse: async (stream: ReadableStream, messageId: string, isContinuation = false) => {
      const reader = stream.getReader()
      const decoder = new TextDecoder()

      const context: StreamingContext = {
        messageId,
        accumulatedContent: new StringBuilder(),
        contentBlocks: [],
        currentTextBlock: null,
        isInThinkingBlock: false,
        currentThinkingBlock: null,
        pendingContent: '',
        doneEventCount: 0,
      }

      if (isContinuation) {
        const { messages } = get()
        const existingMessage = messages.find((m) => m.id === messageId)
        if (existingMessage) {
          if (existingMessage.content) context.accumulatedContent.append(existingMessage.content)
          context.contentBlocks = existingMessage.contentBlocks ? [...existingMessage.contentBlocks] : []
        }
      }

      const timeoutId = setTimeout(() => {
        logger.warn('Stream timeout reached, completing response')
        reader.cancel()
      }, 600000)

      try {
        for await (const data of parseSSEStream(reader, decoder)) {
          const { abortController } = get()
          if (abortController?.signal.aborted) break
          const handler = sseHandlers[data.type] || sseHandlers.default
          await handler(data, context, get, set)
          if (context.streamComplete) break
        }

        if (sseHandlers.stream_end) sseHandlers.stream_end({}, context, get, set)

        if (streamingUpdateRAF !== null) {
          cancelAnimationFrame(streamingUpdateRAF)
          streamingUpdateRAF = null
        }
        streamingUpdateQueue.clear()

        if (context.contentBlocks) {
          context.contentBlocks.forEach((block) => {
            if (block.type === TEXT_BLOCK_TYPE || block.type === THINKING_BLOCK_TYPE) {
              contentBlockPool.release(block)
            }
          })
        }

        const finalContent = context.accumulatedContent.toString()
        set((state) => ({
          messages: state.messages.map((msg) =>
            msg.id === messageId
              ? {
                  ...msg,
                  content: finalContent,
                  contentBlocks: context.contentBlocks,
                }
              : msg
          ),
          isSendingMessage: false,
          abortController: null,
        }))

        if (context.newChatId && !get().currentChat) {
          await get().handleNewChatCreation(context.newChatId)
        }

        const { currentChat } = get()
        if (currentChat) {
          try {
            const currentMessages = get().messages
            const dbMessages = validateMessagesForLLM(currentMessages)
            await fetch('/api/copilot/chat/update-messages', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chatId: currentChat.id, messages: dbMessages }),
            })
          } catch {}
        }
      } finally {
        clearTimeout(timeoutId)
      }
    },

    // Handle new chat creation from stream
    handleNewChatCreation: async (newChatId: string) => {
      const newChat: CopilotChat = {
        id: newChatId,
        title: null,
        model: 'gpt-4',
        messages: get().messages,
        messageCount: get().messages.length,
        previewYaml: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      set({
        currentChat: newChat,
        chats: [newChat, ...(get().chats || [])],
        chatsLastLoadedAt: null,
        chatsLoadedForWorkflow: null,
        planTodos: [],
        showPlanTodos: false,
      })
    },

    // Utilities
    clearError: () => set({ error: null }),
    clearSaveError: () => set({ saveError: null }),
    clearCheckpointError: () => set({ checkpointError: null }),
    retrySave: async (_chatId: string) => {},

    cleanup: () => {
      const { isSendingMessage } = get()
      if (isSendingMessage) get().abortMessage()
      if (streamingUpdateRAF !== null) {
        cancelAnimationFrame(streamingUpdateRAF)
        streamingUpdateRAF = null
      }
      streamingUpdateQueue.clear()
    },

    reset: () => {
      get().cleanup()
      set(initialState)
    },

    // Input controls
    setInputValue: (value: string) => set({ inputValue: value }),
    clearRevertState: () => set({ revertState: null }),

    // Todo list (UI only)
    setPlanTodos: (todos) => set({ planTodos: todos, showPlanTodos: true }),
    updatePlanTodoStatus: (_id, _status) => {},
    closePlanTodos: () => set({ showPlanTodos: false }),

    // Diff updates are out of scope for minimal store
    updateDiffStore: async (_yamlContent: string) => {},
    updateDiffStoreWithWorkflowState: async (_workflowState: any) => {},

    setAgentDepth: (depth) => set({ agentDepth: depth }),
    setAgentPrefetch: (prefetch) => set({ agentPrefetch: prefetch }),
  }))
)
