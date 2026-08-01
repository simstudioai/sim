/**
 * @vitest-environment jsdom
 */
import { FILE_DOC_SEED } from '@sim/realtime-protocol/file-doc'
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

import { serializeMarkdownBody } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-parse'
import { yDocToMarkdown } from './converter'
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
    // Hocuspocus load-document path that preserves the CRDT's client ids across reopens.
    const cachedDoc = new Y.Doc()
    cachedDoc.getText('marker').insert(0, 'cached')
    const cached = Y.encodeStateAsUpdate(cachedDoc)
    mockFetchBuffer.mockResolvedValue(Buffer.from('# Anything', 'utf-8'))
    mockLoadFresh.mockResolvedValue(cached)

    const seed = await buildFileDocSeed('ws-1', 'file-1')

    expect(seed?.update).toBe(cached)
    const doc = new Y.Doc()
    Y.applyUpdate(doc, seed!.update)
    expect(doc.getText('marker').toString()).toBe('cached')
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
