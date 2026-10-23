import { createWriteStream } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { ZipArchive } from 'archiver'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { encodeVectorBase64 } from '@/lib/knowledge/transfer/bundle'
import { openKnowledgeBundle } from '@/lib/knowledge/transfer/import-archive'

const DOCUMENT_ID = 'doc-1'
const VECTOR = [0.25, -0.5, ...Array<number>(1534).fill(0)]

let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'knowledge-import-archive-'))
})
afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

function manifest(overrides: Record<string, unknown> = {}, document: Record<string, unknown> = {}) {
  return {
    version: 1,
    exportedAt: '2026-10-01T00:00:00.000Z',
    embedding: { model: 'text-embedding-3-small', dimension: 1536, vectorsIncluded: true },
    knowledgeBase: {
      name: 'Support docs',
      description: null,
      chunkingConfig: { maxSize: 1024, minSize: 100, overlap: 200 },
    },
    tags: [],
    documents: [
      {
        id: DOCUMENT_ID,
        filename: 'handbook.txt',
        mimeType: 'text/plain',
        fileSize: 5,
        enabled: true,
        tags: {},
        file: `files/${DOCUMENT_ID}/handbook.txt`,
        chunks: `chunks/${DOCUMENT_ID}.ndjson`,
        chunkCount: 2,
        tokenCount: 4,
        characterCount: 10,
        ...document,
      },
    ],
    ...overrides,
  }
}

const CHUNKS = { chunks: `chunks/${DOCUMENT_ID}.ndjson`, chunkCount: 2, characterCount: 10 }

function chunkLine(index: number, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    index,
    content: `chunk ${index}`,
    tokenCount: 2,
    startOffset: index * 10,
    endOffset: index * 10 + 7,
    enabled: index === 0,
    vector: encodeVectorBase64(VECTOR),
    ...extra,
  })
}

/** Writes entries in order with archiver, which, unlike a map, can repeat a name. */
async function zipOf(entries: [string, string][]): Promise<string> {
  const path = join(directory, 'bundle.zip')
  const archive = new ZipArchive()
  const written = pipeline(archive, createWriteStream(path))
  for (const [name, content] of entries) archive.append(content, { name })
  await archive.finalize()
  await written
  return path
}

function validEntries(
  lines = [chunkLine(0), chunkLine(1)],
  bundleManifest = manifest()
): [string, string][] {
  return [
    [`files/${DOCUMENT_ID}/handbook.txt`, 'hello'],
    [`chunks/${DOCUMENT_ID}.ndjson`, `${lines.join('\n')}\n`],
    ['manifest.json', JSON.stringify(bundleManifest)],
  ]
}

describe('openKnowledgeBundle', () => {
  it('reads the manifest, original file, chunks, and vectors of a well-formed bundle', async () => {
    const reader = await openKnowledgeBundle(await zipOf(validEntries()))
    try {
      expect(reader.manifest.knowledgeBase.name).toBe('Support docs')
      expect((await reader.readFile(`files/${DOCUMENT_ID}/handbook.txt`)).toString()).toBe('hello')
      const withVectors = await reader.readChunks(CHUNKS, true)
      expect(withVectors.chunks).toEqual([
        { text: 'chunk 0', startOffset: 0, endOffset: 7, enabled: true },
        { text: 'chunk 1', startOffset: 10, endOffset: 17, enabled: false },
      ])
      expect(withVectors.vectors).toEqual([VECTOR, VECTOR])
      expect((await reader.readChunks(CHUNKS, false)).vectors).toBeUndefined()
    } finally {
      reader.close()
    }
  })

  it.each<[string, () => Promise<string>, string]>([
    [
      'a file that is not a zip archive',
      async () => {
        const path = join(directory, 'bundle.zip')
        await writeFile(path, 'not a zip')
        return path
      },
      'not a zip archive',
    ],
    [
      'an archive without a manifest',
      () => zipOf(validEntries().slice(0, 2)),
      'missing entry manifest.json',
    ],
    [
      'a manifest that is not JSON',
      () => zipOf([...validEntries().slice(0, 2), ['manifest.json', '{']]),
      'manifest.json is not valid JSON',
    ],
    [
      'an unsupported bundle version',
      () => zipOf(validEntries(undefined, manifest({ version: 2 }))),
      'manifest version',
    ],
    [
      'a document listed twice',
      () => {
        const [listed] = manifest().documents
        return zipOf(validEntries(undefined, manifest({ documents: [listed, listed] })))
      },
      'duplicate document id doc-1',
    ],
    [
      'a manifest naming an entry the archive lacks',
      () => {
        const [file, , manifestEntry] = validEntries()
        return zipOf([file, manifestEntry])
      },
      'missing entry chunks/doc-1.ndjson',
    ],
    [
      'an archive with more entries than any bundle holds',
      () =>
        zipOf(Array.from({ length: 4002 }, (_, index): [string, string] => [`extra/${index}`, ''])),
      'more than 4001 entries',
    ],
    [
      'an archive that repeats an entry name',
      () => zipOf([...validEntries(), ['manifest.json', JSON.stringify(manifest())]]),
      'duplicate entry manifest.json',
    ],
  ])('refuses %s before reading any document', async (_fixture, build, message) => {
    await expect(openKnowledgeBundle(await build())).rejects.toThrow(
      expect.objectContaining({ code: 'validation', message: expect.stringContaining(message) })
    )
  })

  it.each([
    ['a line that is not JSON', [chunkLine(0), '{'], 'line 2 is not valid JSON'],
    ['a line outside the chunk schema', [chunkLine(0), chunkLine(1, { content: '' })], 'line 2'],
    ['chunks out of index order', [chunkLine(1), chunkLine(0)], 'chunks are out of order'],
    [
      'a chunk that ends before it starts',
      [chunkLine(0), chunkLine(1, { startOffset: 20, endOffset: 10 })],
      'chunk 1 ends before it starts',
    ],
    ['fewer chunks than the manifest lists', [chunkLine(0)], 'holds 1 chunks'],
    [
      'a chunk without a vector',
      [chunkLine(0), chunkLine(1, { vector: undefined })],
      'chunk 1 has no valid vector',
    ],
    [
      'a vector of the wrong dimension',
      [chunkLine(0), chunkLine(1, { vector: encodeVectorBase64([1, 2, 3]) })],
      'chunk 1 has no valid vector',
    ],
  ])('refuses a chunk entry with %s', async (_fixture, lines, message) => {
    const reader = await openKnowledgeBundle(await zipOf(validEntries(lines)))
    try {
      await expect(reader.readChunks(CHUNKS, true)).rejects.toThrow(
        expect.objectContaining({ code: 'validation', message: expect.stringContaining(message) })
      )
    } finally {
      reader.close()
    }
  })

  it('refuses a damaged chunk entry when validated, before any document is read', async () => {
    const reader = await openKnowledgeBundle(await zipOf(validEntries([chunkLine(0), '{'])))
    try {
      await expect(reader.validateChunks(false)).rejects.toThrow(
        expect.objectContaining({ code: 'validation', message: expect.stringContaining('line 2') })
      )
    } finally {
      reader.close()
    }
  })

  it('accepts chunks without vectors when they will be re-embedded', async () => {
    const lines = [chunkLine(0, { vector: undefined }), chunkLine(1, { vector: undefined })]
    const reader = await openKnowledgeBundle(await zipOf(validEntries(lines)))
    try {
      const { chunks, vectors } = await reader.readChunks(CHUNKS, false)
      expect(chunks).toHaveLength(2)
      expect(vectors).toBeUndefined()
    } finally {
      reader.close()
    }
  })
})
