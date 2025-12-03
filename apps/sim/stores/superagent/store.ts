import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('SuperagentStore')

/**
 * Tool call state matching Copilot's format
 */
type ToolCallState = 'pending' | 'executing' | 'success' | 'error'

/**
 * Tool call structure matching CopilotToolCall
 */
interface SuperagentToolCall {
  id: string
  name: string
  state: ToolCallState
  params?: Record<string, any>
}

/**
 * Content block types matching Copilot's contentBlocks format
 */
type ContentBlock =
  | { type: 'text'; content: string; timestamp: number }
  | { type: 'tool_call'; toolCall: SuperagentToolCall; timestamp: number }

/**
 * Message structure matching CopilotMessage
 */
interface SuperagentMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  contentBlocks?: ContentBlock[]
  toolCalls?: SuperagentToolCall[]
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
  toolCallsById: Record<string, SuperagentToolCall>

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
  timestamp: new Date().toISOString(),
})

const createStreamingMessage = (): SuperagentMessage => ({
  id: `assistant-${Date.now()}`,
  role: 'assistant',
  content: '',
  timestamp: new Date().toISOString(),
  contentBlocks: [],
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
    toolCallsById: {},

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
      set({ isSendingMessage: true, error: null, abortController, toolCallsById: {} })

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

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let totalContent = ''
        let currentTextBlock: { type: 'text'; content: string; timestamp: number } | null = null

        logger.info('Starting to read stream')

        /**
         * Update the streaming message in state
         */
        const updateStreamingMessage = () => {
          set((state) => {
            const newMessages = [...state.messages]
            const lastMessage = newMessages[newMessages.length - 1]
            if (lastMessage && lastMessage.role === 'assistant') {
              lastMessage.content = totalContent
              // Create a fresh copy of contentBlocks for React to detect changes
              lastMessage.contentBlocks = lastMessage.contentBlocks
                ? [...lastMessage.contentBlocks]
                : []
            }
            return { messages: newMessages }
          })
        }

        /**
         * Process a single SSE data line
         */
        const processSSELine = (line: string) => {
          const trimmedLine = line.trim()
          if (!trimmedLine || !trimmedLine.startsWith('data: ')) return

          const jsonStr = trimmedLine.slice(6)
          if (!jsonStr) return

          try {
            const data = JSON.parse(jsonStr)

            if (data.type === 'text' && data.text) {
              totalContent += data.text

              set((state) => {
                const newMessages = [...state.messages]
                const lastMessage = newMessages[newMessages.length - 1]
                if (lastMessage && lastMessage.role === 'assistant') {
                  lastMessage.content = totalContent

                  if (!lastMessage.contentBlocks) {
                    lastMessage.contentBlocks = []
                  }

                  // Find or create current text block
                  const lastBlock = lastMessage.contentBlocks[lastMessage.contentBlocks.length - 1]
                  if (lastBlock && lastBlock.type === 'text') {
                    lastBlock.content += data.text
                  } else {
                    lastMessage.contentBlocks.push({
                      type: 'text',
                      content: data.text,
                      timestamp: Date.now(),
                    })
                  }
                }
                return { messages: newMessages }
              })
            } else if (data.type === 'content' && data.content) {
              totalContent = data.content

              set((state) => {
                const newMessages = [...state.messages]
                const lastMessage = newMessages[newMessages.length - 1]
                if (lastMessage && lastMessage.role === 'assistant') {
                  lastMessage.content = totalContent

                  if (!lastMessage.contentBlocks) {
                    lastMessage.contentBlocks = []
                  }

                  const lastBlock = lastMessage.contentBlocks[lastMessage.contentBlocks.length - 1]
                  if (lastBlock && lastBlock.type === 'text') {
                    lastBlock.content = data.content
                  } else {
                    lastMessage.contentBlocks.push({
                      type: 'text',
                      content: data.content,
                      timestamp: Date.now(),
                    })
                  }
                }
                return { messages: newMessages }
              })
            } else if (data.type === 'tool_call') {
              const toolName = data.name || data.tool_name || 'unknown'
              const toolId = data.id || data.tool_use_id || `${toolName}-${Date.now()}`
              const toolStatus: ToolCallState =
                data.status === 'success'
                  ? 'success'
                  : data.status === 'error'
                    ? 'error'
                    : data.status === 'calling'
                      ? 'executing'
                      : 'pending'

              const toolCall: SuperagentToolCall = {
                id: toolId,
                name: toolName,
                state: toolStatus,
              }

              set((state) => {
                const newMessages = [...state.messages]
                const lastMessage = newMessages[newMessages.length - 1]
                const newToolCallsById = { ...state.toolCallsById }

                if (lastMessage && lastMessage.role === 'assistant') {
                  if (!lastMessage.contentBlocks) {
                    lastMessage.contentBlocks = []
                  }
                  if (!lastMessage.toolCalls) {
                    lastMessage.toolCalls = []
                  }

                  // Find existing tool call block by ID
                  const existingBlockIndex = lastMessage.contentBlocks.findIndex(
                    (b) => b.type === 'tool_call' && b.toolCall.id === toolId
                  )

                  if (existingBlockIndex >= 0) {
                    // Update existing tool call
                    const block = lastMessage.contentBlocks[existingBlockIndex]
                    if (block.type === 'tool_call') {
                      block.toolCall = { ...block.toolCall, state: toolStatus }
                    }
                  } else if (toolStatus === 'executing' || toolStatus === 'pending') {
                    // Add new tool call block
                    lastMessage.contentBlocks.push({
                      type: 'tool_call',
                      toolCall,
                      timestamp: Date.now(),
                    })
                  }

                  // Update toolCalls array
                  const existingCallIndex = lastMessage.toolCalls.findIndex((tc) => tc.id === toolId)
                  if (existingCallIndex >= 0) {
                    lastMessage.toolCalls[existingCallIndex] = toolCall
                  } else {
                    lastMessage.toolCalls.push(toolCall)
                  }

                  // Update toolCallsById map
                  newToolCallsById[toolId] = toolCall
                }

                return { messages: newMessages, toolCallsById: newToolCallsById }
              })
            } else if (data.type === 'chat_id' && data.chatId) {
              set({ currentChatId: data.chatId })
            } else if (data.type === 'done') {
              get().loadChats()
            }
          } catch {
            // Skip parse errors
          }
        }

        const processBuffer = (text: string): string => {
          const lines = text.split('\n')
          const lastLine = lines.pop() || ''

          for (const line of lines) {
            processSSELine(line)
          }

          return lastLine
        }

        while (true) {
          const { done, value } = await reader.read()

          if (done) {
            if (buffer.trim()) {
              processBuffer(`${buffer}\n`)
            }
            logger.info('Stream reading done', { accumulatedLength: totalContent.length })
            break
          }

          const chunk = decoder.decode(value, { stream: true })
          buffer = processBuffer(buffer + chunk)
        }

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
      set({ messages: [], error: null, toolCallsById: {} })
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
        const response = await fetch(
          `/api/superagent/chat?workspaceId=${workspaceId}&chatId=${chatId}`
        )
        if (!response.ok) {
          throw new Error('Failed to load chat')
        }

        const data = await response.json()
        const chat = data.chat

        set({
          currentChatId: chat.id,
          messages: chat.messages || [],
          selectedModel: chat.model || 'claude-sonnet-4-5',
          toolCallsById: {},
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
        toolCallsById: {},
      })
    },
  }))
)
