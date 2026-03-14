import { db } from '@sim/db'
import { workspaceFiles } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull } from 'drizzle-orm'
import { type FileReadResult, readFileRecord } from '@/lib/copilot/vfs/file-reader'
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
  }
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
      error: err instanceof Error ? err.message : String(err),
    })
    return []
  }
}

/**
 * Read a specific uploaded file by name within a chat session.
 */
export async function readChatUpload(
  filename: string,
  chatId: string
): Promise<FileReadResult | null> {
  try {
    const rows = await db
      .select()
      .from(workspaceFiles)
      .where(
        and(
          eq(workspaceFiles.chatId, chatId),
          eq(workspaceFiles.context, 'mothership'),
          eq(workspaceFiles.originalName, filename),
          isNull(workspaceFiles.deletedAt)
        )
      )
      .limit(1)

    if (rows.length === 0) return null

    const record = toWorkspaceFileRecord(rows[0])
    return readFileRecord(record)
  } catch (err) {
    logger.warn('Failed to read chat upload', {
      filename,
      chatId,
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}
