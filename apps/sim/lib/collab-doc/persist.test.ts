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
  mockStateSourceHash,
  ContentVersionConflictError,
} = vi.hoisted(() => ({
  mockGetWorkspaceFile: vi.fn(),
  mockFetchBuffer: vi.fn(),
  mockUpdateContent: vi.fn(),
  mockSaveState: vi.fn(),
  mockStateSourceHash: vi.fn(),
  ContentVersionConflictError: class ContentVersionConflictError extends Error {},
}))

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  ContentVersionConflictError,
  getWorkspaceFile: mockGetWorkspaceFile,
  fetchWorkspaceFileBuffer: mockFetchBuffer,
  updateWorkspaceFileContent: mockUpdateContent,
}))

vi.mock('./collab-state', () => ({
  hashMarkdown: (buffer: Buffer) => `hash:${buffer.toString('utf-8')}`,
  saveCollabDocState: mockSaveState,
  collabDocStateSourceHash: mockStateSourceHash,
}))

import { markdownToYDoc, yDocToFileMarkdown } from './converter'
import { persistFileDoc } from './persist'

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

describe('persistFileDoc — no-op writes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSaveState.mockResolvedValue(undefined)
    mockStateSourceHash.mockResolvedValue(null)
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
    return durable
  }

  it('writes anyway when the file still holds the bytes this document last projected', async () => {
    const durable = stubConflict('a\n\nb')
    // The cached doc state was tagged with exactly these bytes: nobody else has written since.
    mockStateSourceHash.mockResolvedValue(`hash:${durable.toString('utf-8')}`)

    const result = await persistFileDoc(
      'ws-1',
      'file-1',
      'user-1',
      stateOf('a\n\nb\n\nmoved'),
      VERSION.getTime()
    )

    expect(result).toEqual({ status: 'persisted', version: NEWER.getTime() + 1 })
    // Once with the stale token (rejected), once with the file's real version.
    expect(mockUpdateContent).toHaveBeenCalledTimes(2)
  })

  it('still refuses when the file holds someone else’s content', async () => {
    stubConflict('a\n\nb')
    mockStateSourceHash.mockResolvedValue('hash:something this document never wrote')

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
    mockStateSourceHash.mockResolvedValue(null)

    const result = await persistFileDoc(
      'ws-1',
      'file-1',
      'user-1',
      stateOf('a\n\nb\n\nmoved'),
      VERSION.getTime()
    )

    expect(result).toEqual({ status: 'conflict' })
  })
})
