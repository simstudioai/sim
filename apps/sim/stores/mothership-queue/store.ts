import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { create } from 'zustand'
import { createJSONStorage, devtools, persist } from 'zustand/middleware'
import type { MothershipQueueState, QueuedMothershipMessage } from '@/stores/mothership-queue/types'

const logger = createLogger('MothershipQueueStore')

/**
 * Per-tab sessionStorage adapter. No-ops on SSR and tolerates quota errors so
 * a transient storage failure can never crash a render.
 *
 * The queue persists to **sessionStorage** rather than localStorage (which is
 * what `mothership-drafts` uses) on purpose: a queued message carries
 * intent-to-send, and the rehydrate path auto-drains the queue once chat
 * history confirms there's no active server stream. Tab close should not
 * fire those sends days later, so sessionStorage caps the replay window at
 * the lifetime of the tab.
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

/**
 * Drops the volatile `queuedSendHandoff` so the persisted snapshot only carries
 * data that remains meaningful after reload. Reconstruction on next dispatch is
 * unnecessary because rehydrate happens outside any active-stream lifecycle.
 */
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
            /**
             * Strip `queuedSendHandoff` on edit. The original handoff was
             * created when the slot was first enqueued and references the
             * stream that was active at that moment; once the user changes
             * the payload, that handoff is no longer valid. The dispatcher
             * (or `sendQueuedMessageImmediately`) will mint a fresh handoff
             * at send time if the active-stream lifecycle still needs one.
             */
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
              /**
               * Merge into any existing destination bucket rather than
               * overwriting. In the normal `adoptResolvedChatId` flow the
               * destination is a fresh chatId with no prior bucket, but if
               * a stale entry survives in sessionStorage we'd silently lose
               * the user's pending messages on overwrite. Appending keeps
               * FIFO order (existing first, then the resolved-stream sends).
               */
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
        partialize: (state) => ({
          queues: Object.fromEntries(
            Object.entries(state.queues).map(([key, messages]) => [
              key,
              messages.map(stripVolatile),
            ])
          ),
          editing: state.editing,
        }),
      }
    ),
    { name: 'mothership-queue-store' }
  )
)
