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

        // If this is a continuation, start with the existing message content
        let accumulatedContent = ''
        if (isContinuation) {
          const { messages } = get()
          const existingMessage = messages.find((msg) => msg.id === messageId)
          accumulatedContent = existingMessage?.content || ''
        }

        let newChatId: string | undefined
        let streamComplete = false

        // Track tool calls for native Anthropic events
        let currentBlockType: 'text' | 'tool_use' | null = null
        let toolCallBuffer: any = null
        const toolCalls: any[] = []

        // Track content blocks chronologically
        const contentBlocks: any[] = []
        let currentTextBlock: any = null

        // Add timeout to prevent hanging
        const timeoutId = setTimeout(() => {
          logger.warn('Stream timeout reached, completing response')
          streamComplete = true
        }, 120000) // 2 minute timeout

        try {
          while (true) {
            const { abortController } = get()

            // Check if we should abort
            if (abortController?.signal.aborted) {
              logger.info('Stream reading aborted')
              streamComplete = true
              break
            }

            const { done, value } = await reader.read()

            if (done || streamComplete) {
              logger.info('Stream ended - done:', done, 'streamComplete:', streamComplete)
              break
            }

            const chunk = decoder.decode(value, { stream: true })
            const lines = chunk.split('\n')

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.slice(6))

                  // Handle chat ID event (our custom event)
                  if (data.type === 'chat_id') {
                    newChatId = data.chatId
                    logger.info('Received chatId from stream:', newChatId)

                    // Update current chat if we don't have one
                    const { currentChat } = get()
                    if (!currentChat && newChatId) {
                      await get().handleNewChatCreation(newChatId)
                    }
                  }
                  // Handle tool result events (our custom event for preview_workflow)
                  else if (data.type === 'tool_result') {
                    const { toolCallId, result, success } = data
                    logger.info('Received tool_result event', {
                      toolCallId,
                      success,
                      hasResult: !!result,
                    })
                    if (toolCallId) {
                      // Find the corresponding tool call and update its result
                      const existingToolCall = toolCalls.find((tc) => tc.id === toolCallId)
                      if (existingToolCall) {
                        logger.info('Found existing tool call for result', {
                          name: existingToolCall.name,
                          toolCallId,
                        })
                        if (success) {
                          existingToolCall.result = result
                          logger.info(
                            'Updated tool call result:',
                            toolCallId,
                            existingToolCall.name
                          )

                          // Handle successful preview_workflow tool result
                          if (existingToolCall.name === 'preview_workflow' && result?.yamlContent) {
                            logger.info('Setting preview YAML from tool_result event', {
                              yamlLength: result.yamlContent.length,
                              yamlPreview: result.yamlContent.substring(0, 100),
                            })
                            get().setPreviewYaml(result.yamlContent)
                            get().updateDiffStore(result.yamlContent)
                          }

                          // Handle successful targeted_updates tool result
                          if (existingToolCall.name === 'targeted_updates') {
                            logger.info('Targeted updates tool_result received', {
                              hasResult: !!result,
                              resultType: typeof result,
                              resultKeys: result ? Object.keys(result) : [],
                              hasYamlContent: !!result?.yamlContent,
                              // Log the full result structure for debugging
                              fullResult: JSON.stringify(result, null, 2),
                            })

                            // The targeted_updates tool returns yamlContent directly in the result
                            if (result?.yamlContent) {
                              logger.info(
                                'Setting preview YAML from targeted_updates tool_result event',
                                {
                                  yamlLength: result.yamlContent.length,
                                  yamlPreview: result.yamlContent.substring(0, 200),
                                  // Log the full YAML for debugging
                                  fullYaml: result.yamlContent,
                                }
                              )
                              get().setPreviewYaml(result.yamlContent)
                              get().updateDiffStore(result.yamlContent)

                              // Set the tool call state to ready_for_review like preview_workflow
                              existingToolCall.state = 'ready_for_review'
                            } else {
                              logger.error('Targeted updates tool_result missing yamlContent', {
                                expectedPath: 'result.yamlContent',
                                actualStructure: JSON.stringify(result, null, 2),
                              })
                              // Set to error state if yamlContent is missing
                              existingToolCall.state = 'error'
                              existingToolCall.error = 'Missing yamlContent in result'
                            }
                          }
                        } else {
                          // Tool execution failed
                          existingToolCall.state = 'error'
                          existingToolCall.error = result || 'Tool execution failed'
                          logger.error(
                            'Tool call failed:',
                            toolCallId,
                            existingToolCall.name,
                            result
                          )

                          // If this is a preview_workflow tool that failed, send error back to agent
                          if (existingToolCall.name === 'preview_workflow') {
                            logger.info(
                              'Preview workflow tool execution failed, sending error back to agent for retry'
                            )
                            // Send the error back to the agent after a brief delay to let the UI update
                            setTimeout(() => {
                              get().sendImplicitFeedback(
                                `The previous workflow YAML generation failed with error: "${existingToolCall.error}". Please analyze the error and try generating the workflow YAML again with the necessary fixes.`
                              )
                            }, 1000)
                          }
                        }

                        // Update message with the result and content blocks
                        set((state) => ({
                          messages: state.messages.map((msg) =>
                            msg.id === messageId
                              ? {
                                  ...msg,
                                  content: accumulatedContent,
                                  toolCalls: [...toolCalls],
                                  contentBlocks: msg.contentBlocks?.map((block) =>
                                    block.type === 'tool_call' && block.toolCall.id === toolCallId
                                      ? { ...block, toolCall: { ...existingToolCall } }
                                      : block
                                  ),
                                }
                              : msg
                          ),
                        }))
                      }
                    }
                  }
                  // Handle native Anthropic SSE events
                  else if (data.type === 'message_start') {
                    logger.info('Message started')
                  } else if (data.type === 'content_block_start') {
                    currentBlockType = data.content_block?.type

                    if (currentBlockType === 'text') {
                      // Start a new text block
                      currentTextBlock = {
                        type: 'text',
                        content: '',
                        timestamp: Date.now(),
                      }
                    } else if (currentBlockType === 'tool_use') {
                      // Start buffering a tool call
                      toolCallBuffer = {
                        id: data.content_block.id,
                        name: data.content_block.name,
                        displayName: getToolDisplayName(data.content_block.name),
                        input: {},
                        partialInput: '',
                        state: 'executing',
                        startTime: Date.now(),
                      }
                      toolCalls.push(toolCallBuffer)

                      // Add tool call to content blocks
                      const toolCallBlock = {
                        type: 'tool_call',
                        toolCall: toolCallBuffer,
                        timestamp: Date.now(),
                      }
                      contentBlocks.push(toolCallBlock)

                      logger.info(`Starting tool call: ${data.content_block.name}`)

                      // Update message with content blocks
                      set((state) => ({
                        messages: state.messages.map((msg) =>
                          msg.id === messageId
                            ? {
                                ...msg,
                                content: accumulatedContent,
                                toolCalls: [...toolCalls],
                                contentBlocks: [...contentBlocks],
                              }
                            : msg
                        ),
                      }))
                    }
                  } else if (data.type === 'content_block_delta') {
                    if (currentBlockType === 'text' && data.delta?.text) {
                      // Add text content to accumulated content
                      if (
                        isContinuation &&
                        accumulatedContent &&
                        !accumulatedContent.endsWith(' ') &&
                        data.delta.text &&
                        !data.delta.text.startsWith(' ')
                      ) {
                        accumulatedContent += ` ${data.delta.text}`
                      } else {
                        accumulatedContent += data.delta.text
                      }

                      // Add text to current text block
                      if (currentTextBlock) {
                        currentTextBlock.content += data.delta.text

                        // Update the content blocks array with the streaming text block
                        const updatedContentBlocks = [...contentBlocks]
                        const existingBlockIndex = updatedContentBlocks.findIndex(
                          (block) =>
                            block.type === 'text' && block.timestamp === currentTextBlock.timestamp
                        )

                        if (existingBlockIndex >= 0) {
                          // Update existing block
                          updatedContentBlocks[existingBlockIndex] = { ...currentTextBlock }
                        } else {
                          // Add new text block to content blocks for real-time display
                          updatedContentBlocks.push({ ...currentTextBlock })
                        }

                        // Replace contentBlocks array contents
                        contentBlocks.splice(0, contentBlocks.length, ...updatedContentBlocks)
                      }

                      // Update message in real-time
                      set((state) => ({
                        messages: state.messages.map((msg) =>
                          msg.id === messageId
                            ? {
                                ...msg,
                                content: accumulatedContent,
                                toolCalls: [...toolCalls],
                                contentBlocks: [...contentBlocks],
                              }
                            : msg
                        ),
                      }))
                    } else if (
                      currentBlockType === 'tool_use' &&
                      data.delta?.partial_json &&
                      toolCallBuffer
                    ) {
                      // Buffer partial JSON for tool calls (silently)
                      toolCallBuffer.partialInput += data.delta.partial_json
                    }
                  } else if (data.type === 'content_block_stop') {
                    if (currentBlockType === 'text' && currentTextBlock) {
                      // Text block is already in contentBlocks from streaming, just clean up
                      currentTextBlock = null
                    } else if (currentBlockType === 'tool_use' && toolCallBuffer) {
                      try {
                        // Parse complete tool call input
                        toolCallBuffer.input = JSON.parse(toolCallBuffer.partialInput || '{}')
                        // Set preview_workflow and targeted_updates tools to ready_for_review, others to completed
                        toolCallBuffer.state =
                          toolCallBuffer.name === 'preview_workflow' ||
                          toolCallBuffer.name === 'targeted_updates'
                            ? 'ready_for_review'
                            : 'completed'
                        toolCallBuffer.endTime = Date.now()
                        toolCallBuffer.duration = toolCallBuffer.endTime - toolCallBuffer.startTime
                        logger.info(
                          `Tool call completed: ${toolCallBuffer.name}`,
                          toolCallBuffer.input
                        )

                        // Update message with completed tool call and content blocks
                        set((state) => ({
                          messages: state.messages.map((msg) =>
                            msg.id === messageId
                              ? {
                                  ...msg,
                                  content: accumulatedContent,
                                  toolCalls: [...toolCalls],
                                  contentBlocks: contentBlocks.map((block) =>
                                    block.type === 'tool_call' &&
                                    block.toolCall.id === toolCallBuffer.id
                                      ? { ...block, toolCall: { ...toolCallBuffer } }
                                      : block
                                  ),
                                }
                              : msg
                          ),
                        }))

                        // If this is a preview_workflow tool call, set the preview YAML and diff store
                        if (toolCallBuffer.name === 'preview_workflow') {
                          logger.info(
                            'Preview workflow tool completed with input:',
                            toolCallBuffer.input
                          )

                          if (toolCallBuffer.input?.yamlContent) {
                            logger.info(
                              'Setting preview YAML from completed preview_workflow tool call',
                              {
                                yamlLength: toolCallBuffer.input.yamlContent.length,
                                yamlPreview: toolCallBuffer.input.yamlContent.substring(0, 100),
                              }
                            )
                            get().setPreviewYaml(toolCallBuffer.input.yamlContent)

                            // Also update the diff store with the proposed workflow state
                            get().updateDiffStore(toolCallBuffer.input.yamlContent)
                          } else {
                            logger.warn(
                              'Preview workflow tool completed but no yamlContent found in input'
                            )
                          }
                        }

                        // Don't handle targeted_updates here - it needs to wait for the tool_result event
                        // The result isn't available yet at content_block_stop, only the input
                      } catch (error) {
                        logger.error('Error parsing tool call input:', error)
                        toolCallBuffer.state = 'error'
                        toolCallBuffer.endTime = Date.now()
                        toolCallBuffer.duration = toolCallBuffer.endTime - toolCallBuffer.startTime
                        toolCallBuffer.error =
                          error instanceof Error ? error.message : String(error)

                        // If this is a preview_workflow tool that failed, send error back to agent
                        if (toolCallBuffer.name === 'preview_workflow') {
                          logger.info(
                            'Preview workflow tool failed, sending error back to agent for retry'
                          )
                          // Send the error back to the agent after a brief delay to let the UI update
                          setTimeout(() => {
                            get().sendImplicitFeedback(
                              `The previous workflow YAML generation failed with error: "${toolCallBuffer.error}". Please analyze the error and try generating the workflow YAML again with the necessary fixes.`
                            )
                          }, 1000)
                        }
                      }
                      toolCallBuffer = null
                    }
                    currentBlockType = null
                  } else if (data.type === 'message_delta') {
                    // Handle token usage updates silently
                    if (data.delta?.stop_reason === 'tool_use') {
                      logger.info(
                        'Message stopped for tool use - backend will handle execution and continue'
                      )
                    }
                  } else if (data.type === 'message_stop') {
                    // Backend will continue streaming if there are tools to execute
                    // Don't break the loop - just continue listening for more events
                    logger.info('Message stopped - backend may continue after tool execution')

                    // Reset block state for potential continuation
                    currentBlockType = null
                    toolCallBuffer = null
                  } else if (data.type === 'error') {
                    // Handle error events from backend
                    logger.error('Backend error:', data.error)
                    streamComplete = true
                    break
                  } else {
                    // Log unhandled event types for debugging
                    logger.debug('Unhandled SSE event type:', data.type)
                  }
                } catch (parseError) {
                  logger.warn('Failed to parse SSE data:', parseError)
                }
              }
            }
          }

          // Stream ended naturally - finalize the message
          logger.info(`Completed streaming response, content length: ${accumulatedContent.length}`)

          // Text blocks are already in contentBlocks from streaming, no need to add again

          // Final update when stream actually ends
          set((state) => ({
            messages: state.messages.map((msg) =>
              msg.id === messageId
                ? {
                    ...msg,
                    content: accumulatedContent,
                    toolCalls: [...toolCalls],
                    contentBlocks: [...contentBlocks],
                  }
                : msg
            ),
            isSendingMessage: false,
            abortController: null, // Clear abort controller when streaming completes
          }))

          // Auto-save messages after streaming completes
          const { currentChat } = get()
          const chatIdToSave = currentChat?.id || newChatId

          if (chatIdToSave) {
            try {
              logger.info(
                'Auto-saving chat messages after streaming completion to chat:',
                chatIdToSave
              )
              await get().saveChatMessages(chatIdToSave)
            } catch (error) {
              logger.error('Failed to auto-save chat messages:', error)
            }
          } else {
            logger.warn('No chat ID available for auto-saving messages')
          }
        } catch (error) {
          // Handle AbortError gracefully - this is expected when user aborts
          if (error instanceof Error && error.name === 'AbortError') {
            logger.info('Stream reading was aborted by user')
            return // Don't throw or log as error
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
