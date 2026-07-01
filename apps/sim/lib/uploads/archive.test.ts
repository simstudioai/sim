/**
 * @vitest-environment node
 */
import { Buffer } from 'buffer'
import JSZip from 'jszip'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEnsureFolder, mockUpload } = vi.hoisted(() => ({
  mockEnsureFolder: vi.fn(),
  mockUpload: vi.fn(),
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-folder-manager', () => ({
  ensureWorkspaceFileFolderPath: mockEnsureFolder,
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  uploadWorkspaceFile: mockUpload,
}))

import {
  decompressArchiveBufferToWorkspaceFiles,
  MAX_ARCHIVE_CENTRAL_DIR_EXTRA_BYTES,
  MAX_ARCHIVE_CENTRAL_DIR_RECORDS,
  MAX_ARCHIVE_ENTRY_BYTES,
} from '@/lib/uploads/archive'

async function buildZip(
  files: Record<string, string>,
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

beforeEach(() => {
  vi.clearAllMocks()
  mockEnsureFolder.mockResolvedValue('folder_1')
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
    // The canonical, per-segment-encoded VFS path the files were written under.
    expect(result.rootFolderPath).toBe('files/bundle')
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

  it('returns the encoded root folder path for names that need encoding', async () => {
    const buffer = await buildZip({ 'a.txt': 'x' })

    const result = await decompressArchiveBufferToWorkspaceFiles(buffer, {
      workspaceId: 'ws',
      userId: 'u',
      rootFolderSegments: ['My Archive'],
    })

    expect(result.rootFolderPath).toBe('files/My%20Archive')
  })

  it('rejects an archive with more central-directory records than the cap, before parsing', async () => {
    // One 32-byte central-directory header per record, laid out non-contiguously
    // (a full fixed-size header apart) so the signature scan strides one header
    // at a time and reads each record's real extra-field-length field — here a
    // hard 0 — instead of misreading a neighboring signature's bytes. That keeps
    // summed extra bytes at exactly 0, so this archive trips the RECORD cap and
    // never the extra-bytes cap, isolating record-count regression coverage.
    // JSZip would build one entry per signature it finds (ignoring the EOCD
    // count), so the pre-scan must reject this before loadAsync ever runs.
    const BLOCK_SIZE = 32
    const records = MAX_ARCHIVE_CENTRAL_DIR_RECORDS + 1
    const buffer = Buffer.alloc(records * BLOCK_SIZE)
    for (let r = 0; r < records; r++) {
      const base = r * BLOCK_SIZE
      // bytes 0-3: PK\x01\x02 central-directory file header signature
      buffer[base] = 0x50
      buffer[base + 1] = 0x4b
      buffer[base + 2] = 0x01
      buffer[base + 3] = 0x02
      // bytes 30-31: extra field length = 0 (little-endian) → adds zero toward
      // MAX_ARCHIVE_CENTRAL_DIR_EXTRA_BYTES, so only the record cap can trip.
      buffer.writeUInt16LE(0, base + 30)
    }

    await expect(
      decompressArchiveBufferToWorkspaceFiles(buffer, { workspaceId: 'ws', userId: 'u' })
    ).rejects.toMatchObject({ name: 'ArchiveError', reason: 'too_many_entries' })
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it('rejects an archive whose central-directory extra fields exceed the byte cap, before parsing', async () => {
    // A handful of central-directory headers — far below the record cap — each
    // declaring the maximum 0xFFFF extra-field length, so their summed extra
    // bytes cross MAX_ARCHIVE_CENTRAL_DIR_EXTRA_BYTES. JSZip would allocate one
    // retained object per declared extra field during loadAsync, so the pre-scan
    // must reject on summed extra bytes, not just on record count.
    const BLOCK_SIZE = 32
    const EXTRA_PER_RECORD = 0xffff
    // +5 records of headroom past the cap; still << MAX_ARCHIVE_CENTRAL_DIR_RECORDS
    // so THIS cap (extra bytes), not the record count, is what triggers rejection.
    const records = Math.ceil(MAX_ARCHIVE_CENTRAL_DIR_EXTRA_BYTES / EXTRA_PER_RECORD) + 5
    expect(records).toBeLessThan(MAX_ARCHIVE_CENTRAL_DIR_RECORDS)
    const buffer = Buffer.alloc(records * BLOCK_SIZE)
    for (let r = 0; r < records; r++) {
      const base = r * BLOCK_SIZE
      // bytes 0-3: PK\x01\x02 central-directory file header signature
      buffer[base] = 0x50
      buffer[base + 1] = 0x4b
      buffer[base + 2] = 0x01
      buffer[base + 3] = 0x02
      // bytes 30-31: extra field length = 0xFFFF (little-endian), the CD max
      buffer.writeUInt16LE(EXTRA_PER_RECORD, base + 30)
    }

    await expect(
      decompressArchiveBufferToWorkspaceFiles(buffer, { workspaceId: 'ws', userId: 'u' })
    ).rejects.toMatchObject({ name: 'ArchiveError', reason: 'too_many_entries' })
    expect(mockUpload).not.toHaveBeenCalled()
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
    // out before the skip tally (it never becomes a candidate entry).
    expect(result.extracted).toHaveLength(1)
    expect(result.skipped).toBe(1)
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
