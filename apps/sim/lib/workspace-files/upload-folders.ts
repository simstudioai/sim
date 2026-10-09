import { db } from '@sim/db'
import { folder } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, isNull, min } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbTransaction } from '@/lib/db/types'
import { acquireFolderMutationLock } from '@/lib/folders/locks'
import { deduplicateFolderName } from '@/lib/folders/naming'
import { buildFolderPath, MAX_FOLDER_PATH_SEGMENTS } from '@/lib/folders/paths'
import { assertFolderCollectionHasRoom } from '@/lib/folders/queries'
import { validateUploadDirectories } from '@/lib/workspace-files/upload-directory-plan'

interface PrepareUploadFoldersParams {
  workspaceId: string
  userId: string
  targetFolderId: string | null
  paths: string[][]
}

interface PreparedUploadFolder {
  id: string
  name: string
  path: string[]
}

async function targetPath(tx: DbTransaction, workspaceId: string, targetFolderId: string | null) {
  const segments: string[] = []
  const seen = new Set<string>()
  let id = targetFolderId
  while (id !== null) {
    if (seen.has(id) || segments.length >= MAX_FOLDER_PATH_SEGMENTS) {
      throw new OrchestrationError('validation', 'The destination folder path is too deep')
    }
    seen.add(id)
    const [row] = await tx
      .select({ name: folder.name, parentId: folder.parentId })
      .from(folder)
      .where(
        and(
          eq(folder.id, id),
          eq(folder.workspaceId, workspaceId),
          eq(folder.resourceType, 'file'),
          isNull(folder.deletedAt)
        )
      )
      .limit(1)
    if (!row) throw new OrchestrationError('not_found', 'Target folder not found')
    segments.unshift(row.name)
    id = row.parentId
  }
  return segments
}

/** Creates an entire upload tree atomically; existing roots are kept as numbered siblings. */
export async function prepareUploadFolders(
  params: PrepareUploadFoldersParams
): Promise<PreparedUploadFolder[]> {
  const paths = validateUploadDirectories(params.paths)
  return db.transaction(async (tx) => {
    await acquireFolderMutationLock(tx, params.workspaceId, 'file')
    const destination = await targetPath(tx, params.workspaceId, params.targetFolderId)
    await assertFolderCollectionHasRoom(params.workspaceId, 'file', tx, {
      additionalRows: paths.length,
    })
    const [position] = await tx
      .select({ first: min(folder.sortOrder) })
      .from(folder)
      .where(
        and(
          eq(folder.workspaceId, params.workspaceId),
          eq(folder.resourceType, 'file'),
          isNull(folder.deletedAt),
          params.targetFolderId
            ? eq(folder.parentId, params.targetFolderId)
            : isNull(folder.parentId)
        )
      )
    let rootSortOrder = (position?.first ?? 0) - 1
    const prepared: PreparedUploadFolder[] = []
    const byPath = new Map<string, { id: string; resolvedPath: string[] }>()
    const descendants: (typeof folder.$inferInsert)[] = []
    for (const path of paths) {
      const parent = path.length === 1 ? null : byPath.get(JSON.stringify(path.slice(0, -1)))
      if (path.length > 1 && !parent)
        throw new OrchestrationError('validation', 'Parent folder is missing')
      const requestedName = path[path.length - 1]
      const name = parent
        ? requestedName
        : await deduplicateFolderName(
            tx,
            params.workspaceId,
            params.targetFolderId,
            requestedName,
            'file'
          )
      const resolvedPath = [...(parent?.resolvedPath ?? destination), name]
      buildFolderPath(resolvedPath)
      const id = generateId()
      const row = {
        id,
        name,
        resourceType: 'file' as const,
        workspaceId: params.workspaceId,
        userId: params.userId,
        parentId: parent?.id ?? params.targetFolderId,
        sortOrder: parent ? 0 : rootSortOrder--,
      }
      if (parent) descendants.push(row)
      else await tx.insert(folder).values(row)
      byPath.set(JSON.stringify(path), { id, resolvedPath })
      prepared.push({ id, name, path })
    }
    if (descendants.length > 0) await tx.insert(folder).values(descendants)
    return prepared
  })
}
