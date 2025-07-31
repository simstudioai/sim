'use client'

import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { type CopilotChat, sendStreamingMessage } from '@/lib/copilot/api'
import type { CopilotMessage } from './types'
import { createLogger } from '@/lib/logs/console/logger'
import { COPILOT_TOOL_DISPLAY_NAMES, COPILOT_TOOL_PAST_TENSE, COPILOT_TOOL_ERROR_NAMES } from '@/stores/constants'
import { COPILOT_TOOL_IDS } from './constants'
import type { CopilotStore, WorkflowCheckpoint } from './types'

const logger = createLogger('CopilotStore')

/**
 * Initial state for the copilot store
 */
const initialState = {
  mode: 'ask' as const,
  currentChat: null,
  chats: [],
  messages: [],
  checkpoints: [],
  messageCheckpoints: {}, // New field for message-checkpoint mappings
  isLoading: false,
  isLoadingChats: false,
  isLoadingCheckpoints: false,
  isSendingMessage: false,
  isSaving: false,
  isRevertingCheckpoint: false,
  isAborting: false,
  error: null,
  saveError: null,
  checkpointError: null,
  workflowId: null,
  abortController: null,
  chatsLastLoadedAt: null, // Track when chats were last loaded
  chatsLoadedForWorkflow: null, // Track which workflow the chats were loaded for
  // Revert state management
  revertState: null as { messageId: string; messageContent: string } | null, // Track which message we reverted from
  inputValue: '', // Control the input field
}

/**
 * Helper function to create a new user messagenow let
 */
function createUserMessage(content: string): CopilotMessage {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content,
    timestamp: new Date().toISOString(),
  }
}

/**
 * Helper function to create a streaming placeholder message
 */
function createStreamingMessage(): CopilotMessage {
  return {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: '',
    timestamp: new Date().toISOString(),
  }
}

/**
 * Helper function to create an error message
 */
function createErrorMessage(messageId: string, content: string): CopilotMessage {
  return {
    id: messageId,
    role: 'assistant',
    content,
    timestamp: new Date().toISOString(),
  }
}

/**
 * Helper function to handle errors in async operations
 */
function handleStoreError(error: unknown, fallbackMessage: string): string {
  const errorMessage = error instanceof Error ? error.message : fallbackMessage
  logger.error(fallbackMessage, error)
  return errorMessage
}

/**
 * Helper function to get a display name for a tool
 */
function getToolDisplayName(toolName: string): string {
  // Use dynamically generated display names from the tool registry
  return COPILOT_TOOL_DISPLAY_NAMES[toolName] || toolName
}

/**
 * Helper function to get appropriate tool display name based on state
 */
function getToolDisplayNameByState(toolCall: any): string {
  const toolName = toolCall.name
  const state = toolCall.state
  
  if (state === 'completed' || state === 'applied' || state === 'ready_for_review') {
    // All success states use past tense
    return COPILOT_TOOL_PAST_TENSE[toolName] || getToolDisplayName(toolName)
  } else if (state === 'error') {
    return COPILOT_TOOL_ERROR_NAMES[toolName] || `Errored ${getToolDisplayName(toolName).toLowerCase()}`
  } else if (state === 'rejected') {
    // Special handling for rejected workflow tools
    const isWorkflowTool = toolName === COPILOT_TOOL_IDS.BUILD_WORKFLOW || toolName === COPILOT_TOOL_IDS.EDIT_WORKFLOW
    return isWorkflowTool ? 'Rejected workflow changes' : `Rejected ${getToolDisplayName(toolName).toLowerCase()}`
  } else {
    // For executing, aborted, etc. - use present tense
    return getToolDisplayName(toolName)
  }
}

/**
 * Helper function to ensure tool calls have display names
 * This is needed when loading messages from database where tool calls
 * don't go through createToolCall()
 */
function ensureToolCallDisplayNames(messages: CopilotMessage[]): CopilotMessage[] {
  return messages.map((message: CopilotMessage) => {
    if (message.role === 'assistant' && (message.toolCalls || message.contentBlocks)) {
      return {
        ...message,
        // Always recalculate displayName based on current state
        ...(message.toolCalls && {
          toolCalls: message.toolCalls.map((toolCall: any) => ({
            ...toolCall,
            displayName: getToolDisplayNameByState(toolCall)
          }))
        }),
        // Always recalculate displayName based on current state
        ...(message.contentBlocks && {
          contentBlocks: message.contentBlocks.map((block: any) => 
            block.type === 'tool_call' ? {
              ...block,
              toolCall: {
                ...block.toolCall,
                displayName: getToolDisplayNameByState(block.toolCall)
              }
            } : block
          )
        })
      }
    }
    return message
  })
}

/**
 * Helper function to process workflow tool results (build_workflow or edit_workflow)
 */
function processWorkflowToolResult(toolCall: any, result: any, get: () => CopilotStore): void {
  // Extract YAML content from various possible locations in the result
  const yamlContent =
    result?.yamlContent ||
    result?.data?.yamlContent ||
    toolCall.input?.yamlContent ||
    toolCall.input?.data?.yamlContent

  if (yamlContent) {
    logger.info(`Setting preview YAML from ${toolCall.name} tool`, {
      yamlLength: yamlContent.length,
      yamlPreview: yamlContent.substring(0, 100),
    })
    get().setPreviewYaml(yamlContent)
    get().updateDiffStore(yamlContent, toolCall.name)
  } else {
    logger.warn(`No yamlContent found in ${toolCall.name} result`, {
      resultKeys: Object.keys(result || {}),
      inputKeys: Object.keys(toolCall.input || {}),
    })
  }
}

/**
 * Helper function to handle tool execution failure
 */
function handleToolFailure(toolCall: any, error: string): void {
  toolCall.state = 'error'
  toolCall.error = error
  
  // Update displayName to match the error state
  toolCall.displayName = getToolDisplayNameByState(toolCall)

  logger.error('Tool call failed:', toolCall.id, toolCall.name, error)
}

/**
 * Helper function to create a tool call object
 */
function createToolCall(id: string, name: string, input: any = {}): any {
  return {
    id,
    name,
    input,
    displayName: getToolDisplayName(name),
    state: 'executing',
    startTime: Date.now(),
    timestamp: Date.now(),
  }
}

/**
 * Helper function to finalize a tool call
 */
function finalizeToolCall(toolCall: any, success: boolean, result?: any): void {
  toolCall.endTime = Date.now()
  toolCall.duration = toolCall.endTime - toolCall.startTime

  if (success) {
    toolCall.result = result
    // Workflow tools need review, others are completed
    toolCall.state =
      toolCall.name === COPILOT_TOOL_IDS.BUILD_WORKFLOW ||
      toolCall.name === COPILOT_TOOL_IDS.EDIT_WORKFLOW
        ? 'ready_for_review'
        : 'completed'
    
    // Update displayName to match the new state
    toolCall.displayName = getToolDisplayNameByState(toolCall)
  }
}

/**
 * SSE event handlers for different event types
 */
interface StreamingContext {
  messageId: string
  accumulatedContent: string
  toolCalls: any[]
  contentBlocks: any[]
  currentTextBlock: any | null
  currentBlockType: 'text' | 'tool_use' | null
  toolCallBuffer: any | null
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
  // Handle chat ID event (custom event)
  chat_id: async (data, context, get) => {
    context.newChatId = data.chatId
    logger.info('Received chatId from stream:', context.newChatId)

    const { currentChat } = get()
    if (!currentChat && context.newChatId) {
      await get().handleNewChatCreation(context.newChatId)
    }
  },

  // Handle chat title update event (custom event)
  title_updated: async (data, context, get, set) => {
    const { title } = data
    const { currentChat } = get()
    const previousTitle = currentChat?.title

    logger.info('Received title update from stream:', {
      newTitle: title,
      previousTitle,
      isOptimisticReplacement: previousTitle !== null && previousTitle !== title,
    })

    set((state: CopilotStore) => ({
      currentChat: state.currentChat
        ? {
            ...state.currentChat,
            title,
            updatedAt: new Date(),
          }
        : state.currentChat,
      // Also update the chat in the chats array
      chats: state.chats.map((chat) =>
        chat.id === state.currentChat?.id ? { ...chat, title, updatedAt: new Date() } : chat
      ),
    }))
  },

  // Handle tool result events - simplified
  tool_result: (data, context, get, set) => {
    const { toolCallId, result, success } = data

    if (!toolCallId) return

    // Find tool call in context
    const toolCall =
      context.toolCalls.find((tc) => tc.id === toolCallId) ||
      context.contentBlocks
        .filter((b) => b.type === 'tool_call')
        .map((b) => b.toolCall)
        .find((tc) => tc.id === toolCallId)

    if (!toolCall) {
      logger.error('Tool call not found for result', { toolCallId })
      return
    }

    // Ensure tool call is in context for updates
    if (!context.toolCalls.find((tc) => tc.id === toolCallId)) {
      context.toolCalls.push(toolCall)
    }

    if (success) {
      // Parse result if needed
      const parsedResult =
        typeof result === 'string' && result.startsWith('{')
          ? (() => {
              try {
                return JSON.parse(result)
              } catch {
                return result
              }
            })()
          : result

      finalizeToolCall(toolCall, true, parsedResult)

      // Handle workflow tools
      if (
        toolCall.name === COPILOT_TOOL_IDS.BUILD_WORKFLOW ||
        toolCall.name === COPILOT_TOOL_IDS.EDIT_WORKFLOW
      ) {
        processWorkflowToolResult(toolCall, parsedResult, get)
      }
    } else {
      handleToolFailure(toolCall, result || 'Tool execution failed')
    }

    // Update both contentBlocks and toolCalls atomically before UI update
    updateContentBlockToolCall(context.contentBlocks, toolCallId, toolCall)
    
    // Ensure the toolCall in context.toolCalls is also updated with the latest state
    const toolCallIndex = context.toolCalls.findIndex(tc => tc.id === toolCallId)
    if (toolCallIndex !== -1) {
      context.toolCalls[toolCallIndex] = { ...toolCall }
    }
    
    updateStreamingMessage(set, context)
  },

  // Handle content events
  content: (data, context, get, set) => {
    if (!data.data) return

    context.accumulatedContent += data.data

    // Update existing text block or create new one (optimized for minimal array mutations)
    if (context.currentTextBlock && context.contentBlocks.length > 0) {
      // Find the last text block and update it in-place
      const lastBlock = context.contentBlocks[context.contentBlocks.length - 1]
      if (lastBlock.type === 'text' && lastBlock === context.currentTextBlock) {
        // Efficiently update existing text block content in-place
        lastBlock.content += data.data
      } else {
        // Last block is not text, create a new text block
        context.currentTextBlock = {
          type: 'text',
          content: data.data,
          timestamp: Date.now(),
        }
        context.contentBlocks.push(context.currentTextBlock)
      }
    } else {
      // No current text block, create one
      context.currentTextBlock = {
        type: 'text',
        content: data.data,
        timestamp: Date.now(),
      }
      context.contentBlocks.push(context.currentTextBlock)
    }

    updateStreamingMessage(set, context)
  },

  // Handle tool call events - simplified
  tool_call: (data, context, get, set) => {
    const toolData = data.data
    if (!toolData) return

    // Skip if already exists
    if (context.toolCalls.find((tc) => tc.id === toolData.id)) {
      return
    }

    const toolCall = createToolCall(toolData.id, toolData.name, toolData.arguments)
    context.toolCalls.push(toolCall)

    context.contentBlocks.push({
      type: 'tool_call',
      toolCall,
      timestamp: Date.now(),
    })

    updateStreamingMessage(set, context)
  },

  // Handle tool execution event
  tool_execution: (data, context, get, set) => {
    const toolCall = context.toolCalls.find((tc) => tc.id === data.toolCallId)
    if (toolCall) {
      toolCall.state = 'executing'
      
      // Update both contentBlocks and toolCalls atomically before UI update
      updateContentBlockToolCall(context.contentBlocks, data.toolCallId, toolCall)
      
      // toolCall is already updated by reference in context.toolCalls since we found it there
      updateStreamingMessage(set, context)
    }
  },

  // Handle Anthropic content block events - simplified
  content_block_start: (data, context) => {
    context.currentBlockType = data.content_block?.type

    if (context.currentBlockType === 'text') {
      // Start a new text block
      context.currentTextBlock = {
        type: 'text',
        content: '',
        timestamp: Date.now(),
      }
      context.contentBlocks.push(context.currentTextBlock)
    } else if (context.currentBlockType === 'tool_use') {
      // Mark that we're no longer in a text block
      context.currentTextBlock = null

      const toolCall = createToolCall(data.content_block.id, data.content_block.name)
      toolCall.partialInput = ''

      context.toolCallBuffer = toolCall
      context.toolCalls.push(toolCall)

      context.contentBlocks.push({
        type: 'tool_call',
        toolCall,
        timestamp: Date.now(),
      })
    }
  },

  content_block_delta: (data, context, get, set) => {
    if (context.currentBlockType === 'text' && data.delta?.text) {
      // For Anthropic, update the current text block efficiently
      context.accumulatedContent += data.delta.text
      if (context.currentTextBlock) {
        // Update text content in-place for better performance
        context.currentTextBlock.content += data.delta.text
        updateStreamingMessage(set, context)
      }
    } else if (
      context.currentBlockType === 'tool_use' &&
      data.delta?.partial_json &&
      context.toolCallBuffer
    ) {
      // Update partial JSON in-place
      context.toolCallBuffer.partialInput += data.delta.partial_json
    }
  },

  content_block_stop: (data, context, get, set) => {
    if (context.currentBlockType === 'text') {
      // Text block is complete
      context.currentTextBlock = null
    } else if (context.currentBlockType === 'tool_use' && context.toolCallBuffer) {
      try {
        // Parse complete tool input
        context.toolCallBuffer.input = JSON.parse(context.toolCallBuffer.partialInput || '{}')
        finalizeToolCall(context.toolCallBuffer, true)

        // Handle workflow tools immediately
        if (
          context.toolCallBuffer.name === COPILOT_TOOL_IDS.BUILD_WORKFLOW ||
          context.toolCallBuffer.name === COPILOT_TOOL_IDS.EDIT_WORKFLOW
        ) {
          processWorkflowToolResult(context.toolCallBuffer, context.toolCallBuffer.input, get)
        }

        // Update both contentBlocks and toolCalls atomically before UI update
        updateContentBlockToolCall(
          context.contentBlocks,
          context.toolCallBuffer.id,
          context.toolCallBuffer
        )
        
        // Ensure the toolCall in context.toolCalls is also updated with the latest state
        const toolCallIndex = context.toolCalls.findIndex(tc => tc.id === context.toolCallBuffer.id)
        if (toolCallIndex !== -1) {
          context.toolCalls[toolCallIndex] = { ...context.toolCallBuffer }
        }
        
        updateStreamingMessage(set, context)
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        handleToolFailure(context.toolCallBuffer, errorMsg)
      }

      context.toolCallBuffer = null
    }
    context.currentBlockType = null
  },

  // Handle done event
  done: (data, context) => {
    context.doneEventCount++

    // Only complete after all tools are done and we've received multiple done events
    const executingTools = context.toolCalls.filter((tc) => tc.state === 'executing')
    if (executingTools.length === 0 && context.doneEventCount >= 2) {
      context.streamComplete = true
    }
  },

  // Handle errors
  error: (data, context, get, set) => {
    logger.error('Stream error:', data.error)
    set((state: CopilotStore) => ({
      messages: state.messages.map((msg: CopilotMessage) =>
        msg.id === context.messageId
          ? {
              ...msg,
              content:
                context.accumulatedContent || 'An error occurred while processing your request.',
              error: data.error,
            }
          : msg
      ),
    }))
    context.streamComplete = true
  },

  // Handle tool errors
  tool_error: (data, context, get, set) => {
    const toolCall = context.toolCalls.find((tc) => tc.id === data.toolCallId)
    if (toolCall) {
      handleToolFailure(toolCall, data.error)
      updateContentBlockToolCall(context.contentBlocks, data.toolCallId, toolCall)
      updateStreamingMessage(set, context)
    }
  },

  // Default handler
  default: () => {
    // Silently ignore unhandled events
  },
}

/**
 * Helper function to update content block with tool call
 */
function updateContentBlockToolCall(contentBlocks: any[], toolCallId: string, toolCall: any) {
  for (let i = 0; i < contentBlocks.length; i++) {
    const block = contentBlocks[i]
    if (block.type === 'tool_call' && block.toolCall.id === toolCallId) {
      contentBlocks[i] = {
        type: 'tool_call',
        toolCall: { ...toolCall },
        timestamp: block.timestamp,
      }
      break
    }
  }
}

/**
 * Helper function to update content block with text
 */
function updateContentBlockText(contentBlocks: any[], textBlock: any) {
  for (let i = contentBlocks.length - 1; i >= 0; i--) {
    if (
      contentBlocks[i] === textBlock ||
      (contentBlocks[i].type === 'text' && contentBlocks[i].timestamp === textBlock.timestamp)
    ) {
      contentBlocks[i] = { ...textBlock }
      break
    }
  }
}

/**
 * Debounced UI update queue for smoother streaming
 */
let streamingUpdateQueue = new Map<string, StreamingContext>()
let streamingUpdateRAF: number | null = null

/**
 * Helper function to create a shallow copy of content blocks only when needed
 */
function createOptimizedContentBlocks(contentBlocks: any[]): any[] {
  // Create shallow copy for React to detect changes, but reuse objects where possible
  return contentBlocks.map(block => ({ ...block }))
}

/**
 * Helper function to update streaming message in state with debouncing
 */
function updateStreamingMessage(set: any, context: StreamingContext) {
  // Queue this update
  streamingUpdateQueue.set(context.messageId, context)
  
  // If no RAF is scheduled, schedule one
  if (streamingUpdateRAF === null) {
    streamingUpdateRAF = requestAnimationFrame(() => {
      // Process all queued updates in a single batch
      const updates = new Map(streamingUpdateQueue)
      streamingUpdateQueue.clear()
      streamingUpdateRAF = null
      
      set((state: CopilotStore) => {
        // Optimize for the common case where we're only updating the last message
        const messages = state.messages
        const hasUpdates = updates.size > 0
        
        if (!hasUpdates) {
          return state
        }
        
        // Check if we're only updating the last message (common during streaming)
        const lastMessage = messages[messages.length - 1]
        const lastMessageUpdate = lastMessage ? updates.get(lastMessage.id) : null
        
        if (updates.size === 1 && lastMessageUpdate) {
          // Fast path: only updating the last message
          const newMessages = [...messages]
          newMessages[messages.length - 1] = {
            ...lastMessage,
            content: '', // Don't use accumulated content for display
            toolCalls: lastMessageUpdate.toolCalls.length > 0 ? [...lastMessageUpdate.toolCalls] : [],
            contentBlocks: lastMessageUpdate.contentBlocks.length > 0 ? createOptimizedContentBlocks(lastMessageUpdate.contentBlocks) : [],
          }
          return { messages: newMessages }
        } else {
          // Fallback to mapping for multiple updates or non-last message updates
          return {
            messages: messages.map((msg: CopilotMessage) => {
              const update = updates.get(msg.id)
              if (update) {
                return {
                  ...msg,
                  content: '', // Don't use accumulated content for display
                  toolCalls: update.toolCalls.length > 0 ? [...update.toolCalls] : [],
                  contentBlocks: update.contentBlocks.length > 0 ? createOptimizedContentBlocks(update.contentBlocks) : [],
                }
              }
              return msg
            }),
          }
        }
      })
    })
  }
}

/**
 * Parse SSE stream and handle events
 */
async function* parseSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder
) {
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (line.trim() === '') continue
      if (line.startsWith('data: ')) {
        try {
          yield JSON.parse(line.slice(6))
        } catch (error) {
          logger.warn('Failed to parse SSE data:', error)
        }
      }
    }
  }
}

/**
 * Copilot store using the new unified API
 */
export const useCopilotStore = create<CopilotStore>()(
  devtools(
    (set, get) => ({
      ...initialState,

      // Set chat mode
      setMode: (mode) => {
        const previousMode = get().mode
        set({ mode })
        logger.info(`Copilot mode changed from ${previousMode} to ${mode}`)
      },

      // Clear messages for current chat
      clearMessages: () => {
        set({ messages: [] })
        logger.info('Cleared messages')
      },

      // Set workflow ID and reset state
      setWorkflowId: async (workflowId: string | null) => {
        const currentWorkflowId = get().workflowId

        if (currentWorkflowId === workflowId) {
          return
        }

        logger.info(`Setting workflow ID: ${workflowId}`)

        // Reset state when switching workflows, including chat cache and checkpoints
        set({
          ...initialState,
          workflowId,
          mode: get().mode, // Preserve mode
        })
      },

      // Validate that current chat belongs to current workflow
      validateCurrentChat: () => {
        const { currentChat, workflowId, chats } = get()

        if (!currentChat || !workflowId) {
          return false
        }

        // Check if the current chat belongs to the current workflow
        // Since chats are filtered by workflow ID from API, if current chat
        // is not in the chats array, it means it's stale
        const chatExists = chats.some((chat) => chat.id === currentChat.id)

        if (!chatExists) {
          logger.info('Current chat does not belong to current workflow, clearing stale state')
          set({
            currentChat: null,
            messages: [],
          })
          return false
        }

        return true
      },

      // Select chat and load latest messages
      selectChat: async (chat: CopilotChat) => {
        const { workflowId } = get()

        if (!workflowId) {
          logger.warn('Cannot select chat: no workflow ID set')
          return
        }

        // Optimistically set the chat first
        set({
          currentChat: chat,
          messages: ensureToolCallDisplayNames(chat.messages || []),
        })

        try {
          // Fetch the latest version of this specific chat to get updated messages
          const response = await fetch(`/api/copilot/chat?workflowId=${workflowId}`)

          if (!response.ok) {
            throw new Error(`Failed to fetch latest chat data: ${response.status}`)
          }

          const data = await response.json()

          if (data.success && Array.isArray(data.chats)) {
            // Find the selected chat in the fresh data
            const latestChat = data.chats.find((c: CopilotChat) => c.id === chat.id)

            if (latestChat) {
              // Update with the latest messages
              set({
                currentChat: latestChat,
                messages: ensureToolCallDisplayNames(latestChat.messages || []),
                // Also update the chat in the chats array with latest data
                chats: get().chats.map((c: CopilotChat) => (c.id === chat.id ? latestChat : c)),
              })
              logger.info(
                `Selected chat with latest messages: ${latestChat.title || 'Untitled'} (${latestChat.messages?.length || 0} messages)`
              )

              // Automatically load checkpoints for this chat
              await get().loadMessageCheckpoints(chat.id)
              
            } else {
              logger.warn(`Selected chat ${chat.id} not found in latest data`)
            }
          }
        } catch (error) {
          logger.error('Failed to fetch latest chat data, using cached messages:', error)
          // Already set optimistically above, so just log the error
          
          // Still try to load checkpoints even if chat refresh failed
          try {
            await get().loadMessageCheckpoints(chat.id)
          } catch (checkpointError) {
            logger.error('Failed to load checkpoints for selected chat:', checkpointError)
          }
        }
      },

      // Create a new chat - clear current chat state like when switching workflows
      createNewChat: async () => {
        // Set state to null so backend creates a new chat on first message
        set({
          currentChat: null,
          messages: [],
          messageCheckpoints: {}, // Clear checkpoints when creating new chat
        })
        logger.info('Cleared chat state for new conversation')
      },

      // Delete chat is now a no-op since we don't have the API
      deleteChat: async (chatId: string) => {
        logger.warn('Chat deletion not implemented without API endpoint')
        // The interface expects Promise<void>, not Promise<boolean>
      },

      // Check if chats are fresh for a given workflow (within 5 minutes)
      areChatsFresh: (workflowId: string) => {
        const { chatsLastLoadedAt, chatsLoadedForWorkflow } = get()

        if (!chatsLastLoadedAt || chatsLoadedForWorkflow !== workflowId) {
          return false
        }

        // Consider chats fresh if loaded within the last 5 minutes
        const CHAT_FRESHNESS_DURATION = 5 * 60 * 1000 // 5 minutes in milliseconds
        const timeSinceLastLoad = Date.now() - chatsLastLoadedAt.getTime()
        return timeSinceLastLoad < CHAT_FRESHNESS_DURATION
      },

      // Load chats for current workflow with smart caching
      loadChats: async (forceRefresh = false) => {
        const { workflowId } = get()

        if (!workflowId) {
          logger.warn('No workflow ID set, cannot load chats')
          set({ chats: [], isLoadingChats: false })
          return
        }

        // Check if we already have fresh chats for this workflow
        if (!forceRefresh && get().areChatsFresh(workflowId)) {
          logger.info(`Using cached chats for workflow ${workflowId}`)
          return
        }

        // Prevent multiple concurrent requests
        if (get().isLoadingChats && !forceRefresh) {
          logger.info('Chat loading already in progress, skipping duplicate request')
          return
        }

        set({ isLoadingChats: true })

        try {
          logger.info(
            `Loading chats for workflow ${workflowId}${forceRefresh ? ' (forced refresh)' : ''}`
          )
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

            // Auto-select the most recent chat if there are any chats for this workflow
            // Since chats are filtered by workflow ID, any existing currentChat would be stale
            if (data.chats.length > 0) {
              const mostRecentChat = data.chats[0]
              set({
                currentChat: mostRecentChat,
                messages: ensureToolCallDisplayNames(mostRecentChat.messages || []),
              })
              logger.info(
                `Auto-selected most recent chat for workflow ${workflowId}: ${mostRecentChat.title || 'Untitled'}`
              )
              
              // Load checkpoints for the auto-selected chat
              try {
                await get().loadMessageCheckpoints(mostRecentChat.id)
              } catch (checkpointError) {
                logger.error('Failed to load checkpoints for auto-selected chat:', checkpointError)
              }
            } else {
              // Ensure we clear everything if there are no chats for this workflow
              set({
                currentChat: null,
                messages: [],
              })
              logger.info(`No chats found for workflow ${workflowId}, cleared chat state`)
            }

            logger.info(`Loaded ${data.chats.length} chats for workflow ${workflowId}`)
          } else {
            throw new Error('Invalid response format')
          }
        } catch (error) {
          logger.error('Failed to load chats:', error)
          set({
            chats: [],
            isLoadingChats: false,
            error: error instanceof Error ? error.message : 'Failed to load chats',
          })
        }
      },

      // Send a message
      sendMessage: async (message: string, options = {}) => {
        const { workflowId, currentChat, mode, revertState } = get()
        const { stream = true } = options

        if (!workflowId) {
          logger.warn('Cannot send message: no workflow ID set')
          return
        }

        // Create abort controller for this request
        const abortController = new AbortController()
        set({ isSendingMessage: true, error: null, abortController })

        const userMessage = createUserMessage(message)
        const streamingMessage = createStreamingMessage()

        // Handle message history rewriting if we're in revert state
        let newMessages: CopilotMessage[]
        if (revertState) {
          // Since we already truncated the history on revert (excluding the reverted message),
          // just append the new message and assistant response to the remaining messages
          const currentMessages = get().messages
          newMessages = [
            ...currentMessages, // Keep all remaining messages (reverted message already removed)
            userMessage, // Add new message
            streamingMessage // Add assistant response
          ]
          logger.info(`Added new message after revert point, continuing conversation from ${currentMessages.length} existing messages`)
          
          // Clear revert state since we're now continuing from this point
          set({ revertState: null, inputValue: '' })
        } else {
          // Normal message append
          newMessages = [...get().messages, userMessage, streamingMessage]
        }

        // Check if this is the first message before updating state
        const isFirstMessage = get().messages.length === 0 && !currentChat?.title

        set({ messages: newMessages })

        // Optimistic title update for first message
        if (isFirstMessage) {
          // Generate optimistic title from first few words of user message
          const optimisticTitle = message.length > 50 ? `${message.substring(0, 47)}...` : message

          set((state) => ({
            currentChat: state.currentChat
              ? {
                  ...state.currentChat,
                  title: optimisticTitle,
                }
              : state.currentChat,
          }))

          logger.info('Set optimistic title for first message:', optimisticTitle)
        }

        try {
          const result = await sendStreamingMessage({
            message,
            userMessageId: userMessage.id, // Send the frontend-generated ID
            chatId: currentChat?.id,
            workflowId,
            mode,
            createNewChat: !currentChat,
            stream,
            abortSignal: abortController.signal,
          })

          if (result.success && result.stream) {
            await get().handleStreamingResponse(result.stream, streamingMessage.id)

            // Invalidate chat cache after successful message to ensure fresh ordering
            // since the chat's updatedAt timestamp would have changed
            set({
              chatsLastLoadedAt: null,
              chatsLoadedForWorkflow: null,
            })
            logger.info('Invalidated chat cache after successful message send')
          } else {
            // Handle abort gracefully
            if (result.error === 'Request was aborted') {
              logger.info('Message sending was aborted by user')
              return // Don't throw or update state, abort handler already did
            }
            throw new Error(result.error || 'Failed to send message')
          }
        } catch (error) {
          // Check if this was an abort
          if (error instanceof Error && error.name === 'AbortError') {
            logger.info('Message sending was aborted')
            return // Don't update state, abort handler already did
          }

          const errorMessage = createErrorMessage(
            streamingMessage.id,
            'Sorry, I encountered an error while processing your message. Please try again.'
          )

          set((state) => ({
            messages: state.messages.map((msg) =>
              msg.id === streamingMessage.id ? errorMessage : msg
            ),
            error: handleStoreError(error, 'Failed to send message'),
            isSendingMessage: false,
            abortController: null,
          }))
        }
      },

      // Abort current message streaming
      abortMessage: () => {
        const { abortController, isSendingMessage, messages } = get()

        if (!isSendingMessage || !abortController) {
          logger.warn('Cannot abort: no active streaming request')
          return
        }

        logger.info('Aborting message streaming')
        set({ isAborting: true })

        try {
          // Abort the request
          abortController.abort()

          // Find the last streaming message and mark any executing tool calls as aborted
          const lastMessage = messages[messages.length - 1]
          if (lastMessage && lastMessage.role === 'assistant') {
            // Mark any executing tool calls as aborted
            const updatedToolCalls =
              lastMessage.toolCalls?.map((toolCall) =>
                toolCall.state === 'executing'
                  ? { ...toolCall, state: 'aborted' as const, endTime: Date.now() }
                  : toolCall
              ) || []

            // Update content blocks to reflect aborted tool calls
            const updatedContentBlocks =
              lastMessage.contentBlocks?.map((block) =>
                block.type === 'tool_call' && block.toolCall.state === 'executing'
                  ? {
                      ...block,
                      toolCall: {
                        ...block.toolCall,
                        state: 'aborted' as const,
                        endTime: Date.now(),
                      },
                    }
                  : block
              ) || []

            const abortedCount = updatedToolCalls.filter((tc) => tc.state === 'aborted').length

            set((state) => ({
              messages: state.messages.map((msg) =>
                msg.id === lastMessage.id
                  ? {
                      ...msg,
                      toolCalls: updatedToolCalls,
                      contentBlocks: updatedContentBlocks,
                    }
                  : msg
              ),
              isSendingMessage: false,
              isAborting: false,
              abortController: null,
            }))

            logger.info(
              `Message streaming aborted successfully. Marked ${abortedCount} tool calls as aborted.`
            )

            // Save the aborted state to database immediately
            const { currentChat } = get()
            if (currentChat && abortedCount > 0) {
              try {
                const currentMessages = get().messages
                const dbMessages = currentMessages.map(msg => ({
                  id: msg.id,
                  role: msg.role,
                  content: msg.content,
                  timestamp: msg.timestamp,
                  ...(msg.toolCalls && msg.toolCalls.length > 0 && { toolCalls: msg.toolCalls }),
                  ...(msg.contentBlocks && msg.contentBlocks.length > 0 && { contentBlocks: msg.contentBlocks })
                }))

                fetch('/api/copilot/chat/update-messages', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ 
                    chatId: currentChat.id,
                    messages: dbMessages
                  })
                }).then(response => {
                  if (response.ok) {
                    logger.info('Successfully persisted aborted tool call states to database')
                  } else {
                    logger.error('Failed to persist aborted tool call states:', response.statusText)
                  }
                }).catch(error => {
                  logger.error('Error persisting aborted tool call states:', error)
                })
              } catch (error) {
                logger.error('Error persisting aborted tool call states:', error)
              }
            }
          } else {
            // No streaming message found, just reset the state
            set({
              isSendingMessage: false,
              isAborting: false,
              abortController: null,
            })
            logger.info('Message streaming aborted successfully')
          }
        } catch (error) {
          logger.error('Error during abort:', error)
          set({
            isSendingMessage: false,
            isAborting: false,
            abortController: null,
          })
        }
      },

      // Send implicit feedback
      sendImplicitFeedback: async (
        implicitFeedback: string,
        toolCallState?: 'applied' | 'rejected'
      ) => {
        const { workflowId, currentChat, mode } = get()

        if (!workflowId) {
          logger.warn('Cannot send implicit feedback: no workflow ID set')
          return
        }

        // Update the tool call state if provided
        if (toolCallState) {
          get().updatePreviewToolCallState(toolCallState)
        }

        // Create abort controller for this request
        const abortController = new AbortController()
        set({ isSendingMessage: true, error: null, abortController })

        // Create a new assistant message for the response
        const newAssistantMessage = createStreamingMessage()

        set((state) => ({
          messages: [...state.messages, newAssistantMessage],
        }))

        try {
          const result = await sendStreamingMessage({
            message: 'Please continue your response.', // Simple continuation prompt
            chatId: currentChat?.id,
            workflowId,
            mode,
            createNewChat: !currentChat,
            stream: true,
            implicitFeedback, // Pass the implicit feedback
            abortSignal: abortController.signal,
          })

          if (result.success && result.stream) {
            await get().handleStreamingResponse(result.stream, newAssistantMessage.id, false)
          } else {
            if (result.error === 'Request was aborted') {
              logger.info('Implicit feedback sending was aborted by user')
              return
            }
            throw new Error(result.error || 'Failed to send implicit feedback')
          }
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            logger.info('Implicit feedback sending was aborted')
            return
          }

          const errorMessage = createErrorMessage(
            newAssistantMessage.id,
            'Sorry, I encountered an error while processing your feedback. Please try again.'
          )

          set((state) => ({
            messages: state.messages.map((msg) =>
              msg.id === newAssistantMessage.id ? errorMessage : msg
            ),
            error: handleStoreError(error, 'Failed to send implicit feedback'),
            isSendingMessage: false,
            abortController: null,
          }))
        }
      },

      // Update preview tool call state
      updatePreviewToolCallState: (toolCallState: 'applied' | 'rejected') => {
        const { messages } = get()

        // Find the last message with a preview_workflow or targeted_updates tool call
        const lastMessageWithPreview = [...messages]
          .reverse()
          .find(
            (msg) =>
              msg.role === 'assistant' &&
              msg.toolCalls?.some(
                (tc) =>
                  tc.name === COPILOT_TOOL_IDS.BUILD_WORKFLOW ||
                  tc.name === COPILOT_TOOL_IDS.EDIT_WORKFLOW
              )
          )

        if (lastMessageWithPreview) {
          set((state) => ({
            messages: state.messages.map((msg) =>
              msg.id === lastMessageWithPreview.id
                ? {
                    ...msg,
                    toolCalls: msg.toolCalls?.map((tc) =>
                      tc.name === COPILOT_TOOL_IDS.BUILD_WORKFLOW ||
                      tc.name === COPILOT_TOOL_IDS.EDIT_WORKFLOW
                        ? { ...tc, state: toolCallState }
                        : tc
                    ),
                    contentBlocks: msg.contentBlocks?.map((block) =>
                      block.type === 'tool_call' &&
                      (block.toolCall.name === COPILOT_TOOL_IDS.BUILD_WORKFLOW ||
                        block.toolCall.name === COPILOT_TOOL_IDS.EDIT_WORKFLOW)
                        ? { ...block, toolCall: { ...block.toolCall, state: toolCallState } }
                        : block
                    ),
                  }
                : msg
            ),
          }))
          
          // Persist the updated tool call states to the database
          const { currentChat } = get()
          if (currentChat) {
            // Get the updated messages after state change
            const updatedMessages = get().messages
            const dbMessages = updatedMessages.map(msg => ({
              id: msg.id,
              role: msg.role,
              content: msg.content,
              timestamp: msg.timestamp,
              ...(msg.toolCalls && msg.toolCalls.length > 0 && { toolCalls: msg.toolCalls }),
              ...(msg.contentBlocks && msg.contentBlocks.length > 0 && { contentBlocks: msg.contentBlocks })
            }))

            fetch('/api/copilot/chat/update-messages', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                chatId: currentChat.id,
                messages: dbMessages
              })
            }).then(response => {
              if (response.ok) {
                logger.info('Successfully persisted updated tool call states to database')
              } else {
                logger.error('Failed to persist updated tool call states:', response.statusText)
              }
            }).catch(error => {
              logger.error('Error persisting updated tool call states:', error)
            })
          }
        } else {
          logger.warn('No message with workflow tool calls found for state update')
        }
      },

      // Send docs message - simplified without separate API
      sendDocsMessage: async (query: string) => {
        // Just send as a regular message since docs search is now a tool
        await get().sendMessage(query)
      },

      // Save chat messages - no-op for now
      saveChatMessages: async (chatId: string) => {
        logger.info('Chat saving handled automatically by backend')
      },

      // Load checkpoints - no-op (legacy)
      loadCheckpoints: async (chatId: string) => {
        logger.warn('Legacy checkpoint loading not implemented')
        set({ checkpoints: [] })
      },

      // Load message checkpoints
      loadMessageCheckpoints: async (chatId: string) => {
        const { workflowId } = get()
        if (!workflowId) {
          logger.warn('Cannot load message checkpoints: no workflow ID')
          return
        }

        set({ isLoadingCheckpoints: true, checkpointError: null })

        try {
          const response = await fetch(`/api/copilot/checkpoints?chatId=${chatId}`)
          if (!response.ok) {
            throw new Error(`Failed to load checkpoints: ${response.statusText}`)
          }

          const data = await response.json()
          if (data.success && Array.isArray(data.checkpoints)) {
            // Group checkpoints by messageId
            const messageCheckpoints: Record<string, WorkflowCheckpoint[]> = {}
            data.checkpoints.forEach((checkpoint: WorkflowCheckpoint) => {
              if (checkpoint.messageId) {
                if (!messageCheckpoints[checkpoint.messageId]) {
                  messageCheckpoints[checkpoint.messageId] = []
                }
                messageCheckpoints[checkpoint.messageId].push(checkpoint)
              }
            })

            set({ 
              messageCheckpoints,
              isLoadingCheckpoints: false 
            })
            logger.info(`Loaded checkpoints for ${Object.keys(messageCheckpoints).length} messages`)
          }
        } catch (error) {
          logger.error('Failed to load message checkpoints:', error)
          set({
            isLoadingCheckpoints: false,
            checkpointError: error instanceof Error ? error.message : 'Failed to load checkpoints'
          })
        }
      },

      // Revert to checkpoint
      revertToCheckpoint: async (checkpointId: string) => {
        set({ isRevertingCheckpoint: true, checkpointError: null })

        try {
          // Find the checkpoint to get its associated message
          const { messageCheckpoints, messages } = get()
          let checkpointMessage: CopilotMessage | null = null
          
          // Find which message this checkpoint belongs to
          for (const [messageId, checkpoints] of Object.entries(messageCheckpoints)) {
            const checkpoint = checkpoints.find(cp => cp.id === checkpointId)
            if (checkpoint) {
              checkpointMessage = messages.find(msg => msg.id === messageId) || null
              break
            }
          }

          const response = await fetch('/api/copilot/checkpoints/revert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ checkpointId })
          })

          if (!response.ok) {
            throw new Error(`Failed to revert checkpoint: ${response.statusText}`)
          }

          const result = await response.json()
          if (result.success && result.checkpoint?.workflowState) {
            logger.info(`Successfully reverted to checkpoint ${checkpointId}`)
            
            // Update the workflow store directly instead of refreshing the page
            // This follows the same pattern as diff acceptance
            const { useWorkflowStore } = await import('@/stores/workflows/workflow/store')
            const { useSubBlockStore } = await import('@/stores/workflows/subblock/store')
            const { useWorkflowRegistry } = await import('@/stores/workflows/registry/store')
            
            const checkpointState = result.checkpoint.workflowState
            const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
            
            // Update the main workflow store state
            useWorkflowStore.setState({
              blocks: checkpointState.blocks || {},
              edges: checkpointState.edges || [],
              loops: checkpointState.loops || {},
              parallels: checkpointState.parallels || {},
            })

            // Update the subblock store with the values from the checkpoint blocks
            if (activeWorkflowId) {
              const subblockValues: Record<string, Record<string, any>> = {}

              Object.entries(checkpointState.blocks || {}).forEach(([blockId, block]) => {
                subblockValues[blockId] = {}
                Object.entries((block as any).subBlocks || {}).forEach(([subblockId, subblock]) => {
                  subblockValues[blockId][subblockId] = (subblock as any).value
                })
              })

              useSubBlockStore.setState((state: any) => ({
                workflowValues: {
                  ...state.workflowValues,
                  [activeWorkflowId]: subblockValues,
                },
              }))
            }

            // Trigger save and history update
            const workflowStore = useWorkflowStore.getState()
            workflowStore.updateLastSaved()

            // Clear any pending diff changes since we've reverted to a checkpoint
            const { useWorkflowDiffStore } = await import('@/stores/workflow-diff')
            useWorkflowDiffStore.getState().clearDiff()

            // Set up revert state and populate input if we found the message
            if (checkpointMessage) {
              // Find the index of the reverted message and truncate chat history
              const currentMessages = get().messages
              const revertedMessageIndex = currentMessages.findIndex(msg => msg.id === checkpointMessage.id)
              
              let newMessages = currentMessages
              if (revertedMessageIndex !== -1) {
                // Keep only messages up to (but NOT including) the reverted message
                // since the reverted message is now in the text box for editing
                newMessages = currentMessages.slice(0, revertedMessageIndex)
                logger.info(`Truncated chat history: kept ${newMessages.length} messages, removed ${currentMessages.length - newMessages.length} messages from revert point onwards`)
              }

              set({
                revertState: {
                  messageId: checkpointMessage.id,
                  messageContent: checkpointMessage.content
                },
                inputValue: checkpointMessage.content,
                messages: newMessages // Update the chat UI immediately
              })
              logger.info('Set revert state, populated input, and updated chat UI')

              // Persist the truncated chat state to the database
              if (get().currentChat) {
                try {
                  const chatId = get().currentChat!.id
                  
                  // Format messages for database storage (same format as the chat API)
                  const dbMessages = newMessages.map(msg => ({
                    id: msg.id,
                    role: msg.role,
                    content: msg.content,
                    timestamp: msg.timestamp,
                    ...(msg.toolCalls && { toolCalls: msg.toolCalls }),
                    ...(msg.contentBlocks && { contentBlocks: msg.contentBlocks })
                  }))

                  const response = await fetch('/api/copilot/chat/update-messages', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                      chatId,
                      messages: dbMessages
                    })
                  })

                  if (!response.ok) {
                    logger.error('Failed to persist truncated chat state:', response.statusText)
                  } else {
                    logger.info('Successfully persisted truncated chat state to database')
                    
                    // Update the current chat object to reflect the new messages
                    set((state) => ({
                      currentChat: state.currentChat ? {
                        ...state.currentChat,
                        messages: newMessages,
                        updatedAt: new Date()
                      } : state.currentChat,
                      // Invalidate chat cache to ensure fresh data on reload
                      chatsLastLoadedAt: null,
                      chatsLoadedForWorkflow: null,
                    }))
                  }
                } catch (error) {
                  logger.error('Error persisting truncated chat state:', error)
                }
              }
            }

            logger.info('Successfully applied checkpoint state to workflow store and cleared pending diffs')
          } else {
            throw new Error(result.error || 'Failed to revert checkpoint')
          }
        } catch (error) {
          logger.error('Failed to revert to checkpoint:', error)
          set({
            checkpointError: error instanceof Error ? error.message : 'Failed to revert checkpoint'
          })
          throw error
        } finally {
          set({ isRevertingCheckpoint: false })
        }
      },

      getCheckpointsForMessage: (messageId: string) => {
        const { messageCheckpoints } = get()
        return messageCheckpoints[messageId] || []
      },

      // Set preview YAML
      setPreviewYaml: async (yamlContent: string) => {
        const { currentChat } = get()
        if (!currentChat) {
          logger.warn('Cannot set preview YAML: no current chat')
          return
        }

        set((state) => ({
          currentChat: state.currentChat
            ? {
                ...state.currentChat,
                previewYaml: yamlContent,
              }
            : null,
        }))
        logger.info('Preview YAML set locally')
      },

      // Clear preview YAML
      clearPreviewYaml: async () => {
        const { currentChat } = get()
        if (!currentChat) {
          logger.warn('Cannot clear preview YAML: no current chat')
          return
        }

        set((state) => ({
          currentChat: state.currentChat
            ? {
                ...state.currentChat,
                previewYaml: null,
              }
            : null,
        }))
        logger.info('Preview YAML cleared locally')
      },

      // Handle streaming response
      handleStreamingResponse: async (
        stream: ReadableStream,
        messageId: string,
        isContinuation = false
      ) => {
        const reader = stream.getReader()
        const decoder = new TextDecoder()

        // Initialize streaming context
        const context: StreamingContext = {
          messageId,
          accumulatedContent: '',
          toolCalls: [],
          contentBlocks: [],
          currentTextBlock: null,
          currentBlockType: null,
          toolCallBuffer: null,
          doneEventCount: 0,
        }

        // If continuation, preserve existing message state
        if (isContinuation) {
          const { messages } = get()
          const existingMessage = messages.find((msg) => msg.id === messageId)
          if (existingMessage) {
            context.accumulatedContent = existingMessage.content || ''
            context.toolCalls = existingMessage.toolCalls ? [...existingMessage.toolCalls] : []
            context.contentBlocks = existingMessage.contentBlocks
              ? [...existingMessage.contentBlocks]
              : []
          }
        }

        // Add timeout to prevent hanging
        const timeoutId = setTimeout(() => {
          logger.warn('Stream timeout reached, completing response')
          reader.cancel()
        }, 120000) // 2 minute timeout

        try {
          // Process SSE events
          for await (const data of parseSSEStream(reader, decoder)) {
            const { abortController } = get()

            // Check if we should abort
            if (abortController?.signal.aborted) {
              logger.info('Stream reading aborted')
              break
            }

            // Get handler for this event type
            const handler = sseHandlers[data.type] || sseHandlers.default
            await handler(data, context, get, set)

            // Check if handler set stream completion flag
            if (context.streamComplete) {
              break
            }
          }

          // Stream ended - finalize the message
          logger.info(
            `Completed streaming response, content length: ${context.accumulatedContent.length}`
          )

          // Cancel any pending RAF updates and clear queue
          if (streamingUpdateRAF !== null) {
            cancelAnimationFrame(streamingUpdateRAF)
            streamingUpdateRAF = null
          }
          streamingUpdateQueue.clear()

          // Final update - build content from contentBlocks for final message
          const finalContent = context.contentBlocks
            .filter((block) => block.type === 'text')
            .map((block) => block.content)
            .join('')

          set((state) => ({
            messages: state.messages.map((msg) =>
              msg.id === messageId
                ? {
                    ...msg,
                    content: finalContent, // Set final content for non-streaming display
                    toolCalls: context.toolCalls,
                    contentBlocks: context.contentBlocks,
                  }
                : msg
            ),
            isSendingMessage: false,
            abortController: null,
          }))

          // Handle new chat creation if needed
          if (context.newChatId && !get().currentChat) {
            await get().handleNewChatCreation(context.newChatId)
          }

          // Save the complete message state (with contentBlocks and toolCalls) to database
          // This ensures all streamed content including thinking text and tool calls are persisted
          const { currentChat } = get()
          if (currentChat) {
            try {
              const currentMessages = get().messages
              const updatedMessage = currentMessages.find(msg => msg.id === messageId)
              
              if (updatedMessage && (updatedMessage.toolCalls?.length || updatedMessage.contentBlocks?.length)) {
                const dbMessages = currentMessages.map(msg => ({
                  id: msg.id,
                  role: msg.role,
                  content: msg.content,
                  timestamp: msg.timestamp,
                  ...(msg.toolCalls && msg.toolCalls.length > 0 && { toolCalls: msg.toolCalls }),
                  ...(msg.contentBlocks && msg.contentBlocks.length > 0 && { contentBlocks: msg.contentBlocks })
                }))

                const response = await fetch('/api/copilot/chat/update-messages', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ 
                    chatId: currentChat.id,
                    messages: dbMessages
                  })
                })

                if (response.ok) {
                  logger.info('Successfully persisted complete streaming state to database', {
                    messageId,
                    toolCallsCount: updatedMessage.toolCalls?.length || 0,
                    contentBlocksCount: updatedMessage.contentBlocks?.length || 0
                  })
                } else {
                  logger.error('Failed to persist complete streaming state:', response.statusText)
                }
              }
            } catch (error) {
              logger.error('Error persisting complete streaming state:', error)
            }
          }
        } catch (error) {
          // Handle AbortError gracefully
          if (error instanceof Error && error.name === 'AbortError') {
            logger.info('Stream reading was aborted by user')
            // Cancel any pending RAF updates and clear queue on abort
            if (streamingUpdateRAF !== null) {
              cancelAnimationFrame(streamingUpdateRAF)
              streamingUpdateRAF = null
            }
            streamingUpdateQueue.clear()
            return
          }

          logger.error('Error handling streaming response:', error)
          throw error
        } finally {
          clearTimeout(timeoutId)
        }
      },

      // Handle new chat creation after streaming
      handleNewChatCreation: async (newChatId: string) => {
        // Create a proper chat object from the ID
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
          chats: [newChat, ...get().chats],
          // Invalidate cache since we have a new chat
          chatsLastLoadedAt: null,
          chatsLoadedForWorkflow: null,
        })
        logger.info(`Created new chat from streaming response: ${newChatId}`)
      },

      // Clear error
      clearError: () => {
        set({ error: null })
      },

      // Clear save error state
      clearSaveError: () => {
        set({ saveError: null })
      },

      // Clear checkpoint error state
      clearCheckpointError: () => {
        set({ checkpointError: null })
      },

      // Retry saving chat messages
      retrySave: async (chatId: string) => {
        await get().saveChatMessages(chatId)
      },

      // Reset entire store
      reset: () => {
        set(initialState)
      },

      // Input control actions
      setInputValue: (value: string) => {
        set({ inputValue: value })
      },

      clearRevertState: () => {
        set({ revertState: null })
      },

      // Update the diff store with proposed workflow changes
      updateDiffStore: async (yamlContent: string, toolName?: string) => {
        try {
          // Import diff store dynamically to avoid circular dependencies
          const { useWorkflowDiffStore } = await import('@/stores/workflow-diff')

          logger.info('Updating diff store with copilot YAML', {
            yamlLength: yamlContent.length,
            yamlPreview: yamlContent.substring(0, 200),
            toolName: toolName || 'unknown',
          })

          // Check current diff store state before update
          const diffStoreBefore = useWorkflowDiffStore.getState()
          logger.info('Diff store state before update:', {
            isShowingDiff: diffStoreBefore.isShowingDiff,
            isDiffReady: diffStoreBefore.isDiffReady,
            hasDiffWorkflow: !!diffStoreBefore.diffWorkflow,
          })

          // Determine if we should clear or merge based on tool type and message context
          const { messages } = get()
          const currentMessage = messages[messages.length - 1]
          const messageHasExistingEdits =
            currentMessage?.toolCalls?.some(
              (tc) =>
                (tc.name === COPILOT_TOOL_IDS.BUILD_WORKFLOW ||
                  tc.name === COPILOT_TOOL_IDS.EDIT_WORKFLOW) &&
                tc.state !== 'executing'
            ) || false

          const shouldClearDiff =
            toolName === COPILOT_TOOL_IDS.BUILD_WORKFLOW || // build_workflow always clears
            (toolName === COPILOT_TOOL_IDS.EDIT_WORKFLOW && !messageHasExistingEdits) // first edit_workflow in message clears

          logger.info('Diff merge strategy:', {
            toolName,
            messageHasExistingEdits,
            shouldClearDiff,
          })

          // Generate diff analysis by comparing current vs proposed YAML
          // Skip diff analysis - let sim-agent handle it through /api/yaml/diff/create
          // The diff/create endpoint will compare against the current workflow state
          // and generate the diff analysis automatically
          logger.info('Proceeding to create diff without pre-analysis')

          // Set or merge the proposed changes in the diff store based on the strategy
          const diffStore = useWorkflowDiffStore.getState()

          logger.info('CopilotStore.updateDiffStore calling setProposedChanges with:', {
            yamlContentLength: yamlContent.length,
            diffAnalysis: undefined,
            diffAnalysisType: 'undefined',
            diffAnalysisUndefined: true,
            diffAnalysisNull: false,
            shouldClearDiff: shouldClearDiff,
            hasDiffWorkflow: !!diffStoreBefore.diffWorkflow,
          })

          if (shouldClearDiff || !diffStoreBefore.diffWorkflow) {
            // Use setProposedChanges which will create a new diff
            // Pass undefined to let sim-agent generate the diff analysis
            await diffStore.setProposedChanges(yamlContent, undefined)
          } else {
            // Use mergeProposedChanges which will merge into existing diff
            // Pass undefined to let sim-agent generate the diff analysis
            await diffStore.mergeProposedChanges(yamlContent, undefined)
          }

          // Check diff store state after update
          const diffStoreAfter = useWorkflowDiffStore.getState()

          // Log the diff state after update
          logger.info('CopilotStore diff updated:', {
            hasDiffWorkflow: !!diffStoreAfter.diffWorkflow,
            hasDiffAnalysis: !!diffStoreAfter.diffAnalysis,
            diffAnalysis: diffStoreAfter.diffAnalysis,
          })
          logger.info('Diff store state after update:', {
            isShowingDiff: diffStoreAfter.isShowingDiff,
            isDiffReady: diffStoreAfter.isDiffReady,
            hasDiffWorkflow: !!diffStoreAfter.diffWorkflow,
            diffWorkflowBlockCount: diffStoreAfter.diffWorkflow
              ? Object.keys(diffStoreAfter.diffWorkflow.blocks).length
              : 0,
          })

          logger.info('Successfully updated diff store with proposed workflow changes')
        } catch (error) {
          logger.error('Failed to update diff store:', error)
          // Show error to user
          console.error('[Copilot] Error updating diff store:', error)

          // Try to show at least the preview YAML even if diff fails
          const { currentChat } = get()
          if (currentChat?.previewYaml) {
            logger.info('Preview YAML is set, user can still view it despite diff error')
          }
        }
      },
    }),
    { name: 'copilot-store' }
  )
)
