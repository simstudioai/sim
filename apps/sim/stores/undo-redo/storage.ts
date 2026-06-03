import { createLogger } from '@sim/logger'
import { del, get, set } from 'idb-keyval'
import type { StateStorage } from 'zustand/middleware'

const logger = createLogger('UndoRedoStorage')

/** A burst of edits within this window is persisted as a single IndexedDB write. */
const PERSIST_THROTTLE_MS = 1000

/**
 * IndexedDB-backed persistence for the undo/redo store. Unlike localStorage it is
 * asynchronous (never blocks the main thread on write) and has a large quota, so it
 * tolerates the volume of large code-field undo frames. Writes are throttled so a
 * burst of keystrokes produces a single transaction rather than one write per change.
 */
function createThrottledIndexedDbStorage(): StateStorage {
  const pending = new Map<string, string>()
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = (): void => {
    timer = null
    const writes = [...pending]
    pending.clear()
    for (const [name, value] of writes) {
      void set(name, value).catch((error) => logger.warn('IndexedDB write failed', { name, error }))
    }
  }

  if (typeof window !== 'undefined') {
    // Persist any pending write before the tab is hidden or closed so it isn't lost.
    const flushOnHide = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', flushOnHide)
  }

  return {
    getItem: async (name: string): Promise<string | null> => {
      if (typeof window === 'undefined') return null
      if (pending.has(name)) return pending.get(name) ?? null
      try {
        return (await get<string>(name)) ?? null
      } catch (error) {
        logger.warn('IndexedDB read failed', { name, error })
        return null
      }
    },

    setItem: (name: string, value: string): void => {
      if (typeof window === 'undefined') return
      pending.set(name, value)
      if (!timer) timer = setTimeout(flush, PERSIST_THROTTLE_MS)
    },

    removeItem: async (name: string): Promise<void> => {
      if (typeof window === 'undefined') return
      pending.delete(name)
      try {
        await del(name)
      } catch (error) {
        logger.warn('IndexedDB delete failed', { name, error })
      }
    },
  }
}

export const undoRedoStorage: StateStorage = createThrottledIndexedDbStorage()
