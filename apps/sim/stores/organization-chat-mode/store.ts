import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { SearchLevel } from '@/app/o/[organizationId]/home/search-params'
import type { ChatRequestMode } from '@/app/workspace/[workspaceId]/home/types'

interface OrganizationChatModeState {
  modes: Record<string, ChatRequestMode>
  assistantSearchLevels: Record<string, SearchLevel>
  setAssistantSearchLevel: (userId: string, organizationId: string, level: SearchLevel) => void
  setMode: (userId: string, organizationId: string, mode: ChatRequestMode) => void
}

/** Only explicit choices become defaults; viewing a saved chat does not change them. */
export const useOrganizationChatModeStore = create<OrganizationChatModeState>()(
  persist(
    (set) => ({
      modes: {},
      assistantSearchLevels: {},
      setAssistantSearchLevel: (userId, organizationId, level) =>
        set((state) => ({
          assistantSearchLevels: {
            ...state.assistantSearchLevels,
            [`${userId}:${organizationId}`]: level,
          },
        })),
      setMode: (userId, organizationId, mode) =>
        set((state) => ({ modes: { ...state.modes, [`${userId}:${organizationId}`]: mode } })),
    }),
    {
      name: 'organization-chat-mode',
      version: 2,
      migrate: (persisted: unknown) => {
        const modes: Record<string, ChatRequestMode> = {}
        const assistantSearchLevels: Record<string, SearchLevel> = {}
        if (typeof persisted !== 'object' || persisted === null)
          return { modes, assistantSearchLevels }
        if (
          'modes' in persisted &&
          typeof persisted.modes === 'object' &&
          persisted.modes !== null
        ) {
          for (const [key, mode] of Object.entries(persisted.modes)) {
            if (mode === 'agent' || mode === 'assistant') modes[key] = mode
          }
        }
        if (
          'assistantSearchLevels' in persisted &&
          typeof persisted.assistantSearchLevels === 'object' &&
          persisted.assistantSearchLevels !== null
        ) {
          for (const [key, level] of Object.entries(persisted.assistantSearchLevels)) {
            if (level === 'fast' || level === 'adaptive' || level === 'max')
              assistantSearchLevels[key] = level
            else if (level === 'none') assistantSearchLevels[key] = 'adaptive'
          }
        } else if (
          'assistantFast' in persisted &&
          typeof persisted.assistantFast === 'object' &&
          persisted.assistantFast !== null
        ) {
          for (const [key, fast] of Object.entries(persisted.assistantFast)) {
            if (typeof fast === 'boolean') assistantSearchLevels[key] = fast ? 'fast' : 'adaptive'
          }
        }
        return { modes, assistantSearchLevels }
      },
      partialize: (state) => ({
        modes: state.modes,
        assistantSearchLevels: state.assistantSearchLevels,
      }),
    }
  )
)
