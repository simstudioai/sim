import { FILE_DOC_SEED } from '@sim/realtime-protocol/file-doc'
import {
  workspaceUploadsMock,
  workspaceUploadsMockFns,
} from '@sim/testing/mocks/workspace-uploads.mock'
import { getSchema } from '@tiptap/core'
import { prosemirrorJSONToYDoc } from '@tiptap/y-tiptap'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import * as collabState from '@/lib/collab-doc/collab-state'

const { mockGetWorkspaceFile, mockFetchWorkspaceFileBuffer: mockFetchBuffer } =
  workspaceUploadsMockFns
const mockLoadState = vi.fn()
const mockCommitState = vi.fn()

vi.mock('@/lib/uploads/contexts/workspace', () => workspaceUploadsMock)

beforeEach(() => {
  vi.spyOn(collabState, 'loadCollabDocState').mockImplementation(mockLoadState)
  vi.spyOn(collabState, 'commitCollabDocState').mockImplementation(mockCommitState)
})

import { markdownToYDoc, yDocToFileMarkdown, yDocToMarkdown } from '@/lib/collab-doc/converter'
import { COLLAB_DOC_FIELD } from '@/lib/collab-doc/field'
import { buildFileDocSeed } from '@/lib/collab-doc/seed'
import { createMarkdownContentExtensions } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/extensions'
import {
  parseMarkdownToDoc,
  serializeMarkdownBody,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-parse'

const VERSION = new Date('2026-01-01T00:00:00.000Z').getTime()

function cachedState(docState: Uint8Array, markdown: string): collabState.CachedCollabDocState {
  return {
    docState,
    sourceHash: collabState.hashMarkdown(Buffer.from(markdown)),
    stateHash: collabState.hashMarkdown(Buffer.from(docState)),
  }
}

describe('buildFileDocSeed', () => {
  beforeEach(() => {
    mockGetWorkspaceFile.mockResolvedValue({
      id: 'file-1',
      name: 'note.md',
      key: 'k',
      context: 'workspace',
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    })
    mockLoadState.mockResolvedValue(null)
    mockCommitState.mockImplementation(async (_workspaceId, _fileId, version: number) => ({
      status: 'committed',
      version,
    }))
  })

  it('builds a seed whose applied update reproduces the file body (through the client engine)', async () => {
    mockFetchBuffer.mockResolvedValue(Buffer.from('# Title\n\nHello **world**.', 'utf-8'))

    const seed = await buildFileDocSeed('ws-1', 'file-1')
    expect(seed).not.toBeNull()

    const doc = new Y.Doc()
    Y.applyUpdate(doc, seed!.update)
    expect(yDocToMarkdown(doc)).toBe(serializeMarkdownBody('# Title\n\nHello **world**.'))
    doc.destroy()
  })

  it('preserves a named legacy snapshot without introducing an unbroadcast structural repair', async () => {
    const stale = prosemirrorJSONToYDoc(
      getSchema(createMarkdownContentExtensions()),
      parseMarkdownToDoc('# T\n\nbody\n\n- a\n- b'),
      COLLAB_DOC_FIELD
    )
    stale.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.docIdKey, 'legacy-generation')
    const cached = Y.encodeStateAsUpdate(stale)
    mockFetchBuffer.mockResolvedValue(Buffer.from('# T\n\nbody\n\n- a\n- b', 'utf-8'))
    mockLoadState.mockResolvedValue(cachedState(cached, '# T\n\nbody\n\n- a\n- b'))

    const seed = await buildFileDocSeed('ws-1', 'file-1')

    expect(seed?.update).toBe(cached)
    const doc = new Y.Doc()
    Y.applyUpdate(doc, seed!.update)
    expect(doc.getXmlFragment(COLLAB_DOC_FIELD).toJSON()).toEqual(
      stale.getXmlFragment(COLLAB_DOC_FIELD).toJSON()
    )
    expect(Y.encodeStateVector(doc)).toEqual(Y.encodeStateVector(stale))
    stale.destroy()
    doc.destroy()
  })

  it('fails closed when the cache read fails instead of creating a conflicting document identity', async () => {
    mockFetchBuffer.mockResolvedValue(Buffer.from('# Title\n\ntext.', 'utf-8'))
    mockLoadState.mockRejectedValue(new Error('cache table missing'))

    await expect(buildFileDocSeed('ws-1', 'file-1')).rejects.toThrow('cache table missing')
    expect(mockCommitState).not.toHaveBeenCalled()
  })

  it('strips frontmatter — only the body seeds the collaborative doc', async () => {
    mockFetchBuffer.mockResolvedValue(Buffer.from('---\ntitle: X\n---\n\n# Body\n\ntext.', 'utf-8'))

    const seed = await buildFileDocSeed('ws-1', 'file-1')
    const doc = new Y.Doc()
    Y.applyUpdate(doc, seed!.update)
    const md = yDocToMarkdown(doc)
    expect(md).not.toContain('title: X')
    expect(md).toBe(serializeMarkdownBody('# Body\n\ntext.'))
    doc.destroy()
  })

  it('requests the file with throwOnError so a read failure is not mistaken for an empty file', async () => {
    mockGetWorkspaceFile.mockRejectedValue(new Error('db down'))
    await expect(buildFileDocSeed('ws-1', 'file-1')).rejects.toThrow('db down')
    expect(mockGetWorkspaceFile).toHaveBeenCalledWith('ws-1', 'file-1', { throwOnError: true })
  })
})

/**
 * One file, ONE collaborative document, for its whole life.
 *
 * Two documents built from the same markdown are not the same document to Yjs — their items carry
 * different client ids — so a client still holding the first merges the two into the file twice over,
 * and the relay persists that. The guard is never to build a second one: every load resumes the stored
 * document, and a client checks the identity it is offered before it syncs.
 */
describe('buildFileDocSeed — document identity', () => {
  beforeEach(() => {
    mockGetWorkspaceFile.mockResolvedValue({
      id: 'file-1',
      name: 'note.md',
      key: 'k',
      context: 'workspace',
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    })
    mockLoadState.mockResolvedValue(null)
    mockCommitState.mockImplementation(async (_workspaceId, _fileId, version: number) => ({
      status: 'committed',
      version,
    }))
  })

  const docIdOf = (update: Uint8Array): unknown => {
    const doc = new Y.Doc()
    try {
      Y.applyUpdate(doc, update)
      return doc.getMap(FILE_DOC_SEED.configMap).get(FILE_DOC_SEED.docIdKey)
    } finally {
      doc.destroy()
    }
  }

  it('keeps the stored document’s identity when the markdown changed out-of-band', async () => {
    const stored = markdownToYDoc('# Title\n\nbody')
    stored.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.docIdKey, 'doc-original')
    mockLoadState.mockResolvedValue({
      docState: Y.encodeStateAsUpdate(stored),
      sourceHash: 'a-hash-from-before-the-external-write',
      stateHash: collabState.hashMarkdown(Buffer.from(Y.encodeStateAsUpdate(stored))),
    })
    mockFetchBuffer.mockResolvedValue(Buffer.from('# Title\n\nbody\n\nadded externally', 'utf-8'))

    const seed = await buildFileDocSeed('ws-1', 'file-1')

    expect(docIdOf(seed!.update)).toBe('doc-original')
    const doc = new Y.Doc()
    Y.applyUpdate(doc, seed!.update)
    expect(yDocToMarkdown(doc)).toBe(serializeMarkdownBody('# Title\n\nbody\n\nadded externally'))
    doc.destroy()
    stored.destroy()
  })

  it('a client holding the resumed document merges it back without duplicating the file', async () => {
    const original = markdownToYDoc('# Title\n\nfirst\n\nsecond')
    original.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.docIdKey, 'doc-original')
    const client = new Y.Doc()
    Y.applyUpdate(client, Y.encodeStateAsUpdate(original))

    mockLoadState.mockResolvedValue({
      docState: Y.encodeStateAsUpdate(original),
      sourceHash: 'stale-after-an-external-write',
      stateHash: collabState.hashMarkdown(Buffer.from(Y.encodeStateAsUpdate(original))),
    })
    mockFetchBuffer.mockResolvedValue(Buffer.from('# Title\n\nfirst\n\nsecond', 'utf-8'))

    const seed = await buildFileDocSeed('ws-1', 'file-1')
    Y.applyUpdate(client, seed!.update)

    expect(yDocToMarkdown(client)).toBe(serializeMarkdownBody('# Title\n\nfirst\n\nsecond'))
    client.destroy()
    original.destroy()
  })

  it('rebuilds from markdown when the stored document is unusable, rather than failing the seed', async () => {
    mockLoadState.mockResolvedValue({
      docState: new Uint8Array([9, 9, 9, 9]),
      sourceHash: 'stale',
      stateHash: collabState.hashMarkdown(Buffer.from([9, 9, 9, 9])),
    })
    mockFetchBuffer.mockResolvedValue(Buffer.from('# Title\n\nbody', 'utf-8'))

    const seed = await buildFileDocSeed('ws-1', 'file-1')

    expect(seed).not.toBeNull()
    const doc = new Y.Doc()
    Y.applyUpdate(doc, seed!.update)
    expect(yDocToMarkdown(doc)).toBe(serializeMarkdownBody('# Title\n\nbody'))
    doc.destroy()
  })

  it('does not return an unaccepted identity when the cache write fails', async () => {
    mockFetchBuffer.mockResolvedValue(Buffer.from('# Title', 'utf-8'))
    mockCommitState.mockRejectedValue(new Error('db down'))

    await expect(buildFileDocSeed('ws-1', 'file-1')).rejects.toThrow('db down')
  })
})

describe('buildFileDocSeed — accepted revisions', () => {
  beforeEach(() => {
    mockGetWorkspaceFile.mockReset().mockResolvedValue({
      id: 'file-1',
      name: 'note.md',
      key: 'k',
      context: 'workspace',
      updatedAt: new Date(VERSION),
      contentUpdatedAt: new Date(VERSION),
    })
    mockFetchBuffer.mockReset().mockResolvedValue(Buffer.from('base'))
    mockLoadState.mockReset().mockResolvedValue(null)
    mockCommitState
      .mockReset()
      .mockImplementation(async (_workspaceId, _fileId, version: number) => ({
        status: 'committed',
        version,
      }))
  })

  function namedState(markdown: string, identity: string): Uint8Array {
    const doc = markdownToYDoc(markdown)
    try {
      doc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.docIdKey, identity)
      return Y.encodeStateAsUpdate(doc)
    } finally {
      doc.destroy()
    }
  }

  function identityOf(update: Uint8Array): unknown {
    const doc = new Y.Doc()
    try {
      Y.applyUpdate(doc, update)
      return doc.getMap(FILE_DOC_SEED.configMap).get(FILE_DOC_SEED.docIdKey)
    } finally {
      doc.destroy()
    }
  }

  it('makes simultaneous first-open seeds adopt the single accepted document identity', async () => {
    let cache: collabState.CachedCollabDocState | null = null
    const started = Promise.withResolvers<void>()
    const resume = Promise.withResolvers<void>()
    let commits = 0
    let losingUpdate: Uint8Array | undefined
    mockLoadState.mockImplementation(async () => cache)
    mockCommitState.mockImplementation(
      async (
        _workspaceId,
        _fileId,
        version: number,
        prepared: collabState.PreparedCollabDocState
      ) => {
        if (commits++ === 0) {
          losingUpdate = prepared.docState
          started.resolve()
          await resume.promise
        }
        if (
          prepared.expectedState === null
            ? cache !== null
            : cache?.sourceHash !== prepared.expectedState.sourceHash ||
              cache?.stateHash !== prepared.expectedState.stateHash
        ) {
          return { status: 'conflict' }
        }
        cache = cachedState(prepared.docState, 'base')
        return { status: 'committed', version }
      }
    )

    const firstOpen = buildFileDocSeed('ws-1', 'file-1')
    try {
      await started.promise
      const secondOpen = await buildFileDocSeed('ws-1', 'file-1')
      expect(secondOpen).not.toBeNull()
      expect(identityOf(secondOpen!.update)).not.toBe(identityOf(losingUpdate!))
      resume.resolve()
      const resumedFirst = await firstOpen

      expect(resumedFirst?.update).toBe(secondOpen?.update)
      expect(resumedFirst?.update).toBe(cache?.docState)
      expect(mockCommitState).toHaveBeenCalledTimes(3)
      expect(mockLoadState).toHaveBeenCalledTimes(3)
      expect(mockCommitState.mock.calls[2][3].expectedState).toEqual({
        stateHash: cache?.stateHash,
        sourceHash: cache?.sourceHash,
      })
    } finally {
      resume.resolve()
      await firstOpen
    }
  })

  it('adopts a same-content identity replacement instead of returning an unfenced cache hit', async () => {
    const prior = cachedState(namedState('base', 'old-generation'), 'base')
    const winner = cachedState(namedState('base', 'new-generation'), 'base')
    mockLoadState.mockResolvedValueOnce(prior).mockResolvedValue(winner)
    mockCommitState.mockResolvedValueOnce({ status: 'conflict' })

    const seed = await buildFileDocSeed('ws-1', 'file-1')

    expect(identityOf(seed!.update)).toBe('new-generation')
    expect(seed?.update).toBe(winner.docState)
    expect(mockGetWorkspaceFile).toHaveBeenCalledTimes(2)
    expect(mockLoadState).toHaveBeenCalledTimes(2)
    expect(mockCommitState.mock.calls[0][3].expectedState.stateHash).toBe(prior.stateHash)
    expect(mockCommitState.mock.calls[1][3].expectedState.stateHash).toBe(winner.stateHash)
  })

  it('bounds seed conflicts to three complete read/prepare/commit attempts', async () => {
    mockCommitState.mockResolvedValue({ status: 'conflict' })

    await expect(buildFileDocSeed('ws-1', 'file-1')).rejects.toBeInstanceOf(
      collabState.CollabDocStateConflictError
    )
    expect(mockGetWorkspaceFile).toHaveBeenCalledTimes(3)
    expect(mockFetchBuffer).toHaveBeenCalledTimes(3)
    expect(mockLoadState).toHaveBeenCalledTimes(3)
    expect(mockCommitState).toHaveBeenCalledTimes(3)
  })

  it('returns missing if the file is deleted during the commit', async () => {
    mockCommitState.mockResolvedValue({ status: 'missing' })

    await expect(buildFileDocSeed('ws-1', 'file-1')).resolves.toBeNull()
    expect(mockCommitState).toHaveBeenCalledOnce()
    expect(mockGetWorkspaceFile).toHaveBeenCalledOnce()
  })

  it('keeps the freshness hash tied to raw durable Markdown rather than its canonical projection', async () => {
    const markdown = '# Title\r\n\r\nbody\r\n'
    mockFetchBuffer.mockResolvedValue(Buffer.from(markdown))
    const seed = await buildFileDocSeed('ws-1', 'file-1')
    const doc = new Y.Doc()
    try {
      Y.applyUpdate(doc, seed!.update)
      const canonical = yDocToFileMarkdown(doc)
      expect(canonical).not.toBe(markdown)
      expect(mockCommitState.mock.calls[0][3].sourceHash).toBe(
        collabState.hashMarkdown(Buffer.from(markdown))
      )
      expect(mockCommitState.mock.calls[0][3].sourceHash).not.toBe(
        collabState.hashMarkdown(Buffer.from(canonical))
      )
    } finally {
      doc.destroy()
    }
  })

  it('fails closed on an undecodable cache tagged as current rather than returning a fabricated history', async () => {
    mockLoadState.mockResolvedValue(cachedState(new Uint8Array([255]), 'base'))

    await expect(buildFileDocSeed('ws-1', 'file-1')).rejects.toThrow()
    expect(mockCommitState).not.toHaveBeenCalled()
  })

  it('never publishes a rebuilt identity when replacement of a corrupt cache loses every race', async () => {
    mockLoadState.mockResolvedValue(cachedState(new Uint8Array([255]), 'older bytes'))
    mockCommitState.mockResolvedValue({ status: 'conflict' })

    await expect(buildFileDocSeed('ws-1', 'file-1')).rejects.toBeInstanceOf(
      collabState.CollabDocStateConflictError
    )
    expect(mockCommitState).toHaveBeenCalledTimes(3)
  })
})
