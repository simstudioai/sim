/**
 * @vitest-environment node
 */
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
import { decodeVectorBase64, knowledgeBundleManifestSchema } from '@/lib/knowledge/transfer/bundle'
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
    vi.clearAllMocks()
    mocks.downloadFileStream.mockImplementation(async () => Readable.from([Buffer.from('pdf')]))
    mocks.readInlineFileUrl.mockResolvedValue(
      `data:text/plain;base64,${Buffer.from('hi').toString('base64')}`
    )
  })

  it('writes files, chunk lines, and a manifest that validates against the bundle schema', async () => {
    const zip = await readArchive(buildKnowledgeBundleArchive(bundle()))

    expect(Object.keys(zip.files)).toEqual([
      `files/${STORED_ID}/handbook.pdf`,
      `chunks/${STORED_ID}.ndjson`,
      `files/${INLINE_ID}/note.txt`,
      `chunks/${TEXT_ONLY_ID}.ndjson`,
      'manifest.json',
    ])
    expect(await zip.file(`files/${STORED_ID}/handbook.pdf`)!.async('string')).toBe('pdf')
    expect(await zip.file(`files/${INLINE_ID}/note.txt`)!.async('string')).toBe('hi')

    const manifest = knowledgeBundleManifestSchema.parse(
      JSON.parse(await zip.file('manifest.json')!.async('string'))
    )
    expect(manifest.embedding).toEqual({
      model: 'text-embedding-3-small',
      dimension: 1536,
      vectorsIncluded: true,
    })
    expect(manifest.knowledgeBase.name).toBe('Support docs')
    expect(manifest.tags).toEqual([{ slot: 'tag1', displayName: 'Product', fieldType: 'text' }])
    expect(
      manifest.documents.map((document) => [document.id, document.file, document.chunks])
    ).toEqual([
      [STORED_ID, `files/${STORED_ID}/handbook.pdf`, `chunks/${STORED_ID}.ndjson`],
      [INLINE_ID, `files/${INLINE_ID}/note.txt`, null],
      [TEXT_ONLY_ID, null, `chunks/${TEXT_ONLY_ID}.ndjson`],
    ])
  })

  /** Counts come from what the chunk stream wrote, not from the stored counter. */
  it('records the chunk count actually written and carries vectors on every line', async () => {
    const zip = await readArchive(buildKnowledgeBundleArchive(bundle()))
    const lines = (await zip.file(`chunks/${STORED_ID}.ndjson`)!.async('string'))
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line))

    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ index: 0, content: 'chunk 0', enabled: true })
    expect(lines[1]).toMatchObject({ index: 1, enabled: false })
    expect(decodeVectorBase64(lines[0].vector, 2)).toEqual([0.25, 0.5])

    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'))
    expect(manifest.documents[0].chunkCount).toBe(2)
    expect(manifest.documents[2].chunkCount).toBe(1)
  })

  it('omits vectors when the bundle does not include them', async () => {
    const zip = await readArchive(
      buildKnowledgeBundleArchive(
        bundle({
          embedding: { model: 'text-embedding-3-small', dimension: 1536, vectorsIncluded: false },
        })
      )
    )
    const [first] = (await zip.file(`chunks/${STORED_ID}.ndjson`)!.async('string')).split('\n')
    expect(JSON.parse(first)).not.toHaveProperty('vector')
  })

  /** Blobs open only as the archiver reaches them, so a large base never fans out storage reads. */
  it('opens stored blobs one at a time, in entry order', async () => {
    const events: string[] = []
    mocks.downloadFileStream.mockImplementation(async ({ key }: { key: string }) => {
      events.push(`open:${key}`)
      return Readable.from([Buffer.from('pdf')])
    })
    const archive = buildKnowledgeBundleArchive(
      bundle({
        documents: [
          exportableDocument({ id: 'doc-a', file: { kind: 'storage', key: 'kb/a.pdf' } }),
          exportableDocument({ id: 'doc-b', file: { kind: 'storage', key: 'kb/b.pdf' } }),
        ],
      })
    )
    archive.on('entry', (entry: { name: string }) => events.push(`entry:${entry.name}`))

    await readArchive(archive)
    expect(events).toEqual([
      'open:kb/a.pdf',
      'entry:files/doc-a/handbook.pdf',
      'entry:chunks/doc-a.ndjson',
      'open:kb/b.pdf',
      'entry:files/doc-b/handbook.pdf',
      'entry:chunks/doc-b.ndjson',
      'entry:manifest.json',
    ])
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
