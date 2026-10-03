const LEDGER_VERSION = 1
const MAX_TOOL_CALL_ID_LENGTH = 256
const MIN_SERIALIZED_LEDGER_BYTES = 4 * 1024
const SERIALIZED_BYTES_PER_ENTRY = 1_152
const MIN_LEGACY_SCAN_LIMIT = 32

interface PersistedReplayLedgerEntry {
  toolCallId: string
  lastSeenAt: number
}

interface PersistedReplayLedger {
  version: typeof LEDGER_VERSION
  entries: PersistedReplayLedgerEntry[]
  legacyCleanupAt?: number
  legacyScanCursor?: number
}

type StorageRead<T> = { ok: true; value: T } | { ok: false }

interface LegacyKeysRead {
  keys: string[]
  overflow: boolean
  nextCursor: number
}

export type BrowserToolReplayClaim =
  | 'claimed'
  | 'duplicate'
  | 'capacity-exhausted'
  | 'storage-unavailable'

interface BrowserToolReplayLedgerOptions {
  storageKey: string
  legacyStoragePrefix: string
  maxEntries: number
  ttlMs: number
  protectedWindowMs: number
  now?: () => number
  getStorage?: () => Storage | null
}

/**
 * Bounded replay ledger for side-effecting client browser tools.
 *
 * Entries inside `protectedWindowMs` are never evicted to make room. When that
 * window is full, claiming fails closed so a newly executed action cannot
 * become replayable after a renderer reload. Older entries remain useful for
 * replay suppression until `ttlMs`, but may be evicted in least-recently-seen
 * order when capacity is needed.
 */
export class BrowserToolReplayLedger {
  private readonly entries = new Map<string, number>()
  private readonly storageKey: string
  private readonly legacyStoragePrefix: string
  private readonly maxEntries: number
  private readonly ttlMs: number
  private readonly protectedWindowMs: number
  private readonly maxSerializedBytes: number
  private readonly legacyScanLimit: number
  private readonly now: () => number
  private readonly getStorage: () => Storage | null
  private hydrated = false
  private legacyCleanupAt: number | undefined
  private legacyScanCursor = 0

  constructor(options: BrowserToolReplayLedgerOptions) {
    if (options.maxEntries < 1) throw new Error('Replay ledger maxEntries must be positive')
    if (options.protectedWindowMs < 1) {
      throw new Error('Replay ledger protectedWindowMs must be positive')
    }
    if (options.ttlMs < options.protectedWindowMs) {
      throw new Error('Replay ledger ttlMs must cover protectedWindowMs')
    }
    this.storageKey = options.storageKey
    this.legacyStoragePrefix = options.legacyStoragePrefix
    this.maxEntries = options.maxEntries
    this.ttlMs = options.ttlMs
    this.protectedWindowMs = options.protectedWindowMs
    this.maxSerializedBytes = Math.max(
      MIN_SERIALIZED_LEDGER_BYTES,
      options.maxEntries * SERIALIZED_BYTES_PER_ENTRY
    )
    this.legacyScanLimit = Math.max(MIN_LEGACY_SCAN_LIMIT, options.maxEntries * 2)
    this.now = options.now ?? (() => Date.now())
    this.getStorage =
      options.getStorage ??
      (() => {
        if (typeof window === 'undefined') return null
        return window.sessionStorage
      })
  }

  /** Atomically claims an action, or fails closed while the protected window is full. */
  claim(toolCallId: string): BrowserToolReplayClaim {
    if (!isValidToolCallId(toolCallId)) return 'storage-unavailable'

    const now = this.now()
    const storage = this.getStorageSafely()
    const hydrationCertain = this.hydrate(storage, now)
    this.pruneExpired(now)
    const cleanupCertain = hydrationCertain && this.cleanupLegacyKeysIfDue(storage, now)

    if (this.entries.has(toolCallId)) {
      this.touch(toolCallId, now)
      if (hydrationCertain && cleanupCertain) this.persist(storage)
      return 'duplicate'
    }
    const legacyRead =
      storage && hydrationCertain && cleanupCertain
        ? this.readLegacyKey(storage, toolCallId)
        : { ok: false as const }
    if (legacyRead.ok && legacyRead.value) return 'duplicate'

    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.entries().next().value as [string, number] | undefined
      if (!oldest || now - oldest[1] <= this.protectedWindowMs) {
        return 'capacity-exhausted'
      }
      this.entries.delete(oldest[0])
    }

    this.entries.set(toolCallId, now)
    if (!hydrationCertain || !cleanupCertain || !legacyRead.ok) return 'storage-unavailable'
    return this.persist(storage) ? 'claimed' : 'storage-unavailable'
  }

  private hydrate(storage: Storage | null, now: number): boolean {
    if (this.hydrated) return true
    if (!storage) return false

    const persistedRead = this.readPersistedLedger(storage)
    if (!persistedRead.ok) return false
    const persisted = persistedRead.value
    if (persisted) {
      this.legacyCleanupAt =
        persisted.legacyCleanupAt === undefined
          ? undefined
          : Math.min(persisted.legacyCleanupAt, now + this.ttlMs)
      this.legacyScanCursor = persisted.legacyScanCursor ?? 0
      for (const entry of persisted.entries) {
        const lastSeenAt = Math.min(entry.lastSeenAt, now)
        if (now - lastSeenAt > this.ttlMs) continue
        this.touch(entry.toolCallId, lastSeenAt)
      }
      this.pruneToCapacity(now)
    }
    const legacyKeysRead = this.readLegacyKeys(storage)
    if (!legacyKeysRead.ok) return false

    this.hydrated = true

    const { keys: legacyKeys, overflow: legacyOverflow, nextCursor } = legacyKeysRead.value
    this.legacyScanCursor = nextCursor
    if (legacyKeys.length === 0 && !legacyOverflow) return true

    const availableEntries = this.maxEntries - this.entries.size
    if (!legacyOverflow && legacyKeys.length <= availableEntries) {
      for (const key of legacyKeys) {
        this.touch(key.slice(this.legacyStoragePrefix.length), now)
      }
      if (this.persist(storage) && !this.removeStorageKeys(storage, legacyKeys)) {
        this.legacyCleanupAt = now + this.ttlMs
        this.persist(storage)
      }
      return true
    }

    this.legacyCleanupAt ??= now + this.ttlMs
    this.persist(storage)
    return true
  }

  private pruneExpired(now: number): void {
    for (const [toolCallId, lastSeenAt] of this.entries) {
      if (now - lastSeenAt > this.ttlMs) this.entries.delete(toolCallId)
    }
  }

  private pruneToCapacity(now: number): void {
    this.pruneExpired(now)
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined
      if (!oldest) return
      this.entries.delete(oldest)
    }
  }

  private touch(toolCallId: string, timestamp: number): void {
    this.entries.delete(toolCallId)
    this.entries.set(toolCallId, timestamp)
  }

  private getStorageSafely(): Storage | null {
    try {
      return this.getStorage()
    } catch {
      return null
    }
  }

  private readPersistedLedger(storage: Storage): StorageRead<PersistedReplayLedger | null> {
    try {
      const serialized = storage.getItem(this.storageKey)
      if (!serialized) return { ok: true, value: null }
      if (new TextEncoder().encode(serialized).byteLength > this.maxSerializedBytes) {
        return { ok: false }
      }
      const value: unknown = JSON.parse(serialized)
      if (!isPersistedReplayLedger(value, this.maxEntries)) return { ok: false }
      return { ok: true, value }
    } catch {
      return { ok: false }
    }
  }

  private readLegacyKeys(storage: Storage): StorageRead<LegacyKeysRead> {
    const keys: string[] = []
    try {
      const storageLength = storage.length
      const inspectedKeys = Math.min(storageLength, this.legacyScanLimit)
      let overflow = storageLength > inspectedKeys
      const startIndex = storageLength === 0 ? 0 : this.legacyScanCursor % storageLength
      for (let offset = 0; offset < inspectedKeys; offset += 1) {
        const index = (startIndex + offset) % storageLength
        const key = storage.key(index)
        if (!key?.startsWith(this.legacyStoragePrefix) || key === this.storageKey) continue
        if (!isValidToolCallId(key.slice(this.legacyStoragePrefix.length))) {
          overflow = true
          continue
        }
        keys.push(key)
      }
      const nextCursor = storageLength === 0 ? 0 : (startIndex + inspectedKeys) % storageLength
      return { ok: true, value: { keys, overflow, nextCursor } }
    } catch {
      return { ok: false }
    }
  }

  private readLegacyKey(storage: Storage, toolCallId: string): StorageRead<boolean> {
    try {
      return {
        ok: true,
        value: storage.getItem(`${this.legacyStoragePrefix}${toolCallId}`) !== null,
      }
    } catch {
      return { ok: false }
    }
  }

  private cleanupLegacyKeysIfDue(storage: Storage | null, now: number): boolean {
    if (!storage) return false
    if (this.legacyCleanupAt === undefined || now <= this.legacyCleanupAt) return true
    const keysRead = this.readLegacyKeys(storage)
    if (!keysRead.ok) return false
    this.legacyScanCursor = keysRead.value.nextCursor
    if (!this.removeStorageKeys(storage, keysRead.value.keys)) {
      this.legacyCleanupAt = now + this.ttlMs
      this.persist(storage)
      return false
    }
    this.legacyCleanupAt = keysRead.value.overflow ? now + this.ttlMs : undefined
    return this.persist(storage)
  }

  private removeStorageKeys(storage: Storage, keys: string[]): boolean {
    for (const key of keys) {
      try {
        storage.removeItem(key)
      } catch {
        return false
      }
    }
    return true
  }

  private persist(storage: Storage | null): boolean {
    if (!storage) return false
    const payload: PersistedReplayLedger = {
      version: LEDGER_VERSION,
      entries: Array.from(this.entries, ([toolCallId, lastSeenAt]) => ({
        toolCallId,
        lastSeenAt,
      })),
      ...(this.legacyCleanupAt !== undefined ? { legacyCleanupAt: this.legacyCleanupAt } : {}),
      ...(this.legacyScanCursor > 0 ? { legacyScanCursor: this.legacyScanCursor } : {}),
    }
    try {
      const serialized = JSON.stringify(payload)
      if (new TextEncoder().encode(serialized).byteLength > this.maxSerializedBytes) return false
      storage.setItem(this.storageKey, serialized)
      return true
    } catch {
      return false
    }
  }
}

function isValidToolCallId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= MAX_TOOL_CALL_ID_LENGTH
}

function isPersistedReplayLedger(
  value: unknown,
  maxEntries: number
): value is PersistedReplayLedger {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  if (candidate.version !== LEDGER_VERSION || !Array.isArray(candidate.entries)) return false
  if (candidate.entries.length > maxEntries) return false
  if (
    candidate.legacyCleanupAt !== undefined &&
    (typeof candidate.legacyCleanupAt !== 'number' || !Number.isFinite(candidate.legacyCleanupAt))
  ) {
    return false
  }
  if (
    candidate.legacyScanCursor !== undefined &&
    (typeof candidate.legacyScanCursor !== 'number' ||
      !Number.isSafeInteger(candidate.legacyScanCursor) ||
      candidate.legacyScanCursor < 0)
  ) {
    return false
  }
  return candidate.entries.every((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) return false
    const record = entry as Record<string, unknown>
    return (
      isValidToolCallId(record.toolCallId) &&
      typeof record.lastSeenAt === 'number' &&
      Number.isFinite(record.lastSeenAt)
    )
  })
}
