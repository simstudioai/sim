import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ChatRequestMode } from '@/app/workspace/[workspaceId]/home/types'

interface OrganizationChatModeState {
  modes: Record<string, ChatRequestMode>
  setMode: (userId: string, organizationId: string, mode: ChatRequestMode) => void
}

/** Only explicit choices become defaults; viewing a saved chat does not change them. */
export const useOrganizationChatModeStore = create<OrganizationChatModeState>()(
  persist(
    (set) => ({
      modes: {},
      setMode: (userId, organizationId, mode) =>
        set((state) => ({ modes: { ...state.modes, [`${userId}:${organizationId}`]: mode } })),
    }),
    { name: 'organization-chat-mode', partialize: (state) => ({ modes: state.modes }) }
  )
)
