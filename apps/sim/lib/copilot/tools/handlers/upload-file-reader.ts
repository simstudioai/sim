import { db } from '@sim/db'
import { workspaceFiles } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { and, asc, desc, eq, isNull, or } from 'drizzle-orm'
import {
  type FileReadResult,
  MAX_TEXT_READ_BYTES,
  readFileRecord,
} from '@/lib/copilot/vfs/file-reader'
import {
  type GrepCountEntry,
  type GrepMatch,
  type GrepOptions,
  grepReadResult,
  WorkspaceFileGrepError,
} from '@/lib/copilot/vfs/operations'
import { decodeVfsSegment, encodeVfsSegment } from '@/lib/copilot/vfs/path-utils'
import { isZipShaped } from '@/lib/file-parsers/zip-guard'
import { getServePathPrefix } from '@/lib/uploads'
import {
  fetchWorkspaceFileBuffer,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { buildArchiveExtractGuidance, isArchiveFileName } from '@/lib/uploads/utils/file-utils'

const logger = createLogger('UploadFileReader')

/**
 * Sniff budget for uploads whose NAME says archive: below this size the actual
 * bytes decide (a mislabeled text file named `data.zip` stays readable instead
 * of being trapped between read-says-extract and extract-says-invalid); above
 * it the extension is trusted so a real 100MB zip is never downloaded just to
 * refuse it. Aligned with the read path's inline text cap — any mislabeled
 * file too big to sniff would be rejected by read() as too large anyway, so
 * nothing readable is ever dead-ended.
 */
const ARCHIVE_SNIFF_MAX_BYTES = MAX_TEXT_READ_BYTES

/**
 * True when the upload should get extract-first guidance: named like an archive
 * and — for small files — actually shaped like one.
 */
async function isActualArchiveUpload(record: WorkspaceFileRecord): Promise<boolean> {
  if (!isArchiveFileName(record.name)) return false
  if (record.size > ARCHIVE_SNIFF_MAX_BYTES) return true
  try {
    const buffer = await fetchWorkspaceFileBuffer(record, { maxBytes: ARCHIVE_SNIFF_MAX_BYTES })
    return isZipShaped(buffer)
  } catch {
    return true
  }
}

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
  return allRows.find((r) => canonicalUploadKey(vfsName(r)) === segmentKey) ?? null
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
 * Read a specific uploaded file by display name within a chat session.
 * Resolves names with `normalizeVfsSegment` so macOS screenshot spacing (e.g. U+202F)
 * matches when the model passes a visually equivalent path. A `.zip` upload is not
 * read directly — it returns extract-first guidance instead of binary bytes.
 */
export async function readChatUpload(
  filename: string,
  chatId: string
): Promise<FileReadResult | null> {
  try {
    const row = await findMothershipUploadRowByChatAndName(chatId, filename)
    if (!row) return null
    const record = toWorkspaceFileRecord(row)
    if (await isActualArchiveUpload(record)) {
      return { content: `[${buildArchiveExtractGuidance(record.name)}]`, totalLines: 1 }
    }
    return readFileRecord(record)
  } catch (err) {
    logger.warn('Failed to read chat upload', {
      filename,
      chatId,
      error: toError(err).message,
    })
    return null
  }
}

/**
 * Grep the content of a single chat upload (`uploads/<name>`), mirroring
 * {@link WorkspaceVFS.grepFile} for the chat-scoped uploads namespace. Resolves
 * the upload by name (raw or percent-encoded), reads its text per file type, and
 * greps it. Throws {@link WorkspaceFileGrepError} when the upload is missing or
 * has no searchable text (image/binary/too-large) so the caller surfaces the
 * message verbatim.
 */
export async function grepChatUpload(
  filename: string,
  chatId: string,
  pattern: string,
  options?: GrepOptions
): Promise<GrepMatch[] | string[] | GrepCountEntry[]> {
  const row = await findMothershipUploadRowByChatAndName(chatId, filename)
  if (!row) {
    throw new WorkspaceFileGrepError(
      `Upload not found: "${filename}". Use glob("uploads/*") to list available uploads.`
    )
  }
  const record = toWorkspaceFileRecord(row)
  if (await isActualArchiveUpload(record)) {
    throw new WorkspaceFileGrepError(buildArchiveExtractGuidance(record.name))
  }
  const result = await readFileRecord(record)
  if (!result) {
    throw new WorkspaceFileGrepError(`Upload content not found for "${filename}".`)
  }
  const uploadsPath = `uploads/${canonicalUploadKey(record.name)}`
  return grepReadResult(uploadsPath, result, pattern, uploadsPath, options)
}
