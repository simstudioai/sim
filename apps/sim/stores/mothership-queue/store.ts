import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { toRecord, toRecordOrNull } from '@sim/utils/object'
import { create } from 'zustand'
import { createJSONStorage, devtools, persist } from 'zustand/middleware'
import type {
  MothershipQueueState,
  QueuedMothershipMessage,
  QueueMigration,
} from '@/stores/mothership-queue/types'

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

/** Numbers each delete, so a restore or read can tell the delete it saw from a later one. */
let deleteCount = 0

const initialState = {
  queues: {} as Record<string, QueuedMothershipMessage[]>,
  editing: {} as Record<string, string>,
  cleared: {} as Record<string, number>,
  migratedTo: {} as Record<string, QueueMigration>,
}

/**
 * The earlier attempt's id a queued message goes out under, if it reuses one:
 * its Stop handoff's, else the withdrawn send's. `startSendMessage` picks the id
 * in the same order.
 */
export function reusedRequestId(message: QueuedMothershipMessage): string | undefined {
  return message.queuedSendHandoff?.userMessageId ?? message.resumeUserMessageId
}

/**
 * `admissionUnknown` is decided where a send chooses its id (`startSendMessage`)
 * and carried on the entry. A writer that has no say (a session saved before the
 * flag existed, a send handed over from another surface) leaves it out; an entry
 * that then reuses an earlier attempt's id is taken as possibly sent. Every queue
 * write goes through this, so no path can queue such a message as editable.
 */
function withAdmissionGuard(message: QueuedMothershipMessage): QueuedMothershipMessage {
  if (reusedRequestId(message) === undefined || message.admissionUnknown !== undefined) {
    return message
  }
  return { ...message, admissionUnknown: true }
}

function isQueuedMessage(value: unknown): value is QueuedMothershipMessage {
  const record = toRecordOrNull(value)
  return record !== null && typeof record.id === 'string' && typeof record.content === 'string'
}

/**
 * An entry saved before `hold` and `retry` existed, in their shape: a held
 * `retryRequired` (with `heldUntilOnline` when it waited for the network) and a
 * `sendRetries` count with its `notBefore`.
 */
function withCurrentWaitFields(value: unknown): unknown {
  const record = toRecordOrNull(value)
  if (!record) return value
  const { retryRequired, heldUntilOnline, sendRetries, notBefore, ...rest } = record
  return {
    ...rest,
    ...(retryRequired === true && rest.hold === undefined
      ? { hold: heldUntilOnline === true ? 'online' : 'user' }
      : {}),
    ...(typeof sendRetries === 'number' && typeof notBefore === 'number' && rest.retry === undefined
      ? { retry: { attempt: sendRetries, notBefore } }
      : {}),
  }
}

/**
 * Queues saved to this tab's session, brought to the current shape and guarded
 * on the way back in: an entry saved before `admissionUnknown` existed would
 * otherwise be editable.
 */
function restoredQueues(persisted: unknown): Record<string, QueuedMothershipMessage[]> {
  const queues: Record<string, QueuedMothershipMessage[]> = {}
  for (const [chatKey, queue] of Object.entries(toRecord(toRecord(persisted).queues))) {
    if (!Array.isArray(queue)) continue
    const messages = queue
      .map(withCurrentWaitFields)
      .filter(isQueuedMessage)
      .map(withAdmissionGuard)
    if (messages.length > 0) queues[chatKey] = messages
  }
  return queues
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
 * Where a message goes back into its queue after a write captured before an
 * `await`: in the queue's live key, right after the last message still there
 * that was ahead of it (`aheadIds`, plus whatever a chat's queue already held
 * when a new-chat queue moved into it), else at the head. Anchoring on ids, not
 * an index, keeps it in order however the queue changed meanwhile.
 */
export function liveQueuePosition(
  chatKey: string,
  aheadIds: readonly string[]
): { chatKey: string; index: number } {
  const { migratedTo, queues } = useMothershipQueueStore.getState()
  /* One lookup: only a new-chat key moves, and only to its chat's key, which never
     does. \`useChat\` migrates only from its pending sentinel key to the resolved chat
     id (the chat-resolution effect and the detached chat resolution), never from a
     chat key. */
  const migration = migratedTo[chatKey]
  const key = migration?.key ?? chatKey
  const ahead = new Set([...aheadIds, ...(migration?.ahead ?? [])])
  const queue = queues[key] ?? []
  let index = 0
  queue.forEach((message, position) => {
    if (ahead.has(message.id)) index = position + 1
  })
  return { chatKey: key, index }
}

/** The queue key a write captured before an `await` should use now (see `liveQueuePosition`). */
export function liveQueueKey(chatKey: string): string {
  return liveQueuePosition(chatKey, []).chatKey
}

export const useMothershipQueueStore = create<MothershipQueueState>()(
  devtools(
    persist(
      (set) => ({
        ...initialState,

        enqueue: (chatKey, message) =>
          set((state) => {
            if (state.cleared[chatKey]) return state
            return {
              queues: setQueueForChat(state.queues, chatKey, [
                ...(state.queues[chatKey] ?? []),
                withAdmissionGuard(message),
              ]),
            }
          }),

        insertAt: (chatKey, index, message) =>
          set((state) => {
            /** A restore that lands after its chat was cleared (deleted) must not recreate it. */
            if (state.cleared[chatKey]) return state
            const current = state.queues[chatKey] ?? []
            if (current.some((m) => m.id === message.id)) return state
            const next = [...current]
            next.splice(Math.max(0, Math.min(index, next.length)), 0, withAdmissionGuard(message))
            return { queues: setQueueForChat(state.queues, chatKey, next) }
          }),

        replaceAt: (chatKey, id, patch) =>
          set((state) => {
            const current = state.queues[chatKey] ?? []
            const index = current.findIndex((m) => m.id === id)
            if (index === -1) return state
            /** The server may already hold it as sent; an edit would become a second message. */
            if (current[index].admissionUnknown) return state
            const next = [...current]
            /** Editing changes the request identity, never an unresolved Stop dependency. */
            const {
              queuedSendHandoff,
              resumeUserMessageId: _staleResume,
              hold: _hold,
              heldSurface: _surface,
              retry: _retry,
              ...rest
            } = next[index]
            next[index] = {
              ...rest,
              ...(queuedSendHandoff?.stopRequired
                ? { queuedSendHandoff: { ...queuedSendHandoff, userMessageId: undefined } }
                : {}),
              content: patch.content,
              fileAttachments: patch.fileAttachments,
              contexts: patch.contexts,
              requestMode: patch.requestMode,
              assistantSearch: patch.assistantSearch,
              assistantSearchLevel: patch.assistantSearchLevel,
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
            const migratedTo = {
              ...state.migratedTo,
              /** The first move is the real one; a repeat must not rewrite what was ahead. */
              [fromKey]: state.migratedTo[fromKey] ?? {
                key: toKey,
                ahead: (state.queues[toKey] ?? []).map((message) => message.id),
              },
            }
            const fromQueue = state.queues[fromKey]
            const fromEditing = state.editing[fromKey]
            if (!fromQueue && fromEditing === undefined) return { migratedTo }

            const queues = omitKey(state.queues, fromKey)
            /** A chat deleted meanwhile takes nothing: its queue is gone with it. */
            if (fromQueue && fromQueue.length > 0 && !state.cleared[toKey]) {
              // Merge defensively in case a stale bucket survived in
              // sessionStorage. FIFO: existing first, then the resolved stream.
              const existing = state.queues[toKey] ?? []
              /** A chat-bound key is stable, so its messages no longer need a surface to adopt them. */
              queues[toKey] = [
                ...existing,
                ...fromQueue.map(({ heldSurface: _surface, ...message }) => message),
              ]
            }
            const editing = omitKey(state.editing, fromKey)
            if (fromEditing !== undefined) {
              editing[toKey] = fromEditing
            }
            return { queues, editing, migratedTo }
          }),

        releaseHeldUntilOnline: () =>
          set((state) => {
            let released = false
            const queues: Record<string, QueuedMothershipMessage[]> = {}
            for (const [chatKey, queue] of Object.entries(state.queues)) {
              queues[chatKey] = queue.map((message) => {
                if (message.hold !== 'online') return message
                released = true
                const { hold: _hold, ...rest } = message
                return rest
              })
            }
            return released ? { queues } : state
          }),

        deferRetry: (chatKey, id, retry) =>
          set((state) => {
            const current = state.queues[chatKey]
            if (!current?.some((message) => message.id === id)) return state
            return {
              queues: setQueueForChat(
                state.queues,
                chatKey,
                current.map((message) => (message.id === id ? { ...message, retry } : message))
              ),
            }
          }),

        adoptHeldSends: (toKey, surface) =>
          set((state) => {
            const adopted: QueuedMothershipMessage[] = []
            let queues = state.queues
            for (const [chatKey, queue] of Object.entries(state.queues)) {
              if (chatKey === toKey) continue
              const held = queue.filter((message) => message.heldSurface === surface)
              if (held.length === 0) continue
              adopted.push(...held)
              queues = setQueueForChat(
                queues,
                chatKey,
                queue.filter((message) => message.heldSurface !== surface)
              )
            }
            if (adopted.length === 0) return state
            return {
              queues: setQueueForChat(queues, toKey, [...(queues[toKey] ?? []), ...adopted]),
            }
          }),

        holdForSurface: (chatKey, surface) =>
          set((state) => {
            const queue = state.queues[chatKey]
            if (!queue?.some((message) => message.heldSurface !== surface)) return state
            return {
              queues: setQueueForChat(
                state.queues,
                chatKey,
                queue.map((message) => ({ ...message, heldSurface: surface }))
              ),
            }
          }),

        clearChat: (chatKey) =>
          set((state) => ({
            queues: omitKey(state.queues, chatKey),
            editing: omitKey(state.editing, chatKey),
            cleared: { ...state.cleared, [chatKey]: ++deleteCount },
          })),

        liftDelete: (chatKey, deleteToken) =>
          set((state) =>
            state.cleared[chatKey] === deleteToken
              ? { cleared: omitKey(state.cleared, chatKey) }
              : state
          ),

        reopenRestoredChat: (chatKey) =>
          set((state) =>
            state.cleared[chatKey] === undefined
              ? state
              : { cleared: omitKey(state.cleared, chatKey) }
          ),

        reset: () => set(initialState),
      }),
      {
        name: 'mothership-queue',
        storage: createJSONStorage(() => sessionStorageAdapter),
        // `editing` is intentionally omitted — the composer that holds the
        // edit text is component-local and empty after reload, so a persisted
        // editing flag would render an in-edit row with nothing bound.
        partialize: (state) => ({ queues: state.queues }),
        merge: (persisted, current) => ({ ...current, queues: restoredQueues(persisted) }),
      }
    ),
    { name: 'mothership-queue-store' }
  )
)
