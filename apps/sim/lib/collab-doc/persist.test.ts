/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

const {
  mockGetWorkspaceFile,
  mockFetchBuffer,
  mockUpdateContent,
  mockSaveState,
  mockLoadState,
  ContentVersionConflictError,
} = vi.hoisted(() => ({
  mockGetWorkspaceFile: vi.fn(),
  mockFetchBuffer: vi.fn(),
  mockUpdateContent: vi.fn(),
  mockSaveState: vi.fn(),
  mockLoadState: vi.fn(),
  ContentVersionConflictError: class ContentVersionConflictError extends Error {},
}))

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  ContentVersionConflictError,
  getWorkspaceFile: mockGetWorkspaceFile,
  fetchWorkspaceFileBuffer: mockFetchBuffer,
  updateWorkspaceFileContent: mockUpdateContent,
}))

vi.mock('@/lib/collab-doc/collab-state', () => ({
  hashMarkdown: (buffer: Buffer) => `hash:${buffer.toString('utf-8')}`,
  saveCollabDocState: mockSaveState,
  loadCollabDocState: mockLoadState,
}))

import type { CachedCollabDocState } from '@/lib/collab-doc/collab-state'
import {
  applyMarkdownToYDoc,
  canonicalizeYDoc,
  markdownToYDoc,
  yDocToFileMarkdown,
} from '@/lib/collab-doc/converter'
import { persistFileDoc } from '@/lib/collab-doc/persist'

const VERSION = new Date('2026-01-01T00:00:00.000Z')

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

describe('persistFileDoc — no-op writes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSaveState.mockResolvedValue(undefined)
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

  it('still refreshes the cached snapshot on a no-op, so a cold open seeds from the canonical binary', async () => {
    const md = 'a\n\nb'
    stubFile(projectionOf(md))

    await persistFileDoc('ws-1', 'file-1', 'user-1', stateOf(md), VERSION.getTime())

    expect(mockSaveState).toHaveBeenCalledWith(
      'file-1',
      expect.anything(),
      `hash:${projectionOf(md).toString('utf-8')}`
    )
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

  it('falls through to the write when the durable bytes cannot be read', async () => {
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

    await persistFileDoc('ws-1', 'file-1', 'user-1', stateOf(md), VERSION.getTime())

    expect(mockUpdateContent).toHaveBeenCalledTimes(1)
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
    mockSaveState.mockResolvedValue(undefined)
    mockLoadState.mockResolvedValue(null)
  })

  /** The file is at `NEWER` (durable = `durableMd`), while the caller still believes `VERSION`. */
  function stubConflict(durableMd: string) {
    const durable = projectionOf(durableMd)
    mockGetWorkspaceFile.mockResolvedValue({
      id: 'file-1',
      name: 'note.md',
      key: 'k',
      // A different size than the projection under test, so the no-op compare never short-circuits.
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
    // The cached doc state was tagged with exactly these bytes: nobody else has written since.
    mockLoadState.mockResolvedValue({ docState, sourceHash: `hash:${durable.toString('utf-8')}` })

    const result = await persistFileDoc(
      'ws-1',
      'file-1',
      'user-1',
      editedState(docState, 'a\n\nb\n\nmoved'),
      VERSION.getTime()
    )

    expect(result).toEqual({ status: 'persisted', version: NEWER.getTime() + 1 })
    // Once with the stale token (rejected), once with the file's real version.
    expect(mockUpdateContent).toHaveBeenCalledTimes(2)
  })

  it('still refuses when the file holds someone else’s content', async () => {
    stubConflict('a\n\nb')
    mockLoadState.mockResolvedValue({
      docState: stateOf('a\n\nb'),
      sourceHash: 'hash:something this document never wrote',
    })

    const result = await persistFileDoc(
      'ws-1',
      'file-1',
      'user-1',
      stateOf('a\n\nb\n\nmoved'),
      VERSION.getTime()
    )

    expect(result).toEqual({ status: 'conflict' })
    expect(mockUpdateContent).toHaveBeenCalledTimes(1)
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
    mockLoadState.mockResolvedValue({ docState: persisted, sourceHash: `hash:${durable}` })

    await expect(
      persistFileDoc('ws-1', 'file-1', 'user-1', candidate, VERSION.getTime())
    ).resolves.toEqual({ status: 'conflict' })
    expect(mockUpdateContent).toHaveBeenCalledTimes(1)
    expect(mockSaveState).not.toHaveBeenCalled()
  })

  it.each(['alpha', '**alpha**\n\nbeta'])(
    'recovers after already integrating the persisted changes: %s',
    async (persistedMarkdown) => {
      const original = stateOf('alpha\n\nbeta')
      const persisted = editedState(original, persistedMarkdown)
      const candidate = editedState(persisted, `${persistedMarkdown}\n\nlocal edit`)
      const { durable } = stubConflict(persistedMarkdown)
      mockLoadState.mockResolvedValue({ docState: persisted, sourceHash: `hash:${durable}` })

      await expect(
        persistFileDoc('ws-1', 'file-1', 'user-1', candidate, VERSION.getTime())
      ).resolves.toEqual({ status: 'persisted', version: NEWER.getTime() + 1 })
      expect(mockUpdateContent).toHaveBeenCalledTimes(2)
    }
  )

  it('allows harmless canonicalization of the cached snapshot', async () => {
    const original = stateOf('## Heading')
    const cached = new Y.Doc()
    Y.applyUpdate(cached, original)
    canonicalizeYDoc(cached)
    const docState = Y.encodeStateAsUpdate(cached)
    cached.destroy()
    const { durable } = stubConflict('## Heading')
    mockLoadState.mockResolvedValue({ docState, sourceHash: `hash:${durable}` })

    await expect(
      persistFileDoc(
        'ws-1',
        'file-1',
        'user-1',
        editedState(original, '## Heading\n\nlocal edit'),
        VERSION.getTime()
      )
    ).resolves.toEqual({ status: 'persisted', version: NEWER.getTime() + 1 })
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
    mockLoadState.mockResolvedValue({ docState: persisted, sourceHash: `hash:${durable}` })

    await expect(
      persistFileDoc('ws-1', 'file-1', 'user-1', candidate, VERSION.getTime())
    ).resolves.toEqual({ status: 'conflict' })
    expect(mockUpdateContent).toHaveBeenCalledTimes(1)
  })

  it('fails closed when the cached binary is invalid', async () => {
    const { durable } = stubConflict('base')
    mockLoadState.mockResolvedValue({
      docState: new Uint8Array([255]),
      sourceHash: `hash:${durable}`,
    })

    await expect(
      persistFileDoc('ws-1', 'file-1', 'user-1', stateOf('local edit'), VERSION.getTime())
    ).resolves.toEqual({ status: 'conflict' })
    expect(mockUpdateContent).toHaveBeenCalledTimes(1)
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
    mockSaveState.mockImplementation(
      async (_fileId: string, docState: Uint8Array, sourceHash: string) => {
        cache = { docState, sourceHash }
      }
    )
    let attempts = 0
    mockUpdateContent.mockImplementation(
      async (
        _workspaceId: string,
        _fileId: string,
        _userId: string,
        bytes: Buffer,
        _contentType: unknown,
        options: { expectedUpdatedAt: Date }
      ) => {
        if (attempts++ === 0) {
          started.resolve()
          await firstWrite.promise
        }
        if (options.expectedUpdatedAt.getTime() !== version) {
          throw new ContentVersionConflictError('A newer snapshot committed')
        }
        durable = Buffer.from(bytes)
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
      expect(mockSaveState).toHaveBeenCalledTimes(1)
      expect(mockLoadState).toHaveBeenCalledWith('file-1', { maxBytes: 12 * 1024 * 1024 })
    } finally {
      firstWrite.resolve()
      await olderSave
    }
  })
})
