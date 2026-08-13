/**
 * @vitest-environment jsdom
 */
import { FILE_DOC_SEED } from '@sim/realtime-protocol/file-doc'
import { getSchema } from '@tiptap/core'
import { prosemirrorJSONToYDoc } from '@tiptap/y-tiptap'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

const { mockGetWorkspaceFile, mockFetchBuffer, mockLoadFresh } = vi.hoisted(() => ({
  mockGetWorkspaceFile: vi.fn(),
  mockFetchBuffer: vi.fn(),
  mockLoadFresh: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  getWorkspaceFile: mockGetWorkspaceFile,
  fetchWorkspaceFileBuffer: mockFetchBuffer,
}))

// The DB-backed cold-start cache is exercised in its own suite; here we default it to a MISS so these
// tests cover the markdown → Yjs conversion path (the cache-hit fast path has its own test below).
vi.mock('./collab-state', () => ({
  hashMarkdown: () => 'test-source-hash',
  loadFreshCollabDocState: mockLoadFresh,
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
    // Default: no cached binary → the conversion path runs (the case these tests cover).
    mockLoadFresh.mockResolvedValue(null)
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
    const cached = Y.encodeStateAsUpdate(cachedDoc)
    mockFetchBuffer.mockResolvedValue(Buffer.from('# Anything', 'utf-8'))
    mockLoadFresh.mockResolvedValue(cached)

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
    mockLoadFresh.mockResolvedValue(cached)

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
    mockLoadFresh.mockRejectedValue(new Error('cache table missing'))

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
