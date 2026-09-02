/**
 * @vitest-environment node
 */
import { FILE_DOC_SEED } from '@sim/realtime-protocol/file-doc'
import { getSchema } from '@tiptap/core'
import { prosemirrorJSONToYDoc } from '@tiptap/y-tiptap'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

const { mockGetWorkspaceFile, mockFetchBuffer, mockLoadState, mockSaveState } = vi.hoisted(() => ({
  mockGetWorkspaceFile: vi.fn(),
  mockFetchBuffer: vi.fn(),
  mockLoadState: vi.fn(),
  mockSaveState: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  getWorkspaceFile: mockGetWorkspaceFile,
  fetchWorkspaceFileBuffer: mockFetchBuffer,
}))

// The DB-backed cold-start cache is exercised in its own suite; here we default it to a MISS so these
// tests cover the markdown → Yjs conversion path (the cache-hit fast path has its own test below).
vi.mock('./collab-state', () => ({
  hashMarkdown: () => 'test-source-hash',
  loadCollabDocState: mockLoadState,
  saveCollabDocState: mockSaveState,
}))

import { createMarkdownContentExtensions } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/extensions'
import {
  parseMarkdownToDoc,
  serializeMarkdownBody,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-parse'
import { markdownToYDoc, yDocToMarkdown } from './converter'
import { COLLAB_DOC_FIELD } from './field'
import { buildFileDocSeed } from './seed'

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
    // Default: nothing stored → the conversion path runs (the case these tests cover).
    mockLoadState.mockResolvedValue(null)
    mockSaveState.mockResolvedValue(undefined)
  })

  it('builds a seed whose applied update reproduces the file body (through the client engine)', async () => {
    mockFetchBuffer.mockResolvedValue(Buffer.from('# Title\n\nHello **world**.', 'utf-8'))

    const seed = await buildFileDocSeed('ws-1', 'file-1')
    expect(seed).not.toBeNull()

    const doc = new Y.Doc()
    Y.applyUpdate(doc, seed!.update)
    expect(yDocToMarkdown(doc)).toBe(serializeMarkdownBody('# Title\n\nHello **world**.'))
  })

  it('cold-start fast path: returns the cached binary directly without re-converting when it is fresh', async () => {
    // A cached binary derived from the current markdown → seed returns it verbatim (no conversion), the
    // Hocuspocus load-document path that preserves the CRDT's client ids across reopens. Built through
    // `markdownToYDoc` so it is in the canonical form persist caches; a hand-rolled doc would be
    // repaired on the way through and this would assert the fast path while never taking it.
    const cachedDoc = markdownToYDoc('# Anything')
    cachedDoc.getText('marker').insert(0, 'cached')
    // Named, as anything the current seed stored would be — an unnamed document is rewritten once to
    // give it an identity, which has its own test below.
    cachedDoc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.docIdKey, 'doc-already-named')
    const cached = Y.encodeStateAsUpdate(cachedDoc)
    mockFetchBuffer.mockResolvedValue(Buffer.from('# Anything', 'utf-8'))
    mockLoadState.mockResolvedValue({ docState: cached, sourceHash: 'test-source-hash' })

    const seed = await buildFileDocSeed('ws-1', 'file-1')

    expect(seed?.update).toBe(cached)
    const doc = new Y.Doc()
    Y.applyUpdate(doc, seed!.update)
    expect(doc.getText('marker').toString()).toBe('cached')
    cachedDoc.destroy()
  })

  /**
   * The freshness tag is a hash of the markdown alone, so a snapshot written under older parse rules
   * still reads as fresh and would otherwise be replayed verbatim forever. Repairing it here is the only
   * path that ever fixes one — and the repair has to be reported, or the caller hands back the bytes it
   * just decided were wrong (which is how the cached path kept reseeding docs that were missing the
   * editor's trailing paragraph, letting every binding client stack another).
   */
  it('repairs a cached snapshot that is not in the editor normal form', async () => {
    const stale = prosemirrorJSONToYDoc(
      getSchema(createMarkdownContentExtensions()),
      // A raw parse — no trailing paragraph, which is exactly what a pre-normalization snapshot holds.
      parseMarkdownToDoc('# T\n\nbody\n\n- a\n- b'),
      COLLAB_DOC_FIELD
    )
    const cached = Y.encodeStateAsUpdate(stale)
    mockFetchBuffer.mockResolvedValue(Buffer.from('# T\n\nbody\n\n- a\n- b', 'utf-8'))
    mockLoadState.mockResolvedValue({ docState: cached, sourceHash: 'test-source-hash' })

    const seed = await buildFileDocSeed('ws-1', 'file-1')

    expect(seed?.update).not.toBe(cached)
    const doc = new Y.Doc()
    Y.applyUpdate(doc, seed!.update)
    const fragment = doc.getXmlFragment(COLLAB_DOC_FIELD)
    const last = fragment.get(fragment.length - 1)
    expect(last instanceof Y.XmlElement && last.nodeName === 'paragraph' && last.length === 0).toBe(
      true
    )
    stale.destroy()
    doc.destroy()
  })

  it('falls through to conversion when the cache read fails (never blocks a cold open)', async () => {
    // The cache is a best-effort optimization over the durable markdown we already hold; a transient DB
    // error or a not-yet-migrated cache table must convert, not abort the seed.
    mockFetchBuffer.mockResolvedValue(Buffer.from('# Title\n\ntext.', 'utf-8'))
    mockLoadState.mockRejectedValue(new Error('cache table missing'))

    const seed = await buildFileDocSeed('ws-1', 'file-1')
    expect(seed).not.toBeNull()

    const doc = new Y.Doc()
    Y.applyUpdate(doc, seed!.update)
    expect(yDocToMarkdown(doc)).toBe(serializeMarkdownBody('# Title\n\ntext.'))
  })

  it('strips frontmatter — only the body seeds the collaborative doc', async () => {
    mockFetchBuffer.mockResolvedValue(Buffer.from('---\ntitle: X\n---\n\n# Body\n\ntext.', 'utf-8'))

    const seed = await buildFileDocSeed('ws-1', 'file-1')
    const doc = new Y.Doc()
    Y.applyUpdate(doc, seed!.update)
    const md = yDocToMarkdown(doc)
    expect(md).not.toContain('title: X')
    expect(md).toBe(serializeMarkdownBody('# Body\n\ntext.'))
  })

  it('marks the seeded doc as initial-content-loaded so the client needs no seeder handshake', async () => {
    mockFetchBuffer.mockResolvedValue(Buffer.from('# Body', 'utf-8'))
    const seed = await buildFileDocSeed('ws-1', 'file-1')
    const doc = new Y.Doc()
    Y.applyUpdate(doc, seed!.update)
    expect(doc.getMap(FILE_DOC_SEED.configMap).get(FILE_DOC_SEED.flag)).toBe(true)
  })

  it('carries the frontmatter in the config map (not the body)', async () => {
    mockFetchBuffer.mockResolvedValue(Buffer.from('---\ntitle: X\n---\n\n# Body', 'utf-8'))
    const seed = await buildFileDocSeed('ws-1', 'file-1')
    const doc = new Y.Doc()
    Y.applyUpdate(doc, seed!.update)
    expect(doc.getMap(FILE_DOC_SEED.configMap).get(FILE_DOC_SEED.frontmatterKey)).toContain(
      'title: X'
    )
    // …and the frontmatter is NOT in the collaborative body.
    expect(yDocToMarkdown(doc)).not.toContain('title: X')
  })

  it('returns null for a missing file', async () => {
    mockGetWorkspaceFile.mockResolvedValue(null)
    expect(await buildFileDocSeed('ws-1', 'missing')).toBeNull()
  })

  it('requests the file with throwOnError so a read failure is not mistaken for an empty file', async () => {
    mockGetWorkspaceFile.mockRejectedValue(new Error('db down'))
    // Propagates instead of returning null — the relay must retry, never seed blank over a real file.
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
    mockSaveState.mockResolvedValue(undefined)
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
    // Until this row exists, a file that is opened but never edited gets a NEW document on every open.
    mockFetchBuffer.mockResolvedValue(Buffer.from('# Title\n\nbody', 'utf-8'))

    const seed = await buildFileDocSeed('ws-1', 'file-1')

    expect(mockSaveState).toHaveBeenCalledWith('file-1', seed!.update, 'test-source-hash')
    expect(typeof docIdOf(seed!.update)).toBe('string')
  })

  it('keeps the stored document’s identity when the markdown changed out-of-band', async () => {
    // A copilot write (or the content API) moved the markdown on, so the stored binary is stale. It must
    // be UPDATED, not replaced: the identity — and the client ids under it — have to survive.
    const stored = markdownToYDoc('# Title\n\nbody')
    stored.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.docIdKey, 'doc-original')
    mockLoadState.mockResolvedValue({
      docState: Y.encodeStateAsUpdate(stored),
      sourceHash: 'a-hash-from-before-the-external-write',
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
    // The end-to-end property, stated the way it fails: a tab that outlived its room reconnects and
    // syncs. Building a second document here appends the whole file to itself, on both sides.
    const original = markdownToYDoc('# Title\n\nfirst\n\nsecond')
    original.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.docIdKey, 'doc-original')
    const client = new Y.Doc()
    Y.applyUpdate(client, Y.encodeStateAsUpdate(original))

    mockLoadState.mockResolvedValue({
      docState: Y.encodeStateAsUpdate(original),
      sourceHash: 'stale-after-an-external-write',
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
      sourceHash: 'test-source-hash',
    })

    const first = await buildFileDocSeed('ws-1', 'file-1')
    const docId = docIdOf(first!.update)
    expect(typeof docId).toBe('string')
    expect(mockSaveState).toHaveBeenCalledWith('file-1', first!.update, 'test-source-hash')

    // The next open finds it named and hands back the stored bytes untouched.
    mockSaveState.mockClear()
    mockLoadState.mockResolvedValue({ docState: first!.update, sourceHash: 'test-source-hash' })
    const second = await buildFileDocSeed('ws-1', 'file-1')
    expect(docIdOf(second!.update)).toBe(docId)
    expect(mockSaveState).not.toHaveBeenCalled()
    legacy.destroy()
  })

  it('still seeds when the document cannot be stored (the write is best-effort)', async () => {
    mockFetchBuffer.mockResolvedValue(Buffer.from('# Title', 'utf-8'))
    mockSaveState.mockRejectedValue(new Error('db down'))

    const seed = await buildFileDocSeed('ws-1', 'file-1')

    expect(seed).not.toBeNull()
    expect(typeof docIdOf(seed!.update)).toBe('string')
  })
})
