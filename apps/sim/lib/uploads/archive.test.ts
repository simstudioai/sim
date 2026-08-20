/**
 * @vitest-environment node
 */
import { Buffer } from 'buffer'
import JSZip from 'jszip'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The workspace-file store is faked in memory rather than stubbed, because the
 * defects this suite guards against live in the *contract* between the extractor
 * and the folder/file layers, not in the extractor's own arithmetic. The fake
 * therefore enforces the real rules:
 *
 * - folder keys are built with the production {@link buildFolderPath}, so a segment
 *   that needs encoding is rejected or encoded exactly as the folder layer would;
 * - `exactName: true` throws `FileConflictError` on a duplicate leaf name, while
 *   `exactName: false` auto-suffixes, mirroring `uploadWorkspaceFile`.
 */
const { store, mockUpload, mockPurge, mockEnsureFolder, mockArchiveFolderIfEmpty, mockNotify } =
  vi.hoisted(() => ({
    store: {
      folderIdByPath: new Map<string, string>(),
      fileKeys: new Set<string>(),
      blockedFolderIds: new Set<string>(),
      /** Paths passed to the folder-delete operation, in call order. */
      deletedFolderPaths: [] as string[],
      sequence: 0,
    },
    mockUpload: vi.fn(),
    mockPurge: vi.fn(),
    mockEnsureFolder: vi.fn(),
    mockArchiveFolderIfEmpty: vi.fn(),
    mockNotify: vi.fn(),
  }))
vi.mock('@/lib/realtime/notify', () => ({ notifyWorkspaceFilesChanged: mockNotify }))
vi.mock('@/lib/workspace-files/application/workspace-file-folders', () => ({
  ensureWorkspaceFileFolderPathOperation: { execute: mockEnsureFolder },
}))
vi.mock('@/lib/workspace-files/application/create-workspace-file', () => ({
  createWorkspaceFileFromBuffer: {
    execute: mockUpload,
  },
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  purgeCreatedWorkspaceFile: mockPurge,
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-folder-manager', () => ({
  archiveWorkspaceFileFolderIfEmpty: mockArchiveFolderIfEmpty,
}))

import {
  buildFolderPath,
  MAX_FOLDER_PATH_BYTES,
  MAX_FOLDER_PATH_SEGMENTS,
} from '@/lib/folders/paths'
import {
  decompressArchiveBufferToWorkspaceFiles,
  MAX_ARCHIVE_CENTRAL_DIR_EXTRA_BYTES,
  MAX_ARCHIVE_CENTRAL_DIR_RECORDS,
  MAX_ARCHIVE_ENTRY_BYTES,
} from '@/lib/uploads/archive'
import { MAX_WORKSPACE_FILE_BULK_AFFECTED_ITEMS } from '@/lib/workspace-files/limits'

const TEST_PRINCIPAL = {
  kind: 'session',
  userId: 'u',
  sessionId: 'session-1',
} as const

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

/** Mirrors `allocateUniqueWorkspaceFileName`'s " (n)" suffixing. */
function allocateUniqueName(folderKey: string, name: string): string {
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  const extension = dot > 0 ? name.slice(dot) : ''
  for (let attempt = 1; ; attempt++) {
    const candidate = `${base} (${attempt})${extension}`
    if (!store.fileKeys.has(`${folderKey}|${candidate}`)) return candidate
  }
}

/** Reverse lookup of the fake folder store: id -> path, or `undefined` if gone. */
function folderPathById(folderId: string | undefined): string | undefined {
  for (const [path, id] of store.folderIdByPath) {
    if (id === folderId) return path
  }
  return undefined
}

/** Pre-seeds a folder chain that existed before extraction ran. */
function seedExistingFolders(...paths: string[][]): void {
  for (const segments of paths) {
    store.folderIdByPath.set(buildFolderPath(segments), `preexisting_${++store.sequence}`)
  }
}

/** Pre-seeds an already-existing workspace file so a later leaf name collides. */
function seedExistingFile(folderId: string | null, name: string): void {
  store.fileKeys.add(`${folderId ?? ''}|${name}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  store.folderIdByPath.clear()
  store.fileKeys.clear()
  store.blockedFolderIds.clear()
  store.deletedFolderPaths.length = 0
  store.sequence = 0

  mockEnsureFolder.mockImplementation(async ({ input }: { input: { pathSegments: string[] } }) => {
    let folderId: string | null = null
    const walked: string[] = []
    // Only the segments this call actually inserts are reported as created; a
    // segment resolved from the store was reused and must never be rolled back.
    const createdFolderIds: string[] = []
    for (const segment of input.pathSegments) {
      walked.push(segment)
      const path = buildFolderPath(walked)
      const existing = store.folderIdByPath.get(path)
      if (existing) {
        folderId = existing
        continue
      }
      folderId = `folder_${++store.sequence}`
      store.folderIdByPath.set(path, folderId)
      createdFolderIds.push(folderId)
    }
    return { folderId, createdFolderIds }
  })

  mockArchiveFolderIfEmpty.mockImplementation(async ({ folderId }: { folderId: string }) => {
    const path = folderPathById(folderId)
    if (!path) throw new Error('Folder not found')
    const hasChild = [...store.folderIdByPath.keys()].some((candidate) =>
      candidate.startsWith(`${path}/`)
    )
    if (store.blockedFolderIds.has(folderId) || hasChild) throw new Error('Folder is not empty')
    store.deletedFolderPaths.push(path)
    store.folderIdByPath.delete(path)
    return true
  })

  mockPurge.mockResolvedValue(true)
  mockNotify.mockResolvedValue(undefined)
  mockUpload.mockImplementation(
    async ({
      input,
    }: {
      input: { content: Buffer; name: string; folderId?: string | null; exactName: boolean }
    }) => {
      const folderKey = input.folderId ?? ''
      let name = input.name
      if (store.fileKeys.has(`${folderKey}|${name}`)) {
        if (input.exactName) {
          const conflict = new Error(`A file named "${name}" already exists`)
          conflict.name = 'FileConflictError'
          throw conflict
        }
        name = allocateUniqueName(folderKey, name)
      }
      store.fileKeys.add(`${folderKey}|${name}`)
      return {
        file: {
          id: `f_${name}`,
          name,
          url: `/api/files/serve/${name}`,
          key: `workspace/ws/${name}`,
          size: input.content.length,
          type: 'text/plain',
        },
      }
    }
  )
})

describe('decompressArchiveBufferToWorkspaceFiles', () => {
  it('extracts entries as workspace files under the root folder', async () => {
    const buffer = await buildZip({ 'report.txt': 'hi', 'data/sheet.csv': 'a,b' })

    const result = await decompressArchiveBufferToWorkspaceFiles(buffer, {
      workspaceId: 'ws',
      principal: TEST_PRINCIPAL,
      rootFolderSegments: ['bundle'],
    })

    expect(result.extracted).toHaveLength(2)
    expect(result.skippedUnsafePaths).toEqual([])
    expect(mockUpload).toHaveBeenCalledTimes(2)
    expect(mockNotify).toHaveBeenCalledOnce()
    expect(mockNotify).toHaveBeenCalledWith('ws')
    const leafNames = mockUpload.mock.calls.map(([args]) => args.input.name).sort()
    expect(leafNames).toEqual(['report.txt', 'sheet.csv'])
    // Entries are rooted under the archive's folder; nested paths are preserved.
    expect(mockEnsureFolder).toHaveBeenCalledWith(
      expect.objectContaining({ input: { workspaceId: 'ws', pathSegments: ['bundle'] } })
    )
    expect(mockEnsureFolder).toHaveBeenCalledWith(
      expect.objectContaining({ input: { workspaceId: 'ws', pathSegments: ['bundle', 'data'] } })
    )
    // Every folder in the chain is materialized, intermediates included.
    expect([...store.folderIdByPath.keys()].sort()).toEqual(['/bundle', '/bundle/data'])
  })

  it('creates intermediate folders for a deeply nested archive', async () => {
    // `createWorkspaceFileFolderAtPath` semantics would ask for the full leaf path
    // whose parents were never created and fail with "Parent folder not found";
    // extraction must ensure the whole chain instead.
    const buffer = await buildZip({ 'src/deep/nested/leaf.txt': 'x' })

    const result = await decompressArchiveBufferToWorkspaceFiles(buffer, {
      workspaceId: 'ws',
      principal: TEST_PRINCIPAL,
      rootFolderSegments: ['bundle'],
    })

    expect(result.extracted).toHaveLength(1)
    expect([...store.folderIdByPath.keys()].sort()).toEqual([
      '/bundle',
      '/bundle/src',
      '/bundle/src/deep',
      '/bundle/src/deep/nested',
    ])
    expect(mockUpload.mock.calls[0][0].input.folderId).toBe(
      store.folderIdByPath.get('/bundle/src/deep/nested')
    )
  })

  it('reuses a folder that already exists instead of failing on conflict', async () => {
    // Two entries in the same directory, plus a directory that a previous
    // extraction already created — neither may raise a folder conflict.
    store.folderIdByPath.set('/bundle', 'preexisting-folder')
    const buffer = await buildZip({ 'top.txt': 't', 'docs/a.txt': 'a', 'docs/b.txt': 'b' })

    const result = await decompressArchiveBufferToWorkspaceFiles(buffer, {
      workspaceId: 'ws',
      principal: TEST_PRINCIPAL,
      rootFolderSegments: ['bundle'],
    })

    expect(result.extracted).toHaveLength(3)
    expect([...store.folderIdByPath.keys()].sort()).toEqual(['/bundle', '/bundle/docs'])
    expect(store.folderIdByPath.get('/bundle')).toBe('preexisting-folder')
    const folderIdByFileName = new Map(
      mockUpload.mock.calls.map(([args]) => [args.input.name, args.input.folderId])
    )
    expect(folderIdByFileName.get('top.txt')).toBe('preexisting-folder')
    expect(folderIdByFileName.get('a.txt')).toBe(store.folderIdByPath.get('/bundle/docs'))
    expect(folderIdByFileName.get('b.txt')).toBe(store.folderIdByPath.get('/bundle/docs'))
  })

  it('extracts into a folder whose name needs path encoding', async () => {
    // A space (and other reserved characters) must never be handed to the folder
    // layer as a raw path segment — `parseFolderPath` round-trip-checks the
    // encoding and rejects "my report" while accepting "my%20report".
    const buffer = await buildZip({ 'my report/q1 & q2.txt': 'x' })

    const result = await decompressArchiveBufferToWorkspaceFiles(buffer, {
      workspaceId: 'ws',
      principal: TEST_PRINCIPAL,
      rootFolderSegments: ['bundle v2'],
    })

    expect(result.extracted).toHaveLength(1)
    expect([...store.folderIdByPath.keys()].sort()).toEqual([
      '/bundle%20v2',
      '/bundle%20v2/my%20report',
    ])
    expect(mockUpload.mock.calls[0][0].input.name).toBe('q1 & q2.txt')
  })

  it('auto-suffixes a leaf whose name already exists instead of rolling back', async () => {
    // One colliding name must not destroy an otherwise valid extraction: the
    // upload layer allocates a unique name, nothing is deleted, and every entry
    // still lands.
    seedExistingFile(null, 'report.txt')
    const buffer = await buildZip({ 'report.txt': 'hi', 'other.txt': 'yo' })

    const result = await decompressArchiveBufferToWorkspaceFiles(buffer, {
      workspaceId: 'ws',
      principal: TEST_PRINCIPAL,
    })

    expect(result.extracted.map((file) => file.name).sort()).toEqual([
      'other.txt',
      'report (1).txt',
    ])
    expect(mockPurge).not.toHaveBeenCalled()
  })

  it('marks extracted files unknown when an archive has secret provenance', async () => {
    const buffer = await buildZip({ 'one.txt': 'one', 'two.txt': 'two' })
    const secretProvenance = {
      status: 'exact' as const,
      entries: [{ name: 'TOKEN', encryptedValue: 'encrypted-token' }],
    }

    await decompressArchiveBufferToWorkspaceFiles(buffer, {
      workspaceId: 'ws',
      principal: TEST_PRINCIPAL,
      secretProvenance,
    })

    expect(mockUpload).toHaveBeenCalledTimes(2)
    for (const call of mockUpload.mock.calls) {
      expect(call[0].input).toEqual(
        expect.objectContaining({
          secretProvenance: { status: 'unknown' },
          notifyWorkspaceChange: false,
        })
      )
    }
  })

  it('preserves an exact-empty classification across extraction', async () => {
    const buffer = await buildZip({ 'one.txt': 'one' })

    await decompressArchiveBufferToWorkspaceFiles(buffer, {
      workspaceId: 'ws',
      principal: TEST_PRINCIPAL,
      secretProvenance: { status: 'exact', entries: [] },
    })

    expect(mockUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: TEST_PRINCIPAL,
        input: expect.objectContaining({
          workspaceId: 'ws',
          name: 'one.txt',
          contentType: 'text/plain',
          secretProvenance: { status: 'exact', entries: [] },
        }),
      })
    )
  })

  it('rejects an archive with more central-directory records than the cap, before parsing', async () => {
    // A structurally valid central directory (EOCD-anchored) with one record more
    // than the parse-graph cap. JSZip would build one entry per record in the
    // contiguous run, so the pre-parse guard must reject before loadAsync runs —
    // and with the accurate central-directory message, not the file-count one.
    const buffer = craftCentralDirectory(MAX_ARCHIVE_CENTRAL_DIR_RECORDS + 1, 0)

    await expect(
      decompressArchiveBufferToWorkspaceFiles(buffer, {
        workspaceId: 'ws',
        principal: TEST_PRINCIPAL,
      })
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
      decompressArchiveBufferToWorkspaceFiles(buffer, {
        workspaceId: 'ws',
        principal: TEST_PRINCIPAL,
      })
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
      principal: TEST_PRINCIPAL,
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
      decompressArchiveBufferToWorkspaceFiles(buffer, {
        workspaceId: 'ws',
        principal: TEST_PRINCIPAL,
      })
    ).rejects.toMatchObject({ name: 'ArchiveError', reason: 'invalid' })
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it('rolls back already-uploaded files when an upload fails mid-extraction', async () => {
    // Pass 1 validates caps, but an upload itself can still fail mid-loop
    // (storage/DB error, quota crossed). Every file written before the failure
    // must be deleted so callers and retries never observe a partial tree.
    const buffer = await buildZip({ 'a.txt': 'first', 'b.txt': 'second', 'c.txt': 'third' })
    const uploadedAt = new Date('2026-08-17T12:00:00.000Z')
    mockUpload
      .mockResolvedValueOnce({
        file: {
          id: 'f_a',
          name: 'a.txt',
          url: '/a',
          key: 'k/a',
          size: 5,
          folderId: 'folder_archive',
          updatedAt: uploadedAt,
        },
      })
      .mockResolvedValueOnce({
        file: {
          id: 'f_b',
          name: 'b.txt',
          url: '/b',
          key: 'k/b',
          size: 6,
          folderId: 'folder_archive',
          updatedAt: uploadedAt,
        },
      })
      .mockRejectedValueOnce(new Error('storage quota exceeded'))

    await expect(
      decompressArchiveBufferToWorkspaceFiles(buffer, {
        workspaceId: 'ws',
        principal: TEST_PRINCIPAL,
      })
    ).rejects.toThrow('storage quota exceeded')

    expect(mockPurge).toHaveBeenCalledTimes(2)
    expect(mockNotify).toHaveBeenCalledOnce()
    expect(mockNotify).toHaveBeenCalledWith('ws')
    expect(mockPurge).toHaveBeenCalledWith({
      workspaceId: 'ws',
      fileId: 'f_a',
      key: 'k/a',
      expectedName: 'a.txt',
      expectedFolderId: 'folder_archive',
      expectedUpdatedAt: uploadedAt,
    })
    expect(mockPurge).toHaveBeenCalledWith({
      workspaceId: 'ws',
      fileId: 'f_b',
      key: 'k/b',
      expectedName: 'b.txt',
      expectedFolderId: 'folder_archive',
      expectedUpdatedAt: uploadedAt,
    })
  })

  it('rolls back the folders it created when an upload fails mid-extraction', async () => {
    // `save_upload` refuses to re-extract into a root folder that still has any
    // child, so a folder left behind by a failed run turns every retry into
    // "already extracted" until a human deletes the tree by hand.
    const buffer = await buildZip({ 'a/one.txt': 'first', 'b/two.txt': 'second' })
    mockUpload
      .mockResolvedValueOnce({
        file: { id: 'f_one', name: 'one.txt', url: '/one', key: 'k/one', size: 5 },
      })
      .mockRejectedValueOnce(new Error('storage quota exceeded'))

    await expect(
      decompressArchiveBufferToWorkspaceFiles(buffer, {
        workspaceId: 'ws',
        principal: TEST_PRINCIPAL,
        rootFolderSegments: ['bundle'],
      })
    ).rejects.toThrow('storage quota exceeded')

    expect([...store.folderIdByPath.keys()]).toEqual([])
    expect(mockArchiveFolderIfEmpty).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws' })
    )
  })

  it('leaves a folder that already existed before the call untouched on rollback', async () => {
    // Extracting into an existing path is normal — a sibling entry, or an earlier
    // successful extraction. Deleting a reused folder would destroy unrelated data.
    seedExistingFolders(['bundle'], ['bundle', 'keep'])
    const preexistingIds = [...store.folderIdByPath.values()]
    const buffer = await buildZip({ 'keep/kept.txt': 'a', 'fresh/new.txt': 'b' })
    mockUpload
      .mockResolvedValueOnce({
        file: { id: 'f_kept', name: 'kept.txt', url: '/kept', key: 'k/kept', size: 1 },
      })
      .mockRejectedValueOnce(new Error('storage quota exceeded'))

    await expect(
      decompressArchiveBufferToWorkspaceFiles(buffer, {
        workspaceId: 'ws',
        principal: TEST_PRINCIPAL,
        rootFolderSegments: ['bundle'],
      })
    ).rejects.toThrow('storage quota exceeded')

    expect([...store.folderIdByPath.keys()].sort()).toEqual(['/bundle', '/bundle/keep'])
    expect(store.deletedFolderPaths).toEqual(['/bundle/fresh'])
    const deletedIds = mockArchiveFolderIfEmpty.mock.calls.map(([args]) => args.folderId)
    for (const preexistingId of preexistingIds) {
      expect(deletedIds).not.toContain(preexistingId)
    }
  })

  it('deletes rolled-back folders deepest-first', async () => {
    // A parent removed before its children would make the children's own deletes
    // fail (nothing left to archive), so the unwind walks creation order backwards.
    const buffer = await buildZip({ 'x/y/z/leaf.txt': 'a' })
    mockUpload.mockRejectedValueOnce(new Error('storage quota exceeded'))

    await expect(
      decompressArchiveBufferToWorkspaceFiles(buffer, {
        workspaceId: 'ws',
        principal: TEST_PRINCIPAL,
        rootFolderSegments: ['bundle'],
      })
    ).rejects.toThrow('storage quota exceeded')

    expect(store.deletedFolderPaths).toEqual([
      '/bundle/x/y/z',
      '/bundle/x/y',
      '/bundle/x',
      '/bundle',
    ])
    expect([...store.folderIdByPath.keys()]).toEqual([])
  })

  it('preserves created folders that gain collaborator content before rollback', async () => {
    const buffer = await buildZip({ 'nested/one.txt': 'first', 'nested/two.txt': 'second' })
    mockUpload
      .mockImplementationOnce(async ({ input }) => {
        store.blockedFolderIds.add(input.folderId)
        return { file: { id: 'f_one', name: 'one.txt', url: '/one', key: 'k/one', size: 5 } }
      })
      .mockRejectedValueOnce(new Error('storage quota exceeded'))

    await expect(
      decompressArchiveBufferToWorkspaceFiles(buffer, {
        workspaceId: 'ws',
        principal: TEST_PRINCIPAL,
        rootFolderSegments: ['bundle'],
      })
    ).rejects.toThrow('storage quota exceeded')

    expect([...store.folderIdByPath.keys()]).toEqual(['/bundle', '/bundle/nested'])
    expect(store.deletedFolderPaths).toEqual([])
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
      principal: TEST_PRINCIPAL,
      skipNoiseEntries: true,
    })

    expect(result.extracted).toHaveLength(501)
    expect(result.skipped).toBe(501)
  })

  it('rejects a materialized tree above the bulk-operation limit before creating its root', async () => {
    const buffer = await buildZip({ 'nested/file.txt': 'x' })
    const prepareRootFolder = vi.fn(async () => ['bundle'])

    await expect(
      decompressArchiveBufferToWorkspaceFiles(buffer, {
        workspaceId: 'ws',
        principal: TEST_PRINCIPAL,
        prepareRootFolder,
        maxMaterializedItems: 2,
      })
    ).rejects.toMatchObject({ name: 'ArchiveError', reason: 'too_many_entries' })

    expect(prepareRootFolder).not.toHaveBeenCalled()
    expect(mockEnsureFolder).not.toHaveBeenCalled()
    expect(mockUpload).not.toHaveBeenCalled()

    await expect(
      decompressArchiveBufferToWorkspaceFiles(buffer, {
        workspaceId: 'ws',
        principal: TEST_PRINCIPAL,
        prepareRootFolder,
        maxMaterializedItems: 3,
      })
    ).resolves.toMatchObject({ extracted: [expect.objectContaining({ name: 'file.txt' })] })
    expect(prepareRootFolder).toHaveBeenCalledOnce()
  })

  it.each([
    {
      label: 'too many folder segments',
      entryName: `${Array.from({ length: MAX_FOLDER_PATH_SEGMENTS + 1 }, () => 'x').join('/')}/file.txt`,
      expectedMessage: `Folder paths cannot exceed ${MAX_FOLDER_PATH_SEGMENTS} segments`,
    },
    {
      label: 'too many encoded folder-path bytes',
      entryName: `${'x'.repeat(MAX_FOLDER_PATH_BYTES)}/file.txt`,
      expectedMessage: `Folder paths cannot exceed ${MAX_FOLDER_PATH_BYTES} bytes`,
    },
  ])(
    'rejects $label before enumerating or creating folders',
    async ({ entryName, expectedMessage }) => {
      const buffer = await buildZip({ [entryName]: 'x' })
      const prepareRootFolder = vi.fn(async () => ['bundle'])

      await expect(
        decompressArchiveBufferToWorkspaceFiles(buffer, {
          workspaceId: 'ws',
          principal: TEST_PRINCIPAL,
          prepareRootFolder,
          maxMaterializedItems: 5000,
        })
      ).rejects.toMatchObject({
        name: 'ArchiveError',
        reason: 'invalid',
        message: expect.stringContaining(expectedMessage),
      })

      expect(prepareRootFolder).not.toHaveBeenCalled()
      expect(mockEnsureFolder).not.toHaveBeenCalled()
      expect(mockUpload).not.toHaveBeenCalled()
    }
  )

  it('includes the destination prefix when validating archive folder paths', async () => {
    const buffer = await buildZip({ 'nested/file.txt': 'x' })
    const prepareRootFolder = vi.fn(async () => ['unused'])

    await expect(
      decompressArchiveBufferToWorkspaceFiles(buffer, {
        workspaceId: 'ws',
        principal: TEST_PRINCIPAL,
        rootFolderSegments: Array.from(
          { length: MAX_FOLDER_PATH_SEGMENTS },
          (_, index) => `existing-${index}`
        ),
        prepareRootFolder,
      })
    ).rejects.toMatchObject({
      name: 'ArchiveError',
      reason: 'invalid',
      message: expect.stringContaining(
        `Folder paths cannot exceed ${MAX_FOLDER_PATH_SEGMENTS} segments`
      ),
    })

    expect(prepareRootFolder).not.toHaveBeenCalled()
    expect(mockEnsureFolder).not.toHaveBeenCalled()
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it('aborts mid-extraction on the caller signal and rolls the partial tree back', async () => {
    const buffer = await buildZip({ 'a.txt': 'x', 'b.txt': 'y', 'c.txt': 'z' })
    const controller = new AbortController()
    const commit = mockUpload.getMockImplementation()!
    mockUpload.mockImplementation(async (args: any) => {
      const uploaded = await commit(args)
      // Abort once the first file is committed, so rollback has something to undo.
      controller.abort()
      return uploaded
    })

    await expect(
      decompressArchiveBufferToWorkspaceFiles(buffer, {
        workspaceId: 'ws',
        principal: TEST_PRINCIPAL,
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ name: 'AbortError' })

    expect(mockUpload).toHaveBeenCalledOnce()
    expect(mockPurge).toHaveBeenCalledOnce()
    expect(mockPurge).toHaveBeenCalledWith(expect.objectContaining({ expectedName: 'a.txt' }))
  })

  it('applies the workspace bulk limit by default, so every caller is bounded', async () => {
    // 1000 files, each under six folders unique to it: 7000 materialized items from an entry
    // count that is itself within MAX_ARCHIVE_ENTRIES. No caller opts in to this cap.
    const entries: Record<string, string> = {}
    for (let index = 0; index < 1000; index += 1) {
      entries[`a${index}/b/c/d/e/f/file.txt`] = 'x'
    }
    const buffer = await buildZip(entries)

    await expect(
      decompressArchiveBufferToWorkspaceFiles(buffer, {
        workspaceId: 'ws',
        principal: TEST_PRINCIPAL,
      })
    ).rejects.toMatchObject({
      name: 'ArchiveError',
      reason: 'too_many_entries',
      message: expect.stringContaining(`the maximum is ${MAX_WORKSPACE_FILE_BULK_AFFECTED_ITEMS}`),
    })

    expect(mockEnsureFolder).not.toHaveBeenCalled()
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it('re-validates the segments prepareRootFolder actually returned, before any upload', async () => {
    const buffer = await buildZip({ 'nested/file.txt': 'x' })
    // A callback that validates one path and returns a different, invalid one. The callee
    // cannot trust the callback to have checked what it returns, so it re-checks itself.
    const prepareRootFolder = vi.fn(async (validate: (segments: string[]) => void) => {
      validate(['bundle'])
      return Array.from({ length: MAX_FOLDER_PATH_SEGMENTS + 1 }, (_, index) => `deep-${index}`)
    })

    await expect(
      decompressArchiveBufferToWorkspaceFiles(buffer, {
        workspaceId: 'ws',
        principal: TEST_PRINCIPAL,
        prepareRootFolder,
      })
    ).rejects.toMatchObject({
      name: 'ArchiveError',
      reason: 'invalid',
      message: expect.stringContaining(
        `Folder paths cannot exceed ${MAX_FOLDER_PATH_SEGMENTS} segments`
      ),
    })

    expect(prepareRootFolder).toHaveBeenCalledOnce()
    expect(mockEnsureFolder).not.toHaveBeenCalled()
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it('throws ArchiveError invalid for a non-zip buffer (no files written)', async () => {
    await expect(
      decompressArchiveBufferToWorkspaceFiles(Buffer.from('not a zip at all'), {
        workspaceId: 'ws',
        principal: TEST_PRINCIPAL,
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
      principal: TEST_PRINCIPAL,
    })

    // Only the traversal entry counts toward `skipped`; the symlink is filtered
    // out before the skip tally (it never becomes a candidate entry). The
    // traversal entry's raw name is preserved for the callers' forensic logs.
    expect(result.extracted).toHaveLength(1)
    expect(result.skipped).toBe(1)
    expect(result.skippedUnsafePaths).toEqual(['..\\evil.txt'])
    expect(mockUpload).toHaveBeenCalledTimes(1)
    expect(mockUpload.mock.calls[0][0].input.name).toBe('safe.txt')
  })

  it('extracts macOS/Windows filesystem-noise entries by default (skipNoiseEntries unset)', async () => {
    const buffer = await buildZip({ '__MACOSX/a.txt': 'x', '.DS_Store': 'y' })

    const result = await decompressArchiveBufferToWorkspaceFiles(buffer, {
      workspaceId: 'ws',
      principal: TEST_PRINCIPAL,
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
      principal: TEST_PRINCIPAL,
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
      decompressArchiveBufferToWorkspaceFiles(buffer, {
        workspaceId: 'ws',
        principal: TEST_PRINCIPAL,
      })
    ).rejects.toMatchObject({ name: 'ArchiveError', reason: 'entry_too_large' })
    expect(mockUpload).not.toHaveBeenCalled()
  })
})
