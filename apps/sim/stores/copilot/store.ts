import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import {
  type CopilotChat,
  type CopilotMessage,
  createChat,
  deleteChat as deleteApiChat,
  getChat,
  listChats,
  sendStreamingDocsMessage,
  sendStreamingMessage,
  updateChatMessages,
} from '@/lib/copilot-api'
import { createLogger } from '@/lib/logs/console-logger'
import type { CopilotStore } from './types'

const logger = createLogger('CopilotStore')

/**
 * Initial state for the copilot store
 */
const initialState = {
  currentChat: null,
  chats: [],
  messages: [],
  isLoading: false,
  isLoadingChats: false,
  isSendingMessage: false,
  error: null,
  workflowId: null,
}

/**
 * Copilot store using the new unified API
 */
export const useCopilotStore = create<CopilotStore>()(
  devtools(
    (set, get) => ({
      ...initialState,

      // Set current workflow ID
      setWorkflowId: (workflowId: string | null) => {
        const currentWorkflowId = get().workflowId
        if (currentWorkflowId !== workflowId) {
          set({
            workflowId,
            currentChat: null,
            chats: [],
            messages: [],
            error: null,
          })

          // Load chats for the new workflow
          if (workflowId) {
            get().loadChats()
          }
        }
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

            // If no current chat and we have chats, optionally select the most recent one
            const { currentChat } = get()
            if (!currentChat && result.chats.length > 0) {
              // Auto-select most recent chat
              await get().selectChat(result.chats[0])
            }

            logger.info(`Loaded ${result.chats.length} chats for workflow ${workflowId}`)
          } else {
            throw new Error(result.error || 'Failed to load chats')
          }
        } catch (error) {
          logger.error('Failed to load chats:', error)
          set({
            error: error instanceof Error ? error.message : 'Failed to load chats',
            isLoadingChats: false,
          })
        }
      },

      // Select a specific chat
      selectChat: async (chat: CopilotChat) => {
        set({ isLoading: true, error: null })

        try {
          const result = await getChat(chat.id)

          if (result.success && result.chat) {
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
          logger.error('Failed to select chat:', error)
          set({
            error: error instanceof Error ? error.message : 'Failed to load chat',
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

            // Reload chats to include the new one
            await get().loadChats()

            logger.info(`Created new chat: ${result.chat.id}`)
          } else {
            throw new Error(result.error || 'Failed to create chat')
          }
        } catch (error) {
          logger.error('Failed to create new chat:', error)
          set({
            error: error instanceof Error ? error.message : 'Failed to create chat',
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

            // If this was the current chat, clear it
            if (currentChat?.id === chatId) {
              set({
                currentChat: null,
                messages: [],
              })
            }

            logger.info(`Deleted chat: ${chatId}`)
          } else {
            throw new Error(result.error || 'Failed to delete chat')
          }
        } catch (error) {
          logger.error('Failed to delete chat:', error)
          set({
            error: error instanceof Error ? error.message : 'Failed to delete chat',
          })
        }
      },

      // Send a regular message
      sendMessage: async (message: string, options = {}) => {
        const { workflowId, currentChat } = get()
        const { stream = true } = options

        console.log('[CopilotStore] sendMessage called:', {
          message,
          workflowId,
          hasCurrentChat: !!currentChat,
          stream,
        })

        if (!workflowId) {
          console.warn('[CopilotStore] No workflow ID set')
          logger.warn('Cannot send message: no workflow ID set')
          return
        }

        set({ isSendingMessage: true, error: null })

        // Add user message immediately
        const userMessage: CopilotMessage = {
          id: crypto.randomUUID(),
          role: 'user',
          content: message,
          timestamp: new Date().toISOString(),
        }

        // Add placeholder for streaming response
        const streamingMessage: CopilotMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: '',
          timestamp: new Date().toISOString(),
        }

        console.log('[CopilotStore] Adding messages to state:', {
          userMessageId: userMessage.id,
          streamingMessageId: streamingMessage.id,
        })

        set((state) => ({
          messages: [...state.messages, userMessage, streamingMessage],
        }))

        try {
          console.log('[CopilotStore] Requesting streaming response')
          const result = await sendStreamingMessage({
            message,
            chatId: currentChat?.id,
            workflowId,
            createNewChat: !currentChat,
            stream,
          })

          console.log('[CopilotStore] Streaming result:', {
            success: result.success,
            hasStream: !!result.stream,
            error: result.error,
          })

          if (result.success && result.stream) {
            console.log('[CopilotStore] Starting stream processing')
            await get().handleStreamingResponse(result.stream, streamingMessage.id)
            console.log('[CopilotStore] Stream processing completed')
          } else {
            console.error('[CopilotStore] Stream request failed:', result.error)
            throw new Error(result.error || 'Failed to send message')
          }
        } catch (error) {
          logger.error('Failed to send message:', error)

          // Replace streaming message with error
          const errorMessage: CopilotMessage = {
            id: streamingMessage.id,
            role: 'assistant',
            content:
              'Sorry, I encountered an error while processing your message. Please try again.',
            timestamp: new Date().toISOString(),
          }

          set((state) => ({
            messages: state.messages.map((msg) =>
              msg.id === streamingMessage.id ? errorMessage : msg
            ),
            error: error instanceof Error ? error.message : 'Failed to send message',
            isSendingMessage: false,
          }))
        }
      },

      // Send a docs RAG message
      sendDocsMessage: async (query: string, options = {}) => {
        const { workflowId, currentChat } = get()
        const { stream = true, topK = 5 } = options

        if (!workflowId) {
          logger.warn('Cannot send docs message: no workflow ID set')
          return
        }

        set({ isSendingMessage: true, error: null })

        // Add user message immediately
        const userMessage: CopilotMessage = {
          id: crypto.randomUUID(),
          role: 'user',
          content: query,
          timestamp: new Date().toISOString(),
        }

        // Add placeholder for streaming response
        const streamingMessage: CopilotMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: '',
          timestamp: new Date().toISOString(),
        }

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
          logger.error('Failed to send docs message:', error)

          // Replace streaming message with error
          const errorMessage: CopilotMessage = {
            id: streamingMessage.id,
            role: 'assistant',
            content:
              'Sorry, I encountered an error while searching the documentation. Please try again.',
            timestamp: new Date().toISOString(),
          }

          set((state) => ({
            messages: state.messages.map((msg) =>
              msg.id === streamingMessage.id ? errorMessage : msg
            ),
            error: error instanceof Error ? error.message : 'Failed to send docs message',
            isSendingMessage: false,
          }))
        }
      },

      // Handle streaming response (shared by both message types)
      handleStreamingResponse: async (stream: ReadableStream, messageId: string) => {
        console.log('[CopilotStore] handleStreamingResponse started:', {
          messageId,
          hasStream: !!stream,
        })

        const reader = stream.getReader()
        const decoder = new TextDecoder()
        let accumulatedContent = ''
        let newChatId: string | undefined
        let responseCitations: Array<{ id: number; title: string; url: string }> = []
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
                    // Get chatId and citations from metadata
                    if (data.chatId) {
                      newChatId = data.chatId
                    }
                    if (data.citations) {
                      responseCitations = data.citations
                    }
                    if (data.sources) {
                      // Convert sources to citations format
                      responseCitations = data.sources.map((source: any, index: number) => ({
                        id: index + 1,
                        title: source.title,
                        url: source.link,
                      }))
                    }
                  } else if (data.type === 'content') {
                    console.log('[CopilotStore] Received content chunk:', data.content)
                    accumulatedContent += data.content
                    console.log(
                      '[CopilotStore] Accumulated content length:',
                      accumulatedContent.length
                    )

                    // Update the streaming message
                    set((state) => ({
                      messages: state.messages.map((msg) =>
                        msg.id === messageId
                          ? {
                              ...msg,
                              content: accumulatedContent,
                              citations:
                                responseCitations.length > 0 ? responseCitations : undefined,
                            }
                          : msg
                      ),
                    }))
                    console.log('[CopilotStore] Updated message state with content')
                  } else if (data.type === 'done' || data.type === 'complete') {
                    console.log('[CopilotStore] Received completion marker:', data.type)
                    // Final update
                    set((state) => ({
                      messages: state.messages.map((msg) =>
                        msg.id === messageId
                          ? {
                              ...msg,
                              content: accumulatedContent,
                              citations:
                                responseCitations.length > 0 ? responseCitations : undefined,
                            }
                          : msg
                      ),
                      isSendingMessage: false,
                    }))

                    // Save chat to database after streaming completes
                    const chatIdToSave = newChatId || get().currentChat?.id
                    if (chatIdToSave) {
                      console.log('[CopilotStore] Saving chat to database:', chatIdToSave)
                      await get().saveChatMessages(chatIdToSave)
                    }

                    // Handle new chat creation
                    if (newChatId && !get().currentChat) {
                      console.log('[CopilotStore] Reloading chats for new chat:', newChatId)
                      // Reload chats to get the updated list
                      await get().loadChats()
                    }

                    streamComplete = true
                    console.log('[CopilotStore] Stream marked as complete')
                    break
                  } else if (data.type === 'error') {
                    console.error('[CopilotStore] Received error from stream:', data.error)
                    throw new Error(data.error || 'Streaming error')
                  }
                } catch (parseError) {
                  console.warn(
                    '[CopilotStore] Failed to parse SSE data:',
                    parseError,
                    'Line:',
                    line
                  )
                  logger.warn('Failed to parse SSE data:', parseError)
                }
              } else if (line.trim()) {
                console.log('[CopilotStore] Non-SSE line (ignored):', line)
              }
            }
          }

          console.log('[CopilotStore] Stream processing completed successfully')
          logger.info(`Completed streaming response, content length: ${accumulatedContent.length}`)
        } catch (error) {
          console.error('[CopilotStore] Error handling streaming response:', error)
          logger.error('Error handling streaming response:', error)
          throw error
        }
      },

      // Clear current messages
      clearMessages: () => {
        set({
          currentChat: null,
          messages: [],
          error: null,
        })
      },

      // Save chat messages to database
      saveChatMessages: async (chatId: string) => {
        try {
          const { messages, currentChat } = get()
          
          logger.info(`Saving ${messages.length} messages for chat ${chatId}`)
          
          // Let the API handle title generation if needed
          const result = await updateChatMessages(chatId, messages)
          
          if (result.success && result.chat) {
            // Update local state with the saved chat
            set({
              currentChat: result.chat,
              messages: result.chat.messages,
            })
            
            logger.info(`Successfully saved chat ${chatId} with ${result.chat.messages.length} messages`)
          } else {
            logger.error(`Failed to save chat ${chatId}:`, result.error)
          }
        } catch (error) {
          logger.error(`Error saving chat ${chatId}:`, error)
        }
      },

      // Clear error state
      clearError: () => {
        set({ error: null })
      },

      // Reset entire store
      reset: () => {
        set(initialState)
      },
    }),
    { name: 'copilot-store' }
  )
)
