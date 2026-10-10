import { AuditAction, AuditResourceType } from '@sim/audit'
import type { Principal } from '@sim/auth/principal'
import type { WorkspaceFileRow } from '@sim/db/schema'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbTransaction } from '@/lib/db/types'
import type {
  ProjectFileAuthorizationContext,
  ProjectFileTarget,
} from '@/lib/projects/files/application/authorization'
import { defineAuthorizedProjectFileUseCase } from '@/lib/projects/files/application/authorized-use-case'
import {
  processProjectFileDocRetirementNow,
  rotateProjectFileDocInTx,
} from '@/lib/projects/files/application/document-lifecycle'
import { projectFileOperations } from '@/lib/projects/files/application/operations'
import {
  archiveFileItems,
  buildWorkspaceFileFolderPathMap,
  listFileFolders,
  mapFileRecord,
  moveFileItems,
  renameFileInTx,
  restoreFileFolder,
  restoreFileInTx,
} from '@/lib/uploads/contexts/workspace'
import { MAX_WORKSPACE_FILE_BULK_REQUEST_IDS } from '@/lib/workspace-files/limits'

interface LifecycleArgs<I> {
  principal: Principal
  input: I
  context: ProjectFileAuthorizationContext
  tx: DbTransaction
}

interface SelectionInput extends ProjectFileTarget {
  fileIds?: string[]
  folderIds?: string[]
}
interface MoveInput extends SelectionInput {
  targetFolderId?: string | null
  targetFolderPath?: string
}

const retirementEffects = new WeakMap<object, string[]>()

async function retireDocuments(
  tx: DbTransaction,
  projectId: string,
  fileIds: string[],
  result: object
) {
  const eventIds: string[] = []
  for (const fileId of [...new Set(fileIds)].sort()) {
    const retired = await rotateProjectFileDocInTx(tx, { projectId, fileId })
    if (retired) eventIds.push(retired.outboxEventId)
  }
  retirementEffects.set(result, eventIds)
}

async function finishRetirements(result: object) {
  const eventIds = retirementEffects.get(result) ?? []
  retirementEffects.delete(result)
  await Promise.all(eventIds.map(processProjectFileDocRetirementNow))
}

function boundedSelection(input: SelectionInput) {
  const fileIds = [...new Set(input.fileIds ?? [])]
  const folderIds = [...new Set(input.folderIds ?? [])]
  if (fileIds.length + folderIds.length === 0)
    throw new OrchestrationError('validation', 'At least one file or folder must be selected')
  if (
    fileIds.length > MAX_WORKSPACE_FILE_BULK_REQUEST_IDS ||
    folderIds.length > MAX_WORKSPACE_FILE_BULK_REQUEST_IDS
  )
    throw new OrchestrationError(
      'validation',
      `Bulk file operations accept at most ${MAX_WORKSPACE_FILE_BULK_REQUEST_IDS} file and folder IDs`
    )
  return { fileIds, folderIds }
}

async function projectFileRecord(
  tx: DbTransaction,
  context: ProjectFileAuthorizationContext,
  file: WorkspaceFileRow
) {
  const folders = file.folderId ? await listFileFolders(context.owner, { scope: 'all' }, tx) : []
  return mapFileRecord(file, context.owner, buildWorkspaceFileFolderPathMap(folders))
}

export const renameProjectFile = defineAuthorizedProjectFileUseCase({
  operation: projectFileOperations.rename,
  invalidatesFileList: ({ context, result }) => context.file?.originalName !== result.file.name,
  async execute({
    input,
    context,
    tx,
  }: LifecycleArgs<ProjectFileTarget & { fileId: string; name: string }>) {
    const file = await renameFileInTx(tx, context.owner, input.fileId, input.name)
    return { file: await projectFileRecord(tx, context, file) }
  },
  projectAudit: ({ context, result }) => ({
    action: AuditAction.FILE_UPDATED,
    resourceType: AuditResourceType.FILE,
    resourceId: result.file.id,
    resourceName: result.file.name,
    description: `Renamed Project file "${result.file.name}"`,
    metadata: { projectId: context.projectId },
  }),
})

export const archiveProjectFileItems = defineAuthorizedProjectFileUseCase({
  operation: projectFileOperations.archiveItems,
  invalidatesFileList: ({ result }) => result.deletedItems.files + result.deletedItems.folders > 0,
  async execute({ input, context, tx }: LifecycleArgs<SelectionInput>) {
    const archived = await archiveFileItems(
      { owner: context.owner, ...boundedSelection(input) },
      tx
    )
    const result = {
      deletedItems: { files: archived.files, folders: archived.folders },
      affectedIds: { fileIds: archived.fileIds, folderIds: archived.folderIds },
    }
    await retireDocuments(tx, context.projectId, archived.fileIds, result)
    return result
  },
  projectAudit: ({ context, result }) => ({
    action: AuditAction.FILE_DELETED,
    resourceType: AuditResourceType.FILE,
    description: 'Archived Project file items',
    metadata: { projectId: context.projectId, ...result.affectedIds },
  }),
  afterSuccess: ({ result }) => finishRetirements(result),
})

export const moveProjectFileItems = defineAuthorizedProjectFileUseCase({
  operation: projectFileOperations.moveItems,
  invalidatesFileList: ({ result }) => result.movedFiles + result.movedFolders > 0,
  async execute({ input, context, tx }: LifecycleArgs<MoveInput>) {
    return moveFileItems(
      {
        owner: context.owner,
        ...boundedSelection(input),
        targetFolderId: input.targetFolderId,
        targetFolderPath: input.targetFolderPath,
      },
      tx
    )
  },
  projectAudit: ({ context, result }) => ({
    action: AuditAction.FILE_MOVED,
    resourceType: AuditResourceType.FILE,
    description: 'Moved Project file items',
    metadata: {
      projectId: context.projectId,
      fileIds: result.movedFileIds,
      folderIds: result.movedFolderIds,
    },
  }),
})

export const restoreProjectFile = defineAuthorizedProjectFileUseCase({
  operation: projectFileOperations.restore,
  invalidatesFileList: ({ context }) => Boolean(context.file?.deletedAt),
  async execute({ input, context, tx }: LifecycleArgs<ProjectFileTarget & { fileId: string }>) {
    const restored = await restoreFileInTx(tx, context.owner, input.fileId)
    const result = { restored: true as const, file: await projectFileRecord(tx, context, restored) }
    if (context.file?.deletedAt)
      await retireDocuments(tx, context.projectId, [input.fileId], result)
    return result
  },
  projectAudit: ({ context, result }) => ({
    action: AuditAction.FILE_RESTORED,
    resourceType: AuditResourceType.FILE,
    resourceId: result.file.id,
    resourceName: result.file.name,
    description: `Restored Project file "${result.file.name}"`,
    metadata: { projectId: context.projectId },
  }),
  afterSuccess: ({ result }) => finishRetirements(result),
})

export const restoreProjectFileFolder = defineAuthorizedProjectFileUseCase({
  operation: projectFileOperations.restoreFolder,
  invalidatesFileList: ({ result }) =>
    result.restoredItems.files + result.restoredItems.folders > 0,
  async execute({ input, context, tx }: LifecycleArgs<ProjectFileTarget & { folderId: string }>) {
    const restored = await restoreFileFolder(context.owner, input.folderId, tx)
    const result = { folder: restored.folder, restoredItems: restored.restoredItems }
    await retireDocuments(tx, context.projectId, restored.restoredFileIds, result)
    return result
  },
  projectAudit: ({ context, result }) => ({
    action: AuditAction.FOLDER_RESTORED,
    resourceType: AuditResourceType.FOLDER,
    resourceId: result.folder.id,
    resourceName: result.folder.name,
    description: `Restored Project file folder "${result.folder.name}"`,
    metadata: { projectId: context.projectId, restoredItems: result.restoredItems },
  }),
  afterSuccess: ({ result }) => finishRetirements(result),
})
