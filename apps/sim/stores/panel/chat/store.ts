import { v4 as uuidv4 } from 'uuid'
import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import type { ChatMessage, ChatStore } from '@/stores/panel/chat/types'

// MAX across all workflows
const MAX_MESSAGES = 50

export const useChatStore = create<ChatStore>()(
  devtools(
    persist(
      (set, get) => ({
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

          // Helper function to safely stringify and escape CSV values
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

        getWorkflowMessages: (workflowId) => {
          return get().messages.filter((message) => message.workflowId === workflowId)
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
          set((state) => {
            const newMessages = state.messages.map((message) => {
              if (message.id === messageId) {
                return {
                  ...message,
                  content:
                    typeof message.content === 'string'
                      ? message.content + content
                      : message.content
                        ? String(message.content) + content
                        : content,
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
