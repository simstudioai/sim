import { createLogger } from '@sim/logger'
import { del, get, set } from 'idb-keyval'
import type { StateStorage } from 'zustand/middleware'

const logger = createLogger('UndoRedoStorage')

const STORE_KEY = 'workflow-undo-redo'
const MIGRATION_KEY = 'workflow-undo-redo-migrated'

let migrationPromiseInternal: Promise<void> | null = null

/**
 * Migrates existing undo/redo data from localStorage to IndexedDB.
 * Runs once on first load; subsequent loads short-circuit on MIGRATION_KEY.
 *
 * On success the localStorage key is removed, freeing origin storage quota
 * for the other persisted Zustand stores that share it.
 */
async function migrateFromLocalStorage(): Promise<void> {
  if (typeof localStorage === 'undefined') return

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

if (typeof localStorage !== 'undefined') {
  migrationPromiseInternal = migrateFromLocalStorage().finally(() => {
    migrationPromiseInternal = null
  })
}

/**
 * Resolves when the one-time localStorage → IndexedDB migration finishes.
 * Exposed for tests; production code reads through `indexedDBStorage.getItem`
 * which already awaits this promise.
 */
export const migrationReady: Promise<void> = migrationPromiseInternal ?? Promise.resolve()

export const indexedDBStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    if (typeof localStorage === 'undefined') return null

    if (migrationPromiseInternal) {
      await migrationPromiseInternal
    }

    try {
      const value = await get<string>(name)
      return value ?? null
    } catch (error) {
      logger.warn('IndexedDB read failed', { name, error })
      return null
    }
  },

  setItem: async (name: string, value: string): Promise<void> => {
    if (typeof localStorage === 'undefined') return
    try {
      await set(name, value)
    } catch (error) {
      logger.warn('IndexedDB write failed', { name, error })
    }
  },

  removeItem: async (name: string): Promise<void> => {
    if (typeof localStorage === 'undefined') return
    try {
      await del(name)
    } catch (error) {
      logger.warn('IndexedDB delete failed', { name, error })
    }
  },
}
