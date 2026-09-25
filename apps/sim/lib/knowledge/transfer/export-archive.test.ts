import { createReadStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { sleep } from '@sim/utils/helpers'
import JSZip from 'jszip'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  downloadFileStream: vi.fn(),
  readInlineFileUrl: vi.fn(),
}))

vi.mock('@/lib/uploads/core/storage-service', () => ({
  downloadFileStream: mocks.downloadFileStream,
}))

vi.mock('@/lib/knowledge/transfer/export-source', () => ({
  readInlineFileUrl: mocks.readInlineFileUrl,
}))

import type { KnowledgeBaseExportBundle } from '@/lib/knowledge/application/exports'
import { MAX_DOCUMENT_CHUNKS } from '@/lib/knowledge/documents/document-processing-error'
import {
  buildKnowledgeBundleArchive,
  knowledgeBundleFileName,
} from '@/lib/knowledge/transfer/export-archive'
import type { ExportableChunk, ExportableDocument } from '@/lib/knowledge/transfer/export-source'

const STORED_ID = 'doc-stored'
const INLINE_ID = 'doc-inline'
const TEXT_ONLY_ID = 'doc-text'

function exportableDocument(overrides: Partial<ExportableDocument>): ExportableDocument {
  return {
    id: STORED_ID,
    filename: 'handbook.pdf',
    mimeType: 'application/pdf',
    fileSize: 3,
    enabled: true,
    tokenCount: 12,
    characterCount: 40,
    tags: { tag1: 'Billing' },
    file: { kind: 'storage', key: 'kb/handbook.pdf' },
    storedChunkCount: 2,
    ...overrides,
  }
}

function chunk(index: number, vector: number[] | null): ExportableChunk {
  return {
    index,
    content: `chunk ${index}`,
    tokenCount: 2,
    startOffset: index * 10,
    endOffset: index * 10 + 7,
    enabled: index !== 1,
    vector,
  }
}

async function* chunksOf(...chunks: ExportableChunk[]): AsyncGenerator<ExportableChunk> {
  for (const item of chunks) yield item
}

function bundle(overrides: Partial<KnowledgeBaseExportBundle> = {}): KnowledgeBaseExportBundle {
  return {
    knowledgeBase: {
      name: 'Support docs',
      description: 'Everything support knows',
      chunkingConfig: { maxSize: 1024, minSize: 100, overlap: 200 },
    },
    embedding: { model: 'text-embedding-3-small', dimension: 1536, vectorsIncluded: true },
    tags: [{ slot: 'tag1', displayName: 'Product', fieldType: 'text' }],
    documents: [
      exportableDocument({}),
      exportableDocument({
        id: INLINE_ID,
        filename: 'note.txt',
        mimeType: 'text/plain',
        file: { kind: 'data-uri', knowledgeBaseId: 'kb-1', documentId: INLINE_ID },
        storedChunkCount: 0,
      }),
      exportableDocument({ id: TEXT_ONLY_ID, filename: 'wiki page', file: null }),
    ],
    chunks: (documentId) =>
      documentId === STORED_ID
        ? chunksOf(chunk(0, [0.25, 0.5]), chunk(1, [1, 2]))
        : chunksOf(chunk(0, null)),
    ...overrides,
  }
}

async function readArchive(source: Readable): Promise<JSZip> {
  const parts: Buffer[] = []
  for await (const part of source) parts.push(Buffer.from(part))
  return JSZip.loadAsync(Buffer.concat(parts))
}

describe('buildKnowledgeBundleArchive', () => {
  beforeEach(() => {
    mocks.downloadFileStream.mockImplementation(async () => Readable.from([Buffer.from('pdf')]))
    mocks.readInlineFileUrl.mockResolvedValue(
      `data:text/plain;base64,${Buffer.from('hi').toString('base64')}`
    )
  })

  /**
   * `document.chunkCount` is denormalized, so the pre-flight gate can approve a
   * document that has since grown past what a bundle describes. The archive is
   * the last place that can refuse it.
   */
  it('refuses a document whose chunk stream exceeds what the format describes', async () => {
    const overLimit = (async function* () {
      for (let index = 0; index <= MAX_DOCUMENT_CHUNKS; index += 1) yield chunk(index, null)
    })()
    const archive = buildKnowledgeBundleArchive(
      bundle({
        documents: [exportableDocument({ id: TEXT_ONLY_ID, file: null })],
        chunks: () => overLimit,
      })
    )

    await expect(readArchive(archive)).rejects.toThrow(`more than ${MAX_DOCUMENT_CHUNKS} chunks`)
  })

  it('rejects the archive reader when an original disappears before its stream opens', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'knowledge-export-missing-'))
    const source = createReadStream(join(directory, 'absent.txt'))
    mocks.downloadFileStream.mockResolvedValue(source)
    const archive = buildKnowledgeBundleArchive(bundle())
    try {
      await expect(readArchive(archive)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(source.destroyed).toBe(true)
      expect(mocks.readInlineFileUrl).not.toHaveBeenCalled()
    } finally {
      archive.destroy()
      source.destroy()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('rejects a partially streamed original rather than publishing a truncated bundle', async () => {
    const source = Readable.from(
      (async function* () {
        yield Buffer.from('partial original')
        throw new Error('Original source failed')
      })()
    )
    mocks.downloadFileStream.mockResolvedValue(source)
    const archive = buildKnowledgeBundleArchive(bundle())
    await expect(readArchive(archive)).rejects.toThrow('Original source failed')
    expect(source.destroyed).toBe(true)
    expect(mocks.readInlineFileUrl).not.toHaveBeenCalled()
  })

  it('rejects an original that closes before its readable end', async () => {
    const source = new Readable({
      read() {
        this.destroy()
      },
    })
    mocks.downloadFileStream.mockResolvedValue(source)
    const archive = buildKnowledgeBundleArchive(bundle())
    await expect(readArchive(archive)).rejects.toMatchObject({ code: 'ERR_STREAM_PREMATURE_CLOSE' })
    expect(mocks.readInlineFileUrl).not.toHaveBeenCalled()
  })

  /** A browser that abandons the download must not leave the append loop or its blob stream hanging. */
  it('releases the in-flight source and stops appending when the consumer goes away', async () => {
    const blob = new Readable({ read() {} })
    mocks.downloadFileStream.mockResolvedValue(blob)
    const archive = buildKnowledgeBundleArchive(bundle())
    await sleep(1)
    expect(mocks.downloadFileStream).toHaveBeenCalledTimes(1)

    archive.destroy()
    await sleep(1)
    expect(blob.destroyed).toBe(true)
    expect(mocks.readInlineFileUrl).not.toHaveBeenCalled()
  })
})

describe('knowledgeBundleFileName', () => {
  it('sanitizes the base name and appends the bundle suffix', () => {
    expect(knowledgeBundleFileName('Support docs')).toBe('Support docs.simkb.zip')
    expect(knowledgeBundleFileName('a/b:c')).toBe('b_c.simkb.zip')
  })
})
