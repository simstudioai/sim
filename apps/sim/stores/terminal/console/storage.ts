import { createLogger } from '@sim/logger'
import { get, set } from 'idb-keyval'
import type { ConsoleEntry } from './types'

const logger = createLogger('ConsoleStorage')

const STORE_KEY = 'terminal-console-store'
const MIGRATION_KEY = 'terminal-console-store-migrated'

/**
 * Safety-net interval for persisting during very long executions.
 * Only fires while an execution is active. Much longer than a debounce
 * because intermediate writes during execution are low-value.
 */
const LONG_EXECUTION_PERSIST_INTERVAL_MS = 30_000

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

let writeSequence = 0
let activeWrite: Promise<void> | null = null

function writeToIndexedDB(data: PersistedConsoleData): void {
  const seq = ++writeSequence

  const doWrite = async () => {
    try {
      const serialized = JSON.stringify(data)
      if (seq !== writeSequence) return
      await set(STORE_KEY, serialized)
    } catch (error) {
      logger.warn('IndexedDB write failed', { error })
    }
  }

  activeWrite = (activeWrite ?? Promise.resolve()).then(doWrite)
}

/**
 * Execution-aware persistence manager for the terminal console store.
 *
 * Writes happen only at meaningful lifecycle boundaries:
 * - When an execution ends (success, error, cancel)
 * - On explicit user actions (clear console)
 * - On page hide (crash safety)
 * - Every 30s during very long active executions (safety net)
 *
 * During normal execution, no serialization or IndexedDB writes occur,
 * keeping the hot path completely free of persistence overhead.
 */
class ConsolePersistenceManager {
  private dataProvider: (() => PersistedConsoleData) | null = null
  private safetyTimer: ReturnType<typeof setTimeout> | null = null
  private activeExecutions = 0

  /**
   * Binds the data provider function used to snapshot current state.
   * Called once during store initialization.
   */
  bind(provider: () => PersistedConsoleData): void {
    this.dataProvider = provider
  }

  /**
   * Signals that a workflow execution has started.
   * Starts the long-execution safety-net timer if this is the first active execution.
   */
  executionStarted(): void {
    this.activeExecutions++
    if (this.activeExecutions === 1) {
      this.startSafetyTimer()
    }
  }

  /**
   * Signals that a workflow execution has ended (success, error, or cancel).
   * Triggers an immediate persist and stops the safety timer if no executions remain.
   */
  executionEnded(): void {
    this.activeExecutions = Math.max(0, this.activeExecutions - 1)
    this.persist()
    if (this.activeExecutions === 0) {
      this.stopSafetyTimer()
    }
  }

  /**
   * Triggers an immediate persist. Used for explicit user actions
   * like clearing the console, and for page-hide durability.
   */
  persist(): void {
    if (!this.dataProvider) return
    writeToIndexedDB(this.dataProvider())
  }

  private startSafetyTimer(): void {
    this.stopSafetyTimer()
    this.safetyTimer = setInterval(() => {
      this.persist()
    }, LONG_EXECUTION_PERSIST_INTERVAL_MS)
  }

  private stopSafetyTimer(): void {
    if (this.safetyTimer !== null) {
      clearInterval(this.safetyTimer)
      this.safetyTimer = null
    }
  }
}

export const consolePersistence = new ConsolePersistenceManager()
