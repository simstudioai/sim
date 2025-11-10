import { v4 as uuidv4 } from 'uuid'
import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('ChatStore')

/**
 * Maximum number of messages to store across all workflows
 */
const MAX_MESSAGES = 50

/**
 * Floating chat dimensions
 */
const DEFAULT_WIDTH = 250
const DEFAULT_HEIGHT = 286

/**
 * Minimum chat dimensions (same as baseline default)
 */
export const MIN_CHAT_WIDTH = DEFAULT_WIDTH
export const MIN_CHAT_HEIGHT = DEFAULT_HEIGHT

/**
 * Maximum chat dimensions
 */
export const MAX_CHAT_WIDTH = 500
export const MAX_CHAT_HEIGHT = 600

/**
 * Position interface for floating chat
 */
interface ChatPosition {
  x: number
  y: number
}

/**
 * Chat attachment interface
 */
export interface ChatAttachment {
  id: string
  name: string
  type: string
  dataUrl: string
  size?: number
}

/**
 * Chat message interface
 */
export interface ChatMessage {
  id: string
  content: string | any
  workflowId: string
  type: 'user' | 'workflow'
  timestamp: string
  blockId?: string
  isStreaming?: boolean
  attachments?: ChatAttachment[]
}

/**
 * Output configuration for chat deployments
 */
export interface OutputConfig {
  blockId: string
  path: string
}

/**
 * Chat dimensions interface
 */
export interface ChatDimensions {
  width: number
  height: number
}

/**
 * Chat store state interface combining UI state and message data
 */
interface ChatState {
  // UI State
  isChatOpen: boolean
  chatPosition: ChatPosition | null
  chatWidth: number
  chatHeight: number
  setIsChatOpen: (open: boolean) => void
  setChatPosition: (position: ChatPosition) => void
  setChatDimensions: (dimensions: ChatDimensions) => void
  resetChatPosition: () => void

  // Message State
  messages: ChatMessage[]
  selectedWorkflowOutputs: Record<string, string[]>
  conversationIds: Record<string, string>

  // Message Actions
  addMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'> & { id?: string }) => void
  clearChat: (workflowId: string | null) => void
  exportChatCSV: (workflowId: string) => void
  setSelectedWorkflowOutput: (workflowId: string, outputIds: string[]) => void
  getSelectedWorkflowOutput: (workflowId: string) => string[]
  appendMessageContent: (messageId: string, content: string) => void
  finalizeMessageStream: (messageId: string) => void
  getConversationId: (workflowId: string) => string
  generateNewConversationId: (workflowId: string) => string
}

/**
 * Calculate default center position based on available canvas space
 */
const calculateDefaultPosition = (): ChatPosition => {
  if (typeof window === 'undefined') {
    return { x: 100, y: 100 }
  }

  // Get current layout dimensions
  const sidebarWidth = Number.parseInt(
    getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width') || '0'
  )
  const panelWidth = Number.parseInt(
    getComputedStyle(document.documentElement).getPropertyValue('--panel-width') || '0'
  )
  const terminalHeight = Number.parseInt(
    getComputedStyle(document.documentElement).getPropertyValue('--terminal-height') || '0'
  )

  // Calculate available space
  const availableWidth = window.innerWidth - sidebarWidth - panelWidth
  const availableHeight = window.innerHeight - terminalHeight

  // Center in available space
  const x = sidebarWidth + (availableWidth - DEFAULT_WIDTH) / 2
  const y = (availableHeight - DEFAULT_HEIGHT) / 2

  return { x, y }
}

/**
 * Floating chat store
 * Manages the open/close state, position, messages, and all chat functionality
 */
export const useChatStore = create<ChatState>()(
  devtools(
    persist(
      (set, get) => ({
        // UI State
        isChatOpen: false,
        chatPosition: null,
        chatWidth: DEFAULT_WIDTH,
        chatHeight: DEFAULT_HEIGHT,

        setIsChatOpen: (open) => {
          set({ isChatOpen: open })
        },

        setChatPosition: (position) => {
          set({ chatPosition: position })
        },

        setChatDimensions: (dimensions) => {
          set({
            chatWidth: Math.max(MIN_CHAT_WIDTH, Math.min(MAX_CHAT_WIDTH, dimensions.width)),
            chatHeight: Math.max(MIN_CHAT_HEIGHT, Math.min(MAX_CHAT_HEIGHT, dimensions.height)),
          })
        },

        resetChatPosition: () => {
          set({ chatPosition: null })
        },

        // Message State
        messages: [],
        selectedWorkflowOutputs: {},
        conversationIds: {},

        addMessage: (message) => {
          set((state) => {
            const newMessage: ChatMessage = {
              ...message,
              // Preserve provided id and timestamp if they exist; otherwise generate new ones
              id: (message as any).id ?? crypto.randomUUID(),
              timestamp: (message as any).timestamp ?? new Date().toISOString(),
            }

            // Keep only the last MAX_MESSAGES
            const newMessages = [newMessage, ...state.messages].slice(0, MAX_MESSAGES)

            return { messages: newMessages }
          })
        },

        clearChat: (workflowId: string | null) => {
          set((state) => {
            const newState = {
              messages: state.messages.filter(
                (message) => !workflowId || message.workflowId !== workflowId
              ),
            }

            // Generate a new conversationId when clearing chat for a specific workflow
            if (workflowId) {
              const newConversationIds = { ...state.conversationIds }
              newConversationIds[workflowId] = uuidv4()
              return {
                ...newState,
                conversationIds: newConversationIds,
              }
            }
            // When clearing all chats (workflowId is null), also clear all conversationIds
            return {
              ...newState,
              conversationIds: {},
            }
          })
        },

        exportChatCSV: (workflowId: string) => {
          const messages = get().messages.filter((message) => message.workflowId === workflowId)

          if (messages.length === 0) {
            return
          }

          /**
           * Safely stringify and escape CSV values
           */
          const formatCSVValue = (value: any): string => {
            if (value === null || value === undefined) {
              return ''
            }

            let stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value)

            // Truncate very long strings
            if (stringValue.length > 2000) {
              stringValue = `${stringValue.substring(0, 2000)}...`
            }

            // Escape quotes and wrap in quotes if contains special characters
            if (
              stringValue.includes('"') ||
              stringValue.includes(',') ||
              stringValue.includes('\n')
            ) {
              stringValue = `"${stringValue.replace(/"/g, '""')}"`
            }

            return stringValue
          }

          // CSV Headers
          const headers = ['timestamp', 'type', 'content']

          // Sort messages by timestamp (oldest first)
          const sortedMessages = messages.sort(
            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          )

          // Generate CSV rows
          const csvRows = [
            headers.join(','),
            ...sortedMessages.map((message) =>
              [
                formatCSVValue(message.timestamp),
                formatCSVValue(message.type),
                formatCSVValue(message.content),
              ].join(',')
            ),
          ]

          // Create CSV content
          const csvContent = csvRows.join('\n')

          // Generate filename with timestamp
          const now = new Date()
          const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19)
          const filename = `chat-${workflowId}-${timestamp}.csv`

          // Create and trigger download
          const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
          const link = document.createElement('a')

          if (link.download !== undefined) {
            const url = URL.createObjectURL(blob)
            link.setAttribute('href', url)
            link.setAttribute('download', filename)
            link.style.visibility = 'hidden'
            document.body.appendChild(link)
            link.click()
            document.body.removeChild(link)
            URL.revokeObjectURL(url)
          }
        },

        setSelectedWorkflowOutput: (workflowId, outputIds) => {
          set((state) => {
            // Create a new copy of the selections state
            const newSelections = { ...state.selectedWorkflowOutputs }

            // If empty array, explicitly remove the key to prevent empty arrays from persisting
            if (outputIds.length === 0) {
              // Delete the key entirely instead of setting to empty array
              delete newSelections[workflowId]
            } else {
              // Ensure no duplicates in the selection by using Set
              newSelections[workflowId] = [...new Set(outputIds)]
            }

            return { selectedWorkflowOutputs: newSelections }
          })
        },

        getSelectedWorkflowOutput: (workflowId) => {
          return get().selectedWorkflowOutputs[workflowId] || []
        },

        getConversationId: (workflowId) => {
          const state = get()
          if (!state.conversationIds[workflowId]) {
            // Generate a new conversation ID if one doesn't exist
            return get().generateNewConversationId(workflowId)
          }
          return state.conversationIds[workflowId]
        },

        generateNewConversationId: (workflowId) => {
          const newId = uuidv4()
          set((state) => {
            const newConversationIds = { ...state.conversationIds }
            newConversationIds[workflowId] = newId
            return { conversationIds: newConversationIds }
          })
          return newId
        },

        appendMessageContent: (messageId, content) => {
          logger.debug('[ChatStore] appendMessageContent called', {
            messageId,
            contentLength: content.length,
            content: content.substring(0, 30),
          })
          set((state) => {
            const message = state.messages.find((m) => m.id === messageId)
            if (!message) {
              logger.warn('[ChatStore] Message not found for appending', { messageId })
            }

            const newMessages = state.messages.map((message) => {
              if (message.id === messageId) {
                const newContent =
                  typeof message.content === 'string'
                    ? message.content + content
                    : message.content
                      ? String(message.content) + content
                      : content
                logger.debug('[ChatStore] Updated message content', {
                  messageId,
                  oldLength: typeof message.content === 'string' ? message.content.length : 0,
                  newLength: newContent.length,
                  addedLength: content.length,
                })
                return {
                  ...message,
                  content: newContent,
                }
              }
              return message
            })

            return { messages: newMessages }
          })
        },

        finalizeMessageStream: (messageId) => {
          set((state) => {
            const newMessages = state.messages.map((message) => {
              if (message.id === messageId) {
                const { isStreaming, ...rest } = message
                return rest
              }
              return message
            })

            return { messages: newMessages }
          })
        },
      }),
      {
        name: 'chat-store',
      }
    )
  )
)

/**
 * Get the default chat dimensions
 */
export const getDefaultChatDimensions = () => ({
  width: DEFAULT_WIDTH,
  height: DEFAULT_HEIGHT,
})

/**
 * Calculate constrained position ensuring chat stays within bounds
 * @param position - Current position to constrain
 * @param width - Chat width
 * @param height - Chat height
 * @returns Constrained position
 */
export const constrainChatPosition = (
  position: ChatPosition,
  width: number = DEFAULT_WIDTH,
  height: number = DEFAULT_HEIGHT
): ChatPosition => {
  if (typeof window === 'undefined') {
    return position
  }

  // Get current layout dimensions
  const sidebarWidth = Number.parseInt(
    getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width') || '0'
  )
  const panelWidth = Number.parseInt(
    getComputedStyle(document.documentElement).getPropertyValue('--panel-width') || '0'
  )
  const terminalHeight = Number.parseInt(
    getComputedStyle(document.documentElement).getPropertyValue('--terminal-height') || '0'
  )

  // Calculate bounds
  const minX = sidebarWidth
  const maxX = window.innerWidth - panelWidth - width
  const minY = 0
  const maxY = window.innerHeight - terminalHeight - height

  // Constrain position
  return {
    x: Math.max(minX, Math.min(maxX, position.x)),
    y: Math.max(minY, Math.min(maxY, position.y)),
  }
}

/**
 * Get chat position (default if not set or if invalid)
 * @param storedPosition - Stored position from store
 * @param width - Chat width
 * @param height - Chat height
 * @returns Valid chat position
 */
export const getChatPosition = (
  storedPosition: ChatPosition | null,
  width: number = DEFAULT_WIDTH,
  height: number = DEFAULT_HEIGHT
): ChatPosition => {
  if (!storedPosition) {
    return calculateDefaultPosition()
  }

  // Validate stored position is still within bounds
  const constrained = constrainChatPosition(storedPosition, width, height)

  // If position significantly changed, it's likely invalid (window resized, etc)
  // Return default position
  const deltaX = Math.abs(constrained.x - storedPosition.x)
  const deltaY = Math.abs(constrained.y - storedPosition.y)

  if (deltaX > 100 || deltaY > 100) {
    return calculateDefaultPosition()
  }

  return constrained
}
