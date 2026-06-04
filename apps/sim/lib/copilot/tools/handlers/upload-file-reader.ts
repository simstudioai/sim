import { db } from '@sim/db'
import { workspaceFiles } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { and, asc, desc, eq, isNull, or } from 'drizzle-orm'
import { type FileReadResult, readFileRecord } from '@/lib/copilot/vfs/file-reader'
import { normalizeVfsSegment } from '@/lib/copilot/vfs/normalize-segment'
import { getServePathPrefix } from '@/lib/uploads'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace/workspace-file-manager'

const logger = createLogger('UploadFileReader')

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

  const segmentKey = normalizeVfsSegment(fileName)
  return allRows.find((r) => normalizeVfsSegment(vfsName(r)) === segmentKey) ?? null
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
 * matches when the model passes a visually equivalent path.
 */
export async function readChatUpload(
  filename: string,
  chatId: string
): Promise<FileReadResult | null> {
  try {
    const row = await findMothershipUploadRowByChatAndName(chatId, filename)
    if (!row) return null
    return readFileRecord(toWorkspaceFileRecord(row))
  } catch (err) {
    logger.warn('Failed to read chat upload', {
      filename,
      chatId,
      error: toError(err).message,
    })
    return null
  }
}
