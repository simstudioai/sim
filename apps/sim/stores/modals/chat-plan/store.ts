import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

interface ChatPlanModalState {
  /** The workspace whose refused send opened the modal; another workspace never shows it. */
  workspaceId: string | null
  open: (workspaceId: string | undefined) => void
  close: () => void
}

/**
 * Which workspace's Chat plan modal is showing. A send the payer's plan refuses opens it from
 * wherever the send started (the composer, a message waiting to go out, a handoff from another surface), and
 * the workspace shell renders the one modal, only for the workspace that opened it.
 */
export const useChatPlanModalStore = create<ChatPlanModalState>()(
  devtools(
    (set) => ({
      workspaceId: null,
      open: (workspaceId) => set({ workspaceId: workspaceId ?? null }),
      close: () => set({ workspaceId: null }),
    }),
    { name: 'chat-plan-modal-store' }
  )
)
