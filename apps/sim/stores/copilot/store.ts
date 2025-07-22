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
  error: null,
  saveError: null,
  checkpointError: null,
  workflowId: null,
}

/**
 * Helper function to create a new user message
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
      setWorkflowId: (workflowId: string | null) => {
        const currentWorkflowId = get().workflowId
        if (currentWorkflowId !== workflowId) {
          logger.info(`Workflow ID changed from ${currentWorkflowId} to ${workflowId}`)

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
        const { workflowId } = get()

        if (!workflowId) {
          logger.error('Cannot select chat: no workflow ID set')
          return
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
        const { workflowId } = get()
        if (!workflowId) {
          logger.warn('Cannot create chat: no workflow ID set')
          return
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

        set({ isSendingMessage: true, error: null })

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
          })

          if (result.success && result.stream) {
            await get().handleStreamingResponse(result.stream, streamingMessage.id)
          } else {
            throw new Error(result.error || 'Failed to send message')
          }
        } catch (error) {
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

        set({ isSendingMessage: true, error: null })

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
          })

          if (result.success && result.stream) {
            await get().handleStreamingResponse(result.stream, streamingMessage.id)
          } else {
            throw new Error(result.error || 'Failed to send docs message')
          }
        } catch (error) {
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
          }))
        }
      },

      // Handle streaming response
      handleStreamingResponse: async (stream: ReadableStream, messageId: string) => {
        const reader = stream.getReader()
        const decoder = new TextDecoder()
        let accumulatedContent = ''
        let newChatId: string | undefined
        let streamComplete = false

        try {
          while (true) {
            const { done, value } = await reader.read()

            if (done || streamComplete) break

            const chunk = decoder.decode(value, { stream: true })
            const lines = chunk.split('\n')

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.slice(6))

                  if (data.type === 'metadata') {
                    if (data.chatId) {
                      newChatId = data.chatId
                    }
                  } else if (data.type === 'content') {
                    accumulatedContent += data.content

                    // Update the streaming message
                    set((state) => ({
                      messages: state.messages.map((msg) =>
                        msg.id === messageId ? { ...msg, content: accumulatedContent } : msg
                      ),
                    }))
                  } else if (data.type === 'complete') {
                    // Final update
                    set((state) => ({
                      messages: state.messages.map((msg) =>
                        msg.id === messageId ? { ...msg, content: accumulatedContent } : msg
                      ),
                      isSendingMessage: false,
                    }))

                    // Save chat to database after streaming completes
                    const chatIdToSave = newChatId || get().currentChat?.id
                    if (chatIdToSave) {
                      try {
                        await get().saveChatMessages(chatIdToSave)
                      } catch (saveError) {
                        logger.warn(`Chat save failed after streaming: ${saveError}`)
                      }
                    }

                    // Handle new chat creation
                    if (newChatId && !get().currentChat) {
                      await get().handleNewChatCreation(newChatId)
                    }

                    streamComplete = true
                    break
                  } else if (data.type === 'error') {
                    throw new Error(data.error || 'Streaming error')
                  }
                } catch (parseError) {
                  logger.warn('Failed to parse SSE data:', parseError)
                }
              }
            }
          }

          logger.info(`Completed streaming response, content length: ${accumulatedContent.length}`)
        } catch (error) {
          logger.error('Error handling streaming response:', error)
          throw error
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
        const { messages } = get()
        set({ isSaving: true, saveError: null })

        try {
          const result = await updateChatMessages(chatId, messages)

          if (result.success && result.chat) {
            // Update local state with the saved chat
            set({
              currentChat: result.chat,
              messages: result.chat.messages,
              isSaving: false,
              saveError: null,
            })

            // Update the chat in the chats list (atomic check, update, or add)
            set((state) => {
              const chatExists = state.chats.some((chat) => chat.id === result.chat!.id)

              if (!chatExists) {
                // Chat doesn't exist, add it to the beginning
                return {
                  chats: [result.chat!, ...state.chats],
                }
              }
              // Chat exists, update it
              const updatedChats = state.chats.map((chat) =>
                chat.id === result.chat!.id ? result.chat! : chat
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
    }),
    { name: 'copilot-store' }
  )
)
