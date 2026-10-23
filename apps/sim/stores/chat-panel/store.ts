import { createLogger } from '@sim/logger'
import { toRecord } from '@sim/utils/object'
import { LRUCache } from 'lru-cache'
import { create } from 'zustand'
import { createJSONStorage, devtools, persist } from 'zustand/middleware'
import { MOTHERSHIP_WIDTH } from '@/stores/constants'
import { registerUserDataReset } from '@/stores/user-data-reset-registry'

const STORAGE_KEY = 'chat-panel-widths'
const MAX_SAVED_CHATS = 200
const logger = createLogger('ChatPanelStore')
/** A drag can finish after the server assigns its pending chat a durable ID. */
const adoptedChatKeys = new LRUCache<string, string>({ max: MAX_SAVED_CHATS })

interface ChatPanelState {
  widths: Record<string, number>
  resolveChatId: (chatId: string) => string
  setWidth: (userId: string, chatId: string, width: number) => void
  migrate: (fromChatId: string, toChatId: string) => void
  reset: () => void
}

function validWidth(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= MOTHERSHIP_WIDTH.MIN
}

/** Bounds device-local history by most recently adjusted chat, including restored storage. */
function boundedWidths(value: unknown): Record<string, number> {
  const widths: Record<string, number> = {}
  for (const [key, width] of Object.entries(toRecord(value)).slice(-MAX_SAVED_CHATS)) {
    if (key && validWidth(width)) widths[key] = width
  }
  return widths
}

/** Storage failure must not prevent resizing or retaining preferences for the current session. */
const storage = createJSONStorage<Pick<ChatPanelState, 'widths'>>(() => ({
  getItem: (key) => {
    try {
      return window.localStorage.getItem(key)
    } catch {
      return null
    }
  },
  setItem: (key, value) => {
    try {
      window.localStorage.setItem(key, value)
    } catch {
      logger.warn('Unable to save chat panel preferences')
    }
  },
  removeItem: (key) => {
    try {
      window.localStorage.removeItem(key)
    } catch {
      logger.warn('Unable to clear chat panel preferences')
    }
  },
}))

export const useChatPanelStore = create<ChatPanelState>()(
  devtools(
    persist(
      (set, get) => ({
        widths: {},
        resolveChatId: (chatId) => adoptedChatKeys.get(chatId) ?? chatId,
        setWidth: (userId, chatId, width) => {
          if (!validWidth(width)) return
          if (!useChatPanelStore.persist.hasHydrated()) void useChatPanelStore.persist.rehydrate()
          const key = `${userId}:${get().resolveChatId(chatId)}`
          if (get().widths[key] === width) return
          set((state) => {
            const { [key]: _previous, ...rest } = state.widths
            return { widths: boundedWidths({ ...rest, [key]: width }) }
          })
        },
        migrate: (fromChatId, toChatId) => {
          if (fromChatId === toChatId) return
          if (!useChatPanelStore.persist.hasHydrated()) void useChatPanelStore.persist.rehydrate()
          adoptedChatKeys.set(fromChatId, toChatId)
          const previous = get().widths
          const widths = { ...previous }
          let changed = false
          for (const [key, width] of Object.entries(previous)) {
            if (!key.endsWith(`:${fromChatId}`)) continue
            const destination = `${key.slice(0, -fromChatId.length)}${toChatId}`
            widths[destination] ??= width
            delete widths[key]
            changed = true
          }
          if (changed) set({ widths })
        },
        reset: () => {
          adoptedChatKeys.clear()
          set({ widths: {} })
        },
      }),
      {
        name: STORAGE_KEY,
        storage,
        skipHydration: true,
        partialize: ({ widths }) => ({ widths }),
        merge: (persisted, current) => ({
          ...current,
          widths: boundedWidths(toRecord(persisted).widths),
        }),
      }
    ),
    { name: 'chat-panel' }
  )
)

registerUserDataReset(STORAGE_KEY, () => {
  useChatPanelStore.getState().reset()
  void useChatPanelStore.persist.clearStorage()
})
