import { db } from '@sim/db'
import { workspaceFiles } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { and, eq, isNull } from 'drizzle-orm'
import { type FileReadResult, readFileRecord } from '@/lib/copilot/vfs/file-reader'
import { normalizeVfsSegment } from '@/lib/copilot/vfs/normalize-segment'
import { getServePathPrefix } from '@/lib/uploads'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace/workspace-file-manager'

const logger = createLogger('UploadFileReader')

function toWorkspaceFileRecord(row: typeof workspaceFiles.$inferSelect): WorkspaceFileRecord {
  const pathPrefix = getServePathPrefix()
  return {
    id: row.id,
    workspaceId: row.workspaceId || '',
    name: row.originalName,
    key: row.key,
    path: `${pathPrefix}${encodeURIComponent(row.key)}?context=mothership`,
    size: row.size,
    type: row.contentType,
    uploadedBy: row.userId,
    deletedAt: row.deletedAt,
    uploadedAt: row.uploadedAt,
    storageContext: 'mothership',
  }
}

/**
 * Resolve a mothership upload row by `originalName`, preferring an exact DB match (limit 1) and
 * only scanning all chat uploads when that misses (e.g. macOS U+202F vs ASCII space in the name).
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
        eq(workspaceFiles.originalName, fileName),
        isNull(workspaceFiles.deletedAt)
      )
    )
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

  const segmentKey = normalizeVfsSegment(fileName)
  return allRows.find((r) => normalizeVfsSegment(r.originalName) === segmentKey) ?? null
}

/**
 * List all chat-scoped uploads for a given chat.
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
