import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { ChatMessage, ChatStore } from './types'

// MAX across all workflows
const MAX_MESSAGES = 50

export const useChatStore = create<ChatStore>()(
  devtools(
    persist(
      (set, get) => ({
        messages: [],
        selectedWorkflowOutputs: {},

        addMessage: (message) => {
          set((state) => {
            const newMessage: ChatMessage = {
              ...message,
              id: crypto.randomUUID(),
              timestamp: new Date().toISOString(),
            }

            // Keep only the last MAX_MESSAGES
            const newMessages = [newMessage, ...state.messages].slice(0, MAX_MESSAGES)

            return { messages: newMessages }
          })
        },

        clearChat: (workflowId: string | null) => {
          set((state) => ({
            messages: state.messages.filter(
              (message) => !workflowId || message.workflowId !== workflowId
            ),
          }))
        },

        getWorkflowMessages: (workflowId) => {
          return get().messages.filter((message) => message.workflowId === workflowId)
        },

        setSelectedWorkflowOutput: (workflowId, outputId) => {
          set((state) => ({
            selectedWorkflowOutputs: {
              ...state.selectedWorkflowOutputs,
              [workflowId]: outputId,
            },
          }))
        },

        getSelectedWorkflowOutput: (workflowId) => {
          return get().selectedWorkflowOutputs[workflowId] || null
        },
      }),
      {
        name: 'chat-store',
      }
    )
  )
) 