/**
 * @vitest-environment node
 */
import { Buffer } from 'buffer'
import JSZip from 'jszip'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEnsureFolder, mockUpload, mockDelete } = vi.hoisted(() => ({
  mockEnsureFolder: vi.fn(),
  mockUpload: vi.fn(),
  mockDelete: vi.fn(),
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-folder-manager', () => ({
  ensureWorkspaceFileFolderPath: mockEnsureFolder,
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  uploadWorkspaceFile: mockUpload,
  deleteWorkspaceFile: mockDelete,
}))

import {
  decompressArchiveBufferToWorkspaceFiles,
  MAX_ARCHIVE_CENTRAL_DIR_EXTRA_BYTES,
  MAX_ARCHIVE_CENTRAL_DIR_RECORDS,
  MAX_ARCHIVE_ENTRY_BYTES,
} from '@/lib/uploads/archive'

async function buildZip(
  files: Record<string, string | Buffer>,
  opts?: { symlinks?: string[] }
): Promise<Buffer> {
  const zip = new JSZip()
  for (const [name, content] of Object.entries(files)) {
    const isLink = opts?.symlinks?.includes(name)
    zip.file(name, content, isLink ? { unixPermissions: 0o120777 } : undefined)
  }
  // platform: 'UNIX' so unixPermissions (incl. the symlink mode) round-trip,
  // mirroring how macOS/Linux `zip` authors archives.
  return Buffer.from(await zip.generateAsync({ type: 'uint8array', platform: 'UNIX' }))
}

const CD_HEADER_SIZE = 46
const EOCD_SIZE = 22

/**
 * Hand-craft a structurally valid ZIP central directory + EOCD: `records`
 * zero-name CD headers each declaring `extraPerRecord` extra-field bytes
 * (with the bytes actually present, so the walk advances correctly), and an
 * EOCD at the tail pointing at offset 0. There are no local file entries —
 * the pre-parse guard must reject before JSZip ever needs them.
 */
function craftCentralDirectory(records: number, extraPerRecord: number): Buffer {
  const recordSize = CD_HEADER_SIZE + extraPerRecord
  const buffer = Buffer.alloc(records * recordSize + EOCD_SIZE)
  for (let r = 0; r < records; r++) {
    const base = r * recordSize
    buffer.writeUInt32LE(0x02014b50, base) // central-directory file header signature
    buffer.writeUInt16LE(0, base + 28) // file name length
    buffer.writeUInt16LE(extraPerRecord, base + 30) // extra field length
    buffer.writeUInt16LE(0, base + 32) // comment length
  }
  const eocd = records * recordSize
  buffer.writeUInt32LE(0x06054b50, eocd) // EOCD signature
  buffer.writeUInt16LE(Math.min(records, 0xffff), eocd + 8) // entries on this disk
  buffer.writeUInt16LE(Math.min(records, 0xffff), eocd + 10) // total entries
  buffer.writeUInt32LE(records * recordSize, eocd + 12) // central directory size
  buffer.writeUInt32LE(0, eocd + 16) // central directory offset
  buffer.writeUInt16LE(0, eocd + 20) // comment length
  return buffer
}

beforeEach(() => {
  vi.clearAllMocks()
  mockEnsureFolder.mockResolvedValue('folder_1')
  mockDelete.mockResolvedValue(undefined)
  mockUpload.mockImplementation(async (_ws: string, _uid: string, buf: Buffer, name: string) => ({
    id: `f_${name}`,
    name,
    url: `/api/files/serve/${name}`,
    key: `workspace/ws/${name}`,
    size: buf.length,
    type: 'text/plain',
  }))
})

describe('decompressArchiveBufferToWorkspaceFiles', () => {
  it('extracts entries as workspace files under the root folder', async () => {
    const buffer = await buildZip({ 'report.txt': 'hi', 'data/sheet.csv': 'a,b' })

    const result = await decompressArchiveBufferToWorkspaceFiles(buffer, {
      workspaceId: 'ws',
      userId: 'u',
      rootFolderSegments: ['bundle'],
    })

    expect(result.extracted).toHaveLength(2)
    expect(result.skippedUnsafePaths).toEqual([])
    expect(mockUpload).toHaveBeenCalledTimes(2)
    const leafNames = mockUpload.mock.calls.map((c) => c[3]).sort()
    expect(leafNames).toEqual(['report.txt', 'sheet.csv'])
    // Entries are rooted under the archive's folder; nested paths are preserved.
    expect(mockEnsureFolder).toHaveBeenCalledWith(
      expect.objectContaining({ pathSegments: ['bundle'] })
    )
    expect(mockEnsureFolder).toHaveBeenCalledWith(
      expect.objectContaining({ pathSegments: ['bundle', 'data'] })
    )
  })

  it('rejects an archive with more central-directory records than the cap, before parsing', async () => {
    // A structurally valid central directory (EOCD-anchored) with one record more
    // than the parse-graph cap. JSZip would build one entry per record in the
    // contiguous run, so the pre-parse guard must reject before loadAsync runs —
    // and with the accurate central-directory message, not the file-count one.
    const buffer = craftCentralDirectory(MAX_ARCHIVE_CENTRAL_DIR_RECORDS + 1, 0)

    await expect(
      decompressArchiveBufferToWorkspaceFiles(buffer, { workspaceId: 'ws', userId: 'u' })
    ).rejects.toMatchObject({
      name: 'ArchiveError',
      reason: 'central_dir_too_large',
      message: expect.stringContaining(String(MAX_ARCHIVE_CENTRAL_DIR_RECORDS)),
    })
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it('rejects an archive whose central-directory extra fields exceed the byte cap, before parsing', async () => {
    // A handful of records — far below the record cap — each declaring (and
    // carrying) the maximum 0xFFFF extra-field bytes, so their sum crosses
    // MAX_ARCHIVE_CENTRAL_DIR_EXTRA_BYTES. JSZip retains one object per declared
    // extra field during loadAsync, so the guard must reject on summed extra
    // bytes, not just on record count.
    const EXTRA_PER_RECORD = 0xffff
    const records = Math.ceil(MAX_ARCHIVE_CENTRAL_DIR_EXTRA_BYTES / EXTRA_PER_RECORD) + 5
    expect(records).toBeLessThan(MAX_ARCHIVE_CENTRAL_DIR_RECORDS)
    const buffer = craftCentralDirectory(records, EXTRA_PER_RECORD)

    await expect(
      decompressArchiveBufferToWorkspaceFiles(buffer, { workspaceId: 'ws', userId: 'u' })
    ).rejects.toMatchObject({ name: 'ArchiveError', reason: 'central_dir_too_large' })
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it('extracts a zip whose STORED entry contains foreign central-directory signatures', async () => {
    // Regression: a whole-buffer signature scan would count the PK\x01\x02
    // signatures inside this stored payload (a nested archive's central
    // directory travels verbatim inside STORED entries) and falsely reject the
    // archive. The EOCD-anchored walk must ignore entry payloads entirely.
    const signatures = Buffer.alloc((MAX_ARCHIVE_CENTRAL_DIR_RECORDS + 1) * 4)
    for (let r = 0; r <= MAX_ARCHIVE_CENTRAL_DIR_RECORDS; r++) {
      signatures.writeUInt32LE(0x02014b50, r * 4)
    }
    const zip = new JSZip()
    zip.file('inner.zip', signatures, { compression: 'STORE' })
    const buffer = Buffer.from(await zip.generateAsync({ type: 'uint8array' }))

    const result = await decompressArchiveBufferToWorkspaceFiles(buffer, {
      workspaceId: 'ws',
      userId: 'u',
    })

    expect(result.extracted).toHaveLength(1)
    expect(mockUpload).toHaveBeenCalledTimes(1)
  })

  it('uploads nothing when an entry is corrupted mid-archive (all-or-nothing)', async () => {
    // Corrupt one entry's DEFLATE bytes AFTER the central directory is built, so
    // loadAsync parses fine and only streaming inflation fails. The validation
    // pass must catch it before ANY entry is uploaded, and the raw zlib error
    // must surface as the module's ArchiveError, not leak through.
    const zip = new JSZip()
    zip.file('fine.txt', 'this entry is intact')
    // Incompressible payload so the DEFLATE stream is large enough to stomp
    // without touching the following records.
    zip.file('bad.bin', Buffer.from(Array.from({ length: 20000 }, (_, i) => (i * 137) % 251)))
    const buffer = Buffer.from(
      await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
    )
    const nameOffset = buffer.indexOf(Buffer.from('bad.bin'))
    // Local file header: name follows the 30-byte fixed header; data follows the
    // name (+ extra field, empty here). Stomp a chunk of the DEFLATE stream.
    buffer.fill(0xff, nameOffset + 'bad.bin'.length, nameOffset + 'bad.bin'.length + 256)

    await expect(
      decompressArchiveBufferToWorkspaceFiles(buffer, { workspaceId: 'ws', userId: 'u' })
    ).rejects.toMatchObject({ name: 'ArchiveError', reason: 'invalid' })
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it('rolls back already-uploaded files when an upload fails mid-extraction', async () => {
    // Pass 1 validates caps, but an upload itself can still fail mid-loop
    // (storage/DB error, quota crossed). Every file written before the failure
    // must be deleted so callers and retries never observe a partial tree.
    const buffer = await buildZip({ 'a.txt': 'first', 'b.txt': 'second', 'c.txt': 'third' })
    mockUpload
      .mockResolvedValueOnce({ id: 'f_a', name: 'a.txt', url: '/a', key: 'k/a', size: 5 })
      .mockResolvedValueOnce({ id: 'f_b', name: 'b.txt', url: '/b', key: 'k/b', size: 6 })
      .mockRejectedValueOnce(new Error('storage quota exceeded'))

    await expect(
      decompressArchiveBufferToWorkspaceFiles(buffer, { workspaceId: 'ws', userId: 'u' })
    ).rejects.toThrow('storage quota exceeded')

    expect(mockDelete).toHaveBeenCalledTimes(2)
    expect(mockDelete).toHaveBeenCalledWith('ws', 'f_a')
    expect(mockDelete).toHaveBeenCalledWith('ws', 'f_b')
  })

  it('does not count noise entries toward the extraction cap when they are being skipped', async () => {
    // macOS Finder zips carry a __MACOSX/._* shadow per file, doubling the raw
    // entry count. 501 files + 501 shadows = 1002 raw entries — over the
    // 1000-file cap — but with skipNoiseEntries set only the 501 real files are
    // extracted, so the archive must be accepted.
    const files: Record<string, string> = {}
    for (let i = 0; i < 501; i++) {
      files[`f${i}.txt`] = 'x'
      files[`__MACOSX/._f${i}.txt`] = 'shadow'
    }
    const buffer = await buildZip(files)

    const result = await decompressArchiveBufferToWorkspaceFiles(buffer, {
      workspaceId: 'ws',
      userId: 'u',
      skipNoiseEntries: true,
    })

    expect(result.extracted).toHaveLength(501)
    expect(result.skipped).toBe(501)
  })

  it('throws ArchiveError invalid for a non-zip buffer (no files written)', async () => {
    await expect(
      decompressArchiveBufferToWorkspaceFiles(Buffer.from('not a zip at all'), {
        workspaceId: 'ws',
        userId: 'u',
      })
    ).rejects.toMatchObject({ name: 'ArchiveError', reason: 'invalid' })
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it('excludes symlinks (uncounted) and skips zip-slip traversal (counted in skipped)', async () => {
    const buffer = await buildZip(
      {
        'safe.txt': 'ok',
        '..\\evil.txt': 'evil',
        'link.txt': '/etc/passwd',
      },
      { symlinks: ['link.txt'] }
    )

    const result = await decompressArchiveBufferToWorkspaceFiles(buffer, {
      workspaceId: 'ws',
      userId: 'u',
    })

    // Only the traversal entry counts toward `skipped`; the symlink is filtered
    // out before the skip tally (it never becomes a candidate entry). The
    // traversal entry's raw name is preserved for the callers' forensic logs.
    expect(result.extracted).toHaveLength(1)
    expect(result.skipped).toBe(1)
    expect(result.skippedUnsafePaths).toEqual(['..\\evil.txt'])
    expect(mockUpload).toHaveBeenCalledTimes(1)
    expect(mockUpload.mock.calls[0][3]).toBe('safe.txt')
  })

  it('extracts macOS/Windows filesystem-noise entries by default (skipNoiseEntries unset)', async () => {
    const buffer = await buildZip({ '__MACOSX/a.txt': 'x', '.DS_Store': 'y' })

    const result = await decompressArchiveBufferToWorkspaceFiles(buffer, {
      workspaceId: 'ws',
      userId: 'u',
    })

    // Parity with the HTTP decompress route, which extracts these verbatim.
    expect(result.extracted).toHaveLength(2)
    expect(result.skipped).toBe(0)
    expect(mockUpload).toHaveBeenCalledTimes(2)
  })

  it('drops filesystem-noise entries when skipNoiseEntries is set', async () => {
    const buffer = await buildZip({ '__MACOSX/a.txt': 'x', '.DS_Store': 'y' })

    const result = await decompressArchiveBufferToWorkspaceFiles(buffer, {
      workspaceId: 'ws',
      userId: 'u',
      skipNoiseEntries: true,
    })

    expect(result.extracted).toEqual([])
    expect(result.skipped).toBe(2)
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it('rejects an entry whose declared size exceeds the per-entry cap', async () => {
    const zip = new JSZip()
    // Highly compressible zeros keep the archive tiny on disk while the declared
    // uncompressed size blows past the per-entry cap.
    zip.file('big.bin', Buffer.alloc(MAX_ARCHIVE_ENTRY_BYTES + 1024))
    const buffer = Buffer.from(
      await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
    )

    await expect(
      decompressArchiveBufferToWorkspaceFiles(buffer, { workspaceId: 'ws', userId: 'u' })
    ).rejects.toMatchObject({ name: 'ArchiveError', reason: 'entry_too_large' })
    expect(mockUpload).not.toHaveBeenCalled()
  })
})
