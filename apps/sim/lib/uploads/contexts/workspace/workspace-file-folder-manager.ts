import { db } from '@sim/db'
import { folder as folderTable, workspaceFiles, workspace as workspaceTable } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage, getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, isNull, min, sql } from 'drizzle-orm'
import { type ListSortOrder, listOrderBy } from '@/lib/api/list-query'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx, DbTransaction } from '@/lib/db/types'
import { FolderCollectionLimitExceededError } from '@/lib/folders/errors'
import { deduplicateFolderName, deduplicateFolderNameInScope } from '@/lib/folders/naming'
import {
  buildFolderPath,
  buildFolderPathIndex,
  FolderPathError,
  folderNameFromPath,
  parentFolderPath,
  parseFolderPath,
  requireNonRootFolderPath,
  resolveFolderMoveDestination,
} from '@/lib/folders/paths'
import { FOLDER_SORTS, type FolderSortBy } from '@/lib/folders/queries'
import {
  isWorkspaceFolder,
  requireWorkspaceFolder,
  requireWorkspaceFolderCreator,
} from '@/lib/folders/scope'
import { collectDescendantFolderIds } from '@/lib/folders/subtree'
import { lockWorkspaceProject } from '@/lib/projects/membership'
import {
  encodeWorkspaceFileFolderDisplaySegment,
  folderPathSegments,
} from '@/lib/workspace-files/folder-display-path'
import { MAX_WORKSPACE_FILE_BULK_AFFECTED_ITEMS } from '@/lib/workspace-files/limits'
import { lockFileDirectories } from '@/lib/workspace-files/locks'
import { type EditableFileOwner, editableFileOwnerColumns } from '@/lib/workspace-files/ownership'
import { fileFolderOwnerCondition, fileOwnerCondition } from '@/lib/workspace-files/ownership-query'
import { getWorkspaceWithOwner } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('WorkspaceFileFolders')

/**
 * File folders live in the generic `folder` table alongside workflow, knowledge-base, and
 * table folders. Every read and write here — id-keyed lookups included — carries this
 * predicate: folder ids are UUIDs and cannot collide, but nothing stops a caller from
 * handing a workflow folder's id to a file-folder endpoint.
 */
const FILE_FOLDER_RESOURCE_TYPE = 'file' as const
const isFileFolder = eq(folderTable.resourceType, FILE_FOLDER_RESOURCE_TYPE)

type WorkspaceFileFolderScope = 'active' | 'archived' | 'all'

/**
 * An {@link OrchestrationError} so every surface reaches 409 by class rather than each
 * adapter restating the translation. Carries the inherited `code: 'conflict'`; the old
 * `'FOLDER_CONFLICT'` discriminator had no readers.
 */
export class WorkspaceFileFolderConflictError extends OrchestrationError {
  constructor(name: string) {
    super('conflict', `A folder named "${name}" already exists in this location`)
    this.name = 'WorkspaceFileFolderConflictError'
  }
}

/**
 * An {@link OrchestrationError} so every surface reaches 409 by class. Carries the inherited
 * `code: 'conflict'`; the old `'FILE_MOVE_CONFLICT'` discriminator had no readers.
 */
export class WorkspaceFileMoveConflictError extends OrchestrationError {
  constructor(name: string) {
    super('conflict', `A file named "${name}" already exists in the destination folder`)
    this.name = 'WorkspaceFileMoveConflictError'
  }
}

/**
 * An {@link OrchestrationError} so every surface reaches 404 by class. Carries the inherited
 * `code: 'not_found'`; the old `'WORKSPACE_FILE_ITEMS_NOT_FOUND'` discriminator had no readers.
 */
export class WorkspaceFileItemsNotFoundError extends OrchestrationError {
  constructor(fileIds: string[], folderIds: string[]) {
    const parts = [
      fileIds.length > 0 ? `files: ${fileIds.join(', ')}` : null,
      folderIds.length > 0 ? `folders: ${folderIds.join(', ')}` : null,
    ].filter(Boolean)
    super('not_found', `Workspace file items not found (${parts.join('; ')})`)
    this.name = 'WorkspaceFileItemsNotFoundError'
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

type FileFolderRecord<O extends EditableFileOwner = EditableFileOwner> = Omit<
  WorkspaceFileFolderRecord,
  'workspaceId'
> & {
  owner: O
}

interface FileFolderListOptions {
  scope?: WorkspaceFileFolderScope
  sortBy?: FolderSortBy
  sortOrder?: ListSortOrder
}

export interface WorkspaceFileOperationContext {
  workspaceId: string
  workspaceOrganizationId: string | null
  allowPersonalApiKeys: boolean
  billedAccountUserId: string
}

/**
 * Loads the active workspace authorization context for folder and bulk-file operations.
 * The workspace row is the canonical scope; callers must not authorize from a caller-supplied
 * folder or file workspace id.
 */
export async function loadWorkspaceFileOperationContext(
  workspaceId: string
): Promise<WorkspaceFileOperationContext | null> {
  const workspace = await getWorkspaceWithOwner(workspaceId)
  if (!workspace) return null
  const [settings] = await db
    .select({ allowPersonalApiKeys: workspaceTable.allowPersonalApiKeys })
    .from(workspaceTable)
    .where(eq(workspaceTable.id, workspaceId))
    .limit(1)
  return {
    workspaceId: workspace.id,
    workspaceOrganizationId: workspace.organizationId,
    allowPersonalApiKeys: settings?.allowPersonalApiKeys ?? false,
    billedAccountUserId: workspace.billedAccountUserId,
  }
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

export interface WorkspaceFileArchiveResult {
  folders: number
  files: number
}

export interface WorkspaceFileBulkArchiveResult extends WorkspaceFileArchiveResult {
  folderIds: string[]
  fileIds: string[]
}

function assertBulkAffectedItemsWithinLimit(count: number): void {
  if (count > MAX_WORKSPACE_FILE_BULK_AFFECTED_ITEMS) {
    throw new OrchestrationError(
      'validation',
      `File operation affects more than ${MAX_WORKSPACE_FILE_BULK_AFFECTED_ITEMS} items`
    )
  }
}

/**
 * Verifies every requested active file/folder belongs to this workspace before a bulk mutation.
 * This prevents the bulk archive primitive's workspace predicate from silently turning an
 * out-of-scope id into a successful zero-row operation.
 */
export async function assertWorkspaceFileItemsBelongToWorkspace(params: {
  workspaceId: string
  fileIds?: string[]
  folderIds?: string[]
}): Promise<void> {
  return assertFileItemsBelongToOwner({
    ...params,
    owner: { entityType: 'workspace', entityId: params.workspaceId },
  })
}

/** Requires every selected active file and folder to belong to the canonical owner. */
async function assertFileItemsBelongToOwner(
  params: {
    owner: EditableFileOwner
    fileIds?: string[]
    folderIds?: string[]
  },
  client: DbOrTx = db
): Promise<void> {
  const fileIds = Array.from(new Set(params.fileIds ?? []))
  const folderIds = Array.from(new Set(params.folderIds ?? []))
  const [files, folders] = await Promise.all([
    fileIds.length === 0
      ? Promise.resolve([])
      : client
          .select({ id: workspaceFiles.id })
          .from(workspaceFiles)
          .where(
            and(
              inArray(workspaceFiles.id, fileIds),
              fileOwnerCondition(params.owner),
              isNull(workspaceFiles.deletedAt)
            )
          ),
    folderIds.length === 0
      ? Promise.resolve([])
      : client
          .select({ id: folderTable.id })
          .from(folderTable)
          .where(
            and(
              inArray(folderTable.id, folderIds),
              fileFolderOwnerCondition(params.owner),
              isFileFolder,
              isNull(folderTable.deletedAt)
            )
          ),
  ])
  const foundFiles = new Set(files.map((file) => file.id))
  const foundFolders = new Set(folders.map((folder) => folder.id))
  const missingFiles = fileIds.filter((id) => !foundFiles.has(id))
  const missingFolders = folderIds.filter((id) => !foundFolders.has(id))
  if (missingFiles.length > 0 || missingFolders.length > 0) {
    throw new WorkspaceFileItemsNotFoundError(missingFiles, missingFolders)
  }
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
  return normalized ? eq(folderTable.parentId, normalized) : isNull(folderTable.parentId)
}

/**
 * Folder predicate for active-name lookups, spelled exactly as the
 * `workspace_files_workspace_folder_name_active_unique` index expression so the
 * planner can use the index as a point lookup at the root as well as in a folder.
 */
export function workspaceFileNameFolderCondition(folderId?: string | null) {
  return sql`coalesce(${workspaceFiles.folderId}, '') = ${folderId ?? ''}`
}

async function acquireWorkspaceFileFolderMutationLock(tx: DbTransaction, workspaceId: string) {
  await lockWorkspaceProject(tx, workspaceId)
  await lockFileDirectories(tx, [{ entityType: 'workspace', entityId: workspaceId }])
}

async function acquireFileFolderMutationLock(tx: DbTransaction, owner: EditableFileOwner) {
  if (owner.entityType === 'workspace') await lockWorkspaceProject(tx, owner.entityId)
  await lockFileDirectories(tx, [owner])
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
    const encodedName = encodeWorkspaceFileFolderDisplaySegment(folder.name)
    const path = parentPath ? `${parentPath}/${encodedName}` : encodedName
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
  return workspaceFolderRecord(
    mapFileFolder(folder, { entityType: 'workspace', entityId: folder.workspaceId }, paths)
  )
}

function workspaceFolderRecord(folder: FileFolderRecord): WorkspaceFileFolderRecord {
  if (folder.owner.entityType !== 'workspace')
    throw new OrchestrationError('not_found', 'Folder not found')
  const { owner, ...record } = folder
  return { ...record, workspaceId: owner.entityId }
}

function mapFileFolder<O extends EditableFileOwner>(
  folder: Omit<RawWorkspaceFileFolder, 'workspaceId'>,
  owner: O,
  paths: Map<string, string>
): FileFolderRecord<O> {
  return {
    id: folder.id,
    owner,
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
    .from(folderTable)
    .where(
      includeDeleted
        ? and(eq(folderTable.id, folderId), eq(folderTable.workspaceId, workspaceId), isFileFolder)
        : and(
            eq(folderTable.id, folderId),
            eq(folderTable.workspaceId, workspaceId),
            isFileFolder,
            isNull(folderTable.deletedAt)
          )
    )
    .limit(1)

  return folder && isWorkspaceFolder(folder, workspaceId) ? folder : null
}

async function findRawWorkspaceFileFolderByName(
  workspaceId: string,
  name: string,
  parentId?: string | null
): Promise<RawWorkspaceFileFolder | null> {
  const [folder] = await db
    .select()
    .from(folderTable)
    .where(
      and(
        eq(folderTable.workspaceId, workspaceId),
        isFileFolder,
        eq(folderTable.name, name),
        folderParentCondition(parentId),
        isNull(folderTable.deletedAt)
      )
    )
    .limit(1)

  return folder && isWorkspaceFolder(folder, workspaceId) ? folder : null
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

  return segments.map(encodeWorkspaceFileFolderDisplaySegment).join('/')
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

/**
 * Selects the minimal columns needed to resolve every file folder's canonical path.
 *
 * Includes archived rows: an archived folder can still have an active ancestor, so a
 * path map built only from archived rows truncates its path to the bare folder name.
 */
async function selectFileFolderPathRows(
  owner: EditableFileOwner,
  client: DbOrTx
): Promise<Array<Pick<RawWorkspaceFileFolder, 'id' | 'name' | 'parentId'>>> {
  return client
    .select({ id: folderTable.id, name: folderTable.name, parentId: folderTable.parentId })
    .from(folderTable)
    .where(fileFolderOwnerCondition(owner))
}

/**
 * Lists a workspace's file folders, ordered in the database like every other folder
 * list so a name sort uses the same collation and the same `createdAt` tiebreak.
 * Defaults to `position` — `sortOrder ASC, createdAt ASC` — which honours a user's
 * manual ordering and is what surfaces reading the payload positionally expect.
 */
export async function listWorkspaceFileFolders(
  workspaceId: string,
  options?: FileFolderListOptions
): Promise<WorkspaceFileFolderRecord[]> {
  const folders = await listFileFolders({ entityType: 'workspace', entityId: workspaceId }, options)
  return folders.map(workspaceFolderRecord)
}

/** Lists folders within one canonical owner; transaction callers retain their authorization locks. */
export async function listFileFolders<O extends EditableFileOwner>(
  owner: O,
  options?: FileFolderListOptions,
  client: DbOrTx = db
): Promise<FileFolderRecord<O>[]> {
  const { scope = 'active', sortBy = 'position', sortOrder = 'asc' } = options ?? {}
  const rows = await client
    .select()
    .from(folderTable)
    .where(
      scope === 'all'
        ? fileFolderOwnerCondition(owner)
        : scope === 'archived'
          ? and(fileFolderOwnerCondition(owner), sql`${folderTable.deletedAt} IS NOT NULL`)
          : and(fileFolderOwnerCondition(owner), isNull(folderTable.deletedAt))
    )
    .orderBy(...listOrderBy(FOLDER_SORTS[sortBy], sortOrder))

  const paths = buildWorkspaceFileFolderPathMap(
    scope === 'archived' ? await selectFileFolderPathRows(owner, client) : rows
  )
  return rows.map((row) => mapFileFolder(row, owner, paths))
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
    .from(folderTable)
    .where(
      includeDeleted
        ? and(eq(folderTable.workspaceId, workspaceId), isFileFolder)
        : and(eq(folderTable.workspaceId, workspaceId), isFileFolder, isNull(folderTable.deletedAt))
    )

  const paths = buildWorkspaceFileFolderPathMap(allFolders)
  return mapFolder(folder, paths)
}

async function getFileFolder<O extends EditableFileOwner>(
  owner: O,
  folderId: string,
  client: DbOrTx
): Promise<FileFolderRecord<O> | null> {
  const [row] = await client
    .select()
    .from(folderTable)
    .where(
      and(
        fileFolderOwnerCondition(owner),
        eq(folderTable.id, folderId),
        isNull(folderTable.deletedAt)
      )
    )
    .limit(1)
  if (!row) return null
  const paths = buildWorkspaceFileFolderPathMap(await selectFileFolderPathRows(owner, client))
  return mapFileFolder(row, owner, paths)
}

/** Resolves one active folder by ID or path within the authorized owner. */
export async function resolveFileFolderTarget<O extends EditableFileOwner>(
  owner: O,
  target: { folderId?: string | null; folderPath?: string },
  client: DbOrTx = db
): Promise<FileFolderRecord<O> | null> {
  if (target.folderId !== undefined && target.folderPath !== undefined) {
    throw new OrchestrationError('validation', 'Specify either folderId or folderPath, not both')
  }
  let folderId = normalizeParentId(target.folderId)
  if (target.folderPath !== undefined) {
    const path = buildFolderPath(folderPathSegments(target.folderPath))
    if (path === '/') return null
    const rows = await selectFileFolderPathRows(owner, client)
    folderId = buildFolderPathIndex(rows).idByPath.get(path) ?? null
    if (!folderId) throw new OrchestrationError('not_found', 'Target folder not found')
  }
  if (!folderId) return null
  const folder = await getFileFolder(owner, folderId, client)
  if (!folder) throw new OrchestrationError('not_found', 'Target folder not found')
  return folder
}

export async function resolveWorkspaceFileFolderTarget(
  workspaceId: string,
  folderId?: string | null
): Promise<WorkspaceFileFolderRecord | null> {
  const folder = await resolveFileFolderTarget(
    { entityType: 'workspace', entityId: workspaceId },
    { folderId }
  )
  if (!folder) return null
  return workspaceFolderRecord(folder)
}

/** Checks an active destination without treating a foreign folder ID as a root selection. */
export async function assertFileFolderTarget(
  owner: EditableFileOwner,
  folderId?: string | null,
  client: DbOrTx = db
): Promise<string | null> {
  const normalized = normalizeParentId(folderId)
  if (!normalized) return null
  const [folder] = await client
    .select({ id: folderTable.id })
    .from(folderTable)
    .where(
      and(
        eq(folderTable.id, normalized),
        fileFolderOwnerCondition(owner),
        isNull(folderTable.deletedAt)
      )
    )
    .limit(1)
  if (!folder) throw new OrchestrationError('not_found', 'Target folder not found')
  return folder.id
}

export async function assertWorkspaceFileFolderTarget(
  workspaceId: string,
  folderId?: string | null,
  executor: DbOrTx = db
): Promise<string | null> {
  return assertFileFolderTarget(
    { entityType: 'workspace', entityId: workspaceId },
    folderId,
    executor
  )
}

interface CreateFileFolderParams<O extends EditableFileOwner> {
  owner: O
  userId: string
  name: string
  parentId?: string | null
  sortOrder?: number
  exactName?: boolean
  /** Validates the exact post-deduplication name before the folder row is inserted. */
  validateResolvedName?: (name: string) => void
}

export async function createWorkspaceFileFolder(
  params: Omit<CreateFileFolderParams<EditableFileOwner>, 'owner'> & { workspaceId: string }
): Promise<WorkspaceFileFolderRecord> {
  const folder = await db.transaction((tx) =>
    createFileFolder(
      {
        ...params,
        owner: { entityType: 'workspace', entityId: params.workspaceId },
      },
      tx
    )
  )
  return workspaceFolderRecord(folder)
}

/** Creates one folder under the caller's owner transaction and the shared hierarchy lock. */
export async function createFileFolder<O extends EditableFileOwner>(
  params: CreateFileFolderParams<O>,
  tx: DbTransaction
): Promise<FileFolderRecord<O>> {
  const requestedName = normalizeWorkspaceFileItemName(params.name, 'Folder')
  await acquireFileFolderMutationLock(tx, params.owner)
  const parentId = await assertFileFolderTarget(params.owner, params.parentId, tx)
  const ownerCondition = fileFolderOwnerCondition(params.owner)
  const deduplicate = params.exactName === false
  const name = deduplicate
    ? params.owner.entityType === 'workspace'
      ? await deduplicateFolderName(
          tx,
          params.owner.entityId,
          parentId,
          requestedName,
          FILE_FOLDER_RESOURCE_TYPE
        )
      : await deduplicateFolderNameInScope(tx, ownerCondition, parentId, requestedName)
    : requestedName
  params.validateResolvedName?.(name)
  if (!deduplicate) {
    const existing = await tx
      .select({ id: folderTable.id })
      .from(folderTable)
      .where(
        and(
          ownerCondition,
          eq(folderTable.name, name),
          folderParentCondition(parentId),
          isNull(folderTable.deletedAt)
        )
      )
      .limit(1)
    if (existing.length) throw new WorkspaceFileFolderConflictError(name)
  }
  const [sortOrderResult] = await tx
    .select({ minSortOrder: min(folderTable.sortOrder) })
    .from(folderTable)
    .where(and(ownerCondition, folderParentCondition(parentId), isNull(folderTable.deletedAt)))
  let inserted: typeof folderTable.$inferSelect
  try {
    const now = new Date()
    const [row] = await tx
      .insert(folderTable)
      .values({
        id: generateId(),
        resourceType: FILE_FOLDER_RESOURCE_TYPE,
        name,
        userId: params.userId,
        ...editableFileOwnerColumns(params.owner),
        parentId,
        sortOrder:
          params.sortOrder ??
          (sortOrderResult?.minSortOrder != null ? sortOrderResult.minSortOrder - 1 : 0),
        createdAt: now,
        updatedAt: now,
      })
      .returning()
    if (!row) throw new OrchestrationError('internal', 'Folder creation did not return a record')
    inserted = row
  } catch (error) {
    if (getPostgresErrorCode(error) === '23505') throw new WorkspaceFileFolderConflictError(name)
    throw error
  }
  const paths = buildWorkspaceFileFolderPathMap(await selectFileFolderPathRows(params.owner, tx))
  return mapFileFolder(inserted, params.owner, paths)
}

/**
 * Outcome of {@link ensureWorkspaceFileFolderPath}. `createdFolderIds` lists only the
 * folders this call actually inserted, outermost-first, so a caller that has to unwind
 * a partial write can delete exactly what it added (reverse the list for deepest-first)
 * without ever touching a folder that was merely reused.
 */
export interface EnsureWorkspaceFileFolderPathOutcome {
  /** Id of the deepest folder, or `null` when the path resolves to the root. */
  folderId: string | null
  /** Ids inserted by this call, in creation order (parents before children). */
  createdFolderIds: string[]
}

export async function ensureWorkspaceFileFolderPath(params: {
  workspaceId: string
  userId: string
  pathSegments: string[]
}): Promise<EnsureWorkspaceFileFolderPathOutcome> {
  if (params.pathSegments.length === 0) return { folderId: null, createdFolderIds: [] }

  const pathSegments = params.pathSegments.map((segment) =>
    normalizeWorkspaceFileItemName(segment, 'Folder')
  )
  try {
    buildFolderPath(pathSegments)
  } catch (error) {
    if (error instanceof FolderPathError) {
      throw new OrchestrationError('validation', error.message)
    }
    throw error
  }

  // Fast path: the whole chain already exists (the common case for repeated
  // writes into known folders) — per-segment indexed lookups instead of
  // loading the workspace's entire folder table.
  const existing = await findWorkspaceFileFolderIdByPath(params.workspaceId, pathSegments)
  if (existing) return { folderId: existing, createdFolderIds: [] }

  // Load all active folders once and build a lookup keyed by "name|parentId"
  // so we can resolve existing segments without a per-segment SELECT.
  const existingFolders = await db
    .select()
    .from(folderTable)
    .where(
      and(
        eq(folderTable.workspaceId, params.workspaceId),
        isFileFolder,
        isNull(folderTable.deletedAt)
      )
    )

  /** Key format: `${name}|${parentId ?? ''}` */
  const folderByNameParent = new Map<string, RawWorkspaceFileFolder>()
  for (const folder of existingFolders) {
    folderByNameParent.set(
      `${folder.name}|${folder.parentId ?? ''}`,
      requireWorkspaceFolder(folder, params.workspaceId)
    )
  }

  let parentId: string | null = null
  const createdFolderIds: string[] = []

  for (const name of pathSegments) {
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
      createdFolderIds.push(created.id)
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

  return { folderId: parentId, createdFolderIds }
}

interface UpdateFileFolderParams<O extends EditableFileOwner> {
  owner: O
  folderId: string
  name?: string
  parentId?: string | null
  sortOrder?: number
}

export async function updateWorkspaceFileFolder(
  params: Omit<UpdateFileFolderParams<EditableFileOwner>, 'owner'> & { workspaceId: string }
): Promise<WorkspaceFileFolderRecord> {
  const folder = await db.transaction((tx) =>
    updateFileFolder(
      {
        ...params,
        owner: { entityType: 'workspace', entityId: params.workspaceId },
      },
      tx
    )
  )
  return workspaceFolderRecord(folder)
}

/** Renames or moves one folder while preserving its canonical owner and subtree identity. */
export async function updateFileFolder<O extends EditableFileOwner>(
  params: UpdateFileFolderParams<O>,
  tx: DbTransaction
): Promise<FileFolderRecord<O>> {
  await acquireFileFolderMutationLock(tx, params.owner)
  const ownerCondition = fileFolderOwnerCondition(params.owner)
  const [existing] = await tx
    .select()
    .from(folderTable)
    .where(and(ownerCondition, eq(folderTable.id, params.folderId), isNull(folderTable.deletedAt)))
    .limit(1)
  if (!existing) throw new OrchestrationError('not_found', 'Folder not found')
  const finalName =
    params.name === undefined
      ? existing.name
      : normalizeWorkspaceFileItemName(params.name, 'Folder')
  const finalParentId =
    params.parentId === undefined ? existing.parentId : normalizeParentId(params.parentId)
  if (finalParentId === params.folderId)
    throw new OrchestrationError('validation', 'Folder cannot be its own parent')
  await assertFileFolderTarget(params.owner, finalParentId, tx)
  if (params.parentId !== undefined) {
    const activeFolders = await tx
      .select({ id: folderTable.id, parentId: folderTable.parentId })
      .from(folderTable)
      .where(and(ownerCondition, isNull(folderTable.deletedAt)))
      .limit(MAX_WORKSPACE_FILE_BULK_AFFECTED_ITEMS + 1)
    assertBulkAffectedItemsWithinLimit(activeFolders.length)
    if (
      finalParentId &&
      collectDescendantFolderIds(activeFolders, params.folderId).includes(finalParentId)
    ) {
      throw new OrchestrationError('validation', 'Cannot move a folder into one of its descendants')
    }
  }
  if (finalName !== existing.name || finalParentId !== existing.parentId) {
    const siblings = await tx
      .select({ id: folderTable.id })
      .from(folderTable)
      .where(
        and(
          ownerCondition,
          eq(folderTable.name, finalName),
          folderParentCondition(finalParentId),
          isNull(folderTable.deletedAt)
        )
      )
      .limit(2)
    if (siblings.some((row) => row.id !== params.folderId))
      throw new WorkspaceFileFolderConflictError(finalName)
  }
  const updates: Partial<typeof folderTable.$inferInsert> = { updatedAt: new Date() }
  if (params.name !== undefined) updates.name = finalName
  if (params.parentId !== undefined) updates.parentId = finalParentId
  if (params.sortOrder !== undefined) updates.sortOrder = params.sortOrder
  let updated: typeof folderTable.$inferSelect
  try {
    const [row] = await tx
      .update(folderTable)
      .set(updates)
      .where(
        and(ownerCondition, eq(folderTable.id, params.folderId), isNull(folderTable.deletedAt))
      )
      .returning()
    if (!row) throw new OrchestrationError('not_found', 'Folder not found')
    updated = row
  } catch (error) {
    if (getPostgresErrorCode(error) === '23505')
      throw new WorkspaceFileFolderConflictError(finalName)
    throw error
  }
  const paths = buildWorkspaceFileFolderPathMap(await selectFileFolderPathRows(params.owner, tx))
  return mapFileFolder(updated, params.owner, paths)
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
        workspaceFileNameFolderCondition(folderId),
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
  targetFolderPath?: string
}) {
  return db.transaction((tx) =>
    moveFileItems(
      { ...params, owner: { entityType: 'workspace', entityId: params.workspaceId } },
      tx
    )
  )
}

export async function moveFileItems(
  params: {
    owner: EditableFileOwner
    fileIds?: string[]
    folderIds?: string[]
    targetFolderId?: string | null
    targetFolderPath?: string
  },
  tx: DbTransaction
): Promise<{
  movedFiles: number
  movedFolders: number
  movedFileIds: string[]
  movedFolderIds: string[]
}> {
  const fileIds = Array.from(new Set(params.fileIds ?? []))
  const folderIds = Array.from(new Set(params.folderIds ?? []))
  if (params.targetFolderId !== undefined && params.targetFolderPath !== undefined) {
    throw new OrchestrationError('validation', 'Specify a target folder id or path, not both')
  }

  await acquireFileFolderMutationLock(tx, params.owner)

  let targetFolderId = normalizeParentId(params.targetFolderId)
  if (params.targetFolderPath !== undefined) {
    try {
      parseFolderPath(params.targetFolderPath)
    } catch (error) {
      throw new OrchestrationError('validation', getErrorMessage(error))
    }
    const index = await loadActiveFileFolderPathIndex(params.owner, tx)
    const resolved =
      params.targetFolderPath === '/' ? null : index.idByPath.get(params.targetFolderPath)
    if (resolved === undefined) {
      throw new OrchestrationError('not_found', 'Target folder not found')
    }
    targetFolderId = resolved
  }

  if (targetFolderId) {
    const [target] = await tx
      .select({ id: folderTable.id })
      .from(folderTable)
      .where(
        and(
          eq(folderTable.id, targetFolderId),
          fileFolderOwnerCondition(params.owner),
          isFileFolder,
          isNull(folderTable.deletedAt)
        )
      )
      .limit(1)

    if (!target) {
      throw new OrchestrationError('not_found', 'Target folder not found')
    }
  }

  if (folderIds.includes(targetFolderId ?? '')) {
    throw new OrchestrationError('validation', 'Cannot move a folder into itself')
  }

  if (folderIds.length > 0) {
    const activeFolders = await tx
      .select({ id: folderTable.id, parentId: folderTable.parentId })
      .from(folderTable)
      .where(
        and(fileFolderOwnerCondition(params.owner), isFileFolder, isNull(folderTable.deletedAt))
      )
      .limit(MAX_WORKSPACE_FILE_BULK_AFFECTED_ITEMS + 1)

    assertBulkAffectedItemsWithinLimit(activeFolders.length)

    const affectedFolderIds = new Set<string>()

    for (const folderId of folderIds) {
      const descendants = collectDescendantFolderIds(activeFolders, folderId)
      affectedFolderIds.add(folderId)
      for (const descendantId of descendants) affectedFolderIds.add(descendantId)
      if (targetFolderId && descendants.includes(targetFolderId)) {
        throw new OrchestrationError(
          'validation',
          'Cannot move a folder into one of its descendants'
        )
      }
    }

    assertBulkAffectedItemsWithinLimit(affectedFolderIds.size + fileIds.length)
    if (affectedFolderIds.size > 0) {
      const descendantFiles = await tx
        .select({ id: workspaceFiles.id })
        .from(workspaceFiles)
        .where(
          and(
            inArray(workspaceFiles.folderId, [...affectedFolderIds]),
            fileOwnerCondition(params.owner),
            isNull(workspaceFiles.deletedAt)
          )
        )
        .limit(MAX_WORKSPACE_FILE_BULK_AFFECTED_ITEMS + 1)
      const affectedFileIds = new Set([...fileIds, ...descendantFiles.map((file) => file.id)])
      assertBulkAffectedItemsWithinLimit(affectedFolderIds.size + affectedFileIds.size)
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
              fileOwnerCondition(params.owner),
              isNull(workspaceFiles.deletedAt)
            )
          )
      : []

  const movingFolders =
    folderIds.length > 0
      ? await tx
          .select({ id: folderTable.id, name: folderTable.name })
          .from(folderTable)
          .where(
            and(
              inArray(folderTable.id, folderIds),
              fileFolderOwnerCondition(params.owner),
              isFileFolder,
              isNull(folderTable.deletedAt)
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
          fileOwnerCondition(params.owner),
          eq(workspaceFiles.originalName, file.name),
          workspaceFileNameFolderCondition(targetFolderId),
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
      .select({ id: folderTable.id })
      .from(folderTable)
      .where(
        and(
          fileFolderOwnerCondition(params.owner),
          eq(folderTable.name, folder.name),
          folderParentCondition(targetFolderId),
          isFileFolder,
          isNull(folderTable.deletedAt)
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
              fileOwnerCondition(params.owner),
              isNull(workspaceFiles.deletedAt)
            )
          )
          .returning({ id: workspaceFiles.id })
      : []

  const movedFolders =
    folderIds.length > 0
      ? await tx
          .update(folderTable)
          .set({ parentId: targetFolderId, updatedAt: new Date() })
          .where(
            and(
              inArray(folderTable.id, folderIds),
              fileFolderOwnerCondition(params.owner),
              isFileFolder,
              isNull(folderTable.deletedAt)
            )
          )
          .returning({ id: folderTable.id })
      : []

  return {
    movedFiles: movedFiles.length,
    movedFolders: movedFolders.length,
    movedFileIds: movedFiles.map((file) => file.id),
    movedFolderIds: movedFolders.map((folder) => folder.id),
  }
}

export async function restoreWorkspaceFileFolder(
  workspaceId: string,
  folderId: string
): Promise<WorkspaceFileFolderRestoreResult> {
  const ws = await getWorkspaceWithOwner(workspaceId)
  if (!ws || ws.archivedAt) {
    throw new OrchestrationError('validation', 'Cannot restore folder into an archived workspace')
  }
  const result = await db.transaction((tx) =>
    restoreFileFolder({ entityType: 'workspace', entityId: workspaceId }, folderId, tx)
  )
  return { folder: workspaceFolderRecord(result.folder), restoredItems: result.restoredItems }
}

/** Restores the folder's archive batch, keeping independently archived descendants unchanged. */
export async function restoreFileFolder<O extends EditableFileOwner>(
  owner: O,
  folderId: string,
  tx: DbTransaction
) {
  await acquireFileFolderMutationLock(tx, owner)

  const raw = await tx
    .select()
    .from(folderTable)
    .where(and(eq(folderTable.id, folderId), fileFolderOwnerCondition(owner), isFileFolder))
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (!raw) {
    throw new OrchestrationError('not_found', 'Folder not found')
  }
  if (!raw.deletedAt) throw new OrchestrationError('validation', 'Folder is not archived')

  const folderDeletedAt = raw.deletedAt

  // If the parent folder is still archived, restore to root so the folder
  // doesn't become an orphan (hidden under an archived parent).
  let resolvedParentId = raw.parentId
  if (resolvedParentId) {
    const parent = await tx
      .select({ deletedAt: folderTable.deletedAt })
      .from(folderTable)
      .where(
        and(eq(folderTable.id, resolvedParentId), fileFolderOwnerCondition(owner), isFileFolder)
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (!parent || parent.deletedAt) resolvedParentId = null
  }

  // Clearing `deletedAt` below brings this row back under the partial unique index on
  // active (workspaceId, resourceType, parentId, name). The caller cannot rename an
  // archived folder, so a sibling that took the name while this folder was gone would
  // otherwise make it permanently unrestorable — dedupe instead of erroring. Deduped
  // against the RESOLVED parent, which re-roots when the original parent is still
  // archived. Only the restore root can collide: descendants come back alongside the
  // exact siblings they were archived with.
  const restoredName = await deduplicateFolderNameInScope(
    tx,
    fileFolderOwnerCondition(owner),
    resolvedParentId,
    raw.name
  )
  if (restoredName !== raw.name) {
    logger.info('Renamed file folder on restore to avoid a sibling name conflict', {
      owner,
      folderId,
      from: raw.name,
      to: restoredName,
    })
  }

  const stats: WorkspaceFileArchiveResult = { folders: 0, files: 0 }
  const restoredFileIds: string[] = []
  const seen = new Set<string>()
  const restoreFolderSubtree = async (currentFolderId: string): Promise<void> => {
    if (seen.has(currentFolderId)) return
    seen.add(currentFolderId)

    const pendingFiles = await tx
      .select({ id: workspaceFiles.id })
      .from(workspaceFiles)
      .where(
        and(
          fileOwnerCondition(owner),
          eq(workspaceFiles.folderId, currentFolderId),
          eq(workspaceFiles.deletedAt, folderDeletedAt)
        )
      )
      .limit(MAX_WORKSPACE_FILE_BULK_AFFECTED_ITEMS - stats.files - stats.folders + 1)
    assertBulkAffectedItemsWithinLimit(stats.files + stats.folders + pendingFiles.length)
    const restoredFiles =
      pendingFiles.length > 0
        ? await tx
            .update(workspaceFiles)
            .set({ deletedAt: null, updatedAt: new Date() })
            .where(
              and(
                inArray(
                  workspaceFiles.id,
                  pendingFiles.map((file) => file.id)
                ),
                fileOwnerCondition(owner),
                eq(workspaceFiles.deletedAt, folderDeletedAt)
              )
            )
            .returning({ id: workspaceFiles.id })
        : []
    restoredFileIds.push(...restoredFiles.map((file) => file.id))
    stats.files += restoredFiles.length
    assertBulkAffectedItemsWithinLimit(stats.files + stats.folders)

    const archivedChildren = await tx
      .select({ id: folderTable.id })
      .from(folderTable)
      .where(
        and(
          eq(folderTable.parentId, currentFolderId),
          fileFolderOwnerCondition(owner),
          isFileFolder,
          eq(folderTable.deletedAt, folderDeletedAt)
        )
      )
      .limit(MAX_WORKSPACE_FILE_BULK_AFFECTED_ITEMS + 1)
    assertBulkAffectedItemsWithinLimit(stats.files + stats.folders + archivedChildren.length)

    for (const child of archivedChildren) {
      const [restoredChild] = await tx
        .update(folderTable)
        .set({ deletedAt: null, updatedAt: new Date() })
        .where(
          and(
            eq(folderTable.id, child.id),
            fileFolderOwnerCondition(owner),
            isFileFolder,
            eq(folderTable.deletedAt, folderDeletedAt)
          )
        )
        .returning({ id: folderTable.id })

      if (!restoredChild) continue
      stats.folders += 1
      assertBulkAffectedItemsWithinLimit(stats.files + stats.folders)
      await restoreFolderSubtree(child.id)
    }
  }

  const [row] = await tx
    .update(folderTable)
    .set({
      deletedAt: null,
      parentId: resolvedParentId,
      name: restoredName,
      updatedAt: new Date(),
    })
    .where(and(eq(folderTable.id, folderId), fileFolderOwnerCondition(owner), isFileFolder))
    .returning()

  if (!row) throw new OrchestrationError('not_found', 'Folder not found')
  stats.folders += 1
  assertBulkAffectedItemsWithinLimit(stats.files + stats.folders)
  await restoreFolderSubtree(folderId)

  const paths = buildWorkspaceFileFolderPathMap(await selectFileFolderPathRows(owner, tx))
  return { folder: mapFileFolder(row, owner, paths), restoredItems: stats, restoredFileIds }
}

export async function bulkArchiveWorkspaceFileItems(params: {
  workspaceId: string
  fileIds?: string[]
  folderIds?: string[]
}) {
  return db.transaction((tx) =>
    archiveFileItems(
      { ...params, owner: { entityType: 'workspace', entityId: params.workspaceId } },
      tx
    )
  )
}

export async function archiveFileItems(
  params: {
    owner: EditableFileOwner
    fileIds?: string[]
    folderIds?: string[]
  },
  tx: DbTransaction
): Promise<WorkspaceFileBulkArchiveResult> {
  const now = new Date()
  const explicitFileIds = Array.from(new Set(params.fileIds ?? []))
  const explicitFolderIds = Array.from(new Set(params.folderIds ?? []))

  await acquireFileFolderMutationLock(tx, params.owner)
  await assertFileItemsBelongToOwner(params, tx)

  const activeFolders =
    explicitFolderIds.length > 0
      ? await tx
          .select({ id: folderTable.id, parentId: folderTable.parentId })
          .from(folderTable)
          .where(
            and(fileFolderOwnerCondition(params.owner), isFileFolder, isNull(folderTable.deletedAt))
          )
          .limit(MAX_WORKSPACE_FILE_BULK_AFFECTED_ITEMS + 1)
      : []
  assertBulkAffectedItemsWithinLimit(activeFolders.length)
  const descendantFolderIds = explicitFolderIds.flatMap((folderId) =>
    collectDescendantFolderIds(activeFolders, folderId)
  )
  const allFolderIds = Array.from(new Set([...explicitFolderIds, ...descendantFolderIds]))
  assertBulkAffectedItemsWithinLimit(allFolderIds.length + explicitFileIds.length)

  const descendantFiles =
    allFolderIds.length > 0
      ? await tx
          .select({ id: workspaceFiles.id })
          .from(workspaceFiles)
          .where(
            and(
              inArray(workspaceFiles.folderId, allFolderIds),
              fileOwnerCondition(params.owner),
              isNull(workspaceFiles.deletedAt)
            )
          )
          .limit(MAX_WORKSPACE_FILE_BULK_AFFECTED_ITEMS + 1)
      : []
  const affectedFileIds = new Set([...explicitFileIds, ...descendantFiles.map((file) => file.id)])
  assertBulkAffectedItemsWithinLimit(allFolderIds.length + affectedFileIds.size)

  const archivedExplicitFiles =
    explicitFileIds.length > 0
      ? await tx
          .update(workspaceFiles)
          .set({ deletedAt: now, updatedAt: now })
          .where(
            and(
              inArray(workspaceFiles.id, explicitFileIds),
              fileOwnerCondition(params.owner),
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
              fileOwnerCondition(params.owner),
              isNull(workspaceFiles.deletedAt)
            )
          )
          .returning({ id: workspaceFiles.id })
      : []

  const archivedFolders =
    allFolderIds.length > 0
      ? await tx
          .update(folderTable)
          .set({ deletedAt: now, updatedAt: now })
          .where(
            and(
              inArray(folderTable.id, allFolderIds),
              fileFolderOwnerCondition(params.owner),
              isFileFolder,
              isNull(folderTable.deletedAt)
            )
          )
          .returning({ id: folderTable.id })
      : []

  const archivedFileIds = Array.from(
    new Set([...archivedExplicitFiles, ...archivedDescendantFiles].map((file) => file.id))
  )
  const archivedFolderIds = archivedFolders.map((folder) => folder.id)
  return {
    folders: archivedFolderIds.length,
    files: archivedFileIds.length,
    folderIds: archivedFolderIds,
    fileIds: archivedFileIds,
  }
}

/** Loads a complete canonical owner tree, refusing a partial index when a bound is supplied. */
export async function loadActiveFileFolderPathIndex(
  owner: EditableFileOwner,
  client: DbOrTx = db,
  options?: { maxRows?: number }
) {
  const query = client
    .select()
    .from(folderTable)
    .where(and(fileFolderOwnerCondition(owner), isNull(folderTable.deletedAt)))
  const rows = options?.maxRows === undefined ? await query : await query.limit(options.maxRows + 1)
  if (options?.maxRows !== undefined && rows.length > options.maxRows) {
    throw new FolderCollectionLimitExceededError('path index', options.maxRows)
  }
  return buildFolderPathIndex(rows)
}

export interface WorkspaceFileFolderPathMutation {
  folder: typeof folderTable.$inferSelect & { workspaceId: string; userId: string }
  path: string
}

/** Creates one file-folder leaf with path resolution inside the file tree's mutation lock. */
export async function createWorkspaceFileFolderAtPath(params: {
  workspaceId: string
  userId: string
  path: string
}): Promise<WorkspaceFileFolderPathMutation> {
  requireNonRootFolderPath(params.path)
  const pathName = folderNameFromPath(params.path)
  let name: string
  try {
    name = normalizeWorkspaceFileItemName(pathName, 'Folder')
  } catch (error) {
    throw new OrchestrationError('validation', getErrorMessage(error))
  }
  if (name !== pathName) {
    throw new OrchestrationError('validation', 'Folder path leaf cannot have outer spaces')
  }

  const folder = await db.transaction(async (tx) => {
    await acquireWorkspaceFileFolderMutationLock(tx, params.workspaceId)
    const index = await loadActiveFileFolderPathIndex(
      { entityType: 'workspace', entityId: params.workspaceId },
      tx
    )
    if (index.idByPath.has(params.path)) throw new WorkspaceFileFolderConflictError(name)

    const parentPath = parentFolderPath(params.path)
    const parentId = parentPath === '/' ? null : index.idByPath.get(parentPath)
    if (parentPath !== '/' && !parentId) {
      throw new OrchestrationError('not_found', 'Parent folder not found')
    }

    const [sortOrderResult] = await tx
      .select({ minSortOrder: min(folderTable.sortOrder) })
      .from(folderTable)
      .where(
        and(
          eq(folderTable.workspaceId, params.workspaceId),
          isFileFolder,
          folderParentCondition(parentId),
          isNull(folderTable.deletedAt)
        )
      )

    const now = new Date()
    const [created] = await tx
      .insert(folderTable)
      .values({
        id: generateId(),
        resourceType: FILE_FOLDER_RESOURCE_TYPE,
        name,
        userId: params.userId,
        workspaceId: params.workspaceId,
        parentId,
        sortOrder: sortOrderResult?.minSortOrder != null ? sortOrderResult.minSortOrder - 1 : 0,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
    return requireWorkspaceFolderCreator(created, params.workspaceId)
  })

  return { folder, path: params.path }
}

/** Relocates one file folder while source and destination paths share the same tree lock. */
/** The validated leaf name a canonical folder path addresses. */
function workspaceFileFolderLeafName(path: string): string {
  const pathName = folderNameFromPath(path)
  let name: string
  try {
    name = normalizeWorkspaceFileItemName(pathName, 'Folder')
  } catch (error) {
    throw new OrchestrationError('validation', getErrorMessage(error))
  }
  if (name !== pathName) {
    throw new OrchestrationError('validation', 'Folder path leaf cannot have outer spaces')
  }
  return name
}

/**
 * Renames, moves, or both. A destination naming an existing folder — the root
 * included — receives the source as a child (`mv` semantics, see
 * {@link resolveFolderMoveDestination}); any other destination becomes the
 * source's new path. `path` on the result is where the folder actually landed.
 */
export async function relocateWorkspaceFileFolderByPath(params: {
  workspaceId: string
  path: string
  destinationPath: string
}): Promise<WorkspaceFileFolderPathMutation> {
  requireNonRootFolderPath(params.path)
  /** The root is a valid destination — "move to the top level" — so only canonical form is checked here. */
  parseFolderPath(params.destinationPath)

  return db.transaction(async (tx) => {
    await acquireWorkspaceFileFolderMutationLock(tx, params.workspaceId)
    const index = await loadActiveFileFolderPathIndex(
      { entityType: 'workspace', entityId: params.workspaceId },
      tx
    )
    const folderId = index.idByPath.get(params.path)
    if (!folderId) throw new OrchestrationError('not_found', 'Folder not found')
    /** Resolved under the lock, against the same index the collision check reads. */
    const destinationPath = resolveFolderMoveDestination(index, params.path, params.destinationPath)
    const name = workspaceFileFolderLeafName(destinationPath)
    if (index.idByPath.has(destinationPath)) {
      throw new WorkspaceFileFolderConflictError(name)
    }

    const destinationParentPath = parentFolderPath(destinationPath)
    if (
      destinationParentPath === params.path ||
      destinationParentPath.startsWith(`${params.path}/`)
    ) {
      throw new OrchestrationError('validation', 'Cannot move a folder into one of its descendants')
    }
    const parentId =
      destinationParentPath === '/' ? null : index.idByPath.get(destinationParentPath)
    if (destinationParentPath !== '/' && !parentId) {
      throw new OrchestrationError('not_found', 'Parent folder not found')
    }

    const [updated] = await tx
      .update(folderTable)
      .set({ name, parentId, updatedAt: new Date() })
      .where(
        and(
          eq(folderTable.id, folderId),
          eq(folderTable.workspaceId, params.workspaceId),
          isFileFolder,
          isNull(folderTable.deletedAt)
        )
      )
      .returning()
    if (!updated) throw new OrchestrationError('not_found', 'Folder not found')
    return {
      folder: requireWorkspaceFolderCreator(updated, params.workspaceId),
      path: destinationPath,
    }
  })
}

/** Deletes a file-folder subtree, or only an empty folder when `recursive` is false. */
/**
 * Deletes a folder addressed by path, reporting the id it resolved to.
 *
 * The id is returned rather than kept internal because the caller's audit event
 * identifies the folder by id: without it a path-based delete records
 * `FOLDER_DELETED` with no `resourceId`, and the path survives only in metadata.
 */
export async function deleteWorkspaceFileFolderByPath(params: {
  workspaceId: string
  path: string
  recursive: boolean
}): Promise<WorkspaceFileArchiveResult & { folderId: string }> {
  requireNonRootFolderPath(params.path)
  const now = new Date()

  return db.transaction(async (tx) => {
    await acquireWorkspaceFileFolderMutationLock(tx, params.workspaceId)
    const index = await loadActiveFileFolderPathIndex(
      { entityType: 'workspace', entityId: params.workspaceId },
      tx
    )
    const folderId = index.idByPath.get(params.path)
    if (!folderId) throw new OrchestrationError('not_found', 'Folder not found')

    const folderIds = [
      folderId,
      ...[...index.pathById.entries()]
        .filter(([, path]) => path.startsWith(`${params.path}/`))
        .map(([id]) => id),
    ]

    if (!params.recursive) {
      const [file] = await tx
        .select({ id: workspaceFiles.id })
        .from(workspaceFiles)
        .where(
          and(
            eq(workspaceFiles.folderId, folderId),
            eq(workspaceFiles.workspaceId, params.workspaceId),
            eq(workspaceFiles.context, 'workspace'),
            isNull(workspaceFiles.deletedAt)
          )
        )
        .limit(1)
      if (folderIds.length > 1 || file) {
        throw new OrchestrationError('conflict', 'Folder is not empty')
      }
    }

    const archivedFiles = await tx
      .update(workspaceFiles)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          inArray(workspaceFiles.folderId, folderIds),
          eq(workspaceFiles.workspaceId, params.workspaceId),
          eq(workspaceFiles.context, 'workspace'),
          isNull(workspaceFiles.deletedAt)
        )
      )
      .returning({ id: workspaceFiles.id })
    const archivedFolders = await tx
      .update(folderTable)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          inArray(folderTable.id, folderIds),
          eq(folderTable.workspaceId, params.workspaceId),
          isFileFolder,
          isNull(folderTable.deletedAt)
        )
      )
      .returning({ id: folderTable.id })

    return { folders: archivedFolders.length, files: archivedFiles.length, folderId }
  })
}

/** Archives an exact folder only while it has no active files or child folders. */
export async function archiveWorkspaceFileFolderIfEmpty(params: {
  workspaceId: string
  folderId: string
}): Promise<boolean> {
  const isTargetFolder = and(
    eq(folderTable.id, params.folderId),
    eq(folderTable.workspaceId, params.workspaceId),
    isFileFolder,
    isNull(folderTable.deletedAt)
  )
  return db.transaction(async (tx) => {
    await acquireWorkspaceFileFolderMutationLock(tx, params.workspaceId)

    const [folder] = await tx
      .select({ id: folderTable.id })
      .from(folderTable)
      .where(isTargetFolder)
      .limit(1)
    if (!folder) return false

    const [childFolder] = await tx
      .select({ id: folderTable.id })
      .from(folderTable)
      .where(
        and(
          eq(folderTable.parentId, params.folderId),
          eq(folderTable.workspaceId, params.workspaceId),
          isFileFolder,
          isNull(folderTable.deletedAt)
        )
      )
      .limit(1)
    const [file] = await tx
      .select({ id: workspaceFiles.id })
      .from(workspaceFiles)
      .where(
        and(
          eq(workspaceFiles.folderId, params.folderId),
          eq(workspaceFiles.workspaceId, params.workspaceId),
          eq(workspaceFiles.context, 'workspace'),
          isNull(workspaceFiles.deletedAt)
        )
      )
      .limit(1)
    if (childFolder || file) throw new OrchestrationError('conflict', 'Folder is not empty')

    const [archived] = await tx
      .update(folderTable)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(isTargetFolder)
      .returning({ id: folderTable.id })
    return Boolean(archived)
  })
}
