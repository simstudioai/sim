/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { BrowserToolReplayLedger } from '@/lib/mothership/tools/client/browser-tool-replay-ledger'

const STORAGE_KEY = 'test:browser-tool-ledger:v1'
const LEGACY_PREFIX = 'test:browser-tool-executed:'
const PROTECTED_WINDOW_MS = 120_000
const TTL_MS = 300_000

interface CreateLedgerOptions {
  maxEntries?: number
  now: () => number
  storage?: Storage
}

function createLedger({
  maxEntries = 3,
  now,
  storage = window.sessionStorage,
}: CreateLedgerOptions) {
  return new BrowserToolReplayLedger({
    storageKey: STORAGE_KEY,
    legacyStoragePrefix: LEGACY_PREFIX,
    maxEntries,
    ttlMs: TTL_MS,
    protectedWindowMs: PROTECTED_WINDOW_MS,
    now,
    getStorage: () => storage,
  })
}

function persistedEntries(): Array<{ toolCallId: string; lastSeenAt: number }> {
  const serialized = window.sessionStorage.getItem(STORAGE_KEY)
  if (!serialized) return []
  return JSON.parse(serialized).entries
}

class WriteFailingStorage implements Storage {
  private readonly values = new Map<string, string>()
  keyReads = 0

  get length(): number {
    return this.values.size
  }

  clear(): void {
    this.values.clear()
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  key(index: number): string | null {
    this.keyReads += 1
    return Array.from(this.values.keys())[index] ?? null
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }

  setItem(key: string, value: string): void {
    if (key === STORAGE_KEY) throw new DOMException('Quota exceeded', 'QuotaExceededError')
    this.values.set(key, value)
  }
}

class ReadFailingStorage implements Storage {
  readonly writes: Array<{ key: string; value: string }> = []
  private readonly failure: 'ledger' | 'legacy-iteration'

  constructor(failure: 'ledger' | 'legacy-iteration') {
    this.failure = failure
  }

  get length(): number {
    if (this.failure === 'legacy-iteration') throw new DOMException('Read blocked', 'SecurityError')
    return 0
  }

  clear(): void {}

  getItem(): string | null {
    if (this.failure === 'ledger') throw new DOMException('Read blocked', 'SecurityError')
    return null
  }

  key(): string | null {
    return null
  }

  removeItem(): void {}

  setItem(key: string, value: string): void {
    this.writes.push({ key, value })
  }
}

class RecordingStorage implements Storage {
  private readonly values = new Map<string, string>()
  ledgerWrites = 0

  get length(): number {
    return this.values.size
  }

  clear(): void {
    this.values.clear()
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }

  setItem(key: string, value: string): void {
    if (key === STORAGE_KEY) this.ledgerWrites += 1
    this.values.set(key, value)
  }
}

describe('BrowserToolReplayLedger', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  it('never evicts an entry inside the accepted event window', () => {
    let now = 1_000
    const ledger = createLedger({ maxEntries: 2, now: () => now })

    expect(ledger.claim('call-a')).toBe('claimed')
    now += 1
    expect(ledger.claim('call-b')).toBe('claimed')
    now = 1_000 + PROTECTED_WINDOW_MS

    expect(ledger.claim('call-c')).toBe('capacity-exhausted')
    expect(ledger.claim('call-a')).toBe('duplicate')
    expect(ledger.claim('call-b')).toBe('duplicate')
    expect(persistedEntries()).toHaveLength(2)
  })

  it('evicts the least recently seen eligible entry after the protected window', () => {
    let now = 1_000
    const ledger = createLedger({ maxEntries: 2, now: () => now })

    expect(ledger.claim('call-a')).toBe('claimed')
    now += 1
    expect(ledger.claim('call-b')).toBe('claimed')
    now += PROTECTED_WINDOW_MS
    expect(ledger.claim('call-a')).toBe('duplicate')
    now += PROTECTED_WINDOW_MS

    expect(ledger.claim('call-c')).toBe('claimed')
    expect(persistedEntries().map(({ toolCallId }) => toolCallId)).toEqual(['call-a', 'call-c'])
    expect(ledger.claim('call-a')).toBe('duplicate')
    expect(persistedEntries().map(({ toolCallId }) => toolCallId)).not.toContain('call-b')
  })

  it('keeps persistent storage bounded under sustained use', () => {
    let now = 1_000
    const maxEntries = 32
    const ledger = createLedger({ maxEntries, now: () => now })

    for (let index = 0; index < 10_000; index += 1) {
      if (index > 0 && index % maxEntries === 0) now += PROTECTED_WINDOW_MS + 1
      expect(ledger.claim(`call-${index}`)).toBe('claimed')
    }

    const entries = persistedEntries()
    expect(entries).toHaveLength(maxEntries)
    expect(entries.at(-1)?.toolCallId).toBe('call-9999')
  })

  it('rejects an oversized serialized payload before writing it to storage', () => {
    const storage = new RecordingStorage()
    const ledger = createLedger({ maxEntries: 4, now: () => 1_000, storage })
    const escapedId = (prefix: string) => `${prefix}${'\0'.repeat(255)}`

    expect(ledger.claim(escapedId('\u0001'))).toBe('claimed')
    expect(ledger.claim(escapedId('\u0002'))).toBe('claimed')
    expect(storage.ledgerWrites).toBe(2)

    expect(ledger.claim(escapedId('\u0003'))).toBe('storage-unavailable')
    expect(storage.ledgerWrites).toBe(2)
  })

  it('expires entries only after the configured TTL boundary', () => {
    let now = 1_000
    const ledger = createLedger({ now: () => now })

    expect(ledger.claim('call-a')).toBe('claimed')
    now += TTL_MS + 1
    expect(ledger.claim('call-a')).toBe('claimed')
  })

  it('transactionally migrates legacy keys and survives a fresh ledger instance', () => {
    let now = 1_000
    window.sessionStorage.setItem(`${LEGACY_PREFIX}legacy-call`, '1')
    const firstLedger = createLedger({ now: () => now })

    expect(firstLedger.claim('legacy-call')).toBe('duplicate')
    expect(window.sessionStorage.getItem(`${LEGACY_PREFIX}legacy-call`)).toBeNull()
    expect(persistedEntries()).toEqual([{ toolCallId: 'legacy-call', lastSeenAt: now }])

    now += 1
    const reloadedLedger = createLedger({ now: () => now })
    expect(reloadedLedger.claim('legacy-call')).toBe('duplicate')
  })

  it('retains overflow legacy protection until more than the replay TTL has elapsed', () => {
    let now = 1_000
    window.sessionStorage.setItem(`${LEGACY_PREFIX}legacy-a`, '1')
    window.sessionStorage.setItem(`${LEGACY_PREFIX}legacy-b`, '1')
    window.sessionStorage.setItem(`${LEGACY_PREFIX}legacy-c`, '1')
    const ledger = createLedger({ maxEntries: 2, now: () => now })

    expect(ledger.claim('legacy-a')).toBe('duplicate')
    expect(ledger.claim('legacy-b')).toBe('duplicate')
    expect(ledger.claim('new-call')).toBe('claimed')
    expect(window.sessionStorage.getItem(`${LEGACY_PREFIX}legacy-c`)).toBe('1')

    now += TTL_MS
    expect(ledger.claim('legacy-c')).toBe('duplicate')
    now += 1
    expect(ledger.claim('after-cleanup')).toBe('claimed')
    expect(window.sessionStorage.getItem(`${LEGACY_PREFIX}legacy-c`)).toBeNull()
  })

  it('fails closed while keeping legacy protection and in-memory dedup when writes fail', () => {
    let now = 1_000
    const storage = new WriteFailingStorage()
    storage.setItem(`${LEGACY_PREFIX}legacy-call`, '1')
    const ledger = createLedger({ now: () => now, storage })

    expect(ledger.claim('legacy-call')).toBe('duplicate')
    expect(storage.getItem(`${LEGACY_PREFIX}legacy-call`)).toBe('1')
    expect(ledger.claim('new-call')).toBe('storage-unavailable')
    now += 1
    expect(ledger.claim('new-call')).toBe('duplicate')
  })

  it('fails closed and suppresses same-lifetime redelivery when storage is unavailable', () => {
    let now = 1_000
    const ledger = new BrowserToolReplayLedger({
      storageKey: STORAGE_KEY,
      legacyStoragePrefix: LEGACY_PREFIX,
      maxEntries: 2,
      ttlMs: TTL_MS,
      protectedWindowMs: PROTECTED_WINDOW_MS,
      now: () => now,
      getStorage: () => {
        throw new DOMException('Blocked', 'SecurityError')
      },
    })

    expect(ledger.claim('call-a')).toBe('storage-unavailable')
    now += 1
    expect(ledger.claim('call-a')).toBe('duplicate')
  })

  it.each(['ledger', 'legacy-iteration'] as const)(
    'fails closed when %s reads fail even though writes would succeed',
    (failure) => {
      let now = 1_000
      const storage = new ReadFailingStorage(failure)
      const ledger = createLedger({ now: () => now, storage })

      expect(ledger.claim('call-a')).toBe('storage-unavailable')
      expect(storage.writes).toEqual([])
      now += 1
      expect(ledger.claim('call-a')).toBe('duplicate')
    }
  )

  it('rejects an oversized serialized ledger before parsing or materializing entries', () => {
    const serialized = JSON.stringify({
      version: 1,
      entries: [{ toolCallId: 'persisted-call', lastSeenAt: 1_000 }],
      padding: 'x'.repeat(5_000),
    })
    window.sessionStorage.setItem(STORAGE_KEY, serialized)
    const ledger = createLedger({ now: () => 1_000 })

    expect(ledger.claim('new-call')).toBe('storage-unavailable')
    expect(ledger.claim('new-call')).toBe('duplicate')
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBe(serialized)
  })

  it('rejects a persisted ledger with 2049 entries before hydrating its map', () => {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        entries: Array.from({ length: 2_049 }, (_, index) => ({
          toolCallId: `call-${index}`,
          lastSeenAt: 1_000,
        })),
      })
    )
    const ledger = createLedger({ maxEntries: 2_048, now: () => 1_000 })

    expect(ledger.claim('new-call')).toBe('storage-unavailable')
    expect(ledger.claim('new-call')).toBe('duplicate')
  })

  it.each([
    ['empty', ''],
    ['257-character', 'x'.repeat(257)],
  ])('rejects a persisted ledger containing a %s tool-call id', (_label, toolCallId) => {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, entries: [{ toolCallId, lastSeenAt: 1_000 }] })
    )
    const ledger = createLedger({ now: () => 1_000 })

    expect(ledger.claim('new-call')).toBe('storage-unavailable')
    expect(ledger.claim('new-call')).toBe('duplicate')
  })

  it('rejects persisted entries with non-finite timestamps', () => {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, entries: [{ toolCallId: 'call-a', lastSeenAt: null }] })
    )
    const ledger = createLedger({ now: () => 1_000 })

    expect(ledger.claim('new-call')).toBe('storage-unavailable')
    expect(ledger.claim('new-call')).toBe('duplicate')
  })

  it('clamps a persisted future timestamp after the system clock moves backward', () => {
    let now = 1_000
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        entries: [{ toolCallId: 'future-call', lastSeenAt: 1_000_000_000 }],
      })
    )
    const ledger = createLedger({ now: () => now })

    expect(ledger.claim('new-call')).toBe('claimed')
    expect(persistedEntries()).toContainEqual({ toolCallId: 'future-call', lastSeenAt: now })

    now += TTL_MS + 1
    expect(ledger.claim('future-call')).toBe('claimed')
  })

  it('bounds a future legacy-cleanup deadline to one TTL after hydration', () => {
    let now = 1_000
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        entries: [
          { toolCallId: 'call-a', lastSeenAt: now },
          { toolCallId: 'call-b', lastSeenAt: now },
        ],
        legacyCleanupAt: 1_000_000_000,
      })
    )
    window.sessionStorage.setItem(`${LEGACY_PREFIX}legacy-call`, '1')
    const ledger = createLedger({ maxEntries: 2, now: () => now })

    expect(ledger.claim('new-call')).toBe('capacity-exhausted')
    expect(window.sessionStorage.getItem(`${LEGACY_PREFIX}legacy-call`)).toBe('1')

    now += TTL_MS + 1
    expect(ledger.claim('after-cleanup')).toBe('claimed')
    expect(window.sessionStorage.getItem(`${LEGACY_PREFIX}legacy-call`)).toBeNull()
  })

  it('bounds legacy discovery while preserving exact-key duplicate checks on overflow', () => {
    const storage = new WriteFailingStorage()
    for (let index = 0; index < 100; index += 1) {
      storage.setItem(`${LEGACY_PREFIX}legacy-${index}`, '1')
    }
    const ledger = createLedger({ maxEntries: 2, now: () => 1_000, storage })

    expect(ledger.claim('legacy-99')).toBe('duplicate')
    expect(storage.keyReads).toBeLessThanOrEqual(32)
    expect(storage.getItem(`${LEGACY_PREFIX}legacy-99`)).toBe('1')
  })

  it('rotates bounded legacy cleanup scans without rescanning on every claim', () => {
    let now = 1_000
    const storage = new WriteFailingStorage()
    for (let index = 0; index < 4_096; index += 1) {
      storage.setItem(`unrelated-${index}`, '1')
    }
    storage.setItem(`${LEGACY_PREFIX}late-legacy-call`, '1')
    const ledger = createLedger({ maxEntries: 2_048, now: () => now, storage })

    expect(ledger.claim('new-call')).toBe('storage-unavailable')
    expect(storage.getItem(`${LEGACY_PREFIX}late-legacy-call`)).toBe('1')
    expect(storage.keyReads).toBe(4_096)

    now += TTL_MS + 1
    expect(ledger.claim('after-cleanup')).toBe('storage-unavailable')
    expect(storage.getItem(`${LEGACY_PREFIX}late-legacy-call`)).toBeNull()
    expect(storage.keyReads).toBe(8_192)

    now += 1
    expect(ledger.claim('next-call')).toBe('storage-unavailable')
    expect(storage.keyReads).toBe(8_192)
  })
})
