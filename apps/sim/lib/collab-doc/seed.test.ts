/**
 * @vitest-environment node
 */
import { FILE_DOC_SEED, FILE_DOC_TIMEOUTS } from '@sim/realtime-protocol/file-doc'
import { getSchema } from '@tiptap/core'
import { prosemirrorJSONToYDoc } from '@tiptap/y-tiptap'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import * as collabState from '@/lib/collab-doc/collab-state'

const { mockGetWorkspaceFile, mockFetchBuffer, mockLoadState, mockCommitState } = vi.hoisted(
  () => ({
    mockGetWorkspaceFile: vi.fn(),
    mockFetchBuffer: vi.fn(),
    mockLoadState: vi.fn(),
    mockCommitState: vi.fn(),
  })
)

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  getWorkspaceFile: mockGetWorkspaceFile,
  fetchWorkspaceFileBuffer: mockFetchBuffer,
}))

vi.spyOn(collabState, 'loadCollabDocState').mockImplementation(mockLoadState)
vi.spyOn(collabState, 'commitCollabDocState').mockImplementation(mockCommitState)

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
    vi.clearAllMocks()
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

  it('cold-start fast path: returns the cached binary directly without re-converting when it is fresh', async () => {
    const cachedDoc = markdownToYDoc('# Anything')
    cachedDoc.getText('marker').insert(0, 'cached')
    cachedDoc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.docIdKey, 'doc-already-named')
    const cached = Y.encodeStateAsUpdate(cachedDoc)
    mockFetchBuffer.mockResolvedValue(Buffer.from('# Anything', 'utf-8'))
    mockLoadState.mockResolvedValue(cachedState(cached, '# Anything'))

    const seed = await buildFileDocSeed('ws-1', 'file-1')

    expect(seed?.update).toBe(cached)
    const doc = new Y.Doc()
    Y.applyUpdate(doc, seed!.update)
    expect(doc.getText('marker').toString()).toBe('cached')
    cachedDoc.destroy()
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

  it('marks the seeded doc as initial-content-loaded so the client needs no seeder handshake', async () => {
    mockFetchBuffer.mockResolvedValue(Buffer.from('# Body', 'utf-8'))
    const seed = await buildFileDocSeed('ws-1', 'file-1')
    const doc = new Y.Doc()
    Y.applyUpdate(doc, seed!.update)
    expect(doc.getMap(FILE_DOC_SEED.configMap).get(FILE_DOC_SEED.flag)).toBe(true)
    doc.destroy()
  })

  it('carries the frontmatter in the config map (not the body)', async () => {
    mockFetchBuffer.mockResolvedValue(Buffer.from('---\ntitle: X\n---\n\n# Body', 'utf-8'))
    const seed = await buildFileDocSeed('ws-1', 'file-1')
    const doc = new Y.Doc()
    Y.applyUpdate(doc, seed!.update)
    expect(doc.getMap(FILE_DOC_SEED.configMap).get(FILE_DOC_SEED.frontmatterKey)).toContain(
      'title: X'
    )
    expect(yDocToMarkdown(doc)).not.toContain('title: X')
    doc.destroy()
  })

  it('returns null for a missing file', async () => {
    mockGetWorkspaceFile.mockResolvedValue(null)
    expect(await buildFileDocSeed('ws-1', 'missing')).toBeNull()
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
    vi.clearAllMocks()
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

  it('stores the document it builds, so the next open resumes it rather than building another', async () => {
    mockFetchBuffer.mockResolvedValue(Buffer.from('# Title\n\nbody', 'utf-8'))

    const seed = await buildFileDocSeed('ws-1', 'file-1')

    expect(mockCommitState).toHaveBeenCalledWith('ws-1', 'file-1', VERSION, {
      docState: seed!.update,
      sourceHash: collabState.hashMarkdown(Buffer.from('# Title\n\nbody')),
      expectedState: null,
    })
    expect(typeof docIdOf(seed!.update)).toBe('string')
  })

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

  /**
   * A document stored before identities existed is returned by the fast path on every open, so if it
   * were named only where documents are BUILT those files would never acquire one — and the join-ack
   * guard could never fire for them, which is the population most likely to have a tab that outlived
   * its room. Naming it must also be stored, or every open would name it differently and the guard
   * would refuse a client holding the very same document.
   */
  it('names a stored document that predates identities, once, and keeps that name', async () => {
    const legacy = markdownToYDoc('# Legacy')
    mockFetchBuffer.mockResolvedValue(Buffer.from('# Legacy', 'utf-8'))
    mockLoadState.mockResolvedValue({
      docState: Y.encodeStateAsUpdate(legacy),
      sourceHash: collabState.hashMarkdown(Buffer.from('# Legacy')),
      stateHash: collabState.hashMarkdown(Buffer.from(Y.encodeStateAsUpdate(legacy))),
    })

    const first = await buildFileDocSeed('ws-1', 'file-1')
    const docId = docIdOf(first!.update)
    expect(typeof docId).toBe('string')
    expect(mockCommitState).toHaveBeenCalledWith('ws-1', 'file-1', VERSION, {
      docState: first!.update,
      sourceHash: collabState.hashMarkdown(Buffer.from('# Legacy')),
      expectedState: expect.objectContaining({
        stateHash: collabState.hashMarkdown(Buffer.from(Y.encodeStateAsUpdate(legacy))),
      }),
    })

    mockCommitState.mockClear()
    const stored = cachedState(first!.update, '# Legacy')
    mockLoadState.mockResolvedValue(stored)
    const second = await buildFileDocSeed('ws-1', 'file-1')
    expect(docIdOf(second!.update)).toBe(docId)
    expect(mockCommitState).toHaveBeenCalledOnce()
    expect(mockCommitState).toHaveBeenCalledWith('ws-1', 'file-1', VERSION, {
      docState: first!.update,
      sourceHash: stored.sourceHash,
      expectedState: { sourceHash: stored.sourceHash, stateHash: stored.stateHash },
    })
    legacy.destroy()
  })

  it('does not return an unaccepted identity when the cache write fails', async () => {
    mockFetchBuffer.mockResolvedValue(Buffer.from('# Title', 'utf-8'))
    mockCommitState.mockRejectedValue(new Error('db down'))

    await expect(buildFileDocSeed('ws-1', 'file-1')).rejects.toThrow('db down')
  })
})

describe('buildFileDocSeed — accepted revisions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('revalidates even an unchanged named snapshot against its exact source and binary token', async () => {
    const cached = cachedState(namedState('base', 'existing-document'), 'base')
    mockLoadState.mockResolvedValue(cached)

    const seed = await buildFileDocSeed('ws-1', 'file-1')

    expect(seed?.update).toBe(cached.docState)
    expect(mockCommitState).toHaveBeenCalledWith('ws-1', 'file-1', VERSION, {
      docState: cached.docState,
      sourceHash: cached.sourceHash,
      expectedState: { sourceHash: cached.sourceHash, stateHash: cached.stateHash },
    })
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

  it('rereads content and cache after a content-version race before publishing the winning seed', async () => {
    const winner = cachedState(namedState('new content', 'winning-generation'), 'new content')
    mockCommitState.mockImplementationOnce(async () => {
      mockGetWorkspaceFile.mockResolvedValue({
        id: 'file-1',
        name: 'note.md',
        key: 'new-key',
        context: 'workspace',
        contentUpdatedAt: new Date(VERSION + 1),
        updatedAt: new Date(VERSION + 1),
      })
      mockFetchBuffer.mockResolvedValue(Buffer.from('new content'))
      mockLoadState.mockResolvedValue(winner)
      return { status: 'conflict' }
    })

    const seed = await buildFileDocSeed('ws-1', 'file-1')

    expect(seed).toEqual({ update: winner.docState, version: VERSION + 1 })
    expect(mockGetWorkspaceFile).toHaveBeenCalledTimes(2)
    expect(mockFetchBuffer).toHaveBeenCalledTimes(2)
    expect(mockCommitState.mock.calls[1][2]).toBe(VERSION + 1)
    expect(mockCommitState.mock.calls[1][3].expectedState).toEqual({
      sourceHash: winner.sourceHash,
      stateHash: winner.stateHash,
    })
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

  it('does not start a seed for an already cancelled request', async () => {
    const reason = new Error('request cancelled')

    await expect(buildFileDocSeed('ws-1', 'file-1', AbortSignal.abort(reason))).rejects.toBe(reason)
    expect(mockGetWorkspaceFile).not.toHaveBeenCalled()
    expect(mockFetchBuffer).not.toHaveBeenCalled()
    expect(mockCommitState).not.toHaveBeenCalled()
  })

  it.each(['file lookup', 'download', 'cache lookup'] as const)(
    'stops after cancellation during %s without preparing or committing a seed',
    async (stage) => {
      const controller = new AbortController()
      const reason = new Error('request cancelled')
      const stop = () => controller.abort(reason)
      if (stage === 'file lookup') {
        mockGetWorkspaceFile.mockImplementationOnce(async () => {
          stop()
          return null
        })
      } else if (stage === 'download') {
        mockFetchBuffer.mockImplementationOnce(async (_record, options) => {
          stop()
          expect(options.signal.aborted).toBe(true)
          expect(options.signal.reason).toBe(reason)
          return Buffer.from('base')
        })
      } else {
        mockLoadState.mockImplementationOnce(async () => {
          stop()
          return null
        })
      }

      await expect(buildFileDocSeed('ws-1', 'file-1', controller.signal)).rejects.toBe(reason)
      expect(mockCommitState).not.toHaveBeenCalled()
      if (stage === 'file lookup') expect(mockFetchBuffer).not.toHaveBeenCalled()
      if (stage !== 'cache lookup') expect(mockLoadState).not.toHaveBeenCalled()
    }
  )

  it.each(['committed', 'conflict'] as const)(
    'does not publish or retry a %s result after cancellation during commit',
    async (status) => {
      const controller = new AbortController()
      const reason = new Error('request cancelled')
      mockCommitState.mockImplementationOnce(async () => {
        controller.abort(reason)
        return { status, version: VERSION }
      })

      await expect(buildFileDocSeed('ws-1', 'file-1', controller.signal)).rejects.toBe(reason)
      expect(mockGetWorkspaceFile).toHaveBeenCalledOnce()
      expect(mockCommitState).toHaveBeenCalledOnce()
    }
  )

  it('shares one deadline across retries and stops when it expires without caller cancellation', async () => {
    const deadline = new AbortController()
    const reason = new DOMException('Seed deadline expired', 'TimeoutError')
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
    mockCommitState.mockResolvedValueOnce({ status: 'conflict' })
    mockFetchBuffer.mockResolvedValueOnce(Buffer.from('base')).mockImplementationOnce(async () => {
      deadline.abort(reason)
      return Buffer.from('base')
    })

    try {
      await expect(buildFileDocSeed('ws-1', 'file-1')).rejects.toBe(reason)
      expect(timeout).toHaveBeenCalledExactlyOnceWith(FILE_DOC_TIMEOUTS.seedRequestMs)
      expect(mockFetchBuffer).toHaveBeenCalledTimes(2)
      for (const [, options] of mockFetchBuffer.mock.calls) {
        expect(options.signal).toBe(deadline.signal)
      }
      expect(mockLoadState).toHaveBeenCalledOnce()
      expect(mockCommitState).toHaveBeenCalledOnce()
    } finally {
      timeout.mockRestore()
    }
  })

  it('returns missing if the file is deleted during the commit', async () => {
    mockCommitState.mockResolvedValue({ status: 'missing' })

    await expect(buildFileDocSeed('ws-1', 'file-1')).resolves.toBeNull()
    expect(mockCommitState).toHaveBeenCalledOnce()
    expect(mockGetWorkspaceFile).toHaveBeenCalledOnce()
  })

  it('returns missing if the file disappears before a retry', async () => {
    mockCommitState.mockImplementationOnce(async () => {
      mockGetWorkspaceFile.mockResolvedValue(null)
      return { status: 'conflict' }
    })

    await expect(buildFileDocSeed('ws-1', 'file-1')).resolves.toBeNull()
    expect(mockCommitState).toHaveBeenCalledOnce()
    expect(mockLoadState).toHaveBeenCalledOnce()
    expect(mockGetWorkspaceFile).toHaveBeenCalledTimes(2)
  })

  it('propagates a durable read error without constructing or committing a new document', async () => {
    mockFetchBuffer.mockRejectedValue(new Error('object storage unavailable'))

    await expect(buildFileDocSeed('ws-1', 'file-1')).rejects.toThrow('object storage unavailable')
    expect(mockLoadState).not.toHaveBeenCalled()
    expect(mockCommitState).not.toHaveBeenCalled()
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

  it.each(['fresh', 'stale'] as const)(
    'retains deleted history when the %s cached document seeds a cold room',
    async (kind) => {
      const peer = new Y.Doc()
      const cold = new Y.Doc()
      try {
        Y.applyUpdate(peer, namedState('base', 'shared-generation'))
        const paragraph = peer.getXmlFragment(COLLAB_DOC_FIELD).get(0)
        if (!(paragraph instanceof Y.XmlElement)) throw new Error('Expected paragraph')
        const text = paragraph.get(0)
        if (!(text instanceof Y.XmlText)) throw new Error('Expected text')
        const start = text.length
        text.insert(start, ' transient peer text')
        const beforeDeletion = Y.encodeStateAsUpdate(peer)
        text.delete(start, text.length - start)
        const cache = cachedState(Y.encodeStateAsUpdate(peer), 'base')
        mockLoadState.mockResolvedValue(cache)
        const durable = kind === 'fresh' ? 'base' : 'base\n\nexternal addition'
        mockFetchBuffer.mockResolvedValue(Buffer.from(durable))

        const seed = await buildFileDocSeed('ws-1', 'file-1')
        const accepted = mockCommitState.mock.calls[0][3] as collabState.PreparedCollabDocState
        expect(seed?.update).toBe(accepted.docState)
        Y.applyUpdate(cold, accepted.docState)
        Y.applyUpdate(cold, beforeDeletion)

        expect(yDocToFileMarkdown(cold)).not.toContain('transient peer text')
        expect(yDocToMarkdown(cold)).toBe(serializeMarkdownBody(durable))
        expect(identityOf(seed!.update)).toBe('shared-generation')
        expect(accepted.expectedState).toEqual({
          sourceHash: cache.sourceHash,
          stateHash: cache.stateHash,
        })
      } finally {
        peer.destroy()
        cold.destroy()
      }
    }
  )

  it('fails closed on an undecodable cache tagged as current rather than returning a fabricated history', async () => {
    mockLoadState.mockResolvedValue(cachedState(new Uint8Array([255]), 'base'))

    await expect(buildFileDocSeed('ws-1', 'file-1')).rejects.toThrow()
    expect(mockCommitState).not.toHaveBeenCalled()
  })

  it('fences replacement of an undecodable stale cache against the exact corrupt revision', async () => {
    const corrupt = cachedState(new Uint8Array([255]), 'older bytes')
    mockLoadState.mockResolvedValue(corrupt)
    const seed = await buildFileDocSeed('ws-1', 'file-1')

    expect(typeof identityOf(seed!.update)).toBe('string')
    expect(mockCommitState).toHaveBeenCalledWith('ws-1', 'file-1', VERSION, {
      docState: seed!.update,
      sourceHash: collabState.hashMarkdown(Buffer.from('base')),
      expectedState: { sourceHash: corrupt.sourceHash, stateHash: corrupt.stateHash },
    })
  })

  it('never publishes a rebuilt identity when replacement of a corrupt cache loses every race', async () => {
    mockLoadState.mockResolvedValue(cachedState(new Uint8Array([255]), 'older bytes'))
    mockCommitState.mockResolvedValue({ status: 'conflict' })

    await expect(buildFileDocSeed('ws-1', 'file-1')).rejects.toBeInstanceOf(
      collabState.CollabDocStateConflictError
    )
    expect(mockCommitState).toHaveBeenCalledTimes(3)
  })

  it.each(['fresh', 'frontmatter-only write'] as const)(
    'preserves a peer’s empty-paragraph typing target while preparing a %s seed',
    async (kind) => {
      const peer = new Y.Doc()
      const cold = new Y.Doc()
      try {
        Y.applyUpdate(peer, namedState('base', 'shared-generation'))
        const tail = new Y.XmlElement('paragraph')
        const text = new Y.XmlText()
        tail.insert(0, [text])
        peer.getXmlFragment(COLLAB_DOC_FIELD).push([tail])
        const cache = cachedState(Y.encodeStateAsUpdate(peer), 'base')
        mockLoadState.mockResolvedValue(cache)
        const durable = kind === 'fresh' ? 'base' : '---\ntitle: changed\n---\n\nbase'
        mockFetchBuffer.mockResolvedValue(Buffer.from(durable))

        const seed = await buildFileDocSeed('ws-1', 'file-1')
        expect(seed?.update).toBe(mockCommitState.mock.calls[0][3].docState)
        text.insert(0, 'late offline text')
        Y.applyUpdate(cold, seed!.update)
        Y.applyUpdate(cold, Y.encodeStateAsUpdate(peer))

        expect(yDocToFileMarkdown(cold)).toContain('base\n\nlate offline text')
        if (kind === 'frontmatter-only write') {
          expect(yDocToFileMarkdown(cold)).toContain('title: changed')
        }
      } finally {
        peer.destroy()
        cold.destroy()
      }
    }
  )
})
