/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { idbStore, idbGet, idbSet, idbDel } = vi.hoisted(() => {
  const store = new Map<string, unknown>()
  return {
    idbStore: store,
    idbGet: vi.fn(async (key: string) => store.get(key) ?? undefined),
    idbSet: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value)
    }),
    idbDel: vi.fn(async (key: string) => {
      store.delete(key)
    }),
  }
})

vi.mock('idb-keyval', () => ({
  get: idbGet,
  set: idbSet,
  del: idbDel,
}))

const STORE_KEY = 'workflow-undo-redo'
const MIGRATION_KEY = 'workflow-undo-redo-migrated'

async function loadFreshModule() {
  vi.resetModules()
  return await import('@/stores/undo-redo/storage')
}

describe('undo-redo IndexedDB storage adapter', () => {
  beforeEach(() => {
    idbStore.clear()
    idbGet.mockClear()
    idbSet.mockClear()
    idbDel.mockClear()
    localStorage.clear()
    vi.mocked(localStorage.getItem).mockClear()
    vi.mocked(localStorage.setItem).mockClear()
    vi.mocked(localStorage.removeItem).mockClear()
  })

  describe('migration', () => {
    it('copies localStorage data into IndexedDB and removes the localStorage key on first load', async () => {
      const legacyPayload = JSON.stringify({ state: { stacks: {} }, version: 0 })
      localStorage.setItem(STORE_KEY, legacyPayload)
      idbSet.mockClear()

      const { migrationReady } = await loadFreshModule()
      await migrationReady

      expect(idbSet).toHaveBeenCalledWith(STORE_KEY, legacyPayload)
      expect(idbStore.get(STORE_KEY)).toBe(legacyPayload)
      expect(localStorage.getItem(STORE_KEY)).toBeNull()
      expect(idbStore.get(MIGRATION_KEY)).toBe(true)
    })

    it('skips data copy when localStorage is empty but still marks migration complete', async () => {
      const { migrationReady } = await loadFreshModule()
      await migrationReady

      expect(idbSet).toHaveBeenCalledWith(MIGRATION_KEY, true)
      expect(idbSet).not.toHaveBeenCalledWith(STORE_KEY, expect.anything())
      expect(idbStore.get(MIGRATION_KEY)).toBe(true)
    })

    it('does not re-run when MIGRATION_KEY is already set', async () => {
      idbStore.set(MIGRATION_KEY, true)
      const legacyPayload = JSON.stringify({ state: { stacks: { foo: {} } }, version: 0 })
      localStorage.setItem(STORE_KEY, legacyPayload)

      const { migrationReady } = await loadFreshModule()
      await migrationReady

      expect(idbSet).not.toHaveBeenCalledWith(STORE_KEY, expect.anything())
      expect(localStorage.getItem(STORE_KEY)).toBe(legacyPayload)
    })

    it('does not throw when IndexedDB set fails — leaves localStorage intact for retry', async () => {
      idbSet.mockRejectedValueOnce(new Error('idb write failed'))
      const legacyPayload = JSON.stringify({ state: { stacks: {} }, version: 0 })
      localStorage.setItem(STORE_KEY, legacyPayload)

      const { migrationReady } = await loadFreshModule()
      await expect(migrationReady).resolves.toBeUndefined()

      expect(localStorage.getItem(STORE_KEY)).toBe(legacyPayload)
    })
  })

  describe('storage adapter', () => {
    it('getItem awaits migration completion before reading', async () => {
      const legacyPayload = JSON.stringify({ state: { stacks: { a: {} } }, version: 0 })
      localStorage.setItem(STORE_KEY, legacyPayload)

      const { indexedDBStorage, migrationReady } = await loadFreshModule()
      const readPromise = indexedDBStorage.getItem(STORE_KEY)
      await migrationReady
      const value = await readPromise

      expect(value).toBe(legacyPayload)
    })

    it('getItem returns null when key is absent', async () => {
      const { indexedDBStorage, migrationReady } = await loadFreshModule()
      await migrationReady

      const value = await indexedDBStorage.getItem('does-not-exist')
      expect(value).toBeNull()
    })

    it('setItem writes through to IndexedDB', async () => {
      const { indexedDBStorage, migrationReady } = await loadFreshModule()
      await migrationReady

      await indexedDBStorage.setItem(STORE_KEY, 'new-value')
      expect(idbStore.get(STORE_KEY)).toBe('new-value')
    })

    it('setItem swallows IndexedDB errors so the store never crashes the app', async () => {
      const { indexedDBStorage, migrationReady } = await loadFreshModule()
      await migrationReady

      idbSet.mockRejectedValueOnce(new Error('idb quota'))
      await expect(indexedDBStorage.setItem(STORE_KEY, 'x')).resolves.toBeUndefined()
    })

    it('removeItem deletes from IndexedDB', async () => {
      const { indexedDBStorage, migrationReady } = await loadFreshModule()
      await migrationReady
      idbStore.set(STORE_KEY, 'present')

      await indexedDBStorage.removeItem(STORE_KEY)
      expect(idbStore.has(STORE_KEY)).toBe(false)
    })

    it('removeItem swallows IndexedDB errors', async () => {
      const { indexedDBStorage, migrationReady } = await loadFreshModule()
      await migrationReady

      idbDel.mockRejectedValueOnce(new Error('idb delete failed'))
      await expect(indexedDBStorage.removeItem(STORE_KEY)).resolves.toBeUndefined()
    })

    it('getItem swallows IndexedDB read errors and returns null', async () => {
      const { indexedDBStorage, migrationReady } = await loadFreshModule()
      await migrationReady

      idbGet.mockRejectedValueOnce(new Error('idb read failed'))
      const value = await indexedDBStorage.getItem(STORE_KEY)
      expect(value).toBeNull()
    })
  })

  describe('clearPersistedUndoRedo', () => {
    it('deletes the undo-redo key from IndexedDB', async () => {
      const { clearPersistedUndoRedo, migrationReady } = await loadFreshModule()
      await migrationReady
      idbStore.set(STORE_KEY, 'present')

      await clearPersistedUndoRedo()

      expect(idbStore.has(STORE_KEY)).toBe(false)
    })

    it('leaves the migration flag intact so migration does not re-run', async () => {
      const { clearPersistedUndoRedo, migrationReady } = await loadFreshModule()
      await migrationReady
      idbStore.set(STORE_KEY, 'present')

      await clearPersistedUndoRedo()

      expect(idbStore.get(MIGRATION_KEY)).toBe(true)
    })

    it('propagates IndexedDB errors so callers can surface the failure', async () => {
      const { clearPersistedUndoRedo, migrationReady } = await loadFreshModule()
      await migrationReady

      idbDel.mockRejectedValueOnce(new Error('idb delete failed'))
      await expect(clearPersistedUndoRedo()).rejects.toThrow('idb delete failed')
    })
  })

  describe('hydration race', () => {
    it('blocks setItem until the first getItem resolves', async () => {
      const { indexedDBStorage, migrationReady } = await loadFreshModule()
      await migrationReady
      idbStore.set(STORE_KEY, 'persisted-snapshot')

      let releaseRead: ((value: 'persisted-snapshot') => void) | null = null
      idbGet.mockImplementationOnce(
        () =>
          new Promise<'persisted-snapshot'>((resolve) => {
            releaseRead = resolve
          })
      )

      const readPromise = indexedDBStorage.getItem(STORE_KEY)
      const writePromise = indexedDBStorage.setItem(STORE_KEY, 'empty-state')

      // Give the microtask queue a chance to process; the write must still be pending.
      await Promise.resolve()
      expect(idbStore.get(STORE_KEY)).toBe('persisted-snapshot')

      releaseRead?.('persisted-snapshot')
      await readPromise
      await writePromise

      expect(idbStore.get(STORE_KEY)).toBe('empty-state')
    })
  })
})
