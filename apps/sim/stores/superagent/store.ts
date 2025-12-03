import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('SuperagentStore')

// Store version - increment to force cache refresh
const STORE_VERSION = '2.1.0'

// Debug flag to trace SSE parsing
const DEBUG_SSE = true

interface ToolCallSegment {
  type: 'tool_call'
  id: string // Unique ID for this tool call
  name: string
  status: 'calling' | 'success' | 'error'
  result?: any
}

interface TextSegment {
  type: 'text'
  content: string
}

type ContentSegment = ToolCallSegment | TextSegment

interface SuperagentMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  /** Ordered segments of text and tool calls for inline rendering */
  segments?: ContentSegment[]
  /** @deprecated Use segments instead - kept for backwards compatibility */
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
  segments: [],
  toolCalls: [], // Keep for backwards compatibility
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
        let totalContent = '' // Total accumulated content for the message
        let currentSegmentContent = '' // Content for current text segment only

        logger.info('Starting to read stream')

        /**
         * Process a single SSE data line
         */
        const processSSELine = (line: string) => {
          const trimmedLine = line.trim()
          if (!trimmedLine || !trimmedLine.startsWith('data: ')) return

          const jsonStr = trimmedLine.slice(6) // Remove 'data: ' prefix
          if (!jsonStr) return

          try {
            const data = JSON.parse(jsonStr)

            // Handle different types of streaming data
            if (data.type === 'text' && data.text) {
              totalContent += data.text
              currentSegmentContent += data.text

              set((state) => {
                const newMessages = [...state.messages]
                const lastMessage = newMessages[newMessages.length - 1]
                if (lastMessage && lastMessage.role === 'assistant') {
                  lastMessage.content = totalContent

                  // Update segments - merge consecutive text into last text segment
                  if (!lastMessage.segments) {
                    lastMessage.segments = []
                  }
                  const lastSegment = lastMessage.segments[lastMessage.segments.length - 1]
                  if (lastSegment && lastSegment.type === 'text') {
                    lastSegment.content = currentSegmentContent
                  } else {
                    lastMessage.segments.push({ type: 'text', content: currentSegmentContent })
                  }
                }
                return { messages: newMessages }
              })
            } else if (data.type === 'content' && data.content) {
              // Handle complete content
              totalContent = data.content
              currentSegmentContent = data.content

              set((state) => {
                const newMessages = [...state.messages]
                const lastMessage = newMessages[newMessages.length - 1]
                if (lastMessage && lastMessage.role === 'assistant') {
                  lastMessage.content = totalContent

                  // Reset segments with full content
                  if (!lastMessage.segments) {
                    lastMessage.segments = []
                  }
                  const lastSegment = lastMessage.segments[lastMessage.segments.length - 1]
                  if (lastSegment && lastSegment.type === 'text') {
                    lastSegment.content = currentSegmentContent
                  } else {
                    lastMessage.segments.push({ type: 'text', content: currentSegmentContent })
                  }
                }
                return { messages: newMessages }
              })
            } else if (data.type === 'tool_call') {
              // Track tool calls - add as segment for inline rendering
              set((state) => {
                const newMessages = [...state.messages]
                const lastMessage = newMessages[newMessages.length - 1]
                if (lastMessage && lastMessage.role === 'assistant') {
                  // Add to segments for inline rendering
                  if (!lastMessage.segments) {
                    lastMessage.segments = []
                  }

                  const toolName = data.name || data.tool_name || 'unknown'
                  const toolStatus = data.status || 'calling'
                  // Use tool_use_id from SSE if available, otherwise generate one
                  const toolId = data.id || data.tool_use_id || `${toolName}-${Date.now()}`

                  // Find existing tool call by ID (for status updates)
                  const existingToolIndex = lastMessage.segments.findIndex(
                    (s) => s.type === 'tool_call' && (s as ToolCallSegment).id === toolId
                  )

                  if (existingToolIndex >= 0) {
                    // Update existing tool call status in-place
                    const existingTool = lastMessage.segments[existingToolIndex] as ToolCallSegment
                    existingTool.status = toolStatus
                    existingTool.result = data.result
                  } else if (toolStatus === 'calling') {
                    // Add new tool call segment
                    // Reset current segment content so next text starts fresh after tool
                    currentSegmentContent = ''
                    lastMessage.segments.push({
                      type: 'tool_call',
                      id: toolId,
                      name: toolName,
                      status: toolStatus,
                      result: data.result,
                    })
                  }

                  // Also maintain toolCalls array for backwards compatibility
                  if (!lastMessage.toolCalls) {
                    lastMessage.toolCalls = []
                  }
                  const existingCall = lastMessage.toolCalls.find((tc) => tc.name === toolName)
                  if (existingCall) {
                    existingCall.status = toolStatus
                    existingCall.result = data.result
                  } else {
                    lastMessage.toolCalls.push({
                      name: toolName,
                      status: toolStatus,
                      result: data.result,
                    })
                  }
                }
                return { messages: newMessages }
              })
            } else if (data.type === 'chat_id' && data.chatId) {
              // Update current chat ID when a new chat is created
              set({ currentChatId: data.chatId })
            } else if (data.type === 'done') {
              // Reload chats to get updated list
              get().loadChats()
            }
          } catch {
            // Skip parse errors silently - might be incomplete JSON
          }
        }

        /**
         * Process buffered SSE content
         */
        const processBuffer = (text: string): string => {
          // Split on newlines (SSE messages are separated by \n\n but we process line by line)
          const lines = text.split('\n')

          // Process all complete lines, keep the last one if it might be incomplete
          const lastLine = lines.pop() || ''

          for (const line of lines) {
            processSSELine(line)
          }

          return lastLine
        }

        while (true) {
          const { done, value } = await reader.read()

          if (done) {
            // Process any remaining buffer content when stream ends
            if (buffer.trim()) {
              processBuffer(`${buffer}\n`) // Add newline to ensure last line is processed
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
