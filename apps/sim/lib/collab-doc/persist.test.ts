/**
 * @vitest-environment node
 */

import { FILE_DOC_SEED } from '@sim/realtime-protocol/file-doc'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import * as collabState from '@/lib/collab-doc/collab-state'

const {
  mockGetWorkspaceFile,
  mockFetchBuffer,
  mockUpdateContent,
  mockCommitState,
  mockLoadState,
  ContentVersionConflictError,
} = vi.hoisted(() => ({
  mockGetWorkspaceFile: vi.fn(),
  mockFetchBuffer: vi.fn(),
  mockUpdateContent: vi.fn(),
  mockCommitState: vi.fn(),
  mockLoadState: vi.fn(),
  ContentVersionConflictError: class ContentVersionConflictError extends Error {},
}))

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  ContentVersionConflictError,
  getWorkspaceFile: mockGetWorkspaceFile,
  fetchWorkspaceFileBuffer: mockFetchBuffer,
  updateWorkspaceFileContent: mockUpdateContent,
}))

vi.spyOn(collabState, 'loadCollabDocState').mockImplementation(mockLoadState)
vi.spyOn(collabState, 'commitCollabDocState').mockImplementation(mockCommitState)

import type { CachedCollabDocState, PreparedCollabDocState } from '@/lib/collab-doc/collab-state'
import { applyMarkdownToYDoc, markdownToYDoc, yDocToFileMarkdown } from '@/lib/collab-doc/converter'
import { COLLAB_DOC_FIELD } from '@/lib/collab-doc/field'
import { persistFileDoc } from '@/lib/collab-doc/persist'

const VERSION = new Date('2026-01-01T00:00:00.000Z')

function cachedState(docState: Uint8Array, markdown: Buffer): CachedCollabDocState {
  return {
    docState,
    sourceHash: collabState.hashMarkdown(markdown),
    stateHash: collabState.hashMarkdown(Buffer.from(docState)),
  }
}

/** The exact bytes `persistFileDoc` would project from a doc seeded with `md`. */
function projectionOf(md: string): Buffer {
  const doc = markdownToYDoc(md)
  try {
    return Buffer.from(yDocToFileMarkdown(doc), 'utf-8')
  } finally {
    doc.destroy()
  }
}

function stateOf(md: string): Uint8Array {
  const doc = markdownToYDoc(md)
  try {
    return Y.encodeStateAsUpdate(doc)
  } finally {
    doc.destroy()
  }
}

function editedState(state: Uint8Array, markdown: string): Uint8Array {
  const doc = new Y.Doc()
  try {
    Y.applyUpdate(doc, state)
    applyMarkdownToYDoc(doc, markdown)
    return Y.encodeStateAsUpdate(doc)
  } finally {
    doc.destroy()
  }
}

function stateWithGeneration(markdown: string, generation: string): Uint8Array {
  const doc = markdownToYDoc(markdown)
  try {
    doc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.docIdKey, generation)
    return Y.encodeStateAsUpdate(doc)
  } finally {
    doc.destroy()
  }
}

/** Simulate only atomic storage I/O; every candidate, history merge and projection uses real Yjs. */
function installAtomicStore(markdown: string, initialState: Uint8Array | null = null) {
  const store = {
    durable: projectionOf(markdown),
    version: VERSION.getTime(),
    cache: initialState ? cachedState(initialState, projectionOf(markdown)) : null,
    accepted: [] as PreparedCollabDocState[],
  }
  const matches = (prepared: PreparedCollabDocState) =>
    prepared.expectedState === null
      ? store.cache === null
      : store.cache?.sourceHash === prepared.expectedState.sourceHash &&
        store.cache?.stateHash === prepared.expectedState.stateHash
  const accept = (prepared: PreparedCollabDocState) => {
    store.cache = {
      docState: prepared.docState,
      sourceHash: prepared.sourceHash,
      stateHash: collabState.hashMarkdown(Buffer.from(prepared.docState)),
    }
    store.accepted.push(prepared)
  }
  mockGetWorkspaceFile.mockImplementation(async () => ({
    id: 'file-1',
    name: 'note.md',
    key: 'k',
    size: store.durable.length,
    contentUpdatedAt: new Date(store.version),
    updatedAt: new Date(store.version),
  }))
  mockFetchBuffer.mockImplementation(async () => store.durable)
  mockLoadState.mockImplementation(async () => store.cache)
  mockCommitState.mockImplementation(
    async (_workspaceId, _fileId, version: number, prepared: PreparedCollabDocState) => {
      if (version !== store.version || !matches(prepared)) return { status: 'conflict' }
      accept(prepared)
      return { status: 'committed', version: store.version }
    }
  )
  mockUpdateContent.mockImplementation(
    async (
      _workspaceId,
      _fileId,
      _userId,
      bytes: Buffer,
      _contentType,
      options: { expectedUpdatedAt: Date; collabDocState: PreparedCollabDocState }
    ) => {
      if (options.expectedUpdatedAt.getTime() !== store.version) {
        throw new ContentVersionConflictError('Content changed')
      }
      if (!matches(options.collabDocState)) {
        throw new collabState.CollabDocStateConflictError('file-1')
      }
      accept(options.collabDocState)
      store.durable = Buffer.from(bytes)
      store.version++
      return { contentUpdatedAt: new Date(store.version), updatedAt: new Date(store.version) }
    }
  )
  return store
}

describe('persistFileDoc — no-op writes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCommitState.mockImplementation(async (_workspaceId, _fileId, version: number) => ({
      status: 'committed',
      version,
    }))
    mockLoadState.mockResolvedValue(null)
  })

  function stubFile(durable: Buffer) {
    mockGetWorkspaceFile.mockResolvedValue({
      id: 'file-1',
      name: 'note.md',
      key: 'k',
      size: durable.length,
      updatedAt: VERSION,
      contentUpdatedAt: VERSION,
    })
    mockFetchBuffer.mockResolvedValue(durable)
  }

  /**
   * Opening a file emits a Yjs update of its own (y-tiptap normalizes node attributes on bind), which
   * schedules a persist whose markdown is byte-identical to the file. Writing it would rewrite the file
   * under a fresh storage key and delete the old object, 404ing every reader still holding it — the
   * page's own first content read included.
   */
  it('writes nothing when the projection already matches the durable bytes', async () => {
    const md = '# Title\n\nbody\n\n- [ ] task'
    stubFile(projectionOf(md))

    const result = await persistFileDoc('ws-1', 'file-1', 'user-1', stateOf(md), VERSION.getTime())

    expect(mockUpdateContent).not.toHaveBeenCalled()
    expect(result).toEqual({ status: 'persisted', version: VERSION.getTime() })
  })

  it('reports the CURRENT durable version on a no-op, resyncing a stale If-Match instead of conflicting', async () => {
    const md = 'a\n\nb'
    stubFile(projectionOf(md))

    const result = await persistFileDoc(
      'ws-1',
      'file-1',
      'user-1',
      stateOf(md),
      VERSION.getTime() - 5000
    )

    expect(mockUpdateContent).not.toHaveBeenCalled()
    expect(result).toEqual({ status: 'persisted', version: VERSION.getTime() })
  })

  it('fences the cached snapshot on a no-op so a cold open resumes accepted binary history', async () => {
    const md = 'a\n\nb'
    stubFile(projectionOf(md))

    await persistFileDoc('ws-1', 'file-1', 'user-1', stateOf(md), VERSION.getTime())

    expect(mockCommitState).toHaveBeenCalledWith('ws-1', 'file-1', VERSION.getTime(), {
      docState: expect.any(Uint8Array),
      sourceHash: collabState.hashMarkdown(projectionOf(md)),
      expectedState: null,
    })
  })

  it('writes when the content actually changed', async () => {
    stubFile(projectionOf('a\n\nb'))
    mockUpdateContent.mockResolvedValue({
      contentUpdatedAt: new Date(VERSION.getTime() + 1000),
      updatedAt: new Date(VERSION.getTime() + 1000),
    })

    const result = await persistFileDoc(
      'ws-1',
      'file-1',
      'user-1',
      stateOf('a\n\nb\n\nc'),
      VERSION.getTime()
    )

    expect(mockUpdateContent).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ status: 'persisted', version: VERSION.getTime() + 1000 })
    expect(mockUpdateContent.mock.calls[0][5]).toMatchObject({
      syncLiveDoc: false,
      expectedUpdatedAt: VERSION,
      collabDocState: {
        sourceHash: collabState.hashMarkdown(projectionOf('a\n\nb\n\nc')),
        expectedState: null,
      },
    })
    expect(mockCommitState).not.toHaveBeenCalled()
  })

  it('skips the compare read entirely when the byte count already differs', async () => {
    stubFile(Buffer.from('a shorter file', 'utf-8'))
    mockUpdateContent.mockResolvedValue({
      contentUpdatedAt: new Date(VERSION.getTime() + 1000),
      updatedAt: new Date(VERSION.getTime() + 1000),
    })

    await persistFileDoc(
      'ws-1',
      'file-1',
      'user-1',
      stateOf('# A much longer document\n\nbody'),
      VERSION.getTime()
    )

    expect(mockFetchBuffer).not.toHaveBeenCalled()
    expect(mockUpdateContent).toHaveBeenCalledTimes(1)
  })

  it('fails closed when the durable bytes cannot be read', async () => {
    const md = 'a\n\nb'
    const durable = projectionOf(md)
    mockGetWorkspaceFile.mockResolvedValue({
      id: 'file-1',
      name: 'note.md',
      key: 'k',
      size: durable.length,
      updatedAt: VERSION,
      contentUpdatedAt: VERSION,
    })
    mockFetchBuffer.mockRejectedValue(new Error('storage unavailable'))
    mockUpdateContent.mockResolvedValue({
      contentUpdatedAt: new Date(VERSION.getTime() + 1000),
      updatedAt: new Date(VERSION.getTime() + 1000),
    })

    await expect(
      persistFileDoc('ws-1', 'file-1', 'user-1', stateOf(md), VERSION.getTime())
    ).rejects.toThrow('storage unavailable')

    expect(mockUpdateContent).not.toHaveBeenCalled()
    expect(mockCommitState).not.toHaveBeenCalled()
  })
})

/**
 * The If-Match token is a REMEMBERED timestamp — held in the relay's room (lost with the room) and in a
 * cluster key written best-effort — so a relay that exits just after a successful write comes back with
 * a version older than the file's. Every persist then fails the CAS, and because a conflict neither
 * writes nor advances the token, the document can never be persisted again: the durable markdown
 * freezes, and every reload paints that stale markdown before the live document corrects it on screen.
 */
describe('persistFileDoc — a stale token is not an out-of-band write', () => {
  const NEWER = new Date(VERSION.getTime() + 60_000)

  beforeEach(() => {
    vi.clearAllMocks()
    mockCommitState.mockImplementation(async (_workspaceId, _fileId, version: number) => ({
      status: 'committed',
      version,
    }))
    mockLoadState.mockResolvedValue(null)
  })

  /** The file is at `NEWER` (durable = `durableMd`), while the caller still believes `VERSION`. */
  function stubConflict(durableMd: string) {
    const durable = projectionOf(durableMd)
    mockGetWorkspaceFile.mockResolvedValue({
      id: 'file-1',
      name: 'note.md',
      key: 'k',
      size: durable.length + 999,
      updatedAt: NEWER,
      contentUpdatedAt: NEWER,
    })
    mockFetchBuffer.mockResolvedValue(durable)
    mockUpdateContent.mockImplementation(async (..._args: unknown[]) => {
      const options = _args[5] as { expectedUpdatedAt?: Date }
      if (options?.expectedUpdatedAt?.getTime() !== NEWER.getTime()) {
        throw new ContentVersionConflictError('stale')
      }
      return { contentUpdatedAt: new Date(NEWER.getTime() + 1), updatedAt: NEWER }
    })
    return { durable, docState: stateOf(durableMd) }
  }

  it('writes anyway when the file still holds the bytes this document last projected', async () => {
    const { durable, docState } = stubConflict('a\n\nb')
    mockLoadState.mockResolvedValue(cachedState(docState, durable))

    const result = await persistFileDoc(
      'ws-1',
      'file-1',
      'user-1',
      editedState(docState, 'a\n\nb\n\nmoved'),
      VERSION.getTime()
    )

    expect(result).toEqual({ status: 'persisted', version: NEWER.getTime() + 1 })
    expect(mockUpdateContent).toHaveBeenCalledTimes(1)
  })

  it('still refuses when the file holds someone else’s content', async () => {
    const { docState } = stubConflict('a\n\nb')
    mockLoadState.mockResolvedValue({
      docState,
      sourceHash: 'hash:something this document never wrote',
      stateHash: collabState.hashMarkdown(Buffer.from(docState)),
    })

    const result = await persistFileDoc(
      'ws-1',
      'file-1',
      'user-1',
      editedState(docState, 'a\n\nb\n\nmoved'),
      VERSION.getTime()
    )

    expect(result).toEqual({ status: 'conflict' })
    expect(mockUpdateContent).not.toHaveBeenCalled()
  })

  it('refuses when nothing was ever cached, so there is no proof of authorship', async () => {
    stubConflict('a\n\nb')
    mockLoadState.mockResolvedValue(null)

    const result = await persistFileDoc(
      'ws-1',
      'file-1',
      'user-1',
      stateOf('a\n\nb\n\nmoved'),
      VERSION.getTime()
    )

    expect(result).toEqual({ status: 'conflict' })
  })

  it.each([
    ['insertion', 'alpha\n\nbeta\n\npeer edit'],
    ['deletion', 'alpha'],
    ['formatting', '**alpha**\n\nbeta'],
  ])('refuses a snapshot missing a persisted %s', async (_kind, persistedMarkdown) => {
    const original = stateOf('alpha\n\nbeta')
    const persisted = editedState(original, persistedMarkdown)
    const candidate = editedState(original, 'alpha\n\nbeta\n\nlocal edit')
    if (_kind === 'deletion') {
      expect(Y.encodeStateVectorFromUpdate(persisted)).toEqual(
        Y.encodeStateVectorFromUpdate(original)
      )
    }
    const { durable } = stubConflict(persistedMarkdown)
    mockLoadState.mockResolvedValue(cachedState(persisted, durable))

    await expect(
      persistFileDoc('ws-1', 'file-1', 'user-1', candidate, VERSION.getTime())
    ).resolves.toEqual({ status: 'conflict' })
    expect(mockUpdateContent).not.toHaveBeenCalled()
    expect(mockCommitState).not.toHaveBeenCalled()
  })

  it.each(['alpha', '**alpha**\n\nbeta'])(
    'recovers after already integrating the persisted changes: %s',
    async (persistedMarkdown) => {
      const original = stateOf('alpha\n\nbeta')
      const persisted = editedState(original, persistedMarkdown)
      const candidate = editedState(persisted, `${persistedMarkdown}\n\nlocal edit`)
      const { durable } = stubConflict(persistedMarkdown)
      mockLoadState.mockResolvedValue(cachedState(persisted, durable))

      await expect(
        persistFileDoc('ws-1', 'file-1', 'user-1', candidate, VERSION.getTime())
      ).resolves.toEqual({ status: 'persisted', version: NEWER.getTime() + 1 })
      expect(mockUpdateContent).toHaveBeenCalledTimes(1)
    }
  )

  it('uses cached metadata-only history for stale content proof without adding it to the relay snapshot', async () => {
    const original = stateOf('## Heading')
    const cached = new Y.Doc()
    Y.applyUpdate(cached, original)
    cached.getMap(FILE_DOC_SEED.configMap).set('metadata', 'accepted peer metadata')
    const docState = Y.encodeStateAsUpdate(cached)
    cached.destroy()
    const { durable } = stubConflict('## Heading')
    mockLoadState.mockResolvedValue(cachedState(docState, durable))
    const candidate = editedState(original, '## Heading\n\nlocal edit')

    await expect(
      persistFileDoc('ws-1', 'file-1', 'user-1', candidate, VERSION.getTime())
    ).resolves.toEqual({ status: 'persisted', version: NEWER.getTime() + 1 })
    const accepted = new Y.Doc()
    try {
      const prepared = mockUpdateContent.mock.calls[0][5].collabDocState
      expect(prepared.docState).toBe(candidate)
      Y.applyUpdate(accepted, prepared.docState)
      expect(accepted.getMap(FILE_DOC_SEED.configMap).has('metadata')).toBe(false)
      expect(yDocToFileMarkdown(accepted)).toBe(projectionOf('## Heading\n\nlocal edit').toString())
    } finally {
      accepted.destroy()
    }
  })

  it('never recovers an old generation over a new empty document', async () => {
    const original = markdownToYDoc('old content')
    const replacement = markdownToYDoc('')
    original.getMap('config').set('docId', 'old-generation')
    replacement.getMap('config').set('docId', 'new-generation')
    const candidate = Y.encodeStateAsUpdate(original)
    const persisted = Y.encodeStateAsUpdate(replacement)
    original.destroy()
    replacement.destroy()
    const { durable } = stubConflict('')
    mockLoadState.mockResolvedValue(cachedState(persisted, durable))

    await expect(
      persistFileDoc('ws-1', 'file-1', 'user-1', candidate, VERSION.getTime())
    ).resolves.toEqual({ status: 'conflict' })
    expect(mockUpdateContent).not.toHaveBeenCalled()
  })

  it('fails closed when the cached binary is invalid', async () => {
    const { durable } = stubConflict('base')
    mockLoadState.mockResolvedValue(cachedState(new Uint8Array([255]), durable))

    await expect(
      persistFileDoc('ws-1', 'file-1', 'user-1', stateOf('local edit'), VERSION.getTime())
    ).rejects.toThrow()
    expect(mockUpdateContent).not.toHaveBeenCalled()
    expect(mockCommitState).not.toHaveBeenCalled()
  })

  it('an older in-flight save cannot overwrite a newer completed save', async () => {
    const olderState = stateOf('base\n\nolder local edit')
    const newerState = editedState(olderState, 'base\n\nolder local edit\n\npeer edit')
    let durable = projectionOf('base')
    let version = VERSION.getTime()
    let cache: CachedCollabDocState | null = null
    const firstWrite = Promise.withResolvers<void>()
    const started = Promise.withResolvers<void>()

    mockGetWorkspaceFile.mockImplementation(async () => ({
      id: 'file-1',
      name: 'note.md',
      key: 'key',
      size: durable.length,
      contentUpdatedAt: new Date(version),
      updatedAt: new Date(version),
    }))
    mockFetchBuffer.mockImplementation(async () => durable)
    mockLoadState.mockImplementation(async () => cache)
    let attempts = 0
    mockUpdateContent.mockImplementation(
      async (
        _workspaceId: string,
        _fileId: string,
        _userId: string,
        bytes: Buffer,
        _contentType: unknown,
        options: { expectedUpdatedAt: Date; collabDocState: PreparedCollabDocState }
      ) => {
        if (attempts++ === 0) {
          started.resolve()
          await firstWrite.promise
        }
        if (options.expectedUpdatedAt.getTime() !== version) {
          throw new ContentVersionConflictError('A newer snapshot committed')
        }
        durable = Buffer.from(bytes)
        cache = cachedState(options.collabDocState.docState, bytes)
        version++
        return { contentUpdatedAt: new Date(version), updatedAt: new Date(version) }
      }
    )

    const olderSave = persistFileDoc('ws-1', 'file-1', 'user-1', olderState, VERSION.getTime())
    try {
      await started.promise
      const newerResult = await persistFileDoc(
        'ws-1',
        'file-1',
        'user-1',
        newerState,
        VERSION.getTime()
      )
      expect(newerResult.status).toBe('persisted')
      firstWrite.resolve()
      await expect(olderSave).resolves.toEqual({ status: 'conflict' })
      expect(durable.toString()).toContain('peer edit')
      expect(mockUpdateContent).toHaveBeenCalledTimes(2)
      expect(cache?.sourceHash).toBe(collabState.hashMarkdown(durable))
      expect(cache?.docState).toEqual(mockUpdateContent.mock.calls[1][5].collabDocState.docState)
      expect(mockCommitState).not.toHaveBeenCalled()
      expect(mockLoadState).toHaveBeenCalledTimes(3)
    } finally {
      firstWrite.resolve()
      await olderSave
    }
  })
})

describe('persistFileDoc — atomic cache and native snapshot ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCommitState.mockReset()
    mockLoadState.mockReset()
    mockGetWorkspaceFile.mockReset()
    mockFetchBuffer.mockReset()
    mockUpdateContent.mockReset()
  })

  it.each(['base', 'base\n\nlocal edit'])(
    'rejects an old generation before any write even with a current content token: %s',
    async (candidateMarkdown) => {
      const newer = stateWithGeneration('base', 'new-generation')
      const store = installAtomicStore('base', newer)
      const prior = store.cache

      await expect(
        persistFileDoc(
          'ws-1',
          'file-1',
          'user-1',
          stateWithGeneration(candidateMarkdown, 'old-generation'),
          VERSION.getTime()
        )
      ).resolves.toEqual({ status: 'conflict' })

      expect(mockCommitState).not.toHaveBeenCalled()
      expect(mockUpdateContent).not.toHaveBeenCalled()
      expect(store.cache).toBe(prior)
      expect(store.accepted).toHaveLength(0)
    }
  )

  it.each(['content write', 'no-op'] as const)(
    'reloads the exact cache token without changing the relay snapshot after a same-version %s conflict',
    async (kind) => {
      const base = stateWithGeneration('base', 'shared-generation')
      const store = installAtomicStore('base', base)
      const originalToken = store.cache?.stateHash
      const candidate = kind === 'no-op' ? base : editedState(base, 'base\n\nlocal edit')
      const other = new Y.Doc()
      Y.applyUpdate(other, base)
      other.getMap(FILE_DOC_SEED.configMap).set('metadata', 'other cache writer')
      const winner = cachedState(Y.encodeStateAsUpdate(other), store.durable)
      other.destroy()
      if (kind === 'no-op') {
        mockCommitState.mockImplementationOnce(async () => {
          store.cache = winner
          return { status: 'conflict' }
        })
      } else {
        mockUpdateContent.mockImplementationOnce(async () => {
          store.cache = winner
          throw new collabState.CollabDocStateConflictError('file-1')
        })
      }

      await expect(
        persistFileDoc('ws-1', 'file-1', 'user-1', candidate, VERSION.getTime())
      ).resolves.toMatchObject({ status: 'persisted' })

      expect(mockLoadState).toHaveBeenCalledTimes(2)
      expect(mockGetWorkspaceFile).toHaveBeenCalledTimes(2)
      const calls = kind === 'no-op' ? mockCommitState.mock.calls : mockUpdateContent.mock.calls
      const prepared = (call: unknown[]) =>
        (kind === 'no-op'
          ? call[3]
          : (call[5] as { collabDocState: PreparedCollabDocState })
              .collabDocState) as PreparedCollabDocState
      expect(calls).toHaveLength(2)
      expect(prepared(calls[0]).expectedState?.stateHash).toBe(originalToken)
      expect(prepared(calls[1]).expectedState).toEqual({
        sourceHash: winner.sourceHash,
        stateHash: winner.stateHash,
      })
      expect(store.accepted).toHaveLength(1)
      expect(store.accepted[0].docState).toBe(candidate)
      expect(store.cache?.docState).toBe(candidate)
      const cold = new Y.Doc()
      try {
        Y.applyUpdate(cold, store.accepted[0].docState)
        expect(Buffer.from(yDocToFileMarkdown(cold))).toEqual(store.durable)
      } finally {
        cold.destroy()
      }
    }
  )

  it('rejects a generation replacement found while retrying a no-op cache commit', async () => {
    const original = stateWithGeneration('base', 'original-generation')
    const store = installAtomicStore('base', original)
    const replacement = cachedState(
      stateWithGeneration('base', 'replacement-generation'),
      store.durable
    )
    mockCommitState.mockImplementationOnce(async () => {
      store.cache = replacement
      return { status: 'conflict' }
    })

    await expect(
      persistFileDoc('ws-1', 'file-1', 'user-1', original, VERSION.getTime())
    ).resolves.toEqual({ status: 'conflict' })
    expect(mockCommitState).toHaveBeenCalledTimes(1)
    expect(mockUpdateContent).not.toHaveBeenCalled()
    expect(store.cache).toBe(replacement)
    expect(store.accepted).toHaveLength(0)
  })

  it('retries a content version race only after integrating the winner’s accepted history', async () => {
    const base = stateWithGeneration('base', 'shared-generation')
    const winner = editedState(base, 'base\n\npeer edit')
    const candidate = editedState(winner, 'base\n\npeer edit\n\nlocal edit')
    const store = installAtomicStore('base', base)
    mockUpdateContent.mockImplementationOnce(async () => {
      store.durable = projectionOf('base\n\npeer edit')
      store.cache = cachedState(winner, store.durable)
      store.version++
      throw new ContentVersionConflictError('A peer committed first')
    })

    await expect(
      persistFileDoc('ws-1', 'file-1', 'user-1', candidate, VERSION.getTime())
    ).resolves.toEqual({ status: 'persisted', version: VERSION.getTime() + 2 })
    expect(mockUpdateContent).toHaveBeenCalledTimes(2)
    expect(mockUpdateContent.mock.calls[1][5].expectedUpdatedAt.getTime()).toBe(
      VERSION.getTime() + 1
    )
    expect(store.durable).toEqual(projectionOf('base\n\npeer edit\n\nlocal edit'))
    expect(store.accepted).toHaveLength(1)
  })

  it.each(['content write', 'no-op'] as const)(
    'bounds repeated %s conflicts to two attempts',
    async (kind) => {
      const base = stateOf('base')
      const store = installAtomicStore('base', base)
      const candidate = kind === 'no-op' ? base : editedState(base, 'base\n\nlocal edit')
      if (kind === 'no-op') {
        mockCommitState.mockResolvedValue({ status: 'conflict' })
      } else {
        mockUpdateContent.mockRejectedValue(new collabState.CollabDocStateConflictError('file-1'))
      }

      await expect(
        persistFileDoc('ws-1', 'file-1', 'user-1', candidate, VERSION.getTime())
      ).resolves.toEqual({ status: 'conflict' })
      expect(mockGetWorkspaceFile).toHaveBeenCalledTimes(2)
      expect(mockLoadState).toHaveBeenCalledTimes(2)
      expect(kind === 'no-op' ? mockCommitState : mockUpdateContent).toHaveBeenCalledTimes(2)
      expect(store.accepted).toHaveLength(0)
      expect(store.durable).toEqual(projectionOf('base'))
    }
  )

  it.each(['cache read', 'content write', 'cache-only commit'] as const)(
    'propagates a %s failure without claiming persistence or retrying it as a conflict',
    async (kind) => {
      const base = stateOf('base')
      const store = installAtomicStore('base', base)
      const candidate =
        kind === 'cache-only commit' ? base : editedState(base, 'base\n\nlocal edit')
      const operation =
        kind === 'cache read'
          ? mockLoadState
          : kind === 'content write'
            ? mockUpdateContent
            : mockCommitState
      operation.mockRejectedValue(new Error('storage unavailable'))

      await expect(
        persistFileDoc('ws-1', 'file-1', 'user-1', candidate, VERSION.getTime())
      ).rejects.toThrow('storage unavailable')
      expect(operation).toHaveBeenCalledOnce()
      expect(store.accepted).toHaveLength(0)
      expect(store.durable).toEqual(projectionOf('base'))
      if (kind === 'cache read') {
        expect(mockUpdateContent).not.toHaveBeenCalled()
        expect(mockCommitState).not.toHaveBeenCalled()
      }
    }
  )

  it('reports a deleted file observed after a content conflict without touching its cache', async () => {
    const base = stateOf('base')
    const store = installAtomicStore('base', base)
    mockUpdateContent.mockImplementationOnce(async () => {
      mockGetWorkspaceFile.mockResolvedValue(null)
      throw new ContentVersionConflictError('File changed')
    })

    await expect(
      persistFileDoc(
        'ws-1',
        'file-1',
        'user-1',
        editedState(base, 'base\n\nlocal edit'),
        VERSION.getTime()
      )
    ).resolves.toEqual({ status: 'missing' })
    expect(mockLoadState).toHaveBeenCalledOnce()
    expect(store.accepted).toHaveLength(0)
  })

  it('reports a file deleted during a no-op commit instead of acknowledging it', async () => {
    const base = stateOf('base')
    installAtomicStore('base', base)
    mockCommitState.mockResolvedValue({ status: 'missing' })

    await expect(
      persistFileDoc('ws-1', 'file-1', 'user-1', base, VERSION.getTime())
    ).resolves.toEqual({ status: 'missing' })
    expect(mockCommitState).toHaveBeenCalledOnce()
    expect(mockUpdateContent).not.toHaveBeenCalled()
  })

  it('does not decode, read cache, or write when the relay has no expected version', async () => {
    installAtomicStore('base')
    await expect(
      persistFileDoc('ws-1', 'file-1', 'user-1', new Uint8Array([255]))
    ).resolves.toEqual({ status: 'deferred' })
    expect(mockLoadState).not.toHaveBeenCalled()
    expect(mockCommitState).not.toHaveBeenCalled()
    expect(mockUpdateContent).not.toHaveBeenCalled()
  })

  it('returns missing before processing a snapshot for a nonexistent file', async () => {
    mockGetWorkspaceFile.mockResolvedValue(null)
    await expect(
      persistFileDoc('ws-1', 'file-1', 'user-1', new Uint8Array([255]), VERSION.getTime())
    ).resolves.toEqual({ status: 'missing' })
    expect(mockLoadState).not.toHaveBeenCalled()
  })

  it('rejects an oversized incoming snapshot before decoding or loading its cache', async () => {
    installAtomicStore('base')
    await expect(
      persistFileDoc(
        'ws-1',
        'file-1',
        'user-1',
        new Uint8Array(collabState.MAX_COLLAB_DOC_STATE_BYTES + 1),
        VERSION.getTime()
      )
    ).rejects.toThrow('12 MiB limit')
    expect(mockLoadState).not.toHaveBeenCalled()
    expect(mockUpdateContent).not.toHaveBeenCalled()
  })

  it('repeatedly persists the same legacy snapshot without accumulating server-created structures', async () => {
    const base = markdownToYDoc('# Heading')
    const cold = new Y.Doc()
    try {
      base.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.docIdKey, 'shared-generation')
      const fragment = base.getXmlFragment(COLLAB_DOC_FIELD)
      if (fragment.length > 1) fragment.delete(1, fragment.length - 1)
      const original = Y.encodeStateAsUpdate(base)
      const store = installAtomicStore('# Heading', original)
      store.durable = Buffer.from(yDocToFileMarkdown(base))
      store.cache = cachedState(original, store.durable)

      for (let attempt = 0; attempt < 12; attempt++) {
        await expect(
          persistFileDoc('ws-1', 'file-1', 'user-1', original, store.version)
        ).resolves.toEqual({ status: 'persisted', version: store.version })
      }

      expect(store.accepted).toHaveLength(12)
      expect(
        new Set(
          store.accepted.map(({ docState }) => collabState.hashMarkdown(Buffer.from(docState)))
        ).size
      ).toBe(1)
      Y.applyUpdate(cold, store.accepted[11].docState)
      expect(cold.getXmlFragment(COLLAB_DOC_FIELD).length).toBe(fragment.length)
      expect(Y.encodeStateVector(cold)).toEqual(Y.encodeStateVector(base))
      expect(mockUpdateContent).not.toHaveBeenCalled()
    } finally {
      base.destroy()
      cold.destroy()
    }
  })

  it('keeps late typing into an existing empty paragraph persistable after saving its snapshot', async () => {
    const peer = markdownToYDoc('base')
    const cold = new Y.Doc()
    try {
      peer.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.docIdKey, 'shared-generation')
      const tail = new Y.XmlElement('paragraph')
      const text = new Y.XmlText()
      tail.insert(0, [text])
      peer.getXmlFragment(COLLAB_DOC_FIELD).push([tail])
      const original = Y.encodeStateAsUpdate(peer)
      const store = installAtomicStore('base', original)
      store.durable = Buffer.from(yDocToFileMarkdown(peer))
      store.cache = cachedState(original, store.durable)

      const first = await persistFileDoc('ws-1', 'file-1', 'user-1', original, store.version)
      expect(first.status).toBe('persisted')
      if (first.status !== 'persisted') throw new Error('Initial snapshot was not accepted')
      text.insert(0, 'late user text')

      await expect(
        persistFileDoc('ws-1', 'file-1', 'user-1', Y.encodeStateAsUpdate(peer), first.version)
      ).resolves.toEqual({ status: 'persisted', version: first.version + 1 })
      expect(store.durable.toString()).toBe('base\n\nlate user text')
      expect(store.accepted).toHaveLength(2)
      Y.applyUpdate(cold, store.accepted[1].docState)
      expect(yDocToFileMarkdown(cold)).toBe(store.durable.toString())
    } finally {
      peer.destroy()
      cold.destroy()
    }
  })

  function legacyCachePair(tailCount = 1) {
    const peer = markdownToYDoc('base')
    const detached = new Y.Doc()
    peer.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.docIdKey, 'shared-generation')
    let text = new Y.XmlText()
    for (let index = 0; index < tailCount; index++) {
      const paragraph = new Y.XmlElement('paragraph')
      text = new Y.XmlText()
      paragraph.insert(0, [text])
      peer.getXmlFragment(COLLAB_DOC_FIELD).push([paragraph])
    }
    try {
      Y.applyUpdate(detached, Y.encodeStateAsUpdate(peer))
      detached.getXmlFragment(COLLAB_DOC_FIELD).delete(tailCount, 1)
      return { peer, text, legacyState: Y.encodeStateAsUpdate(detached) }
    } finally {
      detached.destroy()
    }
  }

  it('saves exact-version peer typing despite an old detached cache deletion of its paragraph', async () => {
    const { peer, text, legacyState } = legacyCachePair()
    try {
      const store = installAtomicStore('base', legacyState)
      text.insert(0, 'late user text')
      const candidate = Y.encodeStateAsUpdate(peer)

      await expect(
        persistFileDoc('ws-1', 'file-1', 'user-1', candidate, VERSION.getTime())
      ).resolves.toEqual({ status: 'persisted', version: VERSION.getTime() + 1 })

      expect(store.durable.toString()).toBe('base\n\nlate user text')
      expect(store.cache?.docState).toBe(candidate)
      expect(store.accepted).toHaveLength(1)
      expect(mockUpdateContent).toHaveBeenCalledOnce()
    } finally {
      peer.destroy()
    }
  })

  it.each([VERSION.getTime(), VERSION.getTime() - 1])(
    'keeps the native typing target on a no-op with token %i despite private cache deletions',
    async (expectedVersion) => {
      const { peer, text, legacyState } = legacyCachePair()
      try {
        const store = installAtomicStore('base', legacyState)
        store.durable = Buffer.from(yDocToFileMarkdown(peer))
        store.cache = cachedState(legacyState, store.durable)
        const initial = Y.encodeStateAsUpdate(peer)

        await expect(
          persistFileDoc('ws-1', 'file-1', 'user-1', initial, expectedVersion)
        ).resolves.toEqual({ status: 'persisted', version: VERSION.getTime() })
        expect(store.cache?.docState).toBe(initial)
        expect(mockUpdateContent).not.toHaveBeenCalled()

        text.insert(0, 'next peer text')
        const next = Y.encodeStateAsUpdate(peer)
        await expect(
          persistFileDoc('ws-1', 'file-1', 'user-1', next, VERSION.getTime())
        ).resolves.toEqual({ status: 'persisted', version: VERSION.getTime() + 1 })
        expect(store.durable.toString()).toBe('base\n\nnext peer text')
        expect(store.cache?.docState).toBe(next)
      } finally {
        peer.destroy()
      }
    }
  )

  it('does not retain a stale proof’s invisible private deletion that would erase later peer typing', async () => {
    const { peer, text, legacyState } = legacyCachePair(2)
    const cold = new Y.Doc()
    const proof = new Y.Doc()
    try {
      const store = installAtomicStore('base', legacyState)
      const legacy = new Y.Doc()
      try {
        Y.applyUpdate(legacy, legacyState)
        store.durable = Buffer.from(yDocToFileMarkdown(legacy))
        store.cache = cachedState(legacyState, store.durable)
      } finally {
        legacy.destroy()
      }
      const paragraph = new Y.XmlElement('paragraph')
      const localText = new Y.XmlText()
      localText.insert(0, 'local edit')
      paragraph.insert(0, [localText])
      peer.getXmlFragment(COLLAB_DOC_FIELD).insert(1, [paragraph])
      const candidate = Y.encodeStateAsUpdate(peer)
      Y.applyUpdate(proof, candidate)
      Y.applyUpdate(proof, legacyState)
      expect(yDocToFileMarkdown(proof)).toBe(yDocToFileMarkdown(peer))

      await expect(
        persistFileDoc('ws-1', 'file-1', 'user-1', candidate, VERSION.getTime() - 1)
      ).resolves.toEqual({ status: 'persisted', version: VERSION.getTime() + 1 })
      expect(store.cache?.docState).toBe(candidate)

      text.insert(0, 'late next text')
      const delayed = Y.encodeStateAsUpdate(peer)
      Y.applyUpdate(proof, delayed)
      expect(yDocToFileMarkdown(proof)).not.toContain('late next text')
      Y.applyUpdate(cold, store.accepted[0].docState)
      Y.applyUpdate(cold, delayed)
      expect(yDocToFileMarkdown(cold)).toContain('late next text')
    } finally {
      peer.destroy()
      cold.destroy()
      proof.destroy()
    }
  })

  it('keeps stale content fail-closed when a private cached deletion changes the proof’s projection', async () => {
    const { peer, text, legacyState } = legacyCachePair()
    try {
      const store = installAtomicStore('base', legacyState)
      text.insert(0, 'late user text')

      await expect(
        persistFileDoc(
          'ws-1',
          'file-1',
          'user-1',
          Y.encodeStateAsUpdate(peer),
          VERSION.getTime() - 1
        )
      ).resolves.toEqual({ status: 'conflict' })
      expect(store.durable.toString()).toBe('base')
      expect(store.cache?.docState).toBe(legacyState)
      expect(store.accepted).toHaveLength(0)
      expect(mockUpdateContent).not.toHaveBeenCalled()
    } finally {
      peer.destroy()
    }
  })
})
