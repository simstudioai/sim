import { db } from '@sim/db'
import { workspaceFileFolder, workspaceFiles } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, asc, eq, inArray, isNull, min, type SQL, sql } from 'drizzle-orm'

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
  return folder ? mapFolderWithPath(workspaceId, folder, { includeDeleted }) : null
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

async function workspaceFileFolderExists(
  workspaceId: string,
  name: string,
  parentId?: string | null,
  excludeFolderId?: string
): Promise<boolean> {
  const rows = await db
    .select({ id: workspaceFileFolder.id })
    .from(workspaceFileFolder)
    .where(
      and(
        eq(workspaceFileFolder.workspaceId, workspaceId),
        eq(workspaceFileFolder.name, name),
        folderParentCondition(parentId),
        isNull(workspaceFileFolder.deletedAt)
      )
    )
    .limit(2)

  return rows.some((row) => row.id !== excludeFolderId)
}

async function nextFolderSortOrder(workspaceId: string, parentId?: string | null): Promise<number> {
  const [result] = await db
    .select({ minSortOrder: min(workspaceFileFolder.sortOrder) })
    .from(workspaceFileFolder)
    .where(
      and(
        eq(workspaceFileFolder.workspaceId, workspaceId),
        folderParentCondition(parentId),
        isNull(workspaceFileFolder.deletedAt)
      )
    )

  return result?.minSortOrder != null ? result.minSortOrder - 1 : 0
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

    const parentId = await assertWorkspaceFileFolderTarget(params.workspaceId, params.parentId)

    if (await workspaceFileFolderExists(params.workspaceId, name, parentId)) {
      throw new WorkspaceFileFolderConflictError(name)
    }

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
          sortOrder: params.sortOrder ?? (await nextFolderSortOrder(params.workspaceId, parentId)),
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
  let parentId: string | null = null
  for (const rawSegment of params.pathSegments) {
    const name = normalizeWorkspaceFileItemName(rawSegment, 'Folder')

    const existing = await findRawWorkspaceFileFolderByName(params.workspaceId, name, parentId)
    if (existing) {
      parentId = existing.id
      continue
    }

    try {
      parentId = (
        await createWorkspaceFileFolder({
          workspaceId: params.workspaceId,
          userId: params.userId,
          name,
          parentId,
        })
      ).id
    } catch (error) {
      if (
        error instanceof WorkspaceFileFolderConflictError ||
        getPostgresErrorCode(error) === '23505'
      ) {
        const concurrentExisting = await findRawWorkspaceFileFolderByName(
          params.workspaceId,
          name,
          parentId
        )
        if (concurrentExisting) {
          parentId = concurrentExisting.id
          continue
        }
      }
      throw error
    }
  }

  return parentId
}

async function getDescendantFolderIds(
  workspaceId: string,
  folderId: string,
  options?: { includeDeleted?: boolean }
): Promise<string[]> {
  const folders = await listWorkspaceFileFolders(workspaceId, {
    scope: options?.includeDeleted ? 'all' : 'active',
  })
  const childrenByParent = new Map<string, string[]>()

  for (const folder of folders) {
    if (!folder.parentId) continue
    const children = childrenByParent.get(folder.parentId) ?? []
    children.push(folder.id)
    childrenByParent.set(folder.parentId, children)
  }

  const descendants: string[] = []
  const visit = (id: string) => {
    for (const childId of childrenByParent.get(id) ?? []) {
      descendants.push(childId)
      visit(childId)
    }
  }
  visit(folderId)

  return descendants
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
  const visit = (id: string) => {
    for (const childId of childrenByParent.get(id) ?? []) {
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
  const existing = await getWorkspaceFileFolder(params.workspaceId, params.folderId)
  if (!existing) throw new Error('Folder not found')

  const updates: Partial<typeof workspaceFileFolder.$inferInsert> = { updatedAt: new Date() }
  const finalName =
    params.name !== undefined
      ? normalizeWorkspaceFileItemName(params.name, 'Folder')
      : existing.name
  const finalParentId =
    params.parentId !== undefined
      ? await assertWorkspaceFileFolderTarget(params.workspaceId, params.parentId)
      : existing.parentId

  if (finalParentId === params.folderId) throw new Error('Folder cannot be its own parent')

  if (params.parentId !== undefined) {
    const descendants = await getDescendantFolderIds(params.workspaceId, params.folderId)
    if (finalParentId && descendants.includes(finalParentId)) {
      throw new Error('Cannot move a folder into one of its descendants')
    }
  }

  if (
    (finalName !== existing.name || finalParentId !== existing.parentId) &&
    (await workspaceFileFolderExists(params.workspaceId, finalName, finalParentId, params.folderId))
  ) {
    throw new WorkspaceFileFolderConflictError(finalName)
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

  const [folder] = await db
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

  if (!folder) throw new Error('Folder not found')
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
  const targetFolderId = await assertWorkspaceFileFolderTarget(
    params.workspaceId,
    params.targetFolderId
  )

  if (folderIds.includes(targetFolderId ?? '')) {
    throw new Error('Cannot move a folder into itself')
  }

  for (const folderId of folderIds) {
    const descendants = await getDescendantFolderIds(params.workspaceId, folderId)
    if (targetFolderId && descendants.includes(targetFolderId)) {
      throw new Error('Cannot move a folder into one of its descendants')
    }
  }

  const movingFiles =
    fileIds.length > 0
      ? await db
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
      ? await db
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

  for (const file of movingFiles) {
    if (
      await fileNameExistsInWorkspaceFolder(params.workspaceId, file.name, targetFolderId, file.id)
    ) {
      throw new WorkspaceFileMoveConflictError(file.name)
    }
  }

  const movingFolderNameCounts = new Map<string, number>()
  for (const folder of movingFolders) {
    movingFolderNameCounts.set(folder.name, (movingFolderNameCounts.get(folder.name) ?? 0) + 1)
    if (
      await workspaceFileFolderExists(params.workspaceId, folder.name, targetFolderId, folder.id)
    ) {
      throw new WorkspaceFileFolderConflictError(folder.name)
    }
  }

  for (const [name, count] of movingFolderNameCounts) {
    if (count > 1) {
      throw new WorkspaceFileFolderConflictError(name)
    }
  }

  return db.transaction(async (tx) => {
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
