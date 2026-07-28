import { Buffer } from 'buffer'
import type { Readable } from 'stream'
import JSZip from 'jszip'
import { readZipCentralDirectoryStats } from '@/lib/file-parsers/zip-guard'
import { ensureWorkspaceFileFolderPath } from '@/lib/uploads/contexts/workspace/workspace-file-folder-manager'
import {
  deleteWorkspaceFile,
  uploadWorkspaceFile,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { getFileExtension, getMimeTypeFromExtension } from '@/lib/uploads/utils/file-utils'
import type { UserFile } from '@/executor/types'

/**
 * Shared, zip-bomb / zip-slip safe archive primitives plus the one-shot
 * "decompress into workspace files/" extractor.
 *
 * The declared sizes in a ZIP header are attacker-controlled, so the real caps
 * are always enforced on the inflated byte stream — never on metadata. The
 * parser's object graph is additionally bounded BEFORE parsing via
 * {@link readZipCentralDirectoryStats} (EOCD-anchored central-directory walk),
 * bounding both the record count (JSZip builds one entry per record in the
 * contiguous CD run) and the summed declared extra-field bytes (JSZip retains
 * one object per CD extra field), so a crafted archive cannot balloon the
 * parser's heap. Extraction is all-or-nothing: every entry is first inflated
 * through a counting sink (discarded, nothing persisted) to prove the archive
 * fits the caps, and only then inflated again and uploaded — so a cap violation
 * or lying header can never leave a partial tree behind. Peak memory stays ~one
 * entry in both passes.
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

/** Reason a {@link ArchiveError} was raised, for mapping to a caller response/status. */
export type ArchiveErrorReason =
  | 'invalid'
  | 'too_many_entries'
  | 'central_dir_too_large'
  | 'entry_too_large'
  | 'total_too_large'

/**
 * Raised for malformed archives and cap violations. `message` is the single
 * user-facing source of truth (caps included) — callers surface it verbatim and
 * use `reason` only for response mapping (e.g. HTTP status), never to rebuild
 * the text.
 */
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

const MB = 1024 * 1024

/**
 * Bound JSZip's parse-time object graph before handing it the buffer, using the
 * real (EOCD-anchored) central directory: record count bounds the entry graph,
 * and summed declared extra-field bytes bound the per-field objects. Throws with
 * the accurate cap in the message — these caps are parse-graph bounds, distinct
 * from {@link MAX_ARCHIVE_ENTRIES} which limits extracted files after parsing.
 */
function assertCentralDirWithinCaps(buffer: Buffer): void {
  const stats = readZipCentralDirectoryStats(buffer)
  if (!stats) {
    throw new ArchiveError(
      'invalid',
      'Not a valid .zip archive — its central directory could not be parsed.'
    )
  }
  if (stats.entryCount > MAX_ARCHIVE_CENTRAL_DIR_RECORDS) {
    throw new ArchiveError(
      'central_dir_too_large',
      `Archive central directory has ${stats.entryCount} records; the maximum that can be parsed safely is ${MAX_ARCHIVE_CENTRAL_DIR_RECORDS}.`
    )
  }
  if (stats.totalExtraFieldBytes > MAX_ARCHIVE_CENTRAL_DIR_EXTRA_BYTES) {
    throw new ArchiveError(
      'central_dir_too_large',
      `Archive central-directory metadata is too large to parse safely (over ${MAX_ARCHIVE_CENTRAL_DIR_EXTRA_BYTES / MB} MB of extra fields).`
    )
  }
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

type InflateResult =
  | { ok: true; size: number; buffer: Buffer | null }
  | { ok: false; reason: 'entry' | 'total' }

/**
 * Inflate a single zip entry through a streaming counting sink, tearing the
 * stream down the moment cumulative output would exceed the per-entry cap or the
 * remaining total budget. The declared uncompressed size is NOT trusted:
 * enforcement happens on the actual inflated bytes as they arrive, so peak memory
 * is bounded by the cap plus one DEFLATE chunk. With `retain: false` the bytes
 * are counted and discarded (the validation pass), so peak memory is ~one chunk.
 */
const inflateEntryWithinCaps = (
  entry: JSZip.JSZipObject,
  remainingTotalBudget: number,
  retain: boolean
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
      if (retain) chunks.push(chunk)
    })
    stream.on('end', () =>
      settle({ ok: true, size, buffer: retain ? Buffer.concat(chunks, size) : null })
    )
    stream.on('error', () => {
      if (settled) return
      settled = true
      stream.destroy()
      // A stream error here means the entry's compressed data is corrupt or
      // truncated (it passed the central-directory parse) — surface it under the
      // module's ArchiveError contract, not as a raw zlib error.
      reject(
        new ArchiveError(
          'invalid',
          `Archive entry "${entry.name}" could not be decompressed — the archive may be corrupted or truncated.`,
          entry.name
        )
      )
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

export interface DecompressResult {
  /** Workspace files created under the target folder, in extraction order. */
  extracted: UserFile[]
  /** Count of entries skipped as unsafe (zip-slip) or filesystem noise. */
  skipped: number
  /**
   * Raw entry paths rejected by the zip-slip sanitizer (traversal or empty),
   * so callers can log the attempted names for forensics. Noise entries
   * (`__MACOSX/`, `.DS_Store`) are counted in `skipped` but never listed here.
   */
  skippedUnsafePaths: string[]
}

/** Throw the (single-sourced) ArchiveError for a streaming cap violation. */
function throwInflateCapError(reason: 'entry' | 'total', entryName: string): never {
  if (reason === 'entry') {
    throw new ArchiveError(
      'entry_too_large',
      `Archive entry "${entryName}" is too large to extract. Maximum is ${MAX_ARCHIVE_ENTRY_BYTES / MB} MB per file.`,
      entryName
    )
  }
  throw new ArchiveError(
    'total_too_large',
    `Archive expands to more than the ${MAX_ARCHIVE_TOTAL_BYTES / MB} MB extraction limit.`,
    entryName
  )
}

/**
 * Decompress an archive buffer into workspace files under `rootFolderSegments`
 * (default: the workspace root). Reuses the same caps and zip-slip / zip-bomb /
 * symlink guards everywhere. Throws {@link ArchiveError} for an invalid archive
 * or a cap violation; returns `{ extracted: [] }` when every entry was skipped.
 *
 * All-or-nothing: pass 1 inflates every entry through a discarding counting sink
 * to enforce the per-entry and total caps on REAL inflated bytes (declared sizes
 * can lie), and nothing is uploaded until the whole archive has passed — so a
 * mid-archive violation never leaves a partial tree in the workspace. Pass 2
 * re-inflates and uploads one entry at a time. Peak memory stays ~one entry in
 * both passes; the cost is inflating twice (CPU only, bounded by the caps).
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

  assertCentralDirWithinCaps(buffer)

  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(buffer)
  } catch {
    throw new ArchiveError('invalid', 'Not a valid .zip archive.')
  }

  const realEntries = Object.values(zip.files).filter(
    (entry) => !entry.dir && !isSymlinkEntry(entry)
  )

  // Resolve safe entries first so unsafe ones never count toward the size caps.
  const safeEntries: Array<{ entry: JSZip.JSZipObject; segments: string[] }> = []
  const skippedUnsafePaths: string[] = []
  let skipped = 0
  for (const entry of realEntries) {
    const segments = sanitizeArchiveEntryPath(entry.name)
    if (!segments) {
      skippedUnsafePaths.push(entry.name)
      skipped += 1
      continue
    }
    if (skipNoiseEntries && isArchiveNoiseEntry(segments)) {
      skipped += 1
      continue
    }
    safeEntries.push({ entry, segments })
  }

  // The entry cap applies to what will actually be extracted — a macOS zip whose
  // __MACOSX/ shadows are about to be dropped must not be rejected for them.
  if (safeEntries.length > MAX_ARCHIVE_ENTRIES) {
    throw new ArchiveError(
      'too_many_entries',
      `Archive has ${safeEntries.length} files; the maximum is ${MAX_ARCHIVE_ENTRIES}.`
    )
  }

  // Cheap declared-size fast-reject for honestly-declared archives.
  let declaredTotal = 0
  for (const { entry } of safeEntries) {
    const declaredSize = readEntryUncompressedSize(entry)
    if (declaredSize === undefined) continue
    if (declaredSize > MAX_ARCHIVE_ENTRY_BYTES) throwInflateCapError('entry', entry.name)
    declaredTotal += declaredSize
    if (declaredTotal > MAX_ARCHIVE_TOTAL_BYTES) throwInflateCapError('total', entry.name)
  }

  // Pass 1 — validate: inflate every entry against the caps without retaining or
  // persisting anything, so a lying header aborts before any upload happens.
  let validatedTotal = 0
  for (const { entry } of safeEntries) {
    const result = await inflateEntryWithinCaps(
      entry,
      MAX_ARCHIVE_TOTAL_BYTES - validatedTotal,
      false
    )
    if (!result.ok) throwInflateCapError(result.reason, entry.name)
    validatedTotal += result.size
  }

  // Pass 2 — extract: the archive is proven within caps; inflate again and upload.
  // Uploads themselves can still fail mid-loop (storage/DB errors, quota crossed
  // by another writer), so a failure rolls back every file written so far —
  // callers and their retries must never observe a partial tree.
  const folderIdCache = new Map<string, string | null>()
  const extracted: UserFile[] = []
  let totalBytes = 0
  try {
    for (const { entry, segments } of safeEntries) {
      const result = await inflateEntryWithinCaps(entry, MAX_ARCHIVE_TOTAL_BYTES - totalBytes, true)
      if (!result.ok) throwInflateCapError(result.reason, entry.name)
      totalBytes += result.size
      const entryBuffer = result.buffer as Buffer

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
        entryBuffer,
        leafName,
        mimeType,
        {
          folderId,
        }
      )
      extracted.push(uploaded)
    }
  } catch (error) {
    for (const file of extracted) {
      try {
        await deleteWorkspaceFile(workspaceId, file.id)
      } catch {
        // Best-effort: a file whose cleanup fails is still soft-deletable by hand;
        // the original error is what the caller needs to see.
      }
    }
    throw error
  }

  return { extracted, skipped, skippedUnsafePaths }
}
