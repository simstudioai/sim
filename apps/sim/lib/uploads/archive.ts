import { Buffer } from 'buffer'
import type { Readable } from 'stream'
import JSZip from 'jszip'
import { encodeVfsPathSegments } from '@/lib/copilot/vfs/path-utils'
import { ensureWorkspaceFileFolderPath } from '@/lib/uploads/contexts/workspace/workspace-file-folder-manager'
import { uploadWorkspaceFile } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { getFileExtension, getMimeTypeFromExtension } from '@/lib/uploads/utils/file-utils'
import type { UserFile } from '@/executor/types'

/**
 * Shared, zip-bomb / zip-slip safe archive primitives plus the one-shot
 * "decompress into workspace files/" extractor.
 *
 * The declared sizes in a ZIP header are attacker-controlled, so the real caps
 * are always enforced on the inflated byte stream — never on metadata. The
 * parser's object graph is additionally bounded BEFORE parsing via
 * {@link centralDirExceedsCaps}, which counts central-directory signatures
 * (JSZip builds one entry per signature it finds, NOT per the EOCD's declared
 * count) and sums their declared extra-field bytes (JSZip retains one object per
 * central-directory extra field) so a crafted archive — whether packed with
 * millions of records or a handful of records stuffed with tiny extra fields —
 * cannot balloon the parser's heap. Extraction is sequential (one entry inflated
 * and uploaded at a time) so peak memory is ~one entry.
 */

/** Input archive download/size cap. */
export const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024
/** Maximum number of entries extracted from a single archive. */
export const MAX_ARCHIVE_ENTRIES = 1000
/** Maximum uncompressed size for any single archive entry. */
export const MAX_ARCHIVE_ENTRY_BYTES = 100 * 1024 * 1024
/** Maximum total uncompressed size across all entries, to bound zip-bomb expansion. */
export const MAX_ARCHIVE_TOTAL_BYTES = 200 * 1024 * 1024

const S_IFMT = 0o170000
const S_IFLNK = 0o120000

const CD_SIGNATURE = Buffer.from([0x50, 0x4b, 0x01, 0x02]) // PK\x01\x02 central-directory file header
/** Memory bound for the parse-time object graph (distinct from the file-extraction cap). */
export const MAX_ARCHIVE_CENTRAL_DIR_RECORDS = 10_000
/**
 * Cap on the summed declared extra-field bytes across all central-directory
 * records. JSZip allocates one object per CD extra field (>= 4 bytes each), so
 * bounding the summed extra-field bytes bounds the parse-time object graph even
 * when the record count is tiny (one record may declare up to 65535 extra bytes
 * ≈ 16k tiny fields). Legit archives use only tens of bytes/entry, so 4MB is
 * generous headroom.
 */
export const MAX_ARCHIVE_CENTRAL_DIR_EXTRA_BYTES = 4 * 1024 * 1024

/** Reason a {@link ArchiveError} was raised, for mapping to a caller response. */
type ArchiveErrorReason = 'invalid' | 'too_many_entries' | 'entry_too_large' | 'total_too_large'

/** Raised for malformed archives and cap violations so callers can surface a clear message. */
export class ArchiveError extends Error {
  readonly reason: ArchiveErrorReason
  readonly entryName?: string

  constructor(reason: ArchiveErrorReason, message: string, entryName?: string) {
    super(message)
    this.name = 'ArchiveError'
    this.reason = reason
    this.entryName = entryName
  }
}

/**
 * True when the archive's central directory would push JSZip's parse-time object
 * graph past a safe bound. A single pass over every `PK\x01\x02` signature bounds
 * TWO independent memory vectors:
 *   - RECORD COUNT: JSZip builds one ZipEntry per CD signature it finds (it does
 *     NOT trust the EOCD count), so counting signatures bounds the entry graph.
 *   - EXTRA-FIELD BYTES: `readExtraFields` retains one `{id,length,value}` object
 *     per extra field, and every extra field is >= 4 bytes, so the summed declared
 *     extra-field length is an upper bound on those objects. Record count alone
 *     does NOT bound this — one record may declare up to 65535 extra bytes — so
 *     the extra-field cap is enforced separately.
 *
 * This is a conservative UPPER bound on JSZip's real allocation: JSZip only builds
 * entries for the contiguous run of signatures starting at the EOCD's
 * centralDirOffset, so counting ALL signatures and summing ALL their declared
 * extra lengths is always >= what JSZip allocates. That makes it immune to a
 * lied/absent EOCD count and to ZIP64 (the CD file-header signature is unchanged
 * there). Over-counting only ever rejects, which is safe.
 */
function centralDirExceedsCaps(buffer: Buffer): boolean {
  let records = 0
  let extraBytes = 0
  for (let i = buffer.indexOf(CD_SIGNATURE); i !== -1; i = buffer.indexOf(CD_SIGNATURE, i + 4)) {
    records += 1
    // The CD header's uint16 LE "extra field length" lives at offset +30; only
    // read it when the fixed-size header's extra-length field is fully present.
    if (i + 32 <= buffer.length) {
      extraBytes += buffer.readUInt16LE(i + 30)
    }
    if (
      records > MAX_ARCHIVE_CENTRAL_DIR_RECORDS ||
      extraBytes > MAX_ARCHIVE_CENTRAL_DIR_EXTRA_BYTES
    ) {
      return true
    }
  }
  return false
}

/**
 * Read a zip entry's declared uncompressed size without materializing it. Comes
 * straight from (attacker-controlled) ZIP metadata, so it is only a cheap
 * fast-reject for honestly-declared archives — never the authoritative cap.
 */
const readEntryUncompressedSize = (entry: JSZip.JSZipObject): number | undefined => {
  const data = (entry as JSZip.JSZipObject & { _data?: { uncompressedSize?: number } })._data
  const size = data?.uncompressedSize
  return typeof size === 'number' && Number.isFinite(size) ? size : undefined
}

type InflateResult = { ok: true; buffer: Buffer } | { ok: false; reason: 'entry' | 'total' }

/**
 * Inflate a single zip entry through a streaming counting sink, tearing the
 * stream down the moment cumulative output would exceed the per-entry cap or the
 * remaining total budget. The declared uncompressed size is NOT trusted:
 * enforcement happens on the actual inflated bytes as they arrive, so peak memory
 * is bounded by the cap plus one DEFLATE chunk.
 */
const inflateEntryWithinCaps = (
  entry: JSZip.JSZipObject,
  remainingTotalBudget: number
): Promise<InflateResult> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let settled = false
    const stream = entry.nodeStream() as Readable

    const settle = (result: InflateResult) => {
      if (settled) return
      settled = true
      stream.destroy()
      resolve(result)
    }

    stream.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_ARCHIVE_ENTRY_BYTES) {
        settle({ ok: false, reason: 'entry' })
        return
      }
      if (size > remainingTotalBudget) {
        settle({ ok: false, reason: 'total' })
        return
      }
      chunks.push(chunk)
    })
    stream.on('end', () => settle({ ok: true, buffer: Buffer.concat(chunks, size) }))
    stream.on('error', (error) => {
      if (settled) return
      settled = true
      stream.destroy()
      reject(error)
    })
  })

/** True when a zip entry's unix mode marks it as a symlink (never extracted). */
const isSymlinkEntry = (entry: JSZip.JSZipObject): boolean => {
  const mode = (entry as JSZip.JSZipObject & { unixPermissions?: number | null }).unixPermissions
  return typeof mode === 'number' && (mode & S_IFMT) === S_IFLNK
}

/**
 * Normalize a zip entry path into safe segments, guarding against zip-slip.
 * Returns null for traversal (`..`) and empty paths so the entry is skipped.
 */
const sanitizeArchiveEntryPath = (rawPath: string): string[] | null => {
  const segments = rawPath
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== '.')

  if (segments.length === 0 || segments.includes('..')) return null
  return segments
}

/** Filesystem cruft that should never surface as a readable archive entry. */
const isArchiveNoiseEntry = (segments: string[]): boolean => {
  if (segments[0] === '__MACOSX') return true
  const leaf = segments[segments.length - 1]
  return leaf === '.DS_Store' || leaf === 'Thumbs.db'
}

interface DecompressResult {
  /** Workspace files created under the target folder, in extraction order. */
  extracted: UserFile[]
  /** Count of entries skipped as unsafe (zip-slip) or filesystem noise. */
  skipped: number
  /**
   * Canonical, per-segment-encoded VFS path of the root folder the archive was
   * extracted into (e.g. `files/My%20Archive`), or `files` for the workspace
   * root. Matches what the workspace VFS serves, so the glob/read hint built
   * from it resolves to the files that were just written.
   */
  rootFolderPath: string
}

/**
 * Decompress an archive buffer into workspace files under `rootFolderSegments`
 * (default: the workspace root). Reuses the same caps and zip-slip / zip-bomb /
 * symlink guards everywhere. Throws {@link ArchiveError} for an invalid archive
 * or a cap violation; returns `{ extracted: [] }` when every entry was skipped.
 *
 * Memory is bounded: the central-directory record count and summed extra-field
 * bytes are gated pre-parse, and entries are inflated and uploaded one at a time,
 * so peak working set is ~one entry (≤ the per-entry cap) regardless of how many
 * files the archive holds.
 *
 * Filesystem-noise entries (`__MACOSX/`, `.DS_Store`, `Thumbs.db`) are extracted
 * verbatim unless `skipNoiseEntries` is set — the HTTP decompress route preserves
 * them; the agent-facing extract path drops them.
 */
export async function decompressArchiveBufferToWorkspaceFiles(
  buffer: Buffer,
  opts: {
    workspaceId: string
    userId: string
    rootFolderSegments?: string[]
    skipNoiseEntries?: boolean
  }
): Promise<DecompressResult> {
  const { workspaceId, userId, rootFolderSegments = [], skipNoiseEntries = false } = opts

  if (centralDirExceedsCaps(buffer)) {
    throw new ArchiveError(
      'too_many_entries',
      `Archive has too many entries. Maximum is ${MAX_ARCHIVE_ENTRIES}.`
    )
  }

  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(buffer)
  } catch {
    throw new ArchiveError('invalid', 'Not a valid .zip archive')
  }

  const realEntries = Object.values(zip.files).filter(
    (entry) => !entry.dir && !isSymlinkEntry(entry)
  )
  if (realEntries.length > MAX_ARCHIVE_ENTRIES) {
    throw new ArchiveError(
      'too_many_entries',
      `Archive has too many entries. Maximum is ${MAX_ARCHIVE_ENTRIES}.`
    )
  }

  // Resolve safe entries first so unsafe ones never count toward the size caps.
  const safeEntries: Array<{ entry: JSZip.JSZipObject; segments: string[] }> = []
  let skipped = 0
  for (const entry of realEntries) {
    const segments = sanitizeArchiveEntryPath(entry.name)
    if (!segments || (skipNoiseEntries && isArchiveNoiseEntry(segments))) {
      skipped += 1
      continue
    }
    safeEntries.push({ entry, segments })
  }

  // Cheap declared-size fast-reject for honestly-declared archives.
  let declaredTotal = 0
  for (const { entry } of safeEntries) {
    const declaredSize = readEntryUncompressedSize(entry)
    if (declaredSize === undefined) continue
    if (declaredSize > MAX_ARCHIVE_ENTRY_BYTES) {
      throw new ArchiveError(
        'entry_too_large',
        `Archive entry "${entry.name}" is too large to extract.`,
        entry.name
      )
    }
    declaredTotal += declaredSize
    if (declaredTotal > MAX_ARCHIVE_TOTAL_BYTES) {
      throw new ArchiveError('total_too_large', 'Archive expands beyond the extraction limit.')
    }
  }

  const folderIdCache = new Map<string, string | null>()
  const extracted: UserFile[] = []
  let totalBytes = 0
  for (const { entry, segments } of safeEntries) {
    const result = await inflateEntryWithinCaps(entry, MAX_ARCHIVE_TOTAL_BYTES - totalBytes)
    if (!result.ok) {
      throw new ArchiveError(
        result.reason === 'entry' ? 'entry_too_large' : 'total_too_large',
        result.reason === 'entry'
          ? `Archive entry "${entry.name}" is too large to extract.`
          : 'Archive expands beyond the extraction limit.',
        entry.name
      )
    }
    totalBytes += result.buffer.length

    const leafName = segments[segments.length - 1]
    const folderSegments = [...rootFolderSegments, ...segments.slice(0, -1)]
    const folderKey = folderSegments.join('/')
    let folderId = folderIdCache.get(folderKey)
    if (folderId === undefined) {
      folderId = await ensureWorkspaceFileFolderPath({
        workspaceId,
        userId,
        pathSegments: folderSegments,
      })
      folderIdCache.set(folderKey, folderId)
    }

    const mimeType = getMimeTypeFromExtension(getFileExtension(leafName))
    const uploaded = await uploadWorkspaceFile(
      workspaceId,
      userId,
      result.buffer,
      leafName,
      mimeType,
      {
        folderId,
      }
    )
    extracted.push(uploaded)
  }

  // Encode the root segments the same way the workspace VFS serves folder names
  // (per-segment `encodeVfsSegment`), so the advertised path matches the files
  // that were just written rather than the raw, unencoded display name.
  const rootFolderPath =
    rootFolderSegments.length > 0 ? `files/${encodeVfsPathSegments(rootFolderSegments)}` : 'files'

  return { extracted, skipped, rootFolderPath }
}
