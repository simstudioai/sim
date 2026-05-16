import { db } from '@sim/db'
import { workspaceFileFolder, workspaceFiles } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, asc, eq, inArray, isNull, min, type SQL, sql } from 'drizzle-orm'
import { getWorkspaceWithOwner } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('WorkspaceFileFolders')

export type WorkspaceFileFolderScope = 'active' | 'archived' | 'all'

export class WorkspaceFileFolderConflictError extends Error {
  readonly code = 'FOLDER_CONFLICT' as const

  constructor(name: string) {
    super(`A folder named "${name}" already exists in this location`)
  }
}

export class WorkspaceFileMoveConflictError extends Error {
  readonly code = 'FILE_MOVE_CONFLICT' as const

  constructor(name: string) {
    super(`A file named "${name}" already exists in the destination folder`)
  }
}

export class WorkspaceFileItemsNotFoundError extends Error {
  readonly code = 'WORKSPACE_FILE_ITEMS_NOT_FOUND' as const

  constructor(fileIds: string[], folderIds: string[]) {
    const parts = [
      fileIds.length > 0 ? `files: ${fileIds.join(', ')}` : null,
      folderIds.length > 0 ? `folders: ${folderIds.join(', ')}` : null,
    ].filter(Boolean)
    super(`Workspace file items not found (${parts.join('; ')})`)
  }
}

export interface WorkspaceFileFolderRecord {
  id: string
  workspaceId: string
  userId: string
  name: string
  parentId: string | null
  path: string
  sortOrder: number
  deletedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

interface RawWorkspaceFileFolder {
  id: string
  workspaceId: string
  userId: string
  name: string
  parentId: string | null
  sortOrder: number
  deletedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

interface WorkspaceFileFolderLockTx {
  execute(query: SQL): Promise<unknown>
}

export interface WorkspaceFileArchiveResult {
  folders: number
  files: number
}

export interface WorkspaceFileFolderRestoreResult {
  folder: WorkspaceFileFolderRecord
  restoredItems: WorkspaceFileArchiveResult
}

export function normalizeWorkspaceFileItemName(name: string, itemLabel: 'File' | 'Folder'): string {
  const trimmed = name.trim()
  if (!trimmed) {
    throw new Error(`${itemLabel} name is required`)
  }
  if (trimmed === '.' || trimmed === '..' || trimmed.includes('/') || trimmed.includes('\\')) {
    throw new Error(`${itemLabel} name cannot contain path separators or dot segments`)
  }
  return trimmed
}

function normalizeParentId(parentId?: string | null): string | null {
  return parentId && parentId.length > 0 ? parentId : null
}

function folderParentCondition(parentId?: string | null) {
  const normalized = normalizeParentId(parentId)
  return normalized
    ? eq(workspaceFileFolder.parentId, normalized)
    : isNull(workspaceFileFolder.parentId)
}

function fileFolderCondition(folderId?: string | null) {
  const normalized = normalizeParentId(folderId)
  return normalized ? eq(workspaceFiles.folderId, normalized) : isNull(workspaceFiles.folderId)
}

async function acquireWorkspaceFileFolderMutationLock(
  tx: WorkspaceFileFolderLockTx,
  workspaceId: string
) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`workspace_file_folders:${workspaceId}`}, 0))`
  )
}

export function buildWorkspaceFileFolderPathMap(
  folders: Array<Pick<RawWorkspaceFileFolder, 'id' | 'name' | 'parentId'>>
): Map<string, string> {
  const folderMap = new Map(folders.map((folder) => [folder.id, folder]))
  const paths = new Map<string, string>()

  const resolve = (folderId: string, seen = new Set<string>()): string => {
    const cached = paths.get(folderId)
    if (cached != null) return cached

    const folder = folderMap.get(folderId)
    if (!folder || seen.has(folderId)) return ''

    const nextSeen = new Set(seen)
    nextSeen.add(folderId)
    const parentPath = folder.parentId ? resolve(folder.parentId, nextSeen) : ''
    const path = parentPath ? `${parentPath}/${folder.name}` : folder.name
    paths.set(folderId, path)
    return path
  }

  for (const folder of folders) {
    resolve(folder.id)
  }

  return paths
}

function mapFolder(
  folder: RawWorkspaceFileFolder,
  paths: Map<string, string>
): WorkspaceFileFolderRecord {
  return {
    id: folder.id,
    workspaceId: folder.workspaceId,
    userId: folder.userId,
    name: folder.name,
    parentId: folder.parentId,
    path: paths.get(folder.id) ?? folder.name,
    sortOrder: folder.sortOrder,
    deletedAt: folder.deletedAt,
    createdAt: folder.createdAt,
    updatedAt: folder.updatedAt,
  }
}

async function getRawWorkspaceFileFolder(
  workspaceId: string,
  folderId: string,
  options?: { includeDeleted?: boolean }
): Promise<RawWorkspaceFileFolder | null> {
  const { includeDeleted = false } = options ?? {}
  const [folder] = await db
    .select()
    .from(workspaceFileFolder)
    .where(
      includeDeleted
        ? and(
            eq(workspaceFileFolder.id, folderId),
            eq(workspaceFileFolder.workspaceId, workspaceId)
          )
        : and(
            eq(workspaceFileFolder.id, folderId),
            eq(workspaceFileFolder.workspaceId, workspaceId),
            isNull(workspaceFileFolder.deletedAt)
          )
    )
    .limit(1)

  return folder ?? null
}

async function findRawWorkspaceFileFolderByName(
  workspaceId: string,
  name: string,
  parentId?: string | null
): Promise<RawWorkspaceFileFolder | null> {
  const [folder] = await db
    .select()
    .from(workspaceFileFolder)
    .where(
      and(
        eq(workspaceFileFolder.workspaceId, workspaceId),
        eq(workspaceFileFolder.name, name),
        folderParentCondition(parentId),
        isNull(workspaceFileFolder.deletedAt)
      )
    )
    .limit(1)

  return folder ?? null
}

async function buildWorkspaceFileFolderPath(
  workspaceId: string,
  folder: Pick<RawWorkspaceFileFolder, 'id' | 'name' | 'parentId'>,
  options?: { includeDeleted?: boolean }
): Promise<string> {
  const segments: string[] = []
  const seen = new Set<string>()
  let current: Pick<RawWorkspaceFileFolder, 'id' | 'name' | 'parentId'> | null = folder

  while (current && !seen.has(current.id)) {
    segments.unshift(current.name)
    seen.add(current.id)
    current = current.parentId
      ? await getRawWorkspaceFileFolder(workspaceId, current.parentId, options)
      : null
  }

  return segments.join('/')
}

async function mapFolderWithPath(
  workspaceId: string,
  folder: RawWorkspaceFileFolder,
  options?: { includeDeleted?: boolean }
): Promise<WorkspaceFileFolderRecord> {
  const path = await buildWorkspaceFileFolderPath(workspaceId, folder, options)
  return mapFolder(folder, new Map([[folder.id, path]]))
}

export async function getWorkspaceFileFolderPath(
  workspaceId: string,
  folderId: string,
  options?: { includeDeleted?: boolean }
): Promise<string | null> {
  const folder = await getRawWorkspaceFileFolder(workspaceId, folderId, options)
  return folder ? buildWorkspaceFileFolderPath(workspaceId, folder, options) : null
}

export async function findWorkspaceFileFolderIdByPath(
  workspaceId: string,
  pathSegments: string[]
): Promise<string | null> {
  let parentId: string | null = null

  for (const rawSegment of pathSegments) {
    let name: string
    try {
      name = normalizeWorkspaceFileItemName(rawSegment, 'Folder')
    } catch {
      return null
    }

    const folder = await findRawWorkspaceFileFolderByName(workspaceId, name, parentId)
    if (!folder) return null
    parentId = folder.id
  }

  return parentId
}

export async function listWorkspaceFileFolders(
  workspaceId: string,
  options?: { scope?: WorkspaceFileFolderScope }
): Promise<WorkspaceFileFolderRecord[]> {
  const { scope = 'active' } = options ?? {}
  const rows = await db
    .select()
    .from(workspaceFileFolder)
    .where(
      scope === 'all'
        ? eq(workspaceFileFolder.workspaceId, workspaceId)
        : scope === 'archived'
          ? and(
              eq(workspaceFileFolder.workspaceId, workspaceId),
              sql`${workspaceFileFolder.deletedAt} IS NOT NULL`
            )
          : and(
              eq(workspaceFileFolder.workspaceId, workspaceId),
              isNull(workspaceFileFolder.deletedAt)
            )
    )
    .orderBy(asc(workspaceFileFolder.sortOrder), asc(workspaceFileFolder.createdAt))

  const paths = buildWorkspaceFileFolderPathMap(rows)
  return rows.map((row) => mapFolder(row, paths))
}

export async function getWorkspaceFileFolder(
  workspaceId: string,
  folderId: string,
  options?: { includeDeleted?: boolean }
): Promise<WorkspaceFileFolderRecord | null> {
  const { includeDeleted = false } = options ?? {}
  const folder = await getRawWorkspaceFileFolder(workspaceId, folderId, { includeDeleted })
  if (!folder) return null

  // Load all folders in one query to build the path map instead of chaining
  // per-ancestor SELECTs inside buildWorkspaceFileFolderPath.
  const allFolders = await db
    .select()
    .from(workspaceFileFolder)
    .where(
      includeDeleted
        ? eq(workspaceFileFolder.workspaceId, workspaceId)
        : and(
            eq(workspaceFileFolder.workspaceId, workspaceId),
            isNull(workspaceFileFolder.deletedAt)
          )
    )

  const paths = buildWorkspaceFileFolderPathMap(allFolders)
  return mapFolder(folder, paths)
}

export async function assertWorkspaceFileFolderTarget(
  workspaceId: string,
  folderId?: string | null
): Promise<string | null> {
  const normalized = normalizeParentId(folderId)
  if (!normalized) return null

  const folder = await getWorkspaceFileFolder(workspaceId, normalized)
  if (!folder) {
    throw new Error('Target folder not found')
  }

  return normalized
}

export async function createWorkspaceFileFolder(params: {
  workspaceId: string
  userId: string
  name: string
  parentId?: string | null
  sortOrder?: number
}): Promise<WorkspaceFileFolderRecord> {
  const name = normalizeWorkspaceFileItemName(params.name, 'Folder')

  const folder = await db.transaction(async (tx) => {
    await acquireWorkspaceFileFolderMutationLock(tx, params.workspaceId)

    const parentId = normalizeParentId(params.parentId)
    if (parentId) {
      const [target] = await tx
        .select({ id: workspaceFileFolder.id })
        .from(workspaceFileFolder)
        .where(
          and(
            eq(workspaceFileFolder.id, parentId),
            eq(workspaceFileFolder.workspaceId, params.workspaceId),
            isNull(workspaceFileFolder.deletedAt)
          )
        )
        .limit(1)

      if (!target) {
        throw new Error('Target folder not found')
      }
    }

    const existingFolders = await tx
      .select({ id: workspaceFileFolder.id })
      .from(workspaceFileFolder)
      .where(
        and(
          eq(workspaceFileFolder.workspaceId, params.workspaceId),
          eq(workspaceFileFolder.name, name),
          folderParentCondition(parentId),
          isNull(workspaceFileFolder.deletedAt)
        )
      )
      .limit(1)

    if (existingFolders.length > 0) {
      throw new WorkspaceFileFolderConflictError(name)
    }

    const [sortOrderResult] = await tx
      .select({ minSortOrder: min(workspaceFileFolder.sortOrder) })
      .from(workspaceFileFolder)
      .where(
        and(
          eq(workspaceFileFolder.workspaceId, params.workspaceId),
          folderParentCondition(parentId),
          isNull(workspaceFileFolder.deletedAt)
        )
      )

    const id = generateId()
    try {
      const [inserted] = await tx
        .insert(workspaceFileFolder)
        .values({
          id,
          name,
          userId: params.userId,
          workspaceId: params.workspaceId,
          parentId,
          sortOrder:
            params.sortOrder ??
            (sortOrderResult?.minSortOrder != null ? sortOrderResult.minSortOrder - 1 : 0),
        })
        .returning()
      return inserted
    } catch (error) {
      if (getPostgresErrorCode(error) === '23505') {
        throw new WorkspaceFileFolderConflictError(name)
      }
      throw error
    }
  })

  return mapFolderWithPath(params.workspaceId, folder)
}

export async function ensureWorkspaceFileFolderPath(params: {
  workspaceId: string
  userId: string
  pathSegments: string[]
}): Promise<string | null> {
  if (params.pathSegments.length === 0) return null

  // Load all active folders once and build a lookup keyed by "name|parentId"
  // so we can resolve existing segments without a per-segment SELECT.
  const existingFolders = await db
    .select()
    .from(workspaceFileFolder)
    .where(
      and(
        eq(workspaceFileFolder.workspaceId, params.workspaceId),
        isNull(workspaceFileFolder.deletedAt)
      )
    )

  /** Key format: `${name}|${parentId ?? ''}` */
  const folderByNameParent = new Map<string, RawWorkspaceFileFolder>()
  for (const folder of existingFolders) {
    folderByNameParent.set(`${folder.name}|${folder.parentId ?? ''}`, folder)
  }

  let parentId: string | null = null

  for (const rawSegment of params.pathSegments) {
    const name = normalizeWorkspaceFileItemName(rawSegment, 'Folder')
    const lookupKey = `${name}|${parentId ?? ''}`

    const cached = folderByNameParent.get(lookupKey)
    if (cached) {
      parentId = cached.id
      continue
    }

    try {
      const created = await createWorkspaceFileFolder({
        workspaceId: params.workspaceId,
        userId: params.userId,
        name,
        parentId,
      })
      // Insert the newly created folder into the in-memory map so subsequent
      // segments in this path can find their parent without extra DB round trips.
      folderByNameParent.set(`${created.name}|${created.parentId ?? ''}`, {
        id: created.id,
        workspaceId: created.workspaceId,
        userId: created.userId,
        name: created.name,
        parentId: created.parentId,
        sortOrder: created.sortOrder,
        deletedAt: created.deletedAt,
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      })
      parentId = created.id
    } catch (error) {
      if (
        error instanceof WorkspaceFileFolderConflictError ||
        getPostgresErrorCode(error) === '23505'
      ) {
        // A concurrent request created this folder between our initial load and
        // the INSERT — fall back to a targeted SELECT to get its id.
        const concurrentExisting = await findRawWorkspaceFileFolderByName(
          params.workspaceId,
          name,
          parentId
        )
        if (concurrentExisting) {
          folderByNameParent.set(
            `${concurrentExisting.name}|${concurrentExisting.parentId ?? ''}`,
            concurrentExisting
          )
          parentId = concurrentExisting.id
          continue
        }
      }
      throw error
    }
  }

  return parentId
}

function collectDescendantFolderIds(
  folders: Array<Pick<WorkspaceFileFolderRecord, 'id' | 'parentId'>>,
  folderId: string
): string[] {
  const childrenByParent = new Map<string, string[]>()

  for (const folder of folders) {
    if (!folder.parentId) continue
    const children = childrenByParent.get(folder.parentId) ?? []
    children.push(folder.id)
    childrenByParent.set(folder.parentId, children)
  }

  const descendants: string[] = []
  const seen = new Set([folderId])
  const visit = (id: string) => {
    for (const childId of childrenByParent.get(id) ?? []) {
      if (seen.has(childId)) continue
      seen.add(childId)
      descendants.push(childId)
      visit(childId)
    }
  }
  visit(folderId)

  return descendants
}

export async function updateWorkspaceFileFolder(params: {
  workspaceId: string
  folderId: string
  name?: string
  parentId?: string | null
  sortOrder?: number
}): Promise<WorkspaceFileFolderRecord> {
  const folder = await db.transaction(async (tx) => {
    await acquireWorkspaceFileFolderMutationLock(tx, params.workspaceId)

    const [existing] = await tx
      .select()
      .from(workspaceFileFolder)
      .where(
        and(
          eq(workspaceFileFolder.id, params.folderId),
          eq(workspaceFileFolder.workspaceId, params.workspaceId),
          isNull(workspaceFileFolder.deletedAt)
        )
      )
      .limit(1)

    if (!existing) throw new Error('Folder not found')

    const updates: Partial<typeof workspaceFileFolder.$inferInsert> = { updatedAt: new Date() }
    const finalName =
      params.name !== undefined
        ? normalizeWorkspaceFileItemName(params.name, 'Folder')
        : existing.name
    const finalParentId =
      params.parentId !== undefined ? normalizeParentId(params.parentId) : existing.parentId

    if (finalParentId === params.folderId) throw new Error('Folder cannot be its own parent')

    if (finalParentId) {
      const [target] = await tx
        .select({ id: workspaceFileFolder.id })
        .from(workspaceFileFolder)
        .where(
          and(
            eq(workspaceFileFolder.id, finalParentId),
            eq(workspaceFileFolder.workspaceId, params.workspaceId),
            isNull(workspaceFileFolder.deletedAt)
          )
        )
        .limit(1)

      if (!target) {
        throw new Error('Target folder not found')
      }
    }

    if (params.parentId !== undefined) {
      const activeFolders = await tx
        .select({ id: workspaceFileFolder.id, parentId: workspaceFileFolder.parentId })
        .from(workspaceFileFolder)
        .where(
          and(
            eq(workspaceFileFolder.workspaceId, params.workspaceId),
            isNull(workspaceFileFolder.deletedAt)
          )
        )

      const descendants = collectDescendantFolderIds(activeFolders, params.folderId)
      if (finalParentId && descendants.includes(finalParentId)) {
        throw new Error('Cannot move a folder into one of its descendants')
      }
    }

    if (finalName !== existing.name || finalParentId !== existing.parentId) {
      const conflictingFolders = await tx
        .select({ id: workspaceFileFolder.id })
        .from(workspaceFileFolder)
        .where(
          and(
            eq(workspaceFileFolder.workspaceId, params.workspaceId),
            eq(workspaceFileFolder.name, finalName),
            folderParentCondition(finalParentId),
            isNull(workspaceFileFolder.deletedAt)
          )
        )
        .limit(2)

      if (conflictingFolders.some((row) => row.id !== params.folderId)) {
        throw new WorkspaceFileFolderConflictError(finalName)
      }
    }

    if (params.name !== undefined) {
      updates.name = finalName
    }

    if (params.parentId !== undefined) {
      updates.parentId = finalParentId
    }

    if (params.sortOrder !== undefined) {
      updates.sortOrder = params.sortOrder
    }

    try {
      const [updatedFolder] = await tx
        .update(workspaceFileFolder)
        .set(updates)
        .where(
          and(
            eq(workspaceFileFolder.id, params.folderId),
            eq(workspaceFileFolder.workspaceId, params.workspaceId),
            isNull(workspaceFileFolder.deletedAt)
          )
        )
        .returning()

      if (!updatedFolder) throw new Error('Folder not found')
      return updatedFolder
    } catch (error) {
      if (getPostgresErrorCode(error) === '23505') {
        throw new WorkspaceFileFolderConflictError(finalName)
      }
      throw error
    }
  })

  return mapFolderWithPath(params.workspaceId, folder)
}

export async function fileNameExistsInWorkspaceFolder(
  workspaceId: string,
  fileName: string,
  folderId?: string | null,
  excludeFileId?: string
): Promise<boolean> {
  const rows = await db
    .select({ id: workspaceFiles.id })
    .from(workspaceFiles)
    .where(
      and(
        eq(workspaceFiles.workspaceId, workspaceId),
        eq(workspaceFiles.originalName, fileName),
        eq(workspaceFiles.context, 'workspace'),
        fileFolderCondition(folderId),
        isNull(workspaceFiles.deletedAt)
      )
    )
    .limit(2)

  return rows.some((row) => row.id !== excludeFileId)
}

export async function moveWorkspaceFileItems(params: {
  workspaceId: string
  fileIds?: string[]
  folderIds?: string[]
  targetFolderId?: string | null
}): Promise<{ movedFiles: number; movedFolders: number }> {
  const fileIds = Array.from(new Set(params.fileIds ?? []))
  const folderIds = Array.from(new Set(params.folderIds ?? []))
  const targetFolderId = normalizeParentId(params.targetFolderId)

  return db.transaction(async (tx) => {
    await acquireWorkspaceFileFolderMutationLock(tx, params.workspaceId)

    if (targetFolderId) {
      const [target] = await tx
        .select({ id: workspaceFileFolder.id })
        .from(workspaceFileFolder)
        .where(
          and(
            eq(workspaceFileFolder.id, targetFolderId),
            eq(workspaceFileFolder.workspaceId, params.workspaceId),
            isNull(workspaceFileFolder.deletedAt)
          )
        )
        .limit(1)

      if (!target) {
        throw new Error('Target folder not found')
      }
    }

    if (folderIds.includes(targetFolderId ?? '')) {
      throw new Error('Cannot move a folder into itself')
    }

    if (folderIds.length > 0) {
      const activeFolders = await tx
        .select({ id: workspaceFileFolder.id, parentId: workspaceFileFolder.parentId })
        .from(workspaceFileFolder)
        .where(
          and(
            eq(workspaceFileFolder.workspaceId, params.workspaceId),
            isNull(workspaceFileFolder.deletedAt)
          )
        )

      for (const folderId of folderIds) {
        const descendants = collectDescendantFolderIds(activeFolders, folderId)
        if (targetFolderId && descendants.includes(targetFolderId)) {
          throw new Error('Cannot move a folder into one of its descendants')
        }
      }
    }

    const movingFiles =
      fileIds.length > 0
        ? await tx
            .select({ id: workspaceFiles.id, name: workspaceFiles.originalName })
            .from(workspaceFiles)
            .where(
              and(
                inArray(workspaceFiles.id, fileIds),
                eq(workspaceFiles.workspaceId, params.workspaceId),
                eq(workspaceFiles.context, 'workspace'),
                isNull(workspaceFiles.deletedAt)
              )
            )
        : []

    const movingFolders =
      folderIds.length > 0
        ? await tx
            .select({ id: workspaceFileFolder.id, name: workspaceFileFolder.name })
            .from(workspaceFileFolder)
            .where(
              and(
                inArray(workspaceFileFolder.id, folderIds),
                eq(workspaceFileFolder.workspaceId, params.workspaceId),
                isNull(workspaceFileFolder.deletedAt)
              )
            )
        : []

    const movingFileIds = new Set(movingFiles.map((file) => file.id))
    const movingFolderIds = new Set(movingFolders.map((folder) => folder.id))
    const missingFileIds = [...new Set(fileIds)].filter((fileId) => !movingFileIds.has(fileId))
    const missingFolderIds = [...new Set(folderIds)].filter(
      (folderId) => !movingFolderIds.has(folderId)
    )
    if (missingFileIds.length > 0 || missingFolderIds.length > 0) {
      throw new WorkspaceFileItemsNotFoundError(missingFileIds, missingFolderIds)
    }

    for (const file of movingFiles) {
      const conflictingFiles = await tx
        .select({ id: workspaceFiles.id })
        .from(workspaceFiles)
        .where(
          and(
            eq(workspaceFiles.workspaceId, params.workspaceId),
            eq(workspaceFiles.originalName, file.name),
            eq(workspaceFiles.context, 'workspace'),
            fileFolderCondition(targetFolderId),
            isNull(workspaceFiles.deletedAt)
          )
        )
        .limit(2)

      if (conflictingFiles.some((row) => row.id !== file.id)) {
        throw new WorkspaceFileMoveConflictError(file.name)
      }
    }

    const movingFolderNameCounts = new Map<string, number>()
    for (const folder of movingFolders) {
      movingFolderNameCounts.set(folder.name, (movingFolderNameCounts.get(folder.name) ?? 0) + 1)
      const conflictingFolders = await tx
        .select({ id: workspaceFileFolder.id })
        .from(workspaceFileFolder)
        .where(
          and(
            eq(workspaceFileFolder.workspaceId, params.workspaceId),
            eq(workspaceFileFolder.name, folder.name),
            folderParentCondition(targetFolderId),
            isNull(workspaceFileFolder.deletedAt)
          )
        )
        .limit(2)

      if (conflictingFolders.some((row) => row.id !== folder.id)) {
        throw new WorkspaceFileFolderConflictError(folder.name)
      }
    }

    for (const [name, count] of movingFolderNameCounts) {
      if (count > 1) {
        throw new WorkspaceFileFolderConflictError(name)
      }
    }

    const movedFiles =
      fileIds.length > 0
        ? await tx
            .update(workspaceFiles)
            .set({ folderId: targetFolderId, updatedAt: new Date() })
            .where(
              and(
                inArray(workspaceFiles.id, fileIds),
                eq(workspaceFiles.workspaceId, params.workspaceId),
                eq(workspaceFiles.context, 'workspace'),
                isNull(workspaceFiles.deletedAt)
              )
            )
            .returning({ id: workspaceFiles.id })
        : []

    const movedFolders =
      folderIds.length > 0
        ? await tx
            .update(workspaceFileFolder)
            .set({ parentId: targetFolderId, updatedAt: new Date() })
            .where(
              and(
                inArray(workspaceFileFolder.id, folderIds),
                eq(workspaceFileFolder.workspaceId, params.workspaceId),
                isNull(workspaceFileFolder.deletedAt)
              )
            )
            .returning({ id: workspaceFileFolder.id })
        : []

    return { movedFiles: movedFiles.length, movedFolders: movedFolders.length }
  })
}

export async function archiveWorkspaceFileFolderRecursive(
  workspaceId: string,
  folderId: string
): Promise<WorkspaceFileArchiveResult> {
  const now = new Date()

  return db.transaction(async (tx) => {
    await acquireWorkspaceFileFolderMutationLock(tx, workspaceId)

    const [folder] = await tx
      .select({ id: workspaceFileFolder.id })
      .from(workspaceFileFolder)
      .where(
        and(
          eq(workspaceFileFolder.id, folderId),
          eq(workspaceFileFolder.workspaceId, workspaceId),
          isNull(workspaceFileFolder.deletedAt)
        )
      )
      .limit(1)

    if (!folder) throw new Error('Folder not found')

    const activeFolders = await tx
      .select({ id: workspaceFileFolder.id, parentId: workspaceFileFolder.parentId })
      .from(workspaceFileFolder)
      .where(
        and(eq(workspaceFileFolder.workspaceId, workspaceId), isNull(workspaceFileFolder.deletedAt))
      )
    const folderIds = [folderId, ...collectDescendantFolderIds(activeFolders, folderId)]

    const archivedFiles = await tx
      .update(workspaceFiles)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          inArray(workspaceFiles.folderId, folderIds),
          eq(workspaceFiles.workspaceId, workspaceId),
          eq(workspaceFiles.context, 'workspace'),
          isNull(workspaceFiles.deletedAt)
        )
      )
      .returning({ id: workspaceFiles.id })

    const archivedFolders = await tx
      .update(workspaceFileFolder)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          inArray(workspaceFileFolder.id, folderIds),
          eq(workspaceFileFolder.workspaceId, workspaceId),
          isNull(workspaceFileFolder.deletedAt)
        )
      )
      .returning({ id: workspaceFileFolder.id })

    logger.info('Archived workspace file folder recursively', {
      workspaceId,
      folderId,
      folders: archivedFolders.length,
      files: archivedFiles.length,
    })

    return { folders: archivedFolders.length, files: archivedFiles.length }
  })
}

export async function restoreWorkspaceFileFolder(
  workspaceId: string,
  folderId: string
): Promise<WorkspaceFileFolderRestoreResult> {
  const ws = await getWorkspaceWithOwner(workspaceId)
  if (!ws || ws.archivedAt) {
    throw new Error('Cannot restore folder into an archived workspace')
  }

  const { restored, restoredItems } = await db.transaction(async (tx) => {
    await acquireWorkspaceFileFolderMutationLock(tx, workspaceId)

    const raw = await tx
      .select()
      .from(workspaceFileFolder)
      .where(
        and(eq(workspaceFileFolder.id, folderId), eq(workspaceFileFolder.workspaceId, workspaceId))
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)

    if (!raw) throw new Error('Folder not found')
    if (!raw.deletedAt) throw new Error('Folder is not archived')

    const folderDeletedAt = raw.deletedAt

    // If the parent folder is still archived, restore to root so the folder
    // doesn't become an orphan (hidden under an archived parent).
    let resolvedParentId = raw.parentId
    if (resolvedParentId) {
      const parent = await tx
        .select({ deletedAt: workspaceFileFolder.deletedAt })
        .from(workspaceFileFolder)
        .where(
          and(
            eq(workspaceFileFolder.id, resolvedParentId),
            eq(workspaceFileFolder.workspaceId, workspaceId)
          )
        )
        .limit(1)
        .then((rows) => rows[0] ?? null)
      if (!parent || parent.deletedAt) resolvedParentId = null
    }

    const stats: WorkspaceFileArchiveResult = { folders: 0, files: 0 }
    const seen = new Set<string>()
    const restoreFolderSubtree = async (currentFolderId: string): Promise<void> => {
      if (seen.has(currentFolderId)) return
      seen.add(currentFolderId)

      const restoredFiles = await tx
        .update(workspaceFiles)
        .set({ deletedAt: null, updatedAt: new Date() })
        .where(
          and(
            eq(workspaceFiles.folderId, currentFolderId),
            eq(workspaceFiles.workspaceId, workspaceId),
            eq(workspaceFiles.context, 'workspace'),
            eq(workspaceFiles.deletedAt, folderDeletedAt)
          )
        )
        .returning({ id: workspaceFiles.id })
      stats.files += restoredFiles.length

      const archivedChildren = await tx
        .select({ id: workspaceFileFolder.id })
        .from(workspaceFileFolder)
        .where(
          and(
            eq(workspaceFileFolder.parentId, currentFolderId),
            eq(workspaceFileFolder.workspaceId, workspaceId),
            eq(workspaceFileFolder.deletedAt, folderDeletedAt)
          )
        )

      for (const child of archivedChildren) {
        const [restoredChild] = await tx
          .update(workspaceFileFolder)
          .set({ deletedAt: null, updatedAt: new Date() })
          .where(
            and(
              eq(workspaceFileFolder.id, child.id),
              eq(workspaceFileFolder.workspaceId, workspaceId),
              eq(workspaceFileFolder.deletedAt, folderDeletedAt)
            )
          )
          .returning({ id: workspaceFileFolder.id })

        if (!restoredChild) continue
        stats.folders += 1
        await restoreFolderSubtree(child.id)
      }
    }

    const [row] = await tx
      .update(workspaceFileFolder)
      .set({ deletedAt: null, parentId: resolvedParentId, updatedAt: new Date() })
      .where(
        and(eq(workspaceFileFolder.id, folderId), eq(workspaceFileFolder.workspaceId, workspaceId))
      )
      .returning()

    stats.folders += 1
    await restoreFolderSubtree(folderId)

    return { restored: row, restoredItems: stats }
  })

  logger.info('Restored workspace file folder', { workspaceId, folderId, restoredItems })

  const allFolders = await db
    .select()
    .from(workspaceFileFolder)
    .where(
      and(eq(workspaceFileFolder.workspaceId, workspaceId), isNull(workspaceFileFolder.deletedAt))
    )
  const paths = buildWorkspaceFileFolderPathMap(allFolders)
  return {
    folder: mapFolder(restored, paths),
    restoredItems,
  }
}

export async function bulkArchiveWorkspaceFileItems(params: {
  workspaceId: string
  fileIds?: string[]
  folderIds?: string[]
}): Promise<WorkspaceFileArchiveResult> {
  const now = new Date()
  const explicitFileIds = Array.from(new Set(params.fileIds ?? []))
  const explicitFolderIds = Array.from(new Set(params.folderIds ?? []))

  return db.transaction(async (tx) => {
    await acquireWorkspaceFileFolderMutationLock(tx, params.workspaceId)

    const activeFolders =
      explicitFolderIds.length > 0
        ? await tx
            .select({ id: workspaceFileFolder.id, parentId: workspaceFileFolder.parentId })
            .from(workspaceFileFolder)
            .where(
              and(
                eq(workspaceFileFolder.workspaceId, params.workspaceId),
                isNull(workspaceFileFolder.deletedAt)
              )
            )
        : []
    const descendantFolderIds = explicitFolderIds.flatMap((folderId) =>
      collectDescendantFolderIds(activeFolders, folderId)
    )
    const allFolderIds = Array.from(new Set([...explicitFolderIds, ...descendantFolderIds]))

    const archivedExplicitFiles =
      explicitFileIds.length > 0
        ? await tx
            .update(workspaceFiles)
            .set({ deletedAt: now, updatedAt: now })
            .where(
              and(
                inArray(workspaceFiles.id, explicitFileIds),
                eq(workspaceFiles.workspaceId, params.workspaceId),
                eq(workspaceFiles.context, 'workspace'),
                isNull(workspaceFiles.deletedAt)
              )
            )
            .returning({ id: workspaceFiles.id })
        : []

    const archivedDescendantFiles =
      allFolderIds.length > 0
        ? await tx
            .update(workspaceFiles)
            .set({ deletedAt: now, updatedAt: now })
            .where(
              and(
                inArray(workspaceFiles.folderId, allFolderIds),
                eq(workspaceFiles.workspaceId, params.workspaceId),
                eq(workspaceFiles.context, 'workspace'),
                isNull(workspaceFiles.deletedAt)
              )
            )
            .returning({ id: workspaceFiles.id })
        : []

    const archivedFolders =
      allFolderIds.length > 0
        ? await tx
            .update(workspaceFileFolder)
            .set({ deletedAt: now, updatedAt: now })
            .where(
              and(
                inArray(workspaceFileFolder.id, allFolderIds),
                eq(workspaceFileFolder.workspaceId, params.workspaceId),
                isNull(workspaceFileFolder.deletedAt)
              )
            )
            .returning({ id: workspaceFileFolder.id })
        : []

    return {
      folders: archivedFolders.length,
      files: new Set([...archivedExplicitFiles, ...archivedDescendantFiles].map((file) => file.id))
        .size,
    }
  })
}
