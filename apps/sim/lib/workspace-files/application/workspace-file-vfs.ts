import { AuditAction, AuditResourceType } from '@sim/audit'
import { resolvePrincipalAttribution } from '@sim/auth/principal'
import { asOrchestrationError, OrchestrationError } from '@/lib/core/orchestration/types'
import { buildFolderPath } from '@/lib/folders/paths'
import { notifyWorkspaceFilesChanged } from '@/lib/realtime/notify'
import {
  bulkArchiveWorkspaceFileItems,
  createWorkspaceFileFolderAtPath,
  findWorkspaceFileFolderIdByPath,
  getWorkspaceFileByName,
  loadWorkspaceFileOperationContext,
  moveRenameWorkspaceFile,
  relocateWorkspaceFileFolderByPath,
  WorkspaceFileFolderConflictError,
} from '@/lib/uploads/contexts/workspace'
import { VfsPathLimitError, validateVfsPathSegments } from '@/lib/vfs/limits'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { fileOperations } from '@/lib/workspace-files/application/operations'

const MAX_FILE_VFS_ITEMS = 100

export interface WorkspaceFileVfsPathReference {
  source: string
  segments: string[]
}

export interface WorkspaceFileVfsDestination {
  segments: string[]
  trailingSlash: boolean
}

export interface WorkspaceFileVfsOutcome {
  source: string
  targetSegments?: string[]
  resourceType: 'file' | 'folder'
  resourceId?: string
  error?: string
}

interface CreatedFolder {
  id: string
  name: string
  path: string
}

interface RelocatedFile {
  id: string
  name: string
  moved: boolean
  renamed: boolean
}

interface RelocatedFolder {
  id: string
  name: string
  sourcePath: string
  destinationPath: string
}

function normalizeReferences(
  references: readonly WorkspaceFileVfsPathReference[]
): WorkspaceFileVfsPathReference[] {
  if (references.length > MAX_FILE_VFS_ITEMS) {
    throw new OrchestrationError(
      'validation',
      `File VFS commands cannot exceed ${MAX_FILE_VFS_ITEMS} items`
    )
  }
  const unique = new Map<string, WorkspaceFileVfsPathReference>()
  for (const reference of references) {
    try {
      validateVfsPathSegments(reference.segments)
    } catch (error) {
      if (error instanceof VfsPathLimitError) {
        throw new OrchestrationError('validation', error.message)
      }
      throw error
    }
    const key = buildFolderPath(reference.segments)
    if (!unique.has(key)) unique.set(key, reference)
  }
  if (unique.size === 0) throw new OrchestrationError('validation', 'At least one path is required')
  return [...unique.values()]
}

/**
 * The per-item message for a failure the caller can act on, or a rethrow for a fault
 * that should fail the whole command.
 *
 * Every caller-fixable failure here carries an orchestration class — the folder and
 * move conflicts classify themselves as `conflict`, and `FolderPathError` as
 * `validation` — so the classified branch covers them all. Anything unclassified, or
 * classified `internal`, is a fault and propagates.
 */
function expectedOutcomeMessage(error: unknown): string {
  const classified = asOrchestrationError(error)
  if (classified && classified.code !== 'internal') return classified.message
  throw error
}

async function ensureFolderPath(params: {
  workspaceId: string
  userId: string
  segments: readonly string[]
  createdFolders: CreatedFolder[]
}): Promise<string | null> {
  let folderId: string | null = null
  for (let index = 0; index < params.segments.length; index += 1) {
    const segments = params.segments.slice(0, index + 1)
    const existing = await findWorkspaceFileFolderIdByPath(params.workspaceId, [...segments])
    if (existing) {
      folderId = existing
      continue
    }
    const path = buildFolderPath(segments)
    try {
      const created = await createWorkspaceFileFolderAtPath({
        workspaceId: params.workspaceId,
        userId: params.userId,
        path,
      })
      folderId = created.folder.id
      params.createdFolders.push({
        id: created.folder.id,
        name: created.folder.name,
        path: created.path,
      })
    } catch (error) {
      if (error instanceof WorkspaceFileFolderConflictError) {
        const concurrentlyCreated = await findWorkspaceFileFolderIdByPath(params.workspaceId, [
          ...segments,
        ])
        if (concurrentlyCreated) {
          folderId = concurrentlyCreated
          continue
        }
      }
      throw error
    }
  }
  return folderId
}

async function resolveSource(
  workspaceId: string,
  reference: WorkspaceFileVfsPathReference
): Promise<
  | { source: string; file: NonNullable<Awaited<ReturnType<typeof getWorkspaceFileByName>>> }
  | { source: string; folderId: string }
  | { source: string; error: string }
> {
  if (reference.segments.length === 0) {
    return { source: reference.source, error: 'Source must name a file or folder under files/' }
  }
  const parentSegments = reference.segments.slice(0, -1)
  const folderId =
    parentSegments.length === 0
      ? null
      : await findWorkspaceFileFolderIdByPath(workspaceId, parentSegments)
  if (parentSegments.length === 0 || folderId) {
    const file = await getWorkspaceFileByName(workspaceId, reference.segments.at(-1) as string, {
      folderId,
    })
    if (file) return { source: reference.source, file }
  }
  const sourceFolderId = await findWorkspaceFileFolderIdByPath(workspaceId, reference.segments)
  return sourceFolderId
    ? { source: reference.source, folderId: sourceFolderId }
    : { source: reference.source, error: `Not found: ${reference.source}` }
}

function createdFolderAudits(folders: readonly CreatedFolder[]) {
  return folders.map((folder) => ({
    action: AuditAction.FOLDER_CREATED,
    resourceType: AuditResourceType.FOLDER,
    resourceId: folder.id,
    resourceName: folder.name,
    description: `Created file folder "${folder.path}"`,
    metadata: { path: folder.path, folderResourceType: 'file' },
  }))
}

export interface CreateWorkspaceFileVfsFoldersInput {
  workspaceId: string
  paths: WorkspaceFileVfsPathReference[]
}

export const createWorkspaceFileVfsFolders = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.createVfsFolders,
  resolveContext: ({ input }: { input: CreateWorkspaceFileVfsFoldersInput }) =>
    loadWorkspaceFileOperationContext(input.workspaceId).then((context) => {
      if (!context) throw new OrchestrationError('not_found', 'Workspace not found')
      return context
    }),
  async execute({ principal, input, context }) {
    const paths = normalizeReferences(input.paths)
    const userId = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    }).attributedUserId
    const createdFolders: CreatedFolder[] = []
    const outcomes: WorkspaceFileVfsOutcome[] = []
    for (const path of paths) {
      if (path.segments.length === 0) {
        outcomes.push({
          source: path.source,
          resourceType: 'folder',
          error: 'Path must include at least one folder segment',
        })
        continue
      }
      try {
        const folderId = await ensureFolderPath({
          workspaceId: context.workspaceId,
          userId,
          segments: path.segments,
          createdFolders,
        })
        outcomes.push({
          source: path.source,
          targetSegments: path.segments,
          resourceType: 'folder',
          resourceId: folderId ?? undefined,
        })
      } catch (error) {
        outcomes.push({
          source: path.source,
          resourceType: 'folder',
          error: expectedOutcomeMessage(error),
        })
      }
    }
    return { outcomes, createdFolders }
  },
  projectAudit: ({ result }) => createdFolderAudits(result.createdFolders),
  afterSuccess: ({ context, result }) =>
    result.createdFolders.length > 0 ? notifyWorkspaceFilesChanged(context.workspaceId) : undefined,
})

export interface RelocateWorkspaceFileVfsItemsInput {
  workspaceId: string
  sources: WorkspaceFileVfsPathReference[]
  destination: WorkspaceFileVfsDestination
}

export const relocateWorkspaceFileVfsItems = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.relocateVfsItems,
  resolveContext: ({ input }: { input: RelocateWorkspaceFileVfsItemsInput }) =>
    loadWorkspaceFileOperationContext(input.workspaceId).then((context) => {
      if (!context) throw new OrchestrationError('not_found', 'Workspace not found')
      return context
    }),
  async execute({ principal, input, context }) {
    const sources = normalizeReferences(input.sources)
    try {
      validateVfsPathSegments(input.destination.segments)
    } catch (error) {
      if (error instanceof VfsPathLimitError) {
        throw new OrchestrationError('validation', error.message)
      }
      throw error
    }
    const references = []
    for (const source of sources) {
      references.push(await resolveSource(context.workspaceId, source))
    }
    const userId = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    }).attributedUserId
    const destinationPath = buildFolderPath(input.destination.segments)
    const existingDestination = await findWorkspaceFileFolderIdByPath(
      context.workspaceId,
      input.destination.segments
    )
    const dirMode =
      input.destination.segments.length === 0 ||
      input.destination.trailingSlash ||
      existingDestination !== null
    if (!dirMode && sources.length > 1) {
      throw new OrchestrationError(
        'validation',
        `With multiple sources the destination must be a folder. "${destinationPath}" does not exist — end it with "/" to create it.`
      )
    }
    const folderSegments = dirMode
      ? input.destination.segments
      : input.destination.segments.slice(0, -1)
    const leafName = dirMode ? undefined : input.destination.segments.at(-1)
    const createdFolders: CreatedFolder[] = []
    let targetFolderPromise: Promise<string | null> | undefined
    const targetFolderId = () =>
      (targetFolderPromise ??= ensureFolderPath({
        workspaceId: context.workspaceId,
        userId,
        segments: folderSegments,
        createdFolders,
      }))
    const outcomes: WorkspaceFileVfsOutcome[] = []
    const relocatedFiles: RelocatedFile[] = []
    const relocatedFolders: RelocatedFolder[] = []

    for (const reference of references) {
      if ('error' in reference) {
        outcomes.push({ source: reference.source, resourceType: 'file', error: reference.error })
        continue
      }
      try {
        const targetId = await targetFolderId()
        if ('file' in reference) {
          const name = leafName ?? reference.file.name
          const result = await moveRenameWorkspaceFile({
            workspaceId: context.workspaceId,
            fileId: reference.file.id,
            targetFolderId: targetId,
            newName: name,
          })
          relocatedFiles.push({
            id: result.file.id,
            name: result.file.name,
            moved: result.moved,
            renamed: result.renamed,
          })
          outcomes.push({
            source: reference.source,
            targetSegments: [...folderSegments, result.file.name],
            resourceType: 'file',
            resourceId: result.file.id,
          })
          continue
        }
        if (targetId === reference.folderId) {
          outcomes.push({
            source: reference.source,
            resourceType: 'folder',
            error: 'Cannot move a folder into itself',
          })
          continue
        }
        const sourcePath = buildFolderPath(
          sources.find((source) => source.source === reference.source)?.segments ?? []
        )
        const name =
          leafName ?? sources.find((source) => source.source === reference.source)?.segments.at(-1)
        if (!name) throw new OrchestrationError('validation', 'Folder name is required')
        const nextPath = buildFolderPath([...folderSegments, name])
        const result = await relocateWorkspaceFileFolderByPath({
          workspaceId: context.workspaceId,
          path: sourcePath,
          destinationPath: nextPath,
        })
        relocatedFolders.push({
          id: result.folder.id,
          name: result.folder.name,
          sourcePath,
          destinationPath: result.path,
        })
        outcomes.push({
          source: reference.source,
          targetSegments: [...folderSegments, result.folder.name],
          resourceType: 'folder',
          resourceId: result.folder.id,
        })
      } catch (error) {
        outcomes.push({
          source: reference.source,
          resourceType: 'file' in reference ? 'file' : 'folder',
          error: expectedOutcomeMessage(error),
        })
      }
    }
    return { outcomes, createdFolders, relocatedFiles, relocatedFolders }
  },
  projectAudit: ({ result }) => [
    ...createdFolderAudits(result.createdFolders),
    ...result.relocatedFiles
      .filter((file) => file.moved || file.renamed)
      .map((file) => ({
        action: file.moved ? AuditAction.FILE_MOVED : AuditAction.FILE_UPDATED,
        resourceType: AuditResourceType.FILE,
        resourceId: file.id,
        resourceName: file.name,
        description: `Relocated file "${file.name}"`,
        metadata: { moved: file.moved, renamed: file.renamed },
      })),
    ...result.relocatedFolders.map((folder) => ({
      action: AuditAction.FOLDER_MOVED,
      resourceType: AuditResourceType.FOLDER,
      resourceId: folder.id,
      resourceName: folder.name,
      description: `Moved file folder to "${folder.destinationPath}"`,
      metadata: { sourcePath: folder.sourcePath, destinationPath: folder.destinationPath },
    })),
  ],
  afterSuccess: ({ context, result }) =>
    result.createdFolders.length > 0 ||
    result.relocatedFiles.some((file) => file.moved || file.renamed) ||
    result.relocatedFolders.length > 0
      ? notifyWorkspaceFilesChanged(context.workspaceId)
      : undefined,
})

export interface DeleteWorkspaceFileVfsItemsInput {
  workspaceId: string
  paths: WorkspaceFileVfsPathReference[]
}

export const deleteWorkspaceFileVfsItems = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.deleteVfsItems,
  resolveContext: ({ input }: { input: DeleteWorkspaceFileVfsItemsInput }) =>
    loadWorkspaceFileOperationContext(input.workspaceId).then((context) => {
      if (!context) throw new OrchestrationError('not_found', 'Workspace not found')
      return context
    }),
  async execute({ input, context }) {
    const paths = normalizeReferences(input.paths)
    const references = []
    for (const path of paths) {
      references.push(await resolveSource(context.workspaceId, path))
    }
    const outcomes: WorkspaceFileVfsOutcome[] = []
    const deletedFiles: Array<{ id: string; name: string }> = []
    const deletedFolders: Array<{ id: string; path: string }> = []
    for (const reference of references) {
      if ('error' in reference) {
        outcomes.push({ source: reference.source, resourceType: 'file', error: reference.error })
        continue
      }
      try {
        if ('file' in reference) {
          const archived = await bulkArchiveWorkspaceFileItems({
            workspaceId: context.workspaceId,
            fileIds: [reference.file.id],
          })
          if (!archived.fileIds.includes(reference.file.id)) {
            throw new OrchestrationError('not_found', 'File not found')
          }
          deletedFiles.push({ id: reference.file.id, name: reference.file.name })
          outcomes.push({
            source: reference.source,
            resourceType: 'file',
            resourceId: reference.file.id,
          })
          continue
        }
        const archived = await bulkArchiveWorkspaceFileItems({
          workspaceId: context.workspaceId,
          folderIds: [reference.folderId],
        })
        if (!archived.folderIds.includes(reference.folderId)) {
          throw new OrchestrationError('not_found', 'Folder not found')
        }
        deletedFolders.push({ id: reference.folderId, path: reference.source })
        outcomes.push({
          source: reference.source,
          resourceType: 'folder',
          resourceId: reference.folderId,
        })
      } catch (error) {
        outcomes.push({
          source: reference.source,
          resourceType: 'file' in reference ? 'file' : 'folder',
          error: expectedOutcomeMessage(error),
        })
      }
    }
    return { outcomes, deletedFiles, deletedFolders }
  },
  projectAudit: ({ result }) => [
    ...result.deletedFiles.map((file) => ({
      action: AuditAction.FILE_DELETED,
      resourceType: AuditResourceType.FILE,
      resourceId: file.id,
      resourceName: file.name,
      description: `Archived file "${file.name}"`,
    })),
    ...result.deletedFolders.map((folder) => ({
      action: AuditAction.FOLDER_DELETED,
      resourceType: AuditResourceType.FOLDER,
      resourceId: folder.id,
      description: `Archived file folder "${folder.path}"`,
      metadata: { path: folder.path },
    })),
  ],
  afterSuccess: ({ context, result }) =>
    result.deletedFiles.length > 0 || result.deletedFolders.length > 0
      ? notifyWorkspaceFilesChanged(context.workspaceId)
      : undefined,
})
