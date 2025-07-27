import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import {
  type CopilotChat,
  type CopilotMessage,
  createChat,
  deleteChat as deleteApiChat,
  getChat,
  listChats,
  listCheckpoints,
  revertToCheckpoint,
  sendStreamingDocsMessage,
  sendStreamingMessage,
  updateChatMessages,
} from '@/lib/copilot/api'
import { createLogger } from '@/lib/logs/console-logger'
import type { CopilotStore } from './types'

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
  switch (toolName) {
    case 'docs_search_internal':
      return 'Searching documentation'
    case 'get_user_workflow':
      return 'Analyzing your workflow'
    case 'preview_workflow':
      return 'Preview workflow changes'
    case 'get_blocks_and_tools':
      return 'Getting block information'
    case 'get_blocks_metadata':
      return 'Getting block metadata'
    case 'get_yaml_structure':
      return 'Analyzing workflow structure'
    case 'edit_workflow':
      return 'Editing your workflow'
    case 'serper_search':
      return 'Searching online'
    case 'get_workflow_examples':
      return 'Reviewing the design'
    case 'get_environment_variables':
      return 'Checking your environment variables'
    case 'set_environment_variables':
      return 'Setting your environment variables'
    case 'targeted_updates':
      return 'Editing workflow'
    default:
      return toolName.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())
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

interface SSEHandler {
  (data: any, context: StreamingContext, get: () => CopilotStore, set: any): Promise<void> | void
}

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

  // Handle tool result events (custom event for preview_workflow)
  tool_result: (data, context, get, set) => {
    const { toolCallId, result, success } = data
    logger.info('Received tool_result event', { toolCallId, success, hasResult: !!result })
    
    if (!toolCallId) return
    
    const toolCall = context.toolCalls.find((tc) => tc.id === toolCallId)
    if (!toolCall) return
    
    logger.info('Found existing tool call for result', {
      name: toolCall.name,
      toolCallId,
    })
    
    if (success) {
      toolCall.result = result
      toolCall.endTime = Date.now()
      toolCall.duration = toolCall.endTime - (toolCall.startTime || Date.now())
      
      // Set appropriate state based on tool type
      if (toolCall.name === 'preview_workflow' || toolCall.name === 'targeted_updates') {
        toolCall.state = 'ready_for_review'
      } else {
        toolCall.state = 'completed'
      }
      
      logger.info('Updated tool call result:', toolCallId, toolCall.name)

      // Handle successful preview_workflow tool result
      if (toolCall.name === 'preview_workflow' && result?.yamlContent) {
        logger.info('Setting preview YAML from tool_result event', {
          yamlLength: result.yamlContent.length,
          yamlPreview: result.yamlContent.substring(0, 100),
        })
        get().setPreviewYaml(result.yamlContent)
        get().updateDiffStore(result.yamlContent)
      }

      // Handle successful targeted_updates tool result
      if (toolCall.name === 'targeted_updates' && result?.yamlContent) {
        logger.info('Setting preview YAML from targeted_updates tool_result event', {
          yamlLength: result.yamlContent.length,
          yamlPreview: result.yamlContent.substring(0, 200),
        })
        get().setPreviewYaml(result.yamlContent)
        get().updateDiffStore(result.yamlContent)
      }
    } else {
      // Tool execution failed
      toolCall.state = 'error'
      toolCall.error = result || 'Tool execution failed'
      logger.error('Tool call failed:', toolCallId, toolCall.name, result)

      // If preview_workflow failed, send error back for retry
      if (toolCall.name === 'preview_workflow') {
        logger.info('Preview workflow tool execution failed, sending error back to agent for retry')
        setTimeout(() => {
          get().sendImplicitFeedback(
            `The previous workflow YAML generation failed with error: "${toolCall.error}". Please analyze the error and try generating the workflow YAML again with the necessary fixes.`
          )
        }, 1000)
      }
    }

    // Update contentBlocks with the updated tool call
    updateContentBlockToolCall(context.contentBlocks, toolCallId, toolCall)
    
    // Update message
    updateStreamingMessage(set, context)
  },

  // Handle Anthropic content block start
  content_block_start: (data, context, get, set) => {
    context.currentBlockType = data.content_block?.type

    if (context.currentBlockType === 'text') {
      context.currentTextBlock = {
        type: 'text',
        content: '',
        timestamp: Date.now(),
      }
    } else if (context.currentBlockType === 'tool_use') {
      // Start buffering a tool call
      context.toolCallBuffer = {
        id: data.content_block.id,
        name: data.content_block.name,
        displayName: getToolDisplayName(data.content_block.name),
        input: {},
        partialInput: '',
        state: 'executing',
        startTime: Date.now(),
      }
      context.toolCalls.push(context.toolCallBuffer)

      // Add tool call to content blocks
      context.contentBlocks.push({
        type: 'tool_call',
        toolCall: context.toolCallBuffer,
        timestamp: Date.now(),
      })

      logger.info(`Starting tool call: ${data.content_block.name}`)
      updateStreamingMessage(set, context)
    }
  },

  // Handle sim agent's content format
  content: (data, context, get, set) => {
    if (!data.data) return
    
    context.accumulatedContent += data.data
    
    // Create or update text block
    if (!context.currentTextBlock) {
      context.currentTextBlock = {
        type: 'text',
        content: data.data,
        timestamp: Date.now(),
      }
      context.contentBlocks.push(context.currentTextBlock)
    } else {
      context.currentTextBlock.content += data.data
      updateContentBlockText(context.contentBlocks, context.currentTextBlock)
    }
    
    updateStreamingMessage(set, context)
  },

  // Handle sim agent's tool call format
  tool_call: (data, context, get, set) => {
    const toolData = data.data
    if (!toolData || toolData.partial) return
    
    const toolCall = {
      id: toolData.id,
      name: toolData.name,
      input: toolData.arguments || {},
      state: 'executing',
      timestamp: Date.now(),
      displayName: getToolDisplayName(toolData.name),
      startTime: Date.now(),
    }
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
    logger.info('Tool execution started:', data.toolName)
    const toolCall = context.toolCalls.find(tc => tc.id === data.toolCallId)
    if (!toolCall) return
    
    toolCall.state = 'executing'
    updateContentBlockToolCall(context.contentBlocks, data.toolCallId, toolCall)
    updateStreamingMessage(set, context)
  },

  // Handle content block delta
  content_block_delta: (data, context, get, set) => {
    if (context.currentBlockType === 'text' && data.delta?.text) {
      context.accumulatedContent += data.delta.text
      
      if (context.currentTextBlock) {
        context.currentTextBlock.content += data.delta.text
        updateContentBlockText(context.contentBlocks, context.currentTextBlock)
      }
      
      updateStreamingMessage(set, context)
    } else if (context.currentBlockType === 'tool_use' && data.delta?.partial_json && context.toolCallBuffer) {
      context.toolCallBuffer.partialInput += data.delta.partial_json
    }
  },

  // Handle content block stop
  content_block_stop: (data, context, get, set) => {
    if (context.currentBlockType === 'text') {
      context.currentTextBlock = null
    } else if (context.currentBlockType === 'tool_use' && context.toolCallBuffer) {
      try {
        // Parse complete tool call input
        context.toolCallBuffer.input = JSON.parse(context.toolCallBuffer.partialInput || '{}')
        context.toolCallBuffer.state = 
          context.toolCallBuffer.name === 'preview_workflow' || 
          context.toolCallBuffer.name === 'targeted_updates'
            ? 'ready_for_review'
            : 'completed'
        context.toolCallBuffer.endTime = Date.now()
        context.toolCallBuffer.duration = context.toolCallBuffer.endTime - context.toolCallBuffer.startTime
        
        logger.info(`Tool call completed: ${context.toolCallBuffer.name}`, context.toolCallBuffer.input)
        
        updateContentBlockToolCall(context.contentBlocks, context.toolCallBuffer.id, context.toolCallBuffer)
        updateStreamingMessage(set, context)

        // Handle preview_workflow completion
        if (context.toolCallBuffer.name === 'preview_workflow' && context.toolCallBuffer.input?.yamlContent) {
          logger.info('Setting preview YAML from completed preview_workflow tool call')
          get().setPreviewYaml(context.toolCallBuffer.input.yamlContent)
          get().updateDiffStore(context.toolCallBuffer.input.yamlContent)
        }
      } catch (error) {
        logger.error('Error parsing tool call input:', error)
        context.toolCallBuffer.state = 'error'
        context.toolCallBuffer.endTime = Date.now()
        context.toolCallBuffer.duration = context.toolCallBuffer.endTime - context.toolCallBuffer.startTime
        context.toolCallBuffer.error = error instanceof Error ? error.message : String(error)

        // Retry on preview_workflow failure
        if (context.toolCallBuffer.name === 'preview_workflow') {
          setTimeout(() => {
            get().sendImplicitFeedback(
              `The previous workflow YAML generation failed with error: "${context.toolCallBuffer.error}". Please analyze the error and try generating the workflow YAML again with the necessary fixes.`
            )
          }, 1000)
        }
      }
      context.toolCallBuffer = null
    }
    context.currentBlockType = null
  },

  // Handle sim agent's done event
  done: (data, context) => {
    context.doneEventCount++
    logger.info('Received done event from sim agent', {
      doneEventCount: context.doneEventCount,
    })
    
    context.currentTextBlock = null
    
    // Complete stream after multiple done events (sim agent sends one after tools and one at end)
    if (context.doneEventCount >= 2) {
      logger.info('Received final done event, completing stream')
      context.streamComplete = true
    }
  },

  // Handle errors
  error: (data, context, get, set) => {
    logger.error('Received error:', data.error)
    set((state: CopilotStore) => ({
      messages: state.messages.map((msg: CopilotMessage) =>
        msg.id === context.messageId
          ? {
              ...msg,
              content: context.accumulatedContent || 'An error occurred while processing your request.',
              error: data.error,
            }
          : msg
      ),
    }))
    context.streamComplete = true
  },

  // Handle tool errors
  tool_error: (data, context) => {
    logger.error('Tool error:', data.toolName, data.error)
    const toolCall = context.toolCalls.find(tc => tc.id === data.toolCallId)
    if (toolCall) {
      toolCall.state = 'error'
      toolCall.error = data.error
    }
  },

  // Default handler for unhandled events
  default: (data) => {
    // Silently handle these common events
    const silentEvents = ['message_start', 'message_delta', 'message_stop']
    if (!silentEvents.includes(data.type)) {
      logger.debug('Unhandled SSE event type:', data.type)
    }
  }
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
    if (contentBlocks[i] === textBlock || 
        (contentBlocks[i].type === 'text' && contentBlocks[i].timestamp === textBlock.timestamp)) {
      contentBlocks[i] = { ...textBlock }
      break
    }
  }
}

/**
 * Helper function to update streaming message in state
 */
function updateStreamingMessage(set: any, context: StreamingContext) {
  set((state: CopilotStore) => ({
    messages: state.messages.map((msg: CopilotMessage) =>
      msg.id === context.messageId
        ? {
            ...msg,
            content: context.accumulatedContent,
            toolCalls: [...context.toolCalls],
            contentBlocks: [...context.contentBlocks],
            lastUpdated: Date.now(),
          }
        : msg
    ),
  }))
}

/**
 * Parse SSE stream and handle events
 */
async function* parseSSEStream(reader: ReadableStreamDefaultReader<Uint8Array>, decoder: TextDecoder) {
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

      // Set current workflow ID
      setWorkflowId: async (workflowId: string | null) => {
        const currentWorkflowId = get().workflowId
        if (currentWorkflowId !== workflowId) {
          logger.info(`Workflow ID changed from ${currentWorkflowId} to ${workflowId}`)

          // Auto-reject any pending diff changes before switching workflows
          try {
            // Import diff store dynamically to avoid circular dependencies
            const { useWorkflowDiffStore } = await import('@/stores/workflow-diff')
            const diffStore = useWorkflowDiffStore.getState()

            // Check if there are any pending diff changes
            if (diffStore.diffWorkflow && diffStore.isDiffReady) {
              logger.info('Auto-rejecting pending diff changes before workflow change')

              // Reject the changes in the diff store
              diffStore.rejectChanges()

              // Update copilot tool call state and clear preview YAML
              get().updatePreviewToolCallState('rejected')
              await get().clearPreviewYaml()

              logger.info('Successfully auto-rejected pending diff changes')
            }
          } catch (error) {
            logger.error('Failed to auto-reject pending changes during workflow change:', error)
            // Don't prevent workflow change if cleanup fails
          }

          // Clear all state to prevent cross-workflow data leaks
          set({
            workflowId,
            currentChat: null,
            chats: [],
            messages: [],
            error: null,
            saveError: null,
            isSaving: false,
            isLoading: false,
            isLoadingChats: false,
          })

          // Load chats for the new workflow
          if (workflowId) {
            get()
              .loadChats()
              .catch((error) => {
                logger.error('Failed to load chats after workflow change:', error)
              })
          }
        }
      },

      // Validate current chat belongs to current workflow
      validateCurrentChat: () => {
        const { currentChat, chats, workflowId } = get()

        if (!currentChat || !workflowId) {
          return true
        }

        // Check if current chat exists in the current workflow's chat list
        const chatBelongsToWorkflow = chats.some((chat) => chat.id === currentChat.id)

        if (!chatBelongsToWorkflow) {
          logger.warn(`Current chat ${currentChat.id} does not belong to workflow ${workflowId}`)
          set({
            currentChat: null,
            messages: [],
          })
          return false
        }

        return true
      },

      // Load chats for current workflow
      loadChats: async () => {
        const { workflowId } = get()
        if (!workflowId) {
          logger.warn('Cannot load chats: no workflow ID set')
          return
        }

        set({ isLoadingChats: true, error: null })

        try {
          const result = await listChats(workflowId)

          if (result.success) {
            set({
              chats: result.chats,
              isLoadingChats: false,
            })
            logger.info(`Loaded ${result.chats.length} chats for workflow ${workflowId}`)

            // Auto-select the most recent chat if no current chat is selected and chats exist
            const { currentChat } = get()
            if (!currentChat && result.chats.length > 0) {
              // Sort by updatedAt descending to get the most recent chat
              const sortedChats = [...result.chats].sort(
                (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
              )
              const mostRecentChat = sortedChats[0]

              logger.info(`Auto-selecting most recent chat: ${mostRecentChat.title || 'Untitled'}`)
              await get().selectChat(mostRecentChat)
            }
          } else {
            throw new Error(result.error || 'Failed to load chats')
          }
        } catch (error) {
          set({
            error: handleStoreError(error, 'Failed to load chats'),
            isLoadingChats: false,
          })
        }
      },

      // Select a specific chat
      selectChat: async (chat: CopilotChat) => {
        const { workflowId, currentChat } = get()

        if (!workflowId) {
          logger.error('Cannot select chat: no workflow ID set')
          return
        }

        // Auto-reject any pending diff changes before switching chats
        if (currentChat && currentChat.id !== chat.id) {
          logger.info(`Chat change detected: ${currentChat.id} -> ${chat.id}`)
          try {
            // Import diff store dynamically to avoid circular dependencies
            const { useWorkflowDiffStore } = await import('@/stores/workflow-diff')
            const diffStore = useWorkflowDiffStore.getState()

            logger.info('Diff store state:', {
              hasDiffWorkflow: !!diffStore.diffWorkflow,
              isDiffReady: diffStore.isDiffReady,
              isShowingDiff: diffStore.isShowingDiff,
            })

            // Check if there are any pending diff changes
            if (diffStore.diffWorkflow && diffStore.isDiffReady) {
              logger.info('Auto-rejecting pending diff changes before chat change')

              // Reject the changes in the diff store
              diffStore.rejectChanges()

              // Update copilot tool call state and clear preview YAML
              get().updatePreviewToolCallState('rejected')
              await get().clearPreviewYaml()

              logger.info('Successfully auto-rejected pending diff changes')
            } else {
              logger.info('No pending diff changes to reject')
            }
          } catch (error) {
            logger.error('Failed to auto-reject pending changes during chat change:', error)
            // Don't prevent chat change if cleanup fails
          }
        } else {
          logger.info('No chat change detected or no current chat')
        }

        set({ isLoading: true, error: null })

        try {
          const result = await getChat(chat.id)

          if (result.success && result.chat) {
            // Verify workflow hasn't changed during selection
            const currentWorkflow = get().workflowId
            if (currentWorkflow !== workflowId) {
              logger.warn('Workflow changed during chat selection')
              set({ isLoading: false })
              return
            }

            set({
              currentChat: result.chat,
              messages: result.chat.messages,
              isLoading: false,
            })

            logger.info(`Selected chat: ${result.chat.title || 'Untitled'}`)
          } else {
            throw new Error(result.error || 'Failed to load chat')
          }
        } catch (error) {
          set({
            error: handleStoreError(error, 'Failed to load chat'),
            isLoading: false,
          })
        }
      },

      // Create a new chat
      createNewChat: async (options = {}) => {
        const { workflowId, currentChat } = get()
        if (!workflowId) {
          logger.warn('Cannot create chat: no workflow ID set')
          return
        }

        // Auto-reject any pending diff changes before creating new chat
        if (currentChat) {
          logger.info(`Creating new chat while current chat exists: ${currentChat.id}`)
          try {
            // Import diff store dynamically to avoid circular dependencies
            const { useWorkflowDiffStore } = await import('@/stores/workflow-diff')
            const diffStore = useWorkflowDiffStore.getState()

            logger.info('Diff store state:', {
              hasDiffWorkflow: !!diffStore.diffWorkflow,
              isDiffReady: diffStore.isDiffReady,
              isShowingDiff: diffStore.isShowingDiff,
            })

            // Check if there are any pending diff changes
            if (diffStore.diffWorkflow && diffStore.isDiffReady) {
              logger.info('Auto-rejecting pending diff changes before creating new chat')

              // Reject the changes in the diff store
              diffStore.rejectChanges()

              // Update copilot tool call state and clear preview YAML
              get().updatePreviewToolCallState('rejected')
              await get().clearPreviewYaml()

              logger.info('Successfully auto-rejected pending diff changes')
            } else {
              logger.info('No pending diff changes to reject')
            }
          } catch (error) {
            logger.error('Failed to auto-reject pending changes during new chat creation:', error)
            // Don't prevent new chat creation if cleanup fails
          }
        } else {
          logger.info('Creating new chat with no current chat')
        }

        set({ isLoading: true, error: null })

        try {
          const result = await createChat(workflowId, options)

          if (result.success && result.chat) {
            set({
              currentChat: result.chat,
              messages: result.chat.messages,
              isLoading: false,
            })

            // Add the new chat to the chats list
            set((state) => ({
              chats: [result.chat!, ...state.chats],
            }))

            logger.info(`Created new chat: ${result.chat.id}`)
          } else {
            throw new Error(result.error || 'Failed to create chat')
          }
        } catch (error) {
          set({
            error: handleStoreError(error, 'Failed to create chat'),
            isLoading: false,
          })
        }
      },

      // Delete a chat
      deleteChat: async (chatId: string) => {
        try {
          const result = await deleteApiChat(chatId)

          if (result.success) {
            const { currentChat } = get()

            // Remove from chats list
            set((state) => ({
              chats: state.chats.filter((chat) => chat.id !== chatId),
            }))

            // If this was the current chat, clear it and select another one
            if (currentChat?.id === chatId) {
              // Get the updated chats list (after removal) in a single atomic operation
              const { chats: updatedChats } = get()
              const remainingChats = updatedChats.filter((chat) => chat.id !== chatId)

              if (remainingChats.length > 0) {
                const sortedByCreation = [...remainingChats].sort(
                  (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
                )
                set({
                  currentChat: null,
                  messages: [],
                })
                await get().selectChat(sortedByCreation[0])
              } else {
                set({
                  currentChat: null,
                  messages: [],
                })
              }
            }

            logger.info(`Deleted chat: ${chatId}`)
          } else {
            throw new Error(result.error || 'Failed to delete chat')
          }
        } catch (error) {
          set({
            error: handleStoreError(error, 'Failed to delete chat'),
          })
        }
      },

      // Send a regular message
      sendMessage: async (message: string, options = {}) => {
        const { workflowId, currentChat, mode } = get()
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

        set((state) => ({
          messages: [...state.messages, userMessage, streamingMessage],
        }))

        try {
          const result = await sendStreamingMessage({
            message,
            chatId: currentChat?.id,
            workflowId,
            mode,
            createNewChat: !currentChat,
            stream,
            abortSignal: abortController.signal,
          })

          if (result.success && result.stream) {
            await get().handleStreamingResponse(result.stream, streamingMessage.id)
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

          // Find the last streaming message and replace it with an aborted message
          const lastMessage = messages[messages.length - 1]
          if (lastMessage && lastMessage.role === 'assistant' && lastMessage.content === '') {
            const abortedMessage = createErrorMessage(
              lastMessage.id,
              'Message was cancelled. You can continue the conversation below.'
            )

            set((state) => ({
              messages: state.messages.map((msg) =>
                msg.id === lastMessage.id ? abortedMessage : msg
              ),
              isSendingMessage: false,
              isAborting: false,
              abortController: null,
            }))
          } else {
            // No streaming message found, just reset the state
            set({
              isSendingMessage: false,
              isAborting: false,
              abortController: null,
            })
          }

          logger.info('Message streaming aborted successfully')
        } catch (error) {
          logger.error('Error during abort:', error)
          set({
            isSendingMessage: false,
            isAborting: false,
            abortController: null,
          })
        }
      },

      // Update preview tool call state without sending feedback
      updatePreviewToolCallState: (toolCallState: 'applied' | 'rejected') => {
        const { messages } = get()

        // Find the last message with a preview_workflow or targeted_updates tool call
        const lastMessageWithPreview = [...messages]
          .reverse()
          .find(
            (msg) =>
              msg.role === 'assistant' &&
              msg.toolCalls?.some(
                (tc) => tc.name === 'preview_workflow' || tc.name === 'targeted_updates'
              )
          )

        if (lastMessageWithPreview) {
          set((state) => ({
            messages: state.messages.map((msg) =>
              msg.id === lastMessageWithPreview.id
                ? {
                    ...msg,
                    toolCalls: msg.toolCalls?.map((tc) =>
                      tc.name === 'preview_workflow' || tc.name === 'targeted_updates'
                        ? { ...tc, state: toolCallState }
                        : tc
                    ),
                    contentBlocks: msg.contentBlocks?.map((block) =>
                      block.type === 'tool_call' &&
                      (block.toolCall.name === 'preview_workflow' ||
                        block.toolCall.name === 'targeted_updates')
                        ? { ...block, toolCall: { ...block.toolCall, state: toolCallState } }
                        : block
                    ),
                  }
                : msg
            ),
          }))
        }
      },

      // Send implicit feedback and update preview tool call state
      sendImplicitFeedback: async (
        implicitFeedback: string,
        toolCallState?: 'applied' | 'rejected'
      ) => {
        const { workflowId, currentChat, mode, messages } = get()

        if (!workflowId) {
          logger.warn('Cannot send implicit feedback: no workflow ID set')
          return
        }

        // Create abort controller for this request
        const abortController = new AbortController()
        set({ isSendingMessage: true, error: null, abortController })

        // Update the preview_workflow or targeted_updates tool call state if provided
        if (toolCallState) {
          // Find the last message with a preview_workflow or targeted_updates tool call
          const lastMessageWithPreview = [...messages]
            .reverse()
            .find(
              (msg) =>
                msg.role === 'assistant' &&
                msg.toolCalls?.some(
                  (tc) => tc.name === 'preview_workflow' || tc.name === 'targeted_updates'
                )
            )

          if (lastMessageWithPreview) {
            set((state) => ({
              messages: state.messages.map((msg) =>
                msg.id === lastMessageWithPreview.id
                  ? {
                      ...msg,
                      toolCalls: msg.toolCalls?.map((tc) =>
                        tc.name === 'preview_workflow' || tc.name === 'targeted_updates'
                          ? { ...tc, state: toolCallState }
                          : tc
                      ),
                      contentBlocks: msg.contentBlocks?.map((block) =>
                        block.type === 'tool_call' &&
                        (block.toolCall.name === 'preview_workflow' ||
                          block.toolCall.name === 'targeted_updates')
                          ? { ...block, toolCall: { ...block.toolCall, state: toolCallState } }
                          : block
                      ),
                    }
                  : msg
              ),
            }))
          }
        }

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
            // Stream to the new assistant message (not continuation)
            await get().handleStreamingResponse(result.stream, newAssistantMessage.id, false)
          } else {
            // Handle abort gracefully
            if (result.error === 'Request was aborted') {
              logger.info('Implicit feedback sending was aborted by user')
              return // Don't throw or update state, abort handler already did
            }
            throw new Error(result.error || 'Failed to send implicit feedback')
          }
        } catch (error) {
          // Check if this was an abort
          if (error instanceof Error && error.name === 'AbortError') {
            logger.info('Implicit feedback sending was aborted')
            return // Don't update state, abort handler already did
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

      // Send a docs RAG message
      sendDocsMessage: async (query: string, options = {}) => {
        const { workflowId, currentChat } = get()
        const { stream = true, topK = 10 } = options

        if (!workflowId) {
          logger.warn('Cannot send docs message: no workflow ID set')
          return
        }

        // Create abort controller for this request
        const abortController = new AbortController()
        set({ isSendingMessage: true, error: null, abortController })

        const userMessage = createUserMessage(query)
        const streamingMessage = createStreamingMessage()

        set((state) => ({
          messages: [...state.messages, userMessage, streamingMessage],
        }))

        try {
          const result = await sendStreamingDocsMessage({
            query,
            topK,
            chatId: currentChat?.id,
            workflowId,
            createNewChat: !currentChat,
            stream,
            abortSignal: abortController.signal,
          })

          if (result.success && result.stream) {
            await get().handleStreamingResponse(result.stream, streamingMessage.id)
          } else {
            // Handle abort gracefully
            if (result.error === 'Request was aborted') {
              logger.info('Docs message sending was aborted by user')
              return // Don't throw or update state, abort handler already did
            }
            throw new Error(result.error || 'Failed to send docs message')
          }
        } catch (error) {
          // Check if this was an abort
          if (error instanceof Error && error.name === 'AbortError') {
            logger.info('Docs message sending was aborted')
            return // Don't update state, abort handler already did
          }

          const errorMessage = createErrorMessage(
            streamingMessage.id,
            'Sorry, I encountered an error while searching the documentation. Please try again.'
          )

          set((state) => ({
            messages: state.messages.map((msg) =>
              msg.id === streamingMessage.id ? errorMessage : msg
            ),
            error: handleStoreError(error, 'Failed to send docs message'),
            isSendingMessage: false,
            abortController: null,
          }))
        }
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

        // If continuation, start with existing message content
        if (isContinuation) {
          const { messages } = get()
          const existingMessage = messages.find((msg) => msg.id === messageId)
          context.accumulatedContent = existingMessage?.content || ''
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
          logger.info(`Completed streaming response, content length: ${context.accumulatedContent.length}`)

          // Final update
          set((state) => ({
            messages: state.messages.map((msg) =>
              msg.id === messageId
                ? {
                    ...msg,
                    content: context.accumulatedContent,
                    toolCalls: context.toolCalls,
                    contentBlocks: context.contentBlocks,
                  }
                : msg
            ),
            isSendingMessage: false,
            abortController: null,
          }))

          // Auto-save messages after streaming completes
          const { currentChat } = get()
          const chatIdToSave = currentChat?.id || context.newChatId

          if (chatIdToSave) {
            try {
              logger.info('Auto-saving chat messages after streaming completion')
              await get().saveChatMessages(chatIdToSave)
            } catch (error) {
              logger.error('Failed to auto-save chat messages:', error)
            }
          }
        } catch (error) {
          // Handle AbortError gracefully
          if (error instanceof Error && error.name === 'AbortError') {
            logger.info('Stream reading was aborted by user')
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
        try {
          const chatResult = await getChat(newChatId)
          if (chatResult.success && chatResult.chat) {
            // Set the new chat as current
            set({
              currentChat: chatResult.chat,
            })

            // Add to chats list if not already there (atomic check and update)
            set((state) => {
              const chatExists = state.chats.some((chat) => chat.id === newChatId)
              if (!chatExists) {
                return {
                  chats: [chatResult.chat!, ...state.chats],
                }
              }
              return state
            })
          }
        } catch (error) {
          logger.error('Failed to fetch new chat after creation:', error)
          // Fallback: reload all chats
          await get().loadChats()
        }
      },

      // Save chat messages to database
      saveChatMessages: async (chatId: string) => {
        const { messages, chats } = get()
        set({ isSaving: true, saveError: null })

        try {
          const result = await updateChatMessages(chatId, messages)

          if (result.success && result.chat) {
            const updatedChat = result.chat

            // Update local state with the saved chat
            // Don't overwrite messages - keep the current local state which has the latest content
            set({
              currentChat: updatedChat,
              isSaving: false,
              saveError: null,
            })

            // Update the chat in the chats list (atomic check, update, or add)
            set((state) => {
              const chatExists = state.chats.some((chat) => chat.id === updatedChat!.id)

              if (!chatExists) {
                // Chat doesn't exist, add it to the beginning
                return {
                  chats: [updatedChat!, ...state.chats],
                }
              }
              // Chat exists, update it
              const updatedChats = state.chats.map((chat) =>
                chat.id === updatedChat!.id ? updatedChat! : chat
              )
              return { chats: updatedChats }
            })

            logger.info(`Successfully saved chat ${chatId}`)
          } else {
            const errorMessage = result.error || 'Failed to save chat'
            set({
              isSaving: false,
              saveError: errorMessage,
            })
            throw new Error(errorMessage)
          }
        } catch (error) {
          const errorMessage = handleStoreError(error, 'Error saving chat')
          set({
            isSaving: false,
            saveError: errorMessage,
          })
          throw error
        }
      },

      // Load checkpoints for current chat
      loadCheckpoints: async (chatId: string) => {
        set({ isLoadingCheckpoints: true, checkpointError: null })

        try {
          const result = await listCheckpoints(chatId)

          if (result.success) {
            set({
              checkpoints: result.checkpoints,
              isLoadingCheckpoints: false,
            })
            logger.info(`Loaded ${result.checkpoints.length} checkpoints for chat ${chatId}`)
          } else {
            throw new Error(result.error || 'Failed to load checkpoints')
          }
        } catch (error) {
          set({
            checkpointError: handleStoreError(error, 'Failed to load checkpoints'),
            isLoadingCheckpoints: false,
          })
        }
      },

      // Revert to a specific checkpoint
      revertToCheckpoint: async (checkpointId: string) => {
        set({ isRevertingCheckpoint: true, checkpointError: null })

        try {
          const result = await revertToCheckpoint(checkpointId)

          if (result.success) {
            set({ isRevertingCheckpoint: false })
            logger.info(`Successfully reverted to checkpoint ${checkpointId}`)
          } else {
            throw new Error(result.error || 'Failed to revert to checkpoint')
          }
        } catch (error) {
          set({
            checkpointError: handleStoreError(error, 'Failed to revert to checkpoint'),
            isRevertingCheckpoint: false,
          })
        }
      },

      // Clear current messages
      clearMessages: () => {
        set({
          currentChat: null,
          messages: [],
          error: null,
        })
        logger.info('Cleared current chat and messages')
      },

      // Set preview YAML for current chat
      setPreviewYaml: async (yamlContent: string) => {
        const { currentChat } = get()
        if (!currentChat) {
          logger.warn('Cannot set preview YAML: no current chat')
          return
        }

        try {
          // Update local state immediately
          set((state) => ({
            currentChat: state.currentChat
              ? {
                  ...state.currentChat,
                  previewYaml: yamlContent,
                }
              : null,
          }))

          // Update database
          const response = await fetch('/api/copilot', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chatId: currentChat.id,
              previewYaml: yamlContent,
            }),
          })

          if (!response.ok) {
            throw new Error('Failed to save preview YAML')
          }

          logger.info('Preview YAML set successfully')
        } catch (error) {
          logger.error('Failed to set preview YAML:', error)
          // Revert local state on error
          set((state) => ({
            currentChat: state.currentChat
              ? {
                  ...state.currentChat,
                  previewYaml: null,
                }
              : null,
          }))
        }
      },

      // Clear preview YAML for current chat
      clearPreviewYaml: async () => {
        const { currentChat } = get()
        if (!currentChat) {
          logger.warn('Cannot clear preview YAML: no current chat')
          return
        }

        try {
          // Update local state immediately
          set((state) => ({
            currentChat: state.currentChat
              ? {
                  ...state.currentChat,
                  previewYaml: null,
                }
              : null,
          }))

          // Update database
          const response = await fetch('/api/copilot', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chatId: currentChat.id,
              previewYaml: null,
            }),
          })

          if (!response.ok) {
            throw new Error('Failed to clear preview YAML')
          }

          logger.info('Preview YAML cleared successfully')
        } catch (error) {
          logger.error('Failed to clear preview YAML:', error)
        }
      },

      // Clear error state
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

      // Update the diff store with proposed workflow changes
      updateDiffStore: async (yamlContent: string) => {
        try {
          // Import diff store dynamically to avoid circular dependencies
          const { useWorkflowDiffStore } = await import('@/stores/workflow-diff')

          logger.info('Updating diff store with copilot YAML')

          // Generate diff analysis by comparing current vs proposed YAML
          let diffAnalysis = null
          try {
            // Get current workflow as YAML for comparison
            const { useWorkflowYamlStore } = await import('@/stores/workflows/yaml/store')
            const currentYaml = useWorkflowYamlStore.getState().getYaml()

            // Call the diff API to compare current vs proposed YAML
            const diffResponse = await fetch('/api/workflows/diff', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                original_yaml: currentYaml,
                agent_yaml: yamlContent,
              }),
            })

            if (diffResponse.ok) {
              const diffResult = await diffResponse.json()
              if (diffResult.success && diffResult.data) {
                diffAnalysis = diffResult.data
                logger.info('Successfully generated diff analysis', {
                  newBlocks: diffAnalysis.new_blocks?.length || 0,
                  editedBlocks: diffAnalysis.edited_blocks?.length || 0,
                  deletedBlocks: diffAnalysis.deleted_blocks?.length || 0,
                })
              }
            } else {
              logger.warn('Failed to generate diff analysis, proceeding without it')
            }
          } catch (diffError) {
            logger.warn('Error generating diff analysis:', diffError)
            // Continue without diff analysis - blocks will be marked as unchanged
          }

          // Set the proposed changes in the diff store
          // The diff store now handles all YAML parsing and conversion internally
          const diffStore = useWorkflowDiffStore.getState()
          await diffStore.setProposedChanges(yamlContent, diffAnalysis)

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
