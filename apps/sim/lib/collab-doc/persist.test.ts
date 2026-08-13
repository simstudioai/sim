/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

const { mockGetWorkspaceFile, mockFetchBuffer, mockUpdateContent, mockSaveState } = vi.hoisted(
  () => ({
    mockGetWorkspaceFile: vi.fn(),
    mockFetchBuffer: vi.fn(),
    mockUpdateContent: vi.fn(),
    mockSaveState: vi.fn(),
  })
)

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  ContentVersionConflictError: class ContentVersionConflictError extends Error {},
  getWorkspaceFile: mockGetWorkspaceFile,
  fetchWorkspaceFileBuffer: mockFetchBuffer,
  updateWorkspaceFileContent: mockUpdateContent,
}))

vi.mock('./collab-state', () => ({
  hashMarkdown: () => 'test-source-hash',
  saveCollabDocState: mockSaveState,
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

    expect(mockSaveState).toHaveBeenCalledWith('file-1', expect.anything(), 'test-source-hash')
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
