import { createLogger } from '@sim/logger'
import { del, get, set } from 'idb-keyval'
import type { ConsoleEntry } from './types'

const logger = createLogger('ConsoleStorage')

const STORE_KEY = 'terminal-console-store'
const MIGRATION_KEY = 'terminal-console-store-migrated'
const WRITE_DEBOUNCE_MS = 750

/**
 * Shape of terminal console data persisted to IndexedDB.
 */
export interface PersistedConsoleData {
  workflowEntries: Record<string, ConsoleEntry[]>
  isOpen: boolean
}

let migrationPromise: Promise<void> | null = null

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

/**
 * Loads persisted console data from IndexedDB.
 * Handles three historical storage formats:
 * 1. Zustand persist wrapper: `{ state: { entries: [...] }, version }` (original flat format)
 * 2. Zustand persist wrapper: `{ state: { workflowEntries: {...} }, version }` (refactored format)
 * 3. Raw data: `{ workflowEntries: {...}, isOpen }` (current format)
 */
export async function loadConsoleData(): Promise<PersistedConsoleData | null> {
  if (typeof window === 'undefined') return null

  if (migrationPromise) {
    await migrationPromise
  }

  try {
    const raw = await get<string>(STORE_KEY)
    if (!raw) return null

    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!parsed || typeof parsed !== 'object') return null

    const data = parsed.state ?? parsed

    if (Array.isArray(data.entries) && !data.workflowEntries) {
      const workflowEntries: Record<string, ConsoleEntry[]> = {}
      for (const entry of data.entries) {
        if (!entry?.workflowId) continue
        const wfId = entry.workflowId
        if (!workflowEntries[wfId]) workflowEntries[wfId] = []
        workflowEntries[wfId].push(entry)
      }
      return { workflowEntries, isOpen: Boolean(data.isOpen) }
    }

    return {
      workflowEntries: data.workflowEntries ?? {},
      isOpen: Boolean(data.isOpen),
    }
  } catch (error) {
    logger.warn('Failed to load console data from IndexedDB', { error })
    return null
  }
}

let pendingData: PersistedConsoleData | null = null
let writeTimer: ReturnType<typeof setTimeout> | null = null

function executeWrite(): void {
  writeTimer = null
  const data = pendingData
  pendingData = null
  if (!data) return

  try {
    const serialized = JSON.stringify(data)
    set(STORE_KEY, serialized).catch((error) => {
      logger.warn('IndexedDB write failed', { error })
    })
  } catch (error) {
    logger.warn('Failed to serialize console data for persistence', { error })
  }
}

/**
 * Schedules a debounced write of console data to IndexedDB.
 * Only stores a reference until the timer fires, so no serialization
 * happens on the calling thread.
 */
export function scheduleConsolePersist(data: PersistedConsoleData): void {
  if (typeof window === 'undefined') return
  pendingData = data
  if (writeTimer !== null) return
  writeTimer = setTimeout(executeWrite, WRITE_DEBOUNCE_MS)
}

/**
 * Immediately flushes any pending console data to IndexedDB.
 * Used on page hide to avoid data loss.
 */
export function flushConsolePersist(): void {
  if (writeTimer !== null) {
    clearTimeout(writeTimer)
  }
  executeWrite()
}

/**
 * Removes all persisted console data from IndexedDB.
 */
export async function clearPersistedConsoleData(): Promise<void> {
  if (typeof window === 'undefined') return

  if (writeTimer !== null) {
    clearTimeout(writeTimer)
    writeTimer = null
  }
  pendingData = null

  try {
    await del(STORE_KEY)
  } catch (error) {
    logger.warn('IndexedDB delete failed', { error })
  }
}
