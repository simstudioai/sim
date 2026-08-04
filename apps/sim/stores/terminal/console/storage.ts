import { createLogger } from '@sim/logger'
import { omit } from '@sim/utils/object'
import { get, set } from 'idb-keyval'
import type { ConsoleEntry } from '@/stores/terminal/console/types'

const logger = createLogger('ConsoleStorage')

const STORE_KEY = 'terminal-console-store'
const MIGRATION_KEY = 'terminal-console-store-migrated'
export const CONSOLE_STORAGE_VERSION = 1

/**
 * Interval for persisting terminal state during active executions.
 * Kept short enough that a hard refresh during execution still has
 * recent rows available once the tab-local reconnect pointer resumes.
 */
const EXECUTION_PERSIST_INTERVAL_MS = 5_000

/**
 * Shape of terminal console data persisted to IndexedDB.
 */
export interface PersistedConsoleData {
  storageVersion: typeof CONSOLE_STORAGE_VERSION
  workflowEntries: Record<string, ConsoleEntry[]>
  isOpen: boolean
}

export interface ConsoleStorageMigrationResult {
  data: PersistedConsoleData
  migrated: boolean
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

function stripPersistedContent(entry: ConsoleEntry): ConsoleEntry {
  return omit(entry, ['input', 'output', 'error', 'warning', 'agentStreamThinking'])
}

function stripPersistedWorkflowContent(
  workflowEntries: Record<string, ConsoleEntry[]>
): Record<string, ConsoleEntry[]> {
  return Object.fromEntries(
    Object.entries(workflowEntries).map(([workflowId, entries]) => [
      workflowId,
      entries.map(stripPersistedContent),
    ])
  )
}

/**
 * Normalizes all historical console formats and removes content from unversioned data.
 * Historical rows have no trusted Secrets-resolution provenance, so their structure is
 * retained while input, output, errors, warnings, and live thinking are discarded.
 */
export function migratePersistedConsoleData(parsed: unknown): ConsoleStorageMigrationResult | null {
  if (!parsed || typeof parsed !== 'object') return null

  const parsedRecord = parsed as Record<string, unknown>
  const wrappedState = parsedRecord.state
  const data =
    wrappedState && typeof wrappedState === 'object'
      ? (wrappedState as Record<string, unknown>)
      : parsedRecord

  let workflowEntries: Record<string, ConsoleEntry[]> = {}
  if (Array.isArray(data.entries) && !data.workflowEntries) {
    for (const rawEntry of data.entries) {
      if (!rawEntry || typeof rawEntry !== 'object') continue
      const entry = rawEntry as ConsoleEntry
      if (!entry.workflowId) continue
      if (!workflowEntries[entry.workflowId]) workflowEntries[entry.workflowId] = []
      workflowEntries[entry.workflowId].push(entry)
    }
  } else if (data.workflowEntries && typeof data.workflowEntries === 'object') {
    workflowEntries = data.workflowEntries as Record<string, ConsoleEntry[]>
  }

  const migrated = data.storageVersion !== CONSOLE_STORAGE_VERSION
  return {
    data: {
      storageVersion: CONSOLE_STORAGE_VERSION,
      workflowEntries: migrated ? stripPersistedWorkflowContent(workflowEntries) : workflowEntries,
      isOpen: Boolean(data.isOpen),
    },
    migrated,
  }
}

/**
 * Loads persisted console data from IndexedDB.
 * Handles historical Zustand wrappers, the original flat entry array, and raw data.
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
    const result = migratePersistedConsoleData(parsed)
    if (!result) return null

    if (result.migrated) {
      await set(STORE_KEY, JSON.stringify(result.data))
    }

    return result.data
  } catch (error) {
    logger.warn('Failed to load console data from IndexedDB', { error })
    return null
  }
}

let activeWrite: Promise<void> | null = null

interface PersistOptions {
  merge?: boolean
}

function entryTimestamp(entry: ConsoleEntry): number {
  return Date.parse(entry.endedAt ?? entry.startedAt ?? entry.timestamp)
}

function shouldReplaceEntry(existing: ConsoleEntry, incoming: ConsoleEntry): boolean {
  if (existing.isRunning && !incoming.isRunning) return true
  if (!existing.isRunning && incoming.isRunning) return false
  return entryTimestamp(incoming) >= entryTimestamp(existing)
}

function mergeEntries(
  existingEntries: ConsoleEntry[] = [],
  incomingEntries: ConsoleEntry[] = []
): ConsoleEntry[] {
  const entriesById = new Map<string, ConsoleEntry>()
  const orderedIds: string[] = []

  for (const entry of existingEntries) {
    entriesById.set(entry.id, entry)
    orderedIds.push(entry.id)
  }

  for (const entry of incomingEntries) {
    const existing = entriesById.get(entry.id)
    if (!existing) {
      entriesById.set(entry.id, entry)
      orderedIds.push(entry.id)
      continue
    }
    if (shouldReplaceEntry(existing, entry)) {
      entriesById.set(entry.id, entry)
    }
  }

  return orderedIds
    .map((id) => entriesById.get(id))
    .filter((entry): entry is ConsoleEntry => !!entry)
}

function mergePersistedConsoleData(
  existing: PersistedConsoleData | null,
  incoming: PersistedConsoleData
): PersistedConsoleData {
  if (!existing) return incoming
  const workflowIds = new Set([
    ...Object.keys(existing.workflowEntries),
    ...Object.keys(incoming.workflowEntries),
  ])
  const workflowEntries: Record<string, ConsoleEntry[]> = {}

  for (const workflowId of workflowIds) {
    const entries = mergeEntries(
      existing.workflowEntries[workflowId],
      incoming.workflowEntries[workflowId]
    )
    if (entries.length > 0) workflowEntries[workflowId] = entries
  }

  return {
    storageVersion: CONSOLE_STORAGE_VERSION,
    workflowEntries,
    isOpen: incoming.isOpen,
  }
}

function writeToIndexedDB(
  data: PersistedConsoleData,
  { merge = true }: PersistOptions = {}
): Promise<void> {
  const doWrite = async () => {
    try {
      const nextData = merge ? mergePersistedConsoleData(await loadConsoleData(), data) : data
      const serialized = JSON.stringify(nextData)
      await set(STORE_KEY, serialized)
    } catch (error) {
      logger.warn('IndexedDB write failed', { error })
    }
  }

  activeWrite = (activeWrite ?? Promise.resolve()).then(doWrite)
  return activeWrite
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
  private needsInitialPersist = false

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
    this.needsInitialPersist = true
    if (this.activeExecutions === 1) {
      this.startSafetyTimer()
    }
  }

  /**
   * Called by the store when a running entry is added during an active execution.
   * Triggers one immediate persist so refreshes can hydrate visible terminal rows,
   * then disables until the next execution starts.
   */
  onRunningEntryAdded(): void {
    if (!this.needsInitialPersist) return
    this.needsInitialPersist = false
    this.persist()
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
  persist(options?: PersistOptions): Promise<void> {
    if (!this.dataProvider) return Promise.resolve()
    return writeToIndexedDB(this.dataProvider(), options)
  }

  private startSafetyTimer(): void {
    this.stopSafetyTimer()
    this.safetyTimer = setInterval(() => {
      this.persist()
    }, EXECUTION_PERSIST_INTERVAL_MS)
  }

  private stopSafetyTimer(): void {
    if (this.safetyTimer !== null) {
      clearInterval(this.safetyTimer)
      this.safetyTimer = null
    }
  }
}

export const consolePersistence = new ConsolePersistenceManager()

const EXEC_POINTER_PREFIX = 'terminal-active-execution:'

/**
 * Lightweight pointer to an in-flight execution, persisted immediately on
 * execution start so the reconnect flow can find it even if no console
 * entries have been written yet. Stored in sessionStorage so ownership stays
 * scoped to the browser tab that started the run.
 */
export interface ExecutionPointer {
  workflowId: string
  executionId: string
  lastEventId: number
}

export async function loadExecutionPointer(workflowId: string): Promise<ExecutionPointer | null> {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(`${EXEC_POINTER_PREFIX}${workflowId}`)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.executionId) return null
    return parsed as ExecutionPointer
  } catch {
    return null
  }
}

export function saveExecutionPointer(pointer: ExecutionPointer): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  try {
    window.sessionStorage.setItem(
      `${EXEC_POINTER_PREFIX}${pointer.workflowId}`,
      JSON.stringify(pointer)
    )
  } catch {
    return Promise.resolve()
  }
  return Promise.resolve()
}

export function clearExecutionPointer(workflowId: string): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  try {
    window.sessionStorage.removeItem(`${EXEC_POINTER_PREFIX}${workflowId}`)
  } catch {
    return Promise.resolve()
  }
  return Promise.resolve()
}
