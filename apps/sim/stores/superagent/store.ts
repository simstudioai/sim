import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('SuperagentStore')

interface SuperagentMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  toolCalls?: Array<{
    name: string
    status: 'calling' | 'success' | 'error'
    result?: any
  }>
}

interface Chat {
  id: string
  title: string | null
  messages: SuperagentMessage[]
  model: string
  createdAt: Date
  updatedAt: Date
}

interface SuperagentStore {
  messages: SuperagentMessage[]
  isSendingMessage: boolean
  error: string | null
  abortController: AbortController | null
  workspaceId: string | null
  selectedModel: string
  chats: Chat[]
  currentChatId: string | null
  isLoadingChats: boolean
  
  setWorkspaceId: (workspaceId: string) => void
  setSelectedModel: (model: string) => void
  sendMessage: (message: string) => Promise<void>
  abortMessage: () => void
  clearMessages: () => void
  loadChats: () => Promise<void>
  selectChat: (chatId: string) => Promise<void>
  createNewChat: () => void
}

const createUserMessage = (content: string): SuperagentMessage => ({
  id: `user-${Date.now()}`,
  role: 'user',
  content,
  timestamp: Date.now(),
})

const createStreamingMessage = (): SuperagentMessage => ({
  id: `assistant-${Date.now()}`,
  role: 'assistant',
  content: '',
  timestamp: Date.now(),
  toolCalls: [],
})

export const useSuperagentStore = create<SuperagentStore>()(
  devtools((set, get) => ({
    messages: [],
    isSendingMessage: false,
    error: null,
    abortController: null,
    workspaceId: null,
    selectedModel: 'claude-sonnet-4-5',
    chats: [],
    currentChatId: null,
    isLoadingChats: false,

    setWorkspaceId: (workspaceId: string) => {
      set({ workspaceId })
    },

    setSelectedModel: (model: string) => {
      set({ selectedModel: model })
    },

    sendMessage: async (message: string) => {
      const { workspaceId, selectedModel, currentChatId } = get()
      
      if (!workspaceId) {
        logger.error('No workspace ID set')
        return
      }

      const abortController = new AbortController()
      set({ isSendingMessage: true, error: null, abortController })

      const userMessage = createUserMessage(message)
      const streamingMessage = createStreamingMessage()

      set((state) => ({
        messages: [...state.messages, userMessage, streamingMessage],
      }))

      try {
        const response = await fetch('/api/superagent/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message,
            workspaceId,
            chatId: currentChatId,
            model: selectedModel,
          }),
          signal: abortController.signal,
          credentials: 'include',
        })

        if (!response.ok) {
          throw new Error(`Server error: ${response.status}`)
        }

        if (!response.body) {
          throw new Error('No response body')
        }

        // Process the streaming response
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let accumulatedContent = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const chunk = decoder.decode(value, { stream: true })
          buffer += chunk

          // Process complete SSE messages
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6))
                
                logger.info('Received SSE chunk', { 
                  type: data.type,
                  hasText: !!data.text,
                  hasContent: !!data.content,
                })
                
                // Handle different types of streaming data
                if (data.type === 'text' && data.text) {
                  accumulatedContent += data.text
                  
                  set((state) => {
                    const newMessages = [...state.messages]
                    const lastMessage = newMessages[newMessages.length - 1]
                    if (lastMessage && lastMessage.role === 'assistant') {
                      lastMessage.content = accumulatedContent
                    }
                    return { messages: newMessages }
                  })
                } else if (data.type === 'content' && data.content) {
                  // Handle complete content
                  accumulatedContent = data.content
                  
                  set((state) => {
                    const newMessages = [...state.messages]
                    const lastMessage = newMessages[newMessages.length - 1]
                    if (lastMessage && lastMessage.role === 'assistant') {
                      lastMessage.content = accumulatedContent
                    }
                    return { messages: newMessages }
                  })
                } else if (data.type === 'tool_call') {
                  // Track tool calls
                  set((state) => {
                    const newMessages = [...state.messages]
                    const lastMessage = newMessages[newMessages.length - 1]
                    if (lastMessage && lastMessage.role === 'assistant') {
                      if (!lastMessage.toolCalls) {
                        lastMessage.toolCalls = []
                      }
                      lastMessage.toolCalls.push({
                        name: data.name || data.tool_name || 'unknown',
                        status: data.status || 'calling',
                        result: data.result,
                      })
                    }
                    return { messages: newMessages }
                  })
                } else if (data.type === 'done') {
                  // Reload chats to get updated list
                  get().loadChats()
                  break
                } else {
                  logger.warn('Unknown chunk type', { type: data.type, data })
                }
              } catch (e) {
                logger.warn('Failed to parse SSE data', { error: e, line })
              }
            }
          }
        }

        logger.info('Stream processing complete', {
          finalContentLength: accumulatedContent.length,
        })

        set({ isSendingMessage: false, abortController: null })
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          logger.info('Message was aborted')
        } else {
          logger.error('Failed to send message', { error })
          set({
            error: error instanceof Error ? error.message : 'Failed to send message',
          })
        }
        
        // Remove the streaming message if there was an error
        set((state) => ({
          messages: state.messages.slice(0, -1),
          isSendingMessage: false,
          abortController: null,
        }))
      }
    },

    abortMessage: () => {
      const { abortController } = get()
      if (abortController) {
        abortController.abort()
        set({ abortController: null, isSendingMessage: false })
      }
    },

    clearMessages: () => {
      set({ messages: [], error: null })
    },

    loadChats: async () => {
      const { workspaceId } = get()
      if (!workspaceId) return

      set({ isLoadingChats: true })

      try {
        const response = await fetch(`/api/superagent/chat?workspaceId=${workspaceId}`)
        if (!response.ok) {
          throw new Error('Failed to load chats')
        }

        const data = await response.json()
        set({ 
          chats: data.chats || [],
          isLoadingChats: false,
        })
      } catch (error) {
        logger.error('Failed to load chats', { error })
        set({ isLoadingChats: false })
      }
    },

    selectChat: async (chatId: string) => {
      const { workspaceId } = get()
      if (!workspaceId) return

      try {
        const response = await fetch(`/api/superagent/chat?workspaceId=${workspaceId}&chatId=${chatId}`)
        if (!response.ok) {
          throw new Error('Failed to load chat')
        }

        const data = await response.json()
        const chat = data.chat
        
        set({
          currentChatId: chat.id,
          messages: chat.messages || [],
          selectedModel: chat.model || 'claude-sonnet-4-5',
        })
      } catch (error) {
        logger.error('Failed to load chat', { error })
      }
    },

    createNewChat: () => {
      set({
        currentChatId: null,
        messages: [],
        error: null,
      })
    },
  }))
)

