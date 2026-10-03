import { AuditAction, AuditResourceType } from '@sim/audit'
import { resolvePrincipalAttribution } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import type { ListSortOrder } from '@/lib/api/list-query'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { parseFolderPath } from '@/lib/folders/paths'
import type { FolderSortBy } from '@/lib/folders/queries'
import { notifyWorkspaceFilesChanged } from '@/lib/realtime/notify'
import {
  assertWorkspaceFileItemsBelongToWorkspace,
  bulkArchiveWorkspaceFileItems,
  createWorkspaceFileFolder,
  createWorkspaceFileFolderAtPath,
  deleteWorkspaceFileFolderByPath,
  ensureWorkspaceFileFolderPath,
  getWorkspaceFileFolderPath,
  listWorkspaceFileFolders,
  loadWorkspaceFileOperationContext,
  relocateWorkspaceFileFolderByPath,
  restoreWorkspaceFileFolder,
  updateWorkspaceFileFolder,
  type WorkspaceFileArchiveResult,
  type WorkspaceFileFolderRecord,
} from '@/lib/uploads/contexts/workspace'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { parseWorkspaceFileFolderDisplayPath } from '@/lib/workspace-files/folder-display-path'

const logger = createLogger('WorkspaceFileFolders')

export interface ListWorkspaceFileFoldersInput {
  workspaceId: string
  scope?: 'active' | 'archived' | 'all'
  parentPath?: string
  search?: string
  /**
   * Only v2 sends a sort; the internal route, Copilot, and the VFS do not, and some of
   * their consumers render the payload in the order it arrives. So this stays optional
   * and undefined means "leave the repository's `position` ordering alone" — a default
   * applied here would silently reorder those surfaces.
   */
  sortBy?: Exclude<FolderSortBy, 'position'>
  sortOrder?: ListSortOrder
  /** Descend the whole subtree instead of listing direct children only. */
  recursive?: boolean
  /** Deepest level below `parentPath` to include. Only meaningful with `recursive`. */
  depth?: number
}

export interface ListWorkspaceFileFoldersResult {
  folders: WorkspaceFileFolderRecord[]
}

export interface CreateWorkspaceFileFolderInput {
  workspaceId: string
  name?: string
  parentId?: string | null
  path?: string
}

export interface CreateWorkspaceFileFolderResult {
  folder: WorkspaceFileFolderRecord
}

export interface EnsureWorkspaceFileFolderPathInput {
  workspaceId: string
  /** Decoded folder names, outermost first. An empty list resolves to the root. */
  pathSegments: string[]
}

export interface EnsureWorkspaceFileFolderPathResult {
  /** Id of the deepest folder, or `null` when the path resolves to the root. */
  folderId: string | null
  /**
   * Ids this call inserted, outermost-first — never a folder it reused. Callers that
   * materialize a tree use it to unwind exactly their own writes on failure.
   */
  createdFolderIds: string[]
}

export interface UpdateWorkspaceFileFolderInput {
  workspaceId: string
  folderId?: string
  name?: string
  parentId?: string | null
  sortOrder?: number
  path?: string
  destinationPath?: string
}

export interface UpdateWorkspaceFileFolderResult {
  folder: WorkspaceFileFolderRecord
}

export interface DeleteWorkspaceFileFolderInput {
  workspaceId: string
  folderId?: string
  path?: string
  recursive?: boolean
}

export interface DeleteWorkspaceFileFolderResult {
  deletedItems: WorkspaceFileArchiveResult
  /** The folder actually deleted, so a path-addressed delete can still be audited by id. */
  folderId?: string
  path?: string
}

/**
 * Addresses exactly one archived folder — by internal id, or by the canonical
 * path an archived-scope list reports. The two selectors are mutually exclusive
 * by construction: a caller supplying neither, or both, is a compile error rather
 * than a `validation` failure raised after the operation has already authorized.
 */
export type RestoreWorkspaceFileFolderInput = {
  workspaceId: string
} & ({ folderId: string; path?: never } | { folderId?: never; path: string })

export interface RestoreWorkspaceFileFolderResult {
  folder: WorkspaceFileFolderRecord
  restoredItems: WorkspaceFileArchiveResult
}

async function resolveFolderContext({ input }: { input: { workspaceId: string } }) {
  const context = await loadWorkspaceFileOperationContext(input.workspaceId)
  if (!context) throw new OrchestrationError('not_found', 'Workspace not found')
  return context
}

type FolderOperationContext = Awaited<ReturnType<typeof resolveFolderContext>>

async function executeListWorkspaceFileFolders(args: {
  input: ListWorkspaceFileFoldersInput
  context: FolderOperationContext
}): Promise<ListWorkspaceFileFoldersResult> {
  let folders = await listWorkspaceFileFolders(args.context.workspaceId, {
    scope: args.input.scope,
    sortBy: args.input.sortBy,
    sortOrder: args.input.sortOrder,
  })
  if (args.input.parentPath !== undefined) {
    const parentSegments = parseFolderPath(args.input.parentPath)
    /*
     * Descendants are matched against the stored materialized path rather than
     * walked by `parentId`, because a scoped list need not contain the parent
     * row at all — an `archived` listing under an active parent is the case
     * that breaks a walk. Comparison stays positional over decoded segments, so
     * `Reportsx` is never read as a child of `Reports`.
     */
    const maxSegments = args.input.recursive
      ? args.input.depth === undefined
        ? Number.POSITIVE_INFINITY
        : parentSegments.length + args.input.depth
      : parentSegments.length + 1
    folders = folders.filter((folder) => {
      const folderSegments = parseWorkspaceFileFolderDisplayPath(folder.path)
      if (folderSegments.length <= parentSegments.length) return false
      if (folderSegments.length > maxSegments) return false
      return parentSegments.every((segment, index) => folderSegments[index] === segment)
    })
  }
  if (args.input.search) {
    const search = args.input.search.toLowerCase()
    folders = folders.filter((folder) => folder.name.toLowerCase().includes(search))
  }
  return { folders }
}

/**
 * Creates a folder at a path, materializing missing ancestors.
 *
 * Ancestors are created only after the direct attempt reports the parent
 * missing, rather than up front. `ensureWorkspaceFileFolderPath` re-normalizes
 * every segment it is handed, and a folder name is allowed to contain a slash
 * while a segment is not — so materializing first rejected `/A/Q3%2FQ4/C` on
 * its own existing parent. Reaching for the materializer only when the parent
 * is genuinely absent keeps that path untouched in the common case.
 *
 * Only the ancestors go through the materializer. The leaf keeps its own call
 * so it still emits FOLDER_CREATED with a full record, and still conflicts when
 * something is already there — the materializer is silent on both counts, so
 * routing the whole path through it would make "create" stop meaning create.
 */
async function createWorkspaceFileFolderAtPathCreatingAncestors(params: {
  workspaceId: string
  userId: string
  path: string
}) {
  try {
    return await createWorkspaceFileFolderAtPath(params)
  } catch (error) {
    const parentMissing =
      error instanceof OrchestrationError &&
      error.code === 'not_found' &&
      error.message === 'Parent folder not found'
    const segments = parseFolderPath(params.path)
    if (!parentMissing || segments.length <= 1) throw error

    await ensureWorkspaceFileFolderPath({
      workspaceId: params.workspaceId,
      userId: params.userId,
      pathSegments: segments.slice(0, -1),
    })
    return await createWorkspaceFileFolderAtPath(params)
  }
}

async function executeCreateWorkspaceFileFolder(args: {
  principal: Parameters<typeof resolvePrincipalAttribution>[0]
  input: CreateWorkspaceFileFolderInput
  context: FolderOperationContext
}): Promise<CreateWorkspaceFileFolderResult> {
  const attribution = resolvePrincipalAttribution(args.principal, {
    workspaceBillingOwnerUserId: args.context.billedAccountUserId,
  })
  const result =
    args.input.path !== undefined
      ? await createWorkspaceFileFolderAtPathCreatingAncestors({
          workspaceId: args.context.workspaceId,
          userId: attribution.attributedUserId,
          path: args.input.path,
        })
      : {
          folder: await createWorkspaceFileFolder({
            workspaceId: args.context.workspaceId,
            userId: attribution.attributedUserId,
            name: args.input.name ?? '',
            parentId: args.input.parentId,
          }),
        }
  const folder = 'path' in result ? { ...result.folder, path: result.path } : result.folder
  return { folder }
}

async function executeEnsureWorkspaceFileFolderPath(args: {
  principal: Parameters<typeof resolvePrincipalAttribution>[0]
  input: EnsureWorkspaceFileFolderPathInput
  context: FolderOperationContext
}): Promise<EnsureWorkspaceFileFolderPathResult> {
  const attribution = resolvePrincipalAttribution(args.principal, {
    workspaceBillingOwnerUserId: args.context.billedAccountUserId,
  })
  return ensureWorkspaceFileFolderPath({
    workspaceId: args.context.workspaceId,
    userId: attribution.attributedUserId,
    pathSegments: args.input.pathSegments,
  })
}

async function executeUpdateWorkspaceFileFolder(args: {
  input: UpdateWorkspaceFileFolderInput
  context: FolderOperationContext
}): Promise<UpdateWorkspaceFileFolderResult> {
  let folder: WorkspaceFileFolderRecord
  if (args.input.path !== undefined || args.input.destinationPath !== undefined) {
    if (!args.input.path || !args.input.destinationPath) {
      throw new OrchestrationError('validation', 'path and destinationPath are required')
    }
    const result = await relocateWorkspaceFileFolderByPath({
      workspaceId: args.context.workspaceId,
      path: args.input.path,
      destinationPath: args.input.destinationPath,
    })
    folder = { ...result.folder, path: result.path }
  } else {
    if (!args.input.folderId) throw new OrchestrationError('validation', 'Folder ID is required')
    folder = await updateWorkspaceFileFolder({
      workspaceId: args.context.workspaceId,
      folderId: args.input.folderId,
      name: args.input.name,
      parentId: args.input.parentId,
      sortOrder: args.input.sortOrder,
    })
  }
  logger.info('Updated workspace file folder', {
    workspaceId: args.context.workspaceId,
    folderId: folder.id,
  })
  return { folder }
}

async function executeDeleteWorkspaceFileFolder(args: {
  input: DeleteWorkspaceFileFolderInput
  context: FolderOperationContext
}): Promise<DeleteWorkspaceFileFolderResult> {
  let deletedItems: WorkspaceFileArchiveResult
  let deletedFolderId: string | undefined
  if (args.input.path !== undefined) {
    const { folderId, ...archived } = await deleteWorkspaceFileFolderByPath({
      workspaceId: args.context.workspaceId,
      path: args.input.path,
      recursive: args.input.recursive ?? false,
    })
    deletedItems = archived
    deletedFolderId = folderId
  } else {
    if (!args.input.folderId) throw new OrchestrationError('validation', 'Folder ID is required')
    await assertWorkspaceFileItemsBelongToWorkspace({
      workspaceId: args.context.workspaceId,
      folderIds: [args.input.folderId],
    })
    const archived = await bulkArchiveWorkspaceFileItems({
      workspaceId: args.context.workspaceId,
      folderIds: [args.input.folderId],
    })
    deletedItems = { files: archived.fileIds.length, folders: archived.folderIds.length }
    deletedFolderId = args.input.folderId
  }
  if (deletedItems.files === 0 && deletedItems.folders === 0) {
    throw new OrchestrationError('not_found', 'Folder not found')
  }
  return { deletedItems, folderId: deletedFolderId, path: args.input.path }
}

/**
 * Resolves an archived folder's id from its canonical path.
 *
 * Deliberately scans the archived set rather than walking the active tree:
 * `findWorkspaceFileFolderIdByPath` resolves live folders, and the folder being
 * restored is by definition not one. Folder counts are small — this is the same
 * full set the folder list already returns unpaged — so a scan is cheaper than
 * a second recursive path query.
 */
async function findArchivedFolderIdByPath(workspaceId: string, path: string): Promise<string> {
  const target = parseFolderPath(path)
  if (target.length === 0) {
    throw new OrchestrationError('validation', 'The workspace root cannot be restored')
  }
  const archived = await listWorkspaceFileFolders(workspaceId, { scope: 'archived' })
  const matches = archived.filter((folder) => {
    const segments = parseWorkspaceFileFolderDisplayPath(folder.path)
    return (
      segments.length === target.length &&
      segments.every((segment, index) => segment === target[index])
    )
  })
  if (matches.length === 0) throw new OrchestrationError('not_found', 'Folder not found')
  if (matches.length > 1) {
    throw new OrchestrationError(
      'conflict',
      'Multiple archived folders share this path. Restore by folder id instead.'
    )
  }
  return matches[0].id
}

async function executeRestoreWorkspaceFileFolder(args: {
  input: RestoreWorkspaceFileFolderInput
  context: FolderOperationContext
}): Promise<RestoreWorkspaceFileFolderResult> {
  const folderId =
    args.input.path !== undefined
      ? await findArchivedFolderIdByPath(args.context.workspaceId, args.input.path)
      : args.input.folderId
  return restoreWorkspaceFileFolder(args.context.workspaceId, folderId)
}

export const listWorkspaceFileFoldersOperation = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.listFolders,
  resolveContext: (args: { input: ListWorkspaceFileFoldersInput }) => resolveFolderContext(args),
  execute: executeListWorkspaceFileFolders,
})

/** Resolves one active folder under the folder-list policy without loading the entire tree. */
export const resolveWorkspaceFileFolderPathOperation = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.listFolders,
  resolveContext: (args: { input: { workspaceId: string; folderId: string } }) =>
    resolveFolderContext(args),
  async execute({ input, context }) {
    return { path: await getWorkspaceFileFolderPath(context.workspaceId, input.folderId) }
  },
})

export const createWorkspaceFileFolderOperation = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.createFolder,
  resolveContext: (args: { input: CreateWorkspaceFileFolderInput }) => resolveFolderContext(args),
  execute: executeCreateWorkspaceFileFolder,
  projectAudit({ result }) {
    return {
      action: AuditAction.FOLDER_CREATED,
      resourceType: AuditResourceType.FOLDER,
      resourceId: result.folder.id,
      resourceName: result.folder.name,
      description: `Created file folder "${result.folder.name}"`,
    }
  },
  async afterSuccess({ context }) {
    await notifyWorkspaceFilesChanged(context.workspaceId)
  },
})

/**
 * Idempotently materializes a whole folder chain, reusing every folder that already
 * exists and creating only the missing ones. Unlike {@link createWorkspaceFileFolderOperation}
 * — which creates exactly one leaf and fails on an existing path or a missing parent —
 * this is the primitive for writers that materialize a tree (archive extraction), where
 * intermediate folders and repeat runs are expected rather than exceptional.
 */
export const ensureWorkspaceFileFolderPathOperation = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.createFolder,
  resolveContext: (args: { input: EnsureWorkspaceFileFolderPathInput }) =>
    resolveFolderContext(args),
  execute: executeEnsureWorkspaceFileFolderPath,
})

export const updateWorkspaceFileFolderOperation = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.updateFolder,
  resolveContext: (args: { input: UpdateWorkspaceFileFolderInput }) => resolveFolderContext(args),
  execute: executeUpdateWorkspaceFileFolder,
  projectAudit({ input, result }) {
    return {
      action: input.path !== undefined ? AuditAction.FOLDER_MOVED : AuditAction.FOLDER_UPDATED,
      resourceType: AuditResourceType.FOLDER,
      resourceId: result.folder.id,
      resourceName: result.folder.name,
      description: `Updated file folder "${result.folder.name}"`,
    }
  },
  async afterSuccess({ context }) {
    await notifyWorkspaceFilesChanged(context.workspaceId)
  },
})

export const deleteWorkspaceFileFolderOperation = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.deleteFolder,
  resolveContext: (args: { input: DeleteWorkspaceFileFolderInput }) => resolveFolderContext(args),
  execute: executeDeleteWorkspaceFileFolder,
  projectAudit({ input, result }) {
    return {
      action: AuditAction.FOLDER_DELETED,
      resourceType: AuditResourceType.FOLDER,
      /*
       * A path-addressed delete has no `input.folderId`, so the audit carried no
       * resource at all and the folder survived only as free text in metadata.
       * The execution resolves the path to an id either way; this is that id.
       */
      resourceId: result.folderId ?? input.folderId,
      description: 'Deleted file folder',
      metadata: {
        path: input.path,
        deletedItems: result.deletedItems,
      },
    }
  },
  async afterSuccess({ context }) {
    await notifyWorkspaceFilesChanged(context.workspaceId)
  },
})

export const restoreWorkspaceFileFolderOperation = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.restoreFolder,
  resolveContext: (args: { input: RestoreWorkspaceFileFolderInput }) => resolveFolderContext(args),
  execute: executeRestoreWorkspaceFileFolder,
  projectAudit({ result }) {
    return {
      action: AuditAction.FOLDER_RESTORED,
      resourceType: AuditResourceType.FOLDER,
      resourceId: result.folder.id,
      resourceName: result.folder.name,
      description: `Restored file folder "${result.folder.name}"`,
      metadata: { restoredItems: result.restoredItems },
    }
  },
  async afterSuccess({ context }) {
    await notifyWorkspaceFilesChanged(context.workspaceId)
  },
})
