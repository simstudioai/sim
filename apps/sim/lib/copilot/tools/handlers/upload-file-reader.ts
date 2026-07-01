import { db } from '@sim/db'
import { workspaceFiles } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { and, asc, desc, eq, isNull, or } from 'drizzle-orm'
import {
  type FileReadResult,
  readFileRecord,
  renderFileBuffer,
} from '@/lib/copilot/vfs/file-reader'
import {
  type GrepCountEntry,
  type GrepMatch,
  type GrepOptions,
  grepReadResult,
  WorkspaceFileGrepError,
} from '@/lib/copilot/vfs/operations'
import { decodeVfsSegment, encodeVfsSegment } from '@/lib/copilot/vfs/path-utils'
import { getServePathPrefix } from '@/lib/uploads'
import {
  ArchiveError,
  extractArchiveEntry,
  listArchiveEntries,
  MAX_ARCHIVE_BYTES,
} from '@/lib/uploads/archive'
import {
  fetchWorkspaceFileBuffer,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import {
  getFileExtension,
  getMimeTypeFromExtension,
  isArchiveFileName,
} from '@/lib/uploads/utils/file-utils'

const logger = createLogger('UploadFileReader')

/**
 * Canonical comparison key for an upload's VFS name. Accepts both the raw display
 * name and a percent-encoded segment (decode first — a no-op for raw names —
 * then re-encode to the canonical `files/`-style form) so either spelling
 * resolves the same row. Raw names containing a literal `%` cannot be decoded;
 * fall back to encoding the raw name.
 */
function canonicalUploadKey(name: string): string {
  let decoded = name
  try {
    decoded = decodeVfsSegment(name)
  } catch {
    decoded = name
  }
  try {
    return encodeVfsSegment(decoded)
  } catch {
    return name.trim()
  }
}

/**
 * Per-segment encode of a stored name (no decode first), so a name containing a
 * literal `%` (e.g. `test%2A.zip`) round-trips: glob/upload-context expose it as
 * `encodeVfsSegment(name)`, and matching that encoded form back recovers the row.
 * {@link canonicalUploadKey} can't, because it decodes the input first and a
 * literal `%2A` is indistinguishable from an encoded `*`.
 */
function encodeUploadName(name: string): string {
  try {
    return encodeVfsSegment(name)
  } catch {
    return name.trim()
  }
}

/** VFS-visible name. Coalesces to originalName for legacy rows that predate displayName. */
function vfsName(row: typeof workspaceFiles.$inferSelect): string {
  return row.displayName ?? row.originalName
}

function toWorkspaceFileRecord(row: typeof workspaceFiles.$inferSelect): WorkspaceFileRecord {
  const pathPrefix = getServePathPrefix()
  return {
    id: row.id,
    workspaceId: row.workspaceId || '',
    name: vfsName(row),
    key: row.key,
    path: `${pathPrefix}${encodeURIComponent(row.key)}?context=mothership`,
    size: row.size,
    type: row.contentType,
    uploadedBy: row.userId,
    deletedAt: row.deletedAt,
    uploadedAt: row.uploadedAt,
    updatedAt: row.updatedAt,
    storageContext: 'mothership',
  }
}

/**
 * Resolve a mothership upload row by VFS name (the collision-disambiguated `displayName`
 * for new rows, or `originalName` for legacy rows that predate the column). Prefers an
 * exact DB match; falls back to a normalized scan when the model passes a visually
 * equivalent name (e.g. macOS U+202F vs ASCII space in screenshot filenames).
 *
 * On ambiguity (multiple legacy rows sharing the same originalName in one chat — the
 * pre-displayName collision case), returns the most recent upload. New rows are unique
 * by index so this only affects pre-fix data.
 */
export async function findMothershipUploadRowByChatAndName(
  chatId: string,
  fileName: string
): Promise<typeof workspaceFiles.$inferSelect | null> {
  const exactRows = await db
    .select()
    .from(workspaceFiles)
    .where(
      and(
        eq(workspaceFiles.chatId, chatId),
        eq(workspaceFiles.context, 'mothership'),
        or(
          eq(workspaceFiles.displayName, fileName),
          and(isNull(workspaceFiles.displayName), eq(workspaceFiles.originalName, fileName))
        ),
        isNull(workspaceFiles.deletedAt)
      )
    )
    .orderBy(desc(workspaceFiles.uploadedAt), desc(workspaceFiles.id))
    .limit(1)

  if (exactRows[0]) {
    return exactRows[0]
  }

  const allRows = await db
    .select()
    .from(workspaceFiles)
    .where(
      and(
        eq(workspaceFiles.chatId, chatId),
        eq(workspaceFiles.context, 'mothership'),
        isNull(workspaceFiles.deletedAt)
      )
    )
    .orderBy(desc(workspaceFiles.uploadedAt), desc(workspaceFiles.id))

  const segmentKey = canonicalUploadKey(fileName)
  return (
    allRows.find((r) => {
      const stored = vfsName(r)
      // Canonical-key match handles visually-equivalent spellings (U+202F vs
      // space); the encoded-form match handles literal `%` names that survive
      // encode but not decode.
      return canonicalUploadKey(stored) === segmentKey || encodeUploadName(stored) === fileName
    }) ?? null
  )
}

/**
 * List all chat-scoped uploads for a given chat in upload order.
 */
export async function listChatUploads(chatId: string): Promise<WorkspaceFileRecord[]> {
  try {
    const rows = await db
      .select()
      .from(workspaceFiles)
      .where(
        and(
          eq(workspaceFiles.chatId, chatId),
          eq(workspaceFiles.context, 'mothership'),
          isNull(workspaceFiles.deletedAt)
        )
      )
      .orderBy(asc(workspaceFiles.uploadedAt), asc(workspaceFiles.id))

    return rows.map(toWorkspaceFileRecord)
  } catch (err) {
    logger.warn('Failed to list chat uploads', {
      chatId,
      error: toError(err).message,
    })
    return []
  }
}

/**
 * True when an uploaded chat file is an archive presented as a virtual folder
 * (currently `.zip`). Detection is by name so it is robust to archive MIME drift.
 */
export function isArchiveUpload(record: WorkspaceFileRecord): boolean {
  return isArchiveFileName(record.name)
}

/**
 * True when an archive's recorded size exceeds the read cap. This is a cheap
 * early-out on `record.size` to skip a doomed download; the download itself is
 * also hard-capped on the actual byte stream (every archive fetch passes
 * `{ maxBytes: MAX_ARCHIVE_BYTES }`), so an object larger than its recorded size
 * still cannot be buffered fully into memory.
 */
function exceedsArchiveReadCap(record: WorkspaceFileRecord): boolean {
  return record.size > MAX_ARCHIVE_BYTES
}

/** Placeholder for an archive too large to download and extract inline. */
function archiveTooLargeResult(record: WorkspaceFileRecord): FileReadResult {
  return {
    content: `[Archive too large to read: ${record.name} (${Math.round(
      record.size / 1024 / 1024
    )}MB, limit ${MAX_ARCHIVE_BYTES / 1024 / 1024}MB)]`,
    totalLines: 1,
  }
}

/** Decode each `/`-separated segment of a VFS entry path back to its real name. */
function decodeEntryPath(raw: string): string {
  return raw
    .split('/')
    .map((segment) => {
      try {
        return decodeVfsSegment(segment)
      } catch {
        return segment
      }
    })
    .join('/')
}

/** Re-encode a real `/`-joined entry path into its VFS-safe per-segment form. */
function encodeEntryPath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeVfsSegment(segment))
    .join('/')
}

/**
 * Canonical per-segment-encoded key for an archive entry path. Returns null for
 * paths that cannot be encoded (empty/dot segments).
 */
function archiveEntryKey(path: string): string | null {
  try {
    return encodeEntryPath(path)
  } catch {
    return null
  }
}

/**
 * De-duplicate raw entry paths by their canonical VFS key (first wins), so two
 * entries that differ only in a form the VFS normalizes away (NFC vs NFD, U+202F
 * vs space, collapsed whitespace) collapse to one listed path. This matches how
 * {@link findArchiveEntryRawPath} resolves a read — first entry whose key matches
 * — so every listed path is reachable and none is silently shadowed.
 */
function dedupeArchiveEntriesByKey(paths: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const path of paths) {
    const key = archiveEntryKey(path) ?? path
    if (seen.has(key)) continue
    seen.add(key)
    result.push(path)
  }
  return result
}

/**
 * Resolve a requested entry path (percent-encoded as the agent received it from
 * glob, or the raw display form from the manifest) to the archive's exact stored
 * path. Matching is on the canonical key so the NFC + whitespace normalization
 * `encodeVfsSegment` applies stays symmetric between the listed paths and the
 * read request — otherwise a macOS-authored (NFD / U+202F) entry name would list
 * but never resolve. Returns null when nothing matches.
 */
async function findArchiveEntryRawPath(
  archiveBuffer: Buffer,
  requestedEntryPath: string
): Promise<string | null> {
  const wantedKey = archiveEntryKey(decodeEntryPath(requestedEntryPath))
  if (!wantedKey) return null
  const entries = await listArchiveEntries(archiveBuffer)
  return entries.find((entry) => archiveEntryKey(entry) === wantedKey) ?? null
}

/** A single entry within an uploaded archive, with both its real and VFS paths. */
export interface ChatUploadArchiveEntry {
  /** Real sanitized path inside the archive (e.g. `data/sheet.csv`). */
  path: string
  /** VFS path the agent uses to read it (e.g. `uploads/archive.zip/data/sheet.csv`). */
  vfsPath: string
}

/**
 * List the entries of an uploaded archive as VFS paths. Returns null when
 * `zipName` is not an archive upload in this chat; returns `[]` when the archive
 * is unreadable or empty (logged) so the caller still surfaces the archive leaf.
 */
export async function listChatUploadArchiveEntries(
  zipName: string,
  chatId: string
): Promise<ChatUploadArchiveEntry[] | null> {
  const row = await findMothershipUploadRowByChatAndName(chatId, zipName)
  if (!row) return null
  const record = toWorkspaceFileRecord(row)
  if (!isArchiveUpload(record)) return null
  if (exceedsArchiveReadCap(record)) {
    logger.warn('Archive too large to list entries', { zipName, chatId, size: record.size })
    return []
  }

  const encodedZip = encodeUploadName(record.name)
  try {
    const buffer = await fetchWorkspaceFileBuffer(record, { maxBytes: MAX_ARCHIVE_BYTES })
    const entries = dedupeArchiveEntriesByKey(await listArchiveEntries(buffer))
    return entries.map((path) => ({
      path,
      vfsPath: `uploads/${encodedZip}/${encodeEntryPath(path)}`,
    }))
  } catch (err) {
    logger.warn('Failed to list archive entries', {
      zipName,
      chatId,
      error: toError(err).message,
    })
    return []
  }
}

/**
 * Render one archive entry from the archive buffer with the same extraction
 * logic as a stored upload. Returns null when the entry is genuinely missing;
 * returns a bracketed placeholder for any {@link ArchiveError} (invalid archive,
 * too many entries, oversized entry) — matching {@link buildArchiveManifest} so a
 * nested read surfaces the real reason instead of the VFS "Upload not found".
 */
async function readArchiveEntry(
  archiveBuffer: Buffer,
  entryPath: string
): Promise<FileReadResult | null> {
  try {
    const rawPath = await findArchiveEntryRawPath(archiveBuffer, entryPath)
    if (!rawPath) return null
    const entryBuffer = await extractArchiveEntry(archiveBuffer, rawPath)
    if (!entryBuffer) return null
    const ext = getFileExtension(rawPath)
    return renderFileBuffer(entryBuffer, {
      name: rawPath,
      type: getMimeTypeFromExtension(ext),
      ext,
    })
  } catch (err) {
    if (err instanceof ArchiveError) {
      return { content: `[${err.message}]`, totalLines: 1 }
    }
    throw err
  }
}

/**
 * Build a file-tree manifest for an archive (`read("uploads/x.zip")`), so the
 * agent gets the contents instead of binary bytes. An optional `note` is
 * prepended — used to tell the agent a requested entry was not found while still
 * showing the valid paths. Returns a placeholder result when the archive is
 * unreadable.
 */
async function buildArchiveManifest(
  record: WorkspaceFileRecord,
  archiveBuffer: Buffer,
  note?: string
): Promise<FileReadResult> {
  const encodedZip = encodeUploadName(record.name)
  try {
    const entries = dedupeArchiveEntriesByKey(await listArchiveEntries(archiveBuffer))
    const header = `Archive "${record.name}" — ${entries.length} file${
      entries.length === 1 ? '' : 's'
    }. Read an entry with read("uploads/${encodedZip}/<path>").`
    const content = [...(note ? [note, ''] : []), header, '', ...entries].join('\n')
    return { content, totalLines: content.split('\n').length }
  } catch (err) {
    if (err instanceof ArchiveError) {
      return { content: `[${err.message}]`, totalLines: 1 }
    }
    throw err
  }
}

/**
 * Read a chat upload addressed by its first path segment and an optional entry
 * path, resolving the upload row exactly once. A plain upload renders directly
 * (a trailing habit suffix like `/content` is ignored); an archive returns the
 * addressed entry, or its file-tree manifest when no entry is given. Resolves
 * names like {@link findMothershipUploadRowByChatAndName} so visually equivalent
 * spellings (e.g. macOS U+202F vs ASCII space) still match.
 */
export async function readChatUploadPath(
  firstSegment: string,
  entryPath: string,
  chatId: string
): Promise<FileReadResult | null> {
  try {
    const row = await findMothershipUploadRowByChatAndName(chatId, firstSegment)
    if (!row) return null
    const record = toWorkspaceFileRecord(row)
    if (!isArchiveUpload(record)) {
      return await readFileRecord(record)
    }
    if (exceedsArchiveReadCap(record)) {
      return archiveTooLargeResult(record)
    }
    const archiveBuffer = await fetchWorkspaceFileBuffer(record, { maxBytes: MAX_ARCHIVE_BYTES })
    if (!entryPath) {
      return await buildArchiveManifest(record, archiveBuffer)
    }
    const entry = await readArchiveEntry(archiveBuffer, entryPath)
    if (entry) return entry
    // Entry not found — show the manifest so the agent can pick a valid path.
    // Handles a stray `/content` habit suffix (carried over from files/) and
    // plain typos uniformly, without special-casing any segment name.
    return await buildArchiveManifest(
      record,
      archiveBuffer,
      `Entry "${decodeEntryPath(entryPath)}" not found in "${record.name}".`
    )
  } catch (err) {
    logger.warn('Failed to read chat upload', {
      firstSegment,
      entryPath,
      chatId,
      error: toError(err).message,
    })
    return null
  }
}

/**
 * Grep a chat upload addressed by its first path segment and an optional entry
 * path, resolving the upload row exactly once and mirroring
 * {@link WorkspaceVFS.grepFile} for the chat-scoped namespace. An archive entry
 * is grepped from the archive; otherwise the upload itself is grepped (a trailing
 * habit suffix on a non-archive is ignored). Throws {@link WorkspaceFileGrepError}
 * when the upload/entry is missing or has no searchable text so the caller
 * surfaces the message verbatim.
 */
export async function grepChatUploadPath(
  firstSegment: string,
  entryPath: string,
  chatId: string,
  pattern: string,
  options?: GrepOptions
): Promise<GrepMatch[] | string[] | GrepCountEntry[]> {
  const row = await findMothershipUploadRowByChatAndName(chatId, firstSegment)
  if (!row) {
    throw new WorkspaceFileGrepError(
      `Upload not found: "${firstSegment}". Use glob("uploads/*") to list available uploads.`
    )
  }
  const record = toWorkspaceFileRecord(row)

  if (entryPath && isArchiveUpload(record)) {
    if (exceedsArchiveReadCap(record)) {
      throw new WorkspaceFileGrepError(
        `Archive too large to grep: "${record.name}" (limit ${MAX_ARCHIVE_BYTES / 1024 / 1024}MB).`
      )
    }
    const archiveBuffer = await fetchWorkspaceFileBuffer(record, { maxBytes: MAX_ARCHIVE_BYTES })
    try {
      const rawPath = await findArchiveEntryRawPath(archiveBuffer, entryPath)
      if (!rawPath) {
        throw new WorkspaceFileGrepError(
          `Archive entry not found: "${decodeEntryPath(entryPath)}" in "${record.name}".`
        )
      }
      const entryBuffer = await extractArchiveEntry(archiveBuffer, rawPath)
      if (!entryBuffer) {
        throw new WorkspaceFileGrepError(
          `Archive entry not found: "${rawPath}" in "${record.name}".`
        )
      }
      const ext = getFileExtension(rawPath)
      const result = await renderFileBuffer(entryBuffer, {
        name: rawPath,
        type: getMimeTypeFromExtension(ext),
        ext,
      })
      const uploadsPath = `uploads/${encodeUploadName(record.name)}/${encodeEntryPath(rawPath)}`
      return grepReadResult(uploadsPath, result, pattern, uploadsPath, options)
    } catch (err) {
      // Surface archive failures (invalid/too-many/oversized) as a grep error
      // with the real reason rather than a generic internal failure.
      if (err instanceof ArchiveError) {
        throw new WorkspaceFileGrepError(err.message)
      }
      throw err
    }
  }

  // A bare archive has no searchable text of its own — guide the agent to target
  // an entry (or read the archive to list them) rather than grepping its bytes.
  if (isArchiveUpload(record)) {
    throw new WorkspaceFileGrepError(
      `Cannot grep an archive directly. Grep an entry (e.g. grep path: "uploads/${encodeUploadName(
        record.name
      )}/<path>") or read("uploads/${encodeUploadName(record.name)}") to list its contents.`
    )
  }

  const result = await readFileRecord(record)
  if (!result) {
    throw new WorkspaceFileGrepError(`Upload content not found for "${firstSegment}".`)
  }
  const uploadsPath = `uploads/${encodeUploadName(record.name)}`
  return grepReadResult(uploadsPath, result, pattern, uploadsPath, options)
}
