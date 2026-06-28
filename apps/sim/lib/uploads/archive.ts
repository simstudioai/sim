import { Buffer } from 'buffer'
import type { Readable } from 'stream'
import JSZip from 'jszip'

/**
 * Shared, zip-bomb / zip-slip safe archive primitives.
 *
 * These were originally inlined in the file-manage decompress route; they are
 * factored here so the copilot VFS can present an uploaded `.zip` as a virtual
 * folder (list entries, extract one entry on read) using the exact same safety
 * guarantees. The declared sizes in a ZIP header are attacker-controlled, so the
 * real caps are always enforced on the inflated byte stream — never on metadata.
 */

/** Input archive download/size cap. */
export const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024
/** Maximum number of entries enumerated/extracted from a single archive. */
export const MAX_ARCHIVE_ENTRIES = 1000
/** Maximum uncompressed size for any single archive entry. */
export const MAX_ARCHIVE_ENTRY_BYTES = 100 * 1024 * 1024
/** Maximum total uncompressed size across all entries, to bound zip-bomb expansion. */
export const MAX_ARCHIVE_TOTAL_BYTES = 200 * 1024 * 1024

const S_IFMT = 0o170000
const S_IFLNK = 0o120000

/** Reason a {@link ArchiveError} was raised, for mapping to a caller response. */
export type ArchiveErrorReason =
  | 'invalid'
  | 'too_many_entries'
  | 'entry_too_large'
  | 'total_too_large'

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
 * Read a zip entry's declared uncompressed size without materializing it. This
 * value comes straight from the (attacker-controlled) ZIP metadata, so it is only
 * usable as a cheap fast-reject for honestly-declared archives — never as the
 * authoritative cap. {@link inflateEntryWithinCaps} enforces the real limit on the
 * inflated byte stream.
 */
export const readEntryUncompressedSize = (entry: JSZip.JSZipObject): number | undefined => {
  const data = (entry as JSZip.JSZipObject & { _data?: { uncompressedSize?: number } })._data
  const size = data?.uncompressedSize
  return typeof size === 'number' && Number.isFinite(size) ? size : undefined
}

type InflateResult = { ok: true; buffer: Buffer } | { ok: false; reason: 'entry' | 'total' }

/**
 * Inflate a single zip entry through a streaming counting sink, tearing the
 * stream down the moment cumulative output would exceed the per-entry cap or the
 * remaining total budget. The declared uncompressed size in the ZIP header is
 * attacker-controlled and is NOT trusted here: a forged-small or absent size
 * cannot cause the full (potentially gigabyte-scale) entry to be materialized in
 * memory, because enforcement happens on the actual inflated bytes as they
 * arrive. Peak memory is bounded by the cap plus one DEFLATE chunk.
 */
export const inflateEntryWithinCaps = (
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
export const isSymlinkEntry = (entry: JSZip.JSZipObject): boolean => {
  const mode = (entry as JSZip.JSZipObject & { unixPermissions?: number | null }).unixPermissions
  return typeof mode === 'number' && (mode & S_IFMT) === S_IFLNK
}

/**
 * Normalize a zip entry path into safe path segments, guarding against zip-slip.
 * Returns null for traversal (`..`) and empty paths; a leading slash or drive root
 * is dropped to empty segments, so the entry stays relative (contained) rather
 * than resolving outside its intended location.
 */
export const sanitizeArchiveEntryPath = (rawPath: string): string[] | null => {
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

/**
 * Parse an archive buffer, throwing {@link ArchiveError} with reason `invalid`
 * when it is not a readable zip.
 */
async function loadArchive(buffer: Buffer): Promise<JSZip> {
  try {
    return await JSZip.loadAsync(buffer)
  } catch {
    throw new ArchiveError('invalid', 'Not a valid .zip archive')
  }
}

/**
 * Enumerate the safe, extractable entry paths of an archive WITHOUT inflating
 * them, each a sanitized `/`-joined path (e.g. `data/sheet.csv`). Skips
 * directories, symlinks, zip-slip paths, and filesystem noise (`__MACOSX/`,
 * `.DS_Store`, `Thumbs.db`). Throws {@link ArchiveError} `too_many_entries` past
 * {@link MAX_ARCHIVE_ENTRIES}.
 *
 * Paths are returned raw (not de-duplicated): two entries can collide only once
 * projected into the VFS's canonical (NFC-encoded) form, so de-duplication
 * belongs with the caller that owns that encoding (`listChatUploadArchiveEntries`).
 */
export async function listArchiveEntries(buffer: Buffer): Promise<string[]> {
  const zip = await loadArchive(buffer)

  const realEntries = Object.values(zip.files).filter(
    (entry) => !entry.dir && !isSymlinkEntry(entry)
  )
  if (realEntries.length > MAX_ARCHIVE_ENTRIES) {
    throw new ArchiveError(
      'too_many_entries',
      `Archive has too many entries. Maximum is ${MAX_ARCHIVE_ENTRIES}.`
    )
  }

  const paths: string[] = []
  for (const entry of realEntries) {
    const segments = sanitizeArchiveEntryPath(entry.name)
    if (!segments || isArchiveNoiseEntry(segments)) continue
    paths.push(segments.join('/'))
  }
  return paths
}

/**
 * Extract a single archive entry by its sanitized `/`-joined path, inflating
 * within the per-entry cap. Returns `null` when no entry matches. Throws
 * {@link ArchiveError} `entry_too_large` if the inflated bytes exceed the cap.
 */
export async function extractArchiveEntry(
  buffer: Buffer,
  entryPath: string
): Promise<Buffer | null> {
  const zip = await loadArchive(buffer)

  const match = Object.values(zip.files).find((entry) => {
    if (entry.dir || isSymlinkEntry(entry)) return false
    const segments = sanitizeArchiveEntryPath(entry.name)
    return segments !== null && segments.join('/') === entryPath
  })
  if (!match) return null

  const result = await inflateEntryWithinCaps(match, MAX_ARCHIVE_ENTRY_BYTES)
  if (!result.ok) {
    throw new ArchiveError(
      'entry_too_large',
      `Archive entry "${entryPath}" is too large to extract. Maximum is ${
        MAX_ARCHIVE_ENTRY_BYTES / (1024 * 1024)
      } MB per file.`,
      entryPath
    )
  }
  return result.buffer
}
