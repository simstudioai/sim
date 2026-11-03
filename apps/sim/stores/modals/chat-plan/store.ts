import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

interface ChatPlanModalState {
  isOpen: boolean
  open: () => void
  close: () => void
}

/**
 * Whether the Chat plan modal is showing. A send the payer's plan refuses opens it from wherever
 * the send started (the composer, a queued message, a handoff from another surface), and the
 * workspace shell renders the one modal.
 */
export const useChatPlanModalStore = create<ChatPlanModalState>()(
  devtools(
    (set) => ({
      isOpen: false,
      open: () => set({ isOpen: true }),
      close: () => set({ isOpen: false }),
    }),
    { name: 'chat-plan-modal-store' }
  )
)
