import { create } from 'zustand'
import { createJSONStorage, devtools, persist } from 'zustand/middleware'
import type { SendPayload } from '@/app/workspace/[workspaceId]/home/types'
import { registerUserDataReset } from '@/stores/user-data-reset-registry'

/**
 * What a chat still has to deliver, as much as a remount needs to carry on under
 * the same ids: the message (text, files and mentions as sent) and where its
 * delivery stood. A message the worker took into a turn (`steered`) is never
 * resent as a turn on restore; its turn's end reads its disposition first.
 */
export interface JournaledOutgoing {
  id: string
  payload: SendPayload
  status: 'pending' | 'steered' | 'applied' | 'failed'
  streamId?: string
  refusedBy?: string
  resumed?: boolean
  textOffset?: number
}

interface MothershipOutgoingState {
  /** Per chat id, in the order the messages were written. */
  chats: Record<string, JournaledOutgoing[]>
  /** Replaces what a chat has to deliver; an empty list drops the chat. */
  record: (chatId: string, messages: JournaledOutgoing[]) => void
  reset: () => void
}

/** The storage of this tab, or none on the server or where it is unavailable. */
const tabStorage = createJSONStorage(() =>
  typeof sessionStorage === 'undefined'
    ? { getItem: () => null, setItem: () => {}, removeItem: () => {} }
    : sessionStorage
)

/**
 * The outgoing messages of each chat, kept per tab (sessionStorage) so a remount,
 * a reload or a chat switch resumes them under the same ids instead of losing
 * them. Per tab, not per device: closing the tab must not send them days later
 * from another one.
 */
export const useMothershipOutgoingStore = create<MothershipOutgoingState>()(
  devtools(
    persist(
      (set) => ({
        chats: {},
        record: (chatId, messages) =>
          set((state) => {
            if (messages.length === 0) {
              if (!(chatId in state.chats)) return state
              const { [chatId]: _, ...rest } = state.chats
              return { chats: rest }
            }
            return { chats: { ...state.chats, [chatId]: messages } }
          }),
        reset: () => set({ chats: {} }),
      }),
      {
        name: 'mothership-outgoing:v1',
        storage: tabStorage,
        partialize: (state) => ({ chats: state.chats }),
      }
    ),
    { name: 'mothership-outgoing-store' }
  )
)

registerUserDataReset('mothership-outgoing', () => useMothershipOutgoingStore.getState().reset())
