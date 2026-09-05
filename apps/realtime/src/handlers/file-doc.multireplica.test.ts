/**
 * @vitest-environment node
 *
 * Multi-replica (store-enabled) coverage for the copilot live-merge stale-check. The main
 * `file-doc.test.ts` runs with the store DISABLED (single-replica fallback); this file mocks an ENABLED
 * store so the cross-process branch of `mergeMarkdownIntoRoom` — staleness against the SHARED synced
 * version under the merge lock, and `recordVersion` writing `setSyncedVersion` — is exercised directly.
 * The enabled merge path reads its base from the shared store (not an in-memory room), so no JOIN/seed
 * is needed: calling `applyMarkdownToLiveFileDoc` against the fake store drives the branch on its own.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

const { mockFetchFileDocMerge } = vi.hoisted(() => ({
  mockFetchFileDocMerge: vi.fn(),
}))

/**
 * A minimal ENABLED store: in-memory monotonic synced version (mirrors SET_VERSION_IF_NEWER_SCRIPT), a
 * non-null stream state so the merge has a base, and no-op locks/publish. Only the surface the
 * store-enabled merge path touches is implemented.
 */
const fakeStore = {
  enabled: true,
  versions: new Map<string, number>(),
  acquireMergeSlot: vi.fn(async () => 'token'),
  releaseMergeSlot: vi.fn(async () => {}),
  getDocumentGeneration: vi.fn(async () => 'shared-generation'),
  getStreamState: vi.fn(async () => new Uint8Array([1])),
  publishAndWait: vi.fn(async () => {}),
  getSyncedVersion: vi.fn(async (name: string) => fakeStore.versions.get(name) ?? null),
  setSyncedVersion: vi.fn(async (name: string, version: number) => {
    fakeStore.versions.set(name, Math.max(fakeStore.versions.get(name) ?? 0, version))
  }),
  markAgentStreaming: vi.fn(async () => {}),
  isAgentStreaming: vi.fn(async () => false),
}

vi.mock('@sim/platform-authz/rooms', () => ({ authorizeRoom: vi.fn() }))

vi.mock('@/handlers/file-doc-app', () => ({
  fetchFileDocSeed: vi.fn(),
  fetchFileDocMerge: mockFetchFileDocMerge,
  fetchFileDocPersist: vi.fn(),
}))

vi.mock('@/handlers/file-doc-store', () => ({
  getFileDocStore: () => fakeStore,
  REDIS_ORIGIN: Symbol('redis'),
  REDIS_SNAPSHOT_ORIGIN: Symbol('redis-snapshot'),
}))

import { applyMarkdownToLiveFileDoc } from '@/handlers/file-doc'

const ROOM_NAME = 'workspace-file-doc:file-1'

describe('applyMarkdownToLiveFileDoc — multi-replica (store-enabled) ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fakeStore.versions.clear()
    fakeStore.acquireMergeSlot.mockResolvedValue('token')
    fakeStore.getStreamState.mockResolvedValue(new Uint8Array([1]))
    mockFetchFileDocMerge.mockResolvedValue(Y.encodeStateAsUpdate(new Y.Doc()))
  })

  it('drops a stale durable write against the SHARED synced version', async () => {
    // A durable write (e.g. a concurrent human save on another process) records the shared synced version.
    expect(await applyMarkdownToLiveFileDoc('file-1', '# durable', { version: 100 })).toBe(
      'applied'
    )
    expect(fakeStore.setSyncedVersion).toHaveBeenCalledWith(ROOM_NAME, 100, 'shared-generation')
    expect(fakeStore.getStreamState).toHaveBeenCalledWith(ROOM_NAME, 'shared-generation')
    expect(fakeStore.publishAndWait).toHaveBeenCalledWith(
      ROOM_NAME,
      expect.any(Uint8Array),
      'shared-generation'
    )
    mockFetchFileDocMerge.mockClear()

    // A durable write with an OLDER version than the SHARED synced version is stale — rejected under the
    // lock before any diff is built, so it can't regress the doc across replicas.
    expect(await applyMarkdownToLiveFileDoc('file-1', '# older durable', { version: 50 })).toBe(
      'stale'
    )
    expect(mockFetchFileDocMerge).not.toHaveBeenCalled()

    // A newer durable write applies and advances the shared synced version.
    expect(await applyMarkdownToLiveFileDoc('file-1', '# durable again', { version: 150 })).toBe(
      'applied'
    )
    expect(fakeStore.setSyncedVersion).toHaveBeenCalledWith(ROOM_NAME, 150, 'shared-generation')
    // setSyncedVersion fired only for the two applied durable writes, never for the stale one.
    expect(fakeStore.setSyncedVersion).toHaveBeenCalledTimes(2)
  })

  it('defers the content merge cluster-wide when a client is streaming (records version, no diff)', async () => {
    // The cluster-wide counterpart of the single-replica deferral: while the shared `isAgentStreaming`
    // flag is set (a client on ANY replica is streaming this agent edit), the durable merge must record
    // the version but skip the content diff — the streaming client owns the bytes, so a whole-document
    // merge here would double-write them.
    fakeStore.isAgentStreaming.mockResolvedValue(true)

    expect(
      await applyMarkdownToLiveFileDoc('file-1', '# streamed by a client', { version: 100 })
    ).toBe('applied')
    expect(mockFetchFileDocMerge).not.toHaveBeenCalled() // content deferred to the client
    expect(fakeStore.publishAndWait).not.toHaveBeenCalled()
    expect(fakeStore.setSyncedVersion).toHaveBeenCalledWith(ROOM_NAME, 100, 'shared-generation') // version still recorded

    // Once streaming stops the flag clears and the (now near-noop) durable merge resumes normally.
    fakeStore.isAgentStreaming.mockResolvedValue(false)
    expect(await applyMarkdownToLiveFileDoc('file-1', '# final durable', { version: 150 })).toBe(
      'applied'
    )
    expect(mockFetchFileDocMerge).toHaveBeenCalledTimes(1)
  })
})
