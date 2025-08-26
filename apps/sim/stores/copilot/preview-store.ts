'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { COPILOT_TOOL_IDS } from './constants'
import type { CopilotMessage, CopilotToolCall } from './types'

export interface PreviewData {
  id: string
  workflowState: any
  yamlContent: string
  description?: string
  timestamp: number
  status: 'pending' | 'accepted' | 'rejected'
  workflowId: string
  toolCallId?: string
  chatId?: string // Track which chat session this preview belongs to
  messageTimestamp?: number // Track when the message containing this preview was created
}

interface PreviewStore {
  previews: Record<string, PreviewData>
  seenToolCallIds: Set<string>
  addPreview: (preview: Omit<PreviewData, 'id' | 'timestamp' | 'status'>) => string
  acceptPreview: (previewId: string) => void
  rejectPreview: (previewId: string) => void
  getLatestPendingPreview: (workflowId: string, chatId?: string) => PreviewData | null
  getPreviewById: (previewId: string) => PreviewData | null
  getPreviewsForWorkflow: (workflowId: string) => PreviewData[]
  getPreviewByToolCall: (toolCallId: string) => PreviewData | null
  clearPreviewsForWorkflow: (workflowId: string) => void
  clearPreviewsForChat: (chatId: string) => void
  clearStalePreviewsForWorkflow: (workflowId: string, maxAgeMinutes?: number) => void
  expireOldPreviews: (maxAgeHours?: number) => void
  markToolCallAsSeen: (toolCallId: string) => void
  isToolCallSeen: (toolCallId: string) => boolean
  scanAndMarkExistingPreviews: (messages: CopilotMessage[]) => void
}

export const usePreviewStore = create<PreviewStore>()(
  persist(
    (set, get) => ({
      previews: {},
      seenToolCallIds: new Set<string>(),

      addPreview: (preview) => {
        const id = `preview_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        const newPreview: PreviewData = {
          ...preview,
          id,
          timestamp: Date.now(),
          status: 'pending',
        }

        set((state) => ({
          previews: {
            ...state.previews,
            [id]: newPreview,
          },
        }))

        return id
      },

      acceptPreview: (previewId) => {
        set((state) => {
          const existingPreview = state.previews[previewId]
          if (!existingPreview) {
            return state
          }

          return {
            previews: {
              ...state.previews,
              [previewId]: {
                ...existingPreview,
                status: 'accepted' as const,
              },
            },
          }
        })
      },

      rejectPreview: (previewId) => {
        set((state) => {
          const existingPreview = state.previews[previewId]
          if (!existingPreview) {
            return state
          }

          return {
            previews: {
              ...state.previews,
              [previewId]: {
                ...existingPreview,
                status: 'rejected' as const,
              },
            },
          }
        })
      },

      getLatestPendingPreview: (workflowId, chatId) => {
        const now = Date.now()
        const maxAge = 30 * 60 * 1000 // 30 minutes
        const allPreviews = Object.values(get().previews)

        const previews = allPreviews
          .filter((p) => {
            // Must be for the current workflow and pending
            if (p.workflowId !== workflowId || p.status !== 'pending') {
              return false
            }

            // If chatId is provided, only show previews from this chat session
            // If no chatId provided or preview has no chatId, allow it (for backward compatibility)
            if (chatId && p.chatId && p.chatId !== chatId) {
              return false
            }

            // Filter out previews older than 30 minutes to avoid stale previews
            if (now - p.timestamp > maxAge) {
              return false
            }

            return true
          })
          .sort((a, b) => b.timestamp - a.timestamp)

        return previews[0] || null
      },

      getPreviewById: (previewId) => {
        return get().previews[previewId] || null
      },

      getPreviewsForWorkflow: (workflowId) => {
        return Object.values(get().previews).filter((p) => p.workflowId === workflowId)
      },

      getPreviewByToolCall: (toolCallId) => {
        return Object.values(get().previews).find((p) => p.toolCallId === toolCallId) || null
      },

      clearPreviewsForWorkflow: (workflowId) => {
        set((state) => ({
          previews: Object.fromEntries(
            Object.entries(state.previews).filter(
              ([_, preview]) => preview.workflowId !== workflowId
            )
          ),
        }))
      },

      clearPreviewsForChat: (chatId) => {
        set((state) => ({
          previews: Object.fromEntries(
            Object.entries(state.previews).filter(([_, preview]) => preview.chatId !== chatId)
          ),
        }))
      },

      clearStalePreviewsForWorkflow: (workflowId, maxAgeMinutes = 30) => {
        const now = Date.now()
        const maxAge = maxAgeMinutes * 60 * 1000

        set((state) => ({
          previews: Object.fromEntries(
            Object.entries(state.previews).filter(([_, preview]) => {
              if (preview.workflowId === workflowId && preview.status === 'pending') {
                return now - preview.timestamp <= maxAge
              }
              return true // Keep previews from other workflows or accepted/rejected previews
            })
          ),
        }))
      },

      expireOldPreviews: (maxAgeHours = 24) => {
        const now = Date.now()
        const maxAge = maxAgeHours * 60 * 60 * 1000

        set((state) => ({
          previews: Object.fromEntries(
            Object.entries(state.previews).filter(
              ([_, preview]) => now - preview.timestamp <= maxAge
            )
          ),
        }))
      },

      markToolCallAsSeen: (toolCallId) => {
        set((state) => ({
          seenToolCallIds: new Set([...state.seenToolCallIds, toolCallId]),
        }))
      },

      isToolCallSeen: (toolCallId) => {
        return get().seenToolCallIds.has(toolCallId)
      },

      scanAndMarkExistingPreviews: (messages: CopilotMessage[]) => {
        const toolCallIds = new Set<string>()

        messages.forEach((message) => {
          if (message.role === 'assistant' && message.toolCalls) {
            message.toolCalls.forEach((toolCall: CopilotToolCall) => {
              if (
                toolCall.name === COPILOT_TOOL_IDS.BUILD_WORKFLOW &&
                toolCall.state === 'success' &&
                toolCall.id
              ) {
                toolCallIds.add(toolCall.id)
              }
            })
          }
        })

        set((state) => ({
          seenToolCallIds: new Set([...state.seenToolCallIds, ...toolCallIds]),
        }))
      },
    }),
    {
      name: 'copilot-preview-store',
      partialize: (state) => ({
        previews: Object.fromEntries(
          Object.entries(state.previews).filter(
            ([_, preview]) => Date.now() - preview.timestamp < 24 * 60 * 60 * 1000 // Keep for 24 hours
          )
        ),
        seenToolCallIds: Array.from(state.seenToolCallIds), // Convert Set to Array for serialization
      }),
      merge: (persistedState: any, currentState) => ({
        ...currentState,
        ...persistedState,
        seenToolCallIds: new Set(persistedState?.seenToolCallIds || []), // Convert Array back to Set
      }),
    }
  )
)
