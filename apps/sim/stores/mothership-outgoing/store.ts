import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { create } from 'zustand'
import { createJSONStorage, devtools, persist } from 'zustand/middleware'
import type { SendPayload } from '@/app/workspace/[workspaceId]/home/types'

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
  unconfirmed?: boolean
  textOffset?: number
  /** Epoch ms it was written: a browser session restore must not send it days later. */
  writtenAt: number
}

interface MothershipOutgoingState {
  /**
   * Per chat id, in the order the messages were written, and per handed-off message
   * for what the surface that resumes it takes behind it (`handedOffJournalKey`).
   */
  chats: Record<string, JournaledOutgoing[]>
  /** Replaces what a chat has to deliver; an empty list drops the chat. */
  record: (chatId: string, messages: JournaledOutgoing[]) => void
  reset: () => void
}

const logger = createLogger('MothershipOutgoingStore')

/**
 * This tab's storage, or nothing on the server. Delivery never depends on it: a
 * quota or access error only costs the message its resume across a reload, so it
 * is logged and never reaches the send.
 */
const tabStorageAdapter = {
  getItem: (name: string): string | null => {
    try {
      if (typeof sessionStorage === 'undefined') return null
      return sessionStorage.getItem(name)
    } catch (error) {
      logger.warn('Failed to read the outgoing journal', toError(error))
      return null
    }
  },
  setItem: (name: string, value: string): void => {
    try {
      if (typeof sessionStorage === 'undefined') return
      sessionStorage.setItem(name, value)
    } catch (error) {
      logger.warn('Failed to write the outgoing journal', toError(error))
    }
  },
  removeItem: (name: string): void => {
    try {
      if (typeof sessionStorage === 'undefined') return
      sessionStorage.removeItem(name)
    } catch (error) {
      logger.warn('Failed to clear the outgoing journal', toError(error))
    }
  },
}

/** What this tab's journal replaced; a tab open across the release drops it once. */
tabStorageAdapter.removeItem('mothership-queue')

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
        storage: createJSONStorage(() => tabStorageAdapter),
        partialize: (state) => ({ chats: state.chats }),
      }
    ),
    { name: 'mothership-outgoing-store' }
  )
)
