/**
 * @vitest-environment jsdom
 */
import { FILE_DOC_SEED } from '@sim/realtime-protocol/file-doc'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

const { mockGetWorkspaceFile, mockFetchBuffer } = vi.hoisted(() => ({
  mockGetWorkspaceFile: vi.fn(),
  mockFetchBuffer: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  getWorkspaceFile: mockGetWorkspaceFile,
  fetchWorkspaceFileBuffer: mockFetchBuffer,
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
    })
  })

  it('builds a seed whose applied update reproduces the file body (through the client engine)', async () => {
    mockFetchBuffer.mockResolvedValue(Buffer.from('# Title\n\nHello **world**.', 'utf-8'))

    const seed = await buildFileDocSeed('ws-1', 'file-1')
    expect(seed).not.toBeNull()

    const doc = new Y.Doc()
    Y.applyUpdate(doc, seed!.update)
    expect(yDocToMarkdown(doc)).toBe(serializeMarkdownBody('# Title\n\nHello **world**.'))
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
