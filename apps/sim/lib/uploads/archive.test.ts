/**
 * @vitest-environment node
 */
import { Buffer } from 'buffer'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import {
  ArchiveError,
  extractArchiveEntry,
  listArchiveEntries,
  MAX_ARCHIVE_ENTRIES,
} from '@/lib/uploads/archive'

async function buildZip(files: Record<string, string | Uint8Array>): Promise<Buffer> {
  const zip = new JSZip()
  for (const [name, content] of Object.entries(files)) {
    zip.file(name, content)
  }
  const arr = await zip.generateAsync({ type: 'uint8array' })
  return Buffer.from(arr)
}

describe('listArchiveEntries', () => {
  it('enumerates nested entries with sanitized joined paths', async () => {
    const buffer = await buildZip({
      'report.txt': 'hello',
      'data/sheet.csv': 'a,b\n1,2',
      'data/nested/deep.json': '{}',
    })

    const paths = (await listArchiveEntries(buffer)).sort()

    expect(paths).toEqual(['data/nested/deep.json', 'data/sheet.csv', 'report.txt'])
  })

  it('skips directory entries', async () => {
    const zip = new JSZip()
    zip.folder('emptydir')
    zip.file('file.txt', 'x')
    const buffer = Buffer.from(await zip.generateAsync({ type: 'uint8array' }))

    expect(await listArchiveEntries(buffer)).toEqual(['file.txt'])
  })

  it('never surfaces a path with a traversal segment or absolute root', async () => {
    // JSZip itself strips leading `../`, keeping a contained basename; our guard
    // additionally rejects any residual `..` (e.g. a Windows-style backslash path
    // that JSZip stores verbatim) so nothing can escape the archive root.
    const buffer = await buildZip({
      'safe.txt': 'ok',
      '..\\evil.txt': 'evil',
      'sub\\..\\..\\evil2.txt': 'evil',
    })

    const paths = await listArchiveEntries(buffer)

    expect(paths).toContain('safe.txt')
    expect(paths.some((p) => p.split('/').includes('..'))).toBe(false)
    expect(paths.some((p) => p.startsWith('/'))).toBe(false)
    expect(paths).not.toContain('evil.txt')
    expect(paths).not.toContain('evil2.txt')
  })

  it('de-duplicates entries that sanitize to the same path', async () => {
    const buffer = await buildZip({
      'a/b.txt': 'first',
      './a/b.txt': 'shadowed',
    })

    const paths = await listArchiveEntries(buffer)

    expect(paths).toEqual(['a/b.txt'])
  })

  it('filters __MACOSX, .DS_Store and Thumbs.db noise', async () => {
    const buffer = await buildZip({
      'doc.txt': 'real',
      '__MACOSX/._doc.txt': 'junk',
      '.DS_Store': 'junk',
      'sub/.DS_Store': 'junk',
      'sub/Thumbs.db': 'junk',
    })

    expect(await listArchiveEntries(buffer)).toEqual(['doc.txt'])
  })

  it('rejects archives with too many entries', async () => {
    const files: Record<string, string> = {}
    for (let i = 0; i <= MAX_ARCHIVE_ENTRIES; i++) {
      files[`f${i}.txt`] = 'x'
    }
    const buffer = await buildZip(files)

    await expect(listArchiveEntries(buffer)).rejects.toMatchObject({
      name: 'ArchiveError',
      reason: 'too_many_entries',
    })
  })

  it('throws ArchiveError invalid for non-zip buffers', async () => {
    await expect(listArchiveEntries(Buffer.from('not a zip at all'))).rejects.toBeInstanceOf(
      ArchiveError
    )
  })
})

describe('extractArchiveEntry', () => {
  it('extracts a single entry by sanitized path', async () => {
    const buffer = await buildZip({
      'report.txt': 'the body',
      'data/sheet.csv': 'a,b\n1,2',
    })

    const csv = await extractArchiveEntry(buffer, 'data/sheet.csv')
    expect(csv?.toString('utf-8')).toBe('a,b\n1,2')

    const txt = await extractArchiveEntry(buffer, 'report.txt')
    expect(txt?.toString('utf-8')).toBe('the body')
  })

  it('returns null when the entry does not exist', async () => {
    const buffer = await buildZip({ 'report.txt': 'x' })
    expect(await extractArchiveEntry(buffer, 'missing.txt')).toBeNull()
  })

  it('does not resolve traversal paths', async () => {
    const buffer = await buildZip({ '..\\evil.txt': 'evil', 'safe.txt': 'ok' })
    // The traversal entry sanitizes to null, so it is unmatchable by any path.
    expect(await extractArchiveEntry(buffer, '../evil.txt')).toBeNull()
    expect(await extractArchiveEntry(buffer, '..\\evil.txt')).toBeNull()
    expect(await extractArchiveEntry(buffer, 'evil.txt')).toBeNull()
    expect((await extractArchiveEntry(buffer, 'safe.txt'))?.toString('utf-8')).toBe('ok')
  })
})
