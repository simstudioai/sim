'use client'

import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import {
  type CopilotChat,
  type CopilotMessage,
  sendStreamingMessage,
} from '@/lib/copilot/api'
import { createLogger } from '@/lib/logs/console-logger'
import type { CopilotStore } from './types'
import { COPILOT_TOOL_IDS } from './constants'
import { COPILOT_TOOL_DISPLAY_NAMES } from '@/stores/constants'

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
  // Use dynamically generated display names from the tool registry
  return COPILOT_TOOL_DISPLAY_NAMES[toolName] || toolName
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
    logger.info('Received tool_result event', { 
      toolCallId, 
      success, 
      hasResult: !!result,
      doneEventCount: context.doneEventCount,
      streamComplete: context.streamComplete
    })
    
    // Reset stream completion if we're still receiving tool results
    if (context.streamComplete) {
      logger.warn('Received tool result after stream marked complete, reopening stream')
      context.streamComplete = false
    }
    
    if (!toolCallId) return
    
    let toolCall = context.toolCalls.find((tc) => tc.id === toolCallId)
    if (!toolCall) {
      logger.warn('Tool call not found in context for result, checking content blocks', { 
        toolCallId,
        existingToolCalls: context.toolCalls.map(tc => ({ id: tc.id, name: tc.name }))
      })
      
      // Try to find the tool call in existing content blocks
      for (const block of context.contentBlocks) {
        if (block.type === 'tool_call' && block.toolCall.id === toolCallId) {
          toolCall = block.toolCall
          // Add it back to context.toolCalls so we can update it
          context.toolCalls.push(toolCall)
          logger.info('Found tool call in content blocks, added to context', {
            toolCallId,
            toolName: toolCall.name
          })
          break
        }
      }
      
      if (!toolCall) {
        logger.error('Tool call not found anywhere for result', { toolCallId })
        return
      }
    }
    
    logger.info('Found existing tool call for result', {
      name: toolCall.name,
      toolCallId,
    })
    
    if (success) {
      // Parse result if it's a string (sim agent sometimes stringifies the result)
      let parsedResult = result
      if (typeof result === 'string' && result.startsWith('{')) {
        try {
          parsedResult = JSON.parse(result)
        } catch (e) {
          logger.warn('Failed to parse tool result as JSON, using as-is', { toolName: toolCall.name })
        }
      }
      
      toolCall.result = parsedResult
      toolCall.endTime = Date.now()
      toolCall.duration = toolCall.endTime - (toolCall.startTime || Date.now())
      
      // Set appropriate state based on tool type
              if (toolCall.name === COPILOT_TOOL_IDS.BUILD_WORKFLOW || toolCall.name === COPILOT_TOOL_IDS.EDIT_WORKFLOW) {
        toolCall.state = 'ready_for_review'
      } else {
        toolCall.state = 'completed'
      }
      
      logger.info('Updated tool call result:', toolCallId, toolCall.name)
      
      // Update the content block to reflect the tool completion
      updateContentBlockToolCall(context.contentBlocks, toolCallId, toolCall)
      updateStreamingMessage(set, context)
      
      // Log successful tool completion
      logger.info('Tool completed successfully', {
        toolId: toolCallId,
        toolName: toolCall.name,
        state: toolCall.state,
        duration: toolCall.duration
      })

              // Handle successful build_workflow tool result
        if (toolCall.name === COPILOT_TOOL_IDS.BUILD_WORKFLOW) {
        // Check both direct yamlContent and nested data.yamlContent
        const yamlContent = parsedResult?.yamlContent || parsedResult?.data?.yamlContent
        if (yamlContent) {
          logger.info('Setting preview YAML from tool_result event', {
            yamlLength: yamlContent.length,
            yamlPreview: yamlContent.substring(0, 100),
          })
          get().setPreviewYaml(yamlContent)
          get().updateDiffStore(yamlContent, COPILOT_TOOL_IDS.BUILD_WORKFLOW)
        } else {
                      logger.warn('No yamlContent found in build_workflow result', {
            hasDirectYaml: !!parsedResult?.yamlContent,
            hasNestedYaml: !!parsedResult?.data?.yamlContent,
            resultStructure: Object.keys(parsedResult || {})
          })
        }
      }

              // Handle successful edit_workflow tool result
        if (toolCall.name === COPILOT_TOOL_IDS.EDIT_WORKFLOW) {
        // Check both direct yamlContent and nested data.yamlContent
        const yamlContent = parsedResult?.yamlContent || parsedResult?.data?.yamlContent
        if (yamlContent) {
          logger.info('Setting preview YAML from edit_workflow tool_result event', {
            yamlLength: yamlContent.length,
            yamlPreview: yamlContent.substring(0, 200),
          })
          get().setPreviewYaml(yamlContent)
          get().updateDiffStore(yamlContent, COPILOT_TOOL_IDS.EDIT_WORKFLOW)
        } else {
          logger.warn('No yamlContent found in edit_workflow result', {
            hasDirectYaml: !!parsedResult?.yamlContent,
            hasNestedYaml: !!parsedResult?.data?.yamlContent,
            resultStructure: Object.keys(parsedResult || {})
          })
        }
      }
    } else {
      // Tool execution failed
      toolCall.state = 'error'
      toolCall.error = result || 'Tool execution failed'
      logger.error('Tool call failed:', toolCallId, toolCall.name, result)

              // If build_workflow failed, send error back for retry
        if (toolCall.name === COPILOT_TOOL_IDS.BUILD_WORKFLOW) {
          logger.info('Build workflow tool execution failed, sending error back to agent for retry')
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
    if (!toolData) return
    
    // Check if this tool call already exists (in case of duplicate events)
    const existingToolCall = context.toolCalls.find(tc => tc.id === toolData.id)
    if (existingToolCall) {
      // If it's a partial update, we might want to update the existing tool call
      if (toolData.partial && toolData.arguments) {
        // Update partial arguments if needed
        existingToolCall.input = { ...existingToolCall.input, ...toolData.arguments }
      }
      logger.debug('Tool call already exists, skipping or updating', {
        id: toolData.id,
        name: toolData.name,
        partial: toolData.partial,
        existingState: existingToolCall.state
      })
      return
    }
    
    logger.info('Creating tool call from tool_call event', {
      id: toolData.id,
      name: toolData.name,
      hasArguments: !!toolData.arguments,
      partial: toolData.partial
    })
    
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
                    context.toolCallBuffer.name === COPILOT_TOOL_IDS.BUILD_WORKFLOW ||
          context.toolCallBuffer.name === COPILOT_TOOL_IDS.EDIT_WORKFLOW
            ? 'ready_for_review'
            : 'completed'
        context.toolCallBuffer.endTime = Date.now()
        context.toolCallBuffer.duration = context.toolCallBuffer.endTime - context.toolCallBuffer.startTime
        
        logger.info(`Tool call completed: ${context.toolCallBuffer.name}`, context.toolCallBuffer.input)
        
        updateContentBlockToolCall(context.contentBlocks, context.toolCallBuffer.id, context.toolCallBuffer)
        updateStreamingMessage(set, context)

        // Handle build_workflow completion
        if (context.toolCallBuffer.name === COPILOT_TOOL_IDS.BUILD_WORKFLOW) {
          // Check both direct yamlContent and nested data.yamlContent
          const yamlContent = context.toolCallBuffer.input?.yamlContent || 
                             context.toolCallBuffer.input?.data?.yamlContent
          if (yamlContent) {
            logger.info('Setting preview YAML from completed build_workflow tool call', {
              yamlLength: yamlContent.length,
              yamlPreview: yamlContent.substring(0, 100)
            })
            get().setPreviewYaml(yamlContent)
            get().updateDiffStore(yamlContent, COPILOT_TOOL_IDS.BUILD_WORKFLOW)
          }
        }

        // Handle edit_workflow completion
        if (context.toolCallBuffer.name === COPILOT_TOOL_IDS.EDIT_WORKFLOW) {
          // Check both direct yamlContent and nested data.yamlContent
          const yamlContent = context.toolCallBuffer.input?.yamlContent || 
                             context.toolCallBuffer.input?.data?.yamlContent
          if (yamlContent) {
            logger.info('Setting preview YAML from completed edit_workflow tool call', {
              yamlLength: yamlContent.length,
              yamlPreview: yamlContent.substring(0, 100)
            })
                      get().setPreviewYaml(yamlContent)
          get().updateDiffStore(yamlContent, COPILOT_TOOL_IDS.EDIT_WORKFLOW)
          }
        }
      } catch (error) {
        logger.error('Error parsing tool call input:', error)
        context.toolCallBuffer.state = 'error'
        context.toolCallBuffer.endTime = Date.now()
        context.toolCallBuffer.duration = context.toolCallBuffer.endTime - context.toolCallBuffer.startTime
        context.toolCallBuffer.error = error instanceof Error ? error.message : String(error)

        // Retry on build_workflow failure
        if (context.toolCallBuffer.name === COPILOT_TOOL_IDS.BUILD_WORKFLOW) {
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
  done: (data, context, get, set) => {
    context.doneEventCount++
    logger.info('Received done event from sim agent', {
      doneEventCount: context.doneEventCount,
      pendingToolCalls: context.toolCalls.filter(tc => tc.state === 'executing').length
    })
    
    context.currentTextBlock = null
    
    // Don't complete stream if there are still executing tool calls
    const executingToolCalls = context.toolCalls.filter(tc => tc.state === 'executing')
    if (executingToolCalls.length > 0) {
      logger.info('Done event received but tools still executing', {
        executingTools: executingToolCalls.map(tc => ({ id: tc.id, name: tc.name }))
      })
      return
    }
    
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

        // Reset state when switching workflows
        set({
          ...initialState,
          workflowId,
          mode: get().mode, // Preserve mode
        })
      },

      // Validate that current chat belongs to current workflow
      validateCurrentChat: () => {
        const { currentChat, workflowId } = get()

        if (!currentChat || !workflowId) {
          return false
        }

        // For now, we can't validate without the API
        // The backend will handle this validation
        return true
      },

      // Simple chat management without API calls
      selectChat: async (chat: CopilotChat) => {
        set({
          currentChat: chat,
          messages: chat.messages || [],
        })
        logger.info(`Selected chat: ${chat.title || 'Untitled'}`)
      },

      // Create a new chat locally (will be persisted when sending first message)
      createNewChat: async () => {
        const newChat: CopilotChat = {
          id: `temp-${Date.now()}`, // Temporary ID until backend creates real one
          title: null,
          model: 'gpt-4',
          messages: [],
          messageCount: 0,
          previewYaml: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }

        set({
          currentChat: newChat,
          messages: [],
        })
        logger.info('Created new local chat')
      },

      // Delete chat is now a no-op since we don't have the API
      deleteChat: async (chatId: string) => {
        logger.warn('Chat deletion not implemented without API endpoint')
        // The interface expects Promise<void>, not Promise<boolean>
      },

      // Load chats - now a no-op
      loadChats: async () => {
        logger.warn('Chat loading not implemented without API endpoint')
        set({ chats: [] })
      },

      // Send a message
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
                (tc) => tc.name === COPILOT_TOOL_IDS.BUILD_WORKFLOW || tc.name === COPILOT_TOOL_IDS.EDIT_WORKFLOW
              )
          )

        if (lastMessageWithPreview) {
          set((state) => ({
            messages: state.messages.map((msg) =>
              msg.id === lastMessageWithPreview.id
                ? {
                    ...msg,
                    toolCalls: msg.toolCalls?.map((tc) =>
                      tc.name === COPILOT_TOOL_IDS.BUILD_WORKFLOW || tc.name === COPILOT_TOOL_IDS.EDIT_WORKFLOW
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

      // Load checkpoints - no-op
      loadCheckpoints: async (chatId: string) => {
        logger.warn('Checkpoint loading not implemented')
        set({ checkpoints: [] })
      },

      // Revert checkpoint - no-op
      revertToCheckpoint: async (checkpointId: string) => {
        logger.warn('Checkpoint reverting not implemented')
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
            context.contentBlocks = existingMessage.contentBlocks ? [...existingMessage.contentBlocks] : []
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

          // Handle new chat creation if needed
          if (context.newChatId && !get().currentChat) {
            await get().handleNewChatCreation(context.newChatId)
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

      // Update the diff store with proposed workflow changes
      updateDiffStore: async (yamlContent: string, toolName?: string) => {
        try {
          // Import diff store dynamically to avoid circular dependencies
          const { useWorkflowDiffStore } = await import('@/stores/workflow-diff')

          logger.info('Updating diff store with copilot YAML', {
            yamlLength: yamlContent.length,
            yamlPreview: yamlContent.substring(0, 200),
            toolName: toolName || 'unknown'
          })

          // Check current diff store state before update
          const diffStoreBefore = useWorkflowDiffStore.getState()
          logger.info('Diff store state before update:', {
            isShowingDiff: diffStoreBefore.isShowingDiff,
            isDiffReady: diffStoreBefore.isDiffReady,
            hasDiffWorkflow: !!diffStoreBefore.diffWorkflow
          })

          // Determine if we should clear or merge based on tool type and message context
          const { messages } = get()
          const currentMessage = messages[messages.length - 1]
          const messageHasExistingEdits = currentMessage?.toolCalls?.some(
            tc => (tc.name === COPILOT_TOOL_IDS.BUILD_WORKFLOW || tc.name === COPILOT_TOOL_IDS.EDIT_WORKFLOW) && 
                  tc.state !== 'executing'
          ) || false

          const shouldClearDiff = 
            toolName === COPILOT_TOOL_IDS.BUILD_WORKFLOW || // build_workflow always clears
            (toolName === COPILOT_TOOL_IDS.EDIT_WORKFLOW && !messageHasExistingEdits) // first edit_workflow in message clears

          logger.info('Diff merge strategy:', {
            toolName,
            messageHasExistingEdits,
            shouldClearDiff
          })

          // Generate diff analysis by comparing current vs proposed YAML
          let diffAnalysis = null
          try {
            // Get current workflow as YAML for comparison
            const { useWorkflowYamlStore } = await import('@/stores/workflows/yaml/store')
            const currentYaml = useWorkflowYamlStore.getState().getYaml()

            logger.info('Got current workflow YAML for diff:', {
              currentYamlLength: currentYaml?.length || 0,
              hasCurrentYaml: !!currentYaml
            })

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

          // Set or merge the proposed changes in the diff store based on the strategy
          const diffStore = useWorkflowDiffStore.getState()
          if (shouldClearDiff || !diffStoreBefore.diffWorkflow) {
            // Use setProposedChanges which will create a new diff
          await diffStore.setProposedChanges(yamlContent, diffAnalysis)
          } else {
            // Use mergeProposedChanges which will merge into existing diff
            await diffStore.mergeProposedChanges(yamlContent, diffAnalysis)
          }

          // Check diff store state after update
          const diffStoreAfter = useWorkflowDiffStore.getState()
          logger.info('Diff store state after update:', {
            isShowingDiff: diffStoreAfter.isShowingDiff,
            isDiffReady: diffStoreAfter.isDiffReady,
            hasDiffWorkflow: !!diffStoreAfter.diffWorkflow,
            diffWorkflowBlockCount: diffStoreAfter.diffWorkflow ? Object.keys(diffStoreAfter.diffWorkflow.blocks).length : 0
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
