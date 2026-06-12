import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { create } from 'zustand'
import { createJSONStorage, devtools, persist } from 'zustand/middleware'
import type { MothershipQueueState, QueuedMothershipMessage } from '@/stores/mothership-queue/types'

const logger = createLogger('MothershipQueueStore')

/**
 * Per-tab sessionStorage adapter — no-ops on SSR and tolerates quota errors.
 *
 * We persist to sessionStorage (not localStorage like `mothership-drafts`)
 * because the queue auto-drains on rehydrate: tab close should not fire those
 * sends days later.
 */
const sessionStorageAdapter = {
  getItem: (name: string): string | null => {
    if (typeof sessionStorage === 'undefined') return null
    try {
      return sessionStorage.getItem(name)
    } catch (error) {
      logger.warn('Failed to read mothership queue from sessionStorage', toError(error))
      return null
    }
  },
  setItem: (name: string, value: string): void => {
    if (typeof sessionStorage === 'undefined') return
    try {
      sessionStorage.setItem(name, value)
    } catch (error) {
      logger.warn('Failed to persist mothership queue to sessionStorage', toError(error))
    }
  },
  removeItem: (name: string): void => {
    if (typeof sessionStorage === 'undefined') return
    try {
      sessionStorage.removeItem(name)
    } catch (error) {
      logger.warn('Failed to remove mothership queue from sessionStorage', toError(error))
    }
  },
}

const initialState = {
  queues: {} as Record<string, QueuedMothershipMessage[]>,
  editing: {} as Record<string, string>,
}

const omitKey = <V>(record: Record<string, V>, key: string): Record<string, V> => {
  if (!(key in record)) return record
  const { [key]: _removed, ...rest } = record
  return rest
}

const setQueueForChat = (
  queues: Record<string, QueuedMothershipMessage[]>,
  chatKey: string,
  next: QueuedMothershipMessage[]
): Record<string, QueuedMothershipMessage[]> =>
  next.length === 0 ? omitKey(queues, chatKey) : { ...queues, [chatKey]: next }

// Drop the volatile `queuedSendHandoff` from the persisted snapshot — its
// stream reference is meaningless after reload; the dispatcher mints a fresh
// one at send time if needed.
const stripVolatile = (message: QueuedMothershipMessage): QueuedMothershipMessage => {
  if (!message.queuedSendHandoff) return message
  const { queuedSendHandoff: _drop, ...rest } = message
  return rest
}

export const useMothershipQueueStore = create<MothershipQueueState>()(
  devtools(
    persist(
      (set) => ({
        ...initialState,

        enqueue: (chatKey, message) =>
          set((state) => ({
            queues: setQueueForChat(state.queues, chatKey, [
              ...(state.queues[chatKey] ?? []),
              message,
            ]),
          })),

        insertAt: (chatKey, index, message) =>
          set((state) => {
            const current = state.queues[chatKey] ?? []
            if (current.some((m) => m.id === message.id)) return state
            const next = [...current]
            next.splice(Math.max(0, Math.min(index, next.length)), 0, message)
            return { queues: setQueueForChat(state.queues, chatKey, next) }
          }),

        replaceAt: (chatKey, id, patch) =>
          set((state) => {
            const current = state.queues[chatKey] ?? []
            const index = current.findIndex((m) => m.id === id)
            if (index === -1) return state
            const next = [...current]
            // Strip `queuedSendHandoff` — references the stream active at
            // original enqueue time; the dispatcher mints a fresh one at send.
            const { queuedSendHandoff: _stale, ...rest } = next[index]
            next[index] = {
              ...rest,
              content: patch.content,
              fileAttachments: patch.fileAttachments,
              contexts: patch.contexts,
            }
            return { queues: setQueueForChat(state.queues, chatKey, next) }
          }),

        remove: (chatKey, id) =>
          set((state) => {
            const current = state.queues[chatKey] ?? []
            const next = current.filter((m) => m.id !== id)
            const wasEditingThis = state.editing[chatKey] === id
            if (next.length === current.length) {
              return wasEditingThis ? { editing: omitKey(state.editing, chatKey) } : state
            }
            return {
              queues: setQueueForChat(state.queues, chatKey, next),
              ...(wasEditingThis ? { editing: omitKey(state.editing, chatKey) } : {}),
            }
          }),

        setEditing: (chatKey, id) =>
          set((state) => ({
            editing:
              id === null ? omitKey(state.editing, chatKey) : { ...state.editing, [chatKey]: id },
          })),

        migrate: (fromKey, toKey) =>
          set((state) => {
            if (fromKey === toKey) return state
            const fromQueue = state.queues[fromKey]
            const fromEditing = state.editing[fromKey]
            if (!fromQueue && fromEditing === undefined) return state

            const queues = omitKey(state.queues, fromKey)
            if (fromQueue && fromQueue.length > 0) {
              // Merge defensively in case a stale bucket survived in
              // sessionStorage. FIFO: existing first, then the resolved stream.
              const existing = state.queues[toKey] ?? []
              queues[toKey] = [...existing, ...fromQueue]
            }
            const editing = omitKey(state.editing, fromKey)
            if (fromEditing !== undefined) {
              editing[toKey] = fromEditing
            }
            return { queues, editing }
          }),

        clearChat: (chatKey) =>
          set((state) => ({
            queues: omitKey(state.queues, chatKey),
            editing: omitKey(state.editing, chatKey),
          })),

        reset: () => set(initialState),
      }),
      {
        name: 'mothership-queue',
        storage: createJSONStorage(() => sessionStorageAdapter),
        // `editing` is intentionally omitted — the composer that holds the
        // edit text is component-local and empty after reload, so a persisted
        // editing flag would render an in-edit row with nothing bound.
        partialize: (state) => ({
          queues: Object.fromEntries(
            Object.entries(state.queues).map(([key, messages]) => [
              key,
              messages.map(stripVolatile),
            ])
          ),
        }),
      }
    ),
    { name: 'mothership-queue-store' }
  )
)
