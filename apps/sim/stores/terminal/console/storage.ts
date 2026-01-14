import { createLogger } from '@sim/logger'
import { del, get, set } from 'idb-keyval'
import type { StateStorage } from 'zustand/middleware'

const logger = createLogger('ConsoleStorage')

const STORE_KEY = 'terminal-console-store'
const MIGRATION_KEY = 'terminal-console-store-migrated'

/**
 * Promise that resolves when migration is complete.
 * Used to ensure getItem waits for migration before reading.
 */
let migrationPromise: Promise<void> | null = null

/**
 * Migrates existing console data from localStorage to IndexedDB.
 * Runs once on first load, then marks migration as complete.
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
      logger.info('Migrated console store to IndexedDB')
    }

    await set(MIGRATION_KEY, true)
  } catch (error) {
    logger.warn('Migration from localStorage failed', { error })
  }
}

if (typeof window !== 'undefined') {
  migrationPromise = migrateFromLocalStorage().finally(() => {
    migrationPromise = null
  })
}

export const indexedDBStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    if (typeof window === 'undefined') return null

    // Ensure migration completes before reading
    if (migrationPromise) {
      await migrationPromise
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
    if (typeof window === 'undefined') return
    try {
      await set(name, value)
    } catch (error) {
      logger.warn('IndexedDB write failed', { name, error })
    }
  },

  removeItem: async (name: string): Promise<void> => {
    if (typeof window === 'undefined') return
    try {
      await del(name)
    } catch (error) {
      logger.warn('IndexedDB delete failed', { name, error })
    }
  },
}
