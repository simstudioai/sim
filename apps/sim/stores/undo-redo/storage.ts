import { createLogger } from '@sim/logger'
import { del, get, set } from 'idb-keyval'
import type { StateStorage } from 'zustand/middleware'

const logger = createLogger('UndoRedoStorage')

const STORE_KEY = 'workflow-undo-redo'
const MIGRATION_KEY = 'workflow-undo-redo-migrated'

let migrationPromiseInternal: Promise<void> | null = null

/**
 * Resolves with the first `getItem` result that goes through the adapter.
 * Used to gate writes until the initial rehydration read completes — without
 * this, a `setItem` triggered before the async `getItem` returns would
 * overwrite the IndexedDB snapshot with an empty in-memory state.
 */
let hydrationReadPromise: Promise<string | null> | null = null

/**
 * Migrates existing undo/redo data from localStorage to IndexedDB.
 * Runs once on first load; subsequent loads short-circuit on MIGRATION_KEY.
 *
 * On success the localStorage key is removed, freeing origin storage quota
 * for the other persisted Zustand stores that share it.
 */
async function migrateFromLocalStorage(): Promise<void> {
  if (typeof window === 'undefined') return

  try {
    const migrated = await get<boolean>(MIGRATION_KEY)
    if (migrated) return

    const localData = localStorage.getItem(STORE_KEY)
    if (localData) {
      await set(STORE_KEY, localData)
      localStorage.removeItem(STORE_KEY)
      logger.info('Migrated undo-redo store from localStorage to IndexedDB')
    }

    await set(MIGRATION_KEY, true)
  } catch (error) {
    logger.warn('Migration from localStorage failed', { error })
  }
}

if (typeof window !== 'undefined') {
  migrationPromiseInternal = migrateFromLocalStorage().finally(() => {
    migrationPromiseInternal = null
  })
}

/**
 * Resolves when the one-time localStorage → IndexedDB migration finishes.
 * Exposed for tests; production code reads through `indexedDBStorage`
 * methods which already await this promise.
 */
export const migrationReady: Promise<void> = migrationPromiseInternal ?? Promise.resolve()

async function awaitMigration(): Promise<void> {
  if (migrationPromiseInternal) {
    await migrationPromiseInternal
  }
}

async function awaitHydrationRead(): Promise<void> {
  if (hydrationReadPromise) {
    try {
      await hydrationReadPromise
    } catch {
      // The read promise already swallowed its own errors; ignore here.
    }
  }
}

/**
 * Removes the persisted undo/redo payload from IndexedDB.
 *
 * Called from `clearUserData` on sign-out so undo history does not
 * survive across user sessions on the same device. Errors are
 * propagated so callers can decide how to react (the default
 * `clearUserData` already wraps this call in a try/catch).
 */
export async function clearPersistedUndoRedo(): Promise<void> {
  if (typeof window === 'undefined') return
  await awaitMigration()

  try {
    await del(STORE_KEY)
  } catch (error) {
    logger.warn('Failed to clear persisted undo-redo', { error })
    throw error
  }
}

export const indexedDBStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    if (typeof window === 'undefined') return null
    await awaitMigration()

    const readPromise = (async () => {
      try {
        const value = await get<string>(name)
        return value ?? null
      } catch (error) {
        logger.warn('IndexedDB read failed', { name, error })
        return null
      }
    })()

    // Record the first read so concurrent writes can wait for it to complete.
    if (!hydrationReadPromise) {
      hydrationReadPromise = readPromise
    }

    return await readPromise
  },

  setItem: async (name: string, value: string): Promise<void> => {
    if (typeof window === 'undefined') return
    await awaitMigration()
    await awaitHydrationRead()

    try {
      await set(name, value)
    } catch (error) {
      logger.warn('IndexedDB write failed', { name, error })
    }
  },

  removeItem: async (name: string): Promise<void> => {
    if (typeof window === 'undefined') return
    await awaitMigration()
    await awaitHydrationRead()

    try {
      await del(name)
    } catch (error) {
      logger.warn('IndexedDB delete failed', { name, error })
    }
  },
}
