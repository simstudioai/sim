import { canonicalWorkspaceFilePath, decodeVfsPathSegments } from '@/lib/copilot/vfs/path-utils'
import {
  ensureWorkflowAliasBacking,
  ensureWorkspacePlanBacking,
} from '@/lib/copilot/vfs/workflow-alias-backing'
import { resolveWorkflowAliasForWorkspace } from '@/lib/copilot/vfs/workflow-alias-resolver'
import {
  isPlanAliasPath,
  isWorkflowAliasBackingPath,
  WORKFLOW_CHANGELOG_BACKING_FOLDER,
  WORKFLOW_PLANS_BACKING_FOLDER,
  WORKSPACE_PLANS_BACKING_FOLDER,
  type WorkflowAliasTarget,
} from '@/lib/copilot/vfs/workflow-aliases'
import {
  ensureWorkspaceFileFolderPath,
  findWorkspaceFileFolderIdByPath,
  normalizeWorkspaceFileItemName,
} from '@/lib/uploads/contexts/workspace/workspace-file-folder-manager'
import {
  FileConflictError,
  getWorkspaceFileByName,
  resolveWorkspaceFileReference,
  updateWorkspaceFileContent,
  uploadWorkspaceFile,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'

export type WorkspaceFileWriteMode = 'create' | 'overwrite'

export interface WorkspaceFileWriteTarget {
  path: string
  mode: WorkspaceFileWriteMode
  mimeType?: string
}

export interface WorkspaceFileWriteResult {
  id: string
  name: string
  size: number
  contentType: string
  downloadUrl?: string
  vfsPath: string
  backingVfsPath?: string
  mode: WorkspaceFileWriteMode
}

interface ResolvedCreateTarget {
  fileName: string
  folderId: string | null
  vfsPath: string
}

export type WorkspaceFileWriteValidation =
  | {
      mode: 'create'
      vfsPath: string
      backingVfsPath?: string
      fileName: string
      folderId: string | null
    }
  | {
      mode: 'overwrite'
      vfsPath: string
      backingVfsPath?: string
      existingFileId: string
    }

function displayFolderPath(segments: string[]): string {
  return segments.length > 0 ? `files/${segments.join('/')}` : 'files/'
}

export function parseWorkspaceFileCreatePath(path: string): {
  folderSegments: string[]
  fileName: string
  vfsPath: string
} {
  const trimmed = path.trim().replace(/^\/+/, '')
  if (!trimmed.startsWith('files/')) {
    throw new Error('Workspace file paths must start with "files/"')
  }

  const decoded = decodeVfsPathSegments(trimmed.slice('files/'.length))
  if (decoded.length === 0) {
    throw new Error('Workspace file path must include a file name')
  }

  const fileName = normalizeWorkspaceFileItemName(decoded.at(-1) ?? '', 'File')
  const folderSegments = decoded
    .slice(0, -1)
    .map((segment) => normalizeWorkspaceFileItemName(segment, 'Folder'))

  return {
    folderSegments,
    fileName,
    vfsPath: canonicalWorkspaceFilePath({ folderPath: folderSegments.join('/'), name: fileName }),
  }
}

async function resolveCreateTarget(
  workspaceId: string,
  path: string
): Promise<ResolvedCreateTarget> {
  const parsed = parseWorkspaceFileCreatePath(path)
  const folderId =
    parsed.folderSegments.length > 0
      ? await findWorkspaceFileFolderIdByPath(workspaceId, parsed.folderSegments, {
          includeReservedSystemFolders: true,
        })
      : null

  if (parsed.folderSegments.length > 0 && !folderId) {
    throw new Error(
      `Directory not yet created: ${displayFolderPath(parsed.folderSegments)}. Create the directory first, then retry the file write.`
    )
  }

  const existing = await getWorkspaceFileByName(workspaceId, parsed.fileName, { folderId })
  if (existing) {
    throw new Error(`File already exists at ${parsed.vfsPath}. Use mode "overwrite" to update it.`)
  }

  return {
    fileName: parsed.fileName,
    folderId,
    vfsPath: parsed.vfsPath,
  }
}

function vfsPathForRecord(record: WorkspaceFileRecord): string {
  return canonicalWorkspaceFilePath({ folderPath: record.folderPath, name: record.name })
}

function assertNotReservedWorkflowAliasBackingPath(path: string): void {
  if (isWorkflowAliasBackingPath(path)) {
    throw new Error(
      `Reserved workflow alias backing paths must be accessed through their alias path: ${path}`
    )
  }
}

async function resolveWorkflowAliasFileTarget(args: {
  workspaceId: string
  userId?: string
  alias: WorkflowAliasTarget
}): Promise<ResolvedCreateTarget & { existingFile?: WorkspaceFileRecord | null }> {
  if (args.alias.kind === 'plans_dir') {
    throw new Error(`Cannot write file content to plan alias directory: ${args.alias.aliasPath}`)
  }

  if (args.userId && args.alias.scope === 'workflow') {
    await ensureWorkflowAliasBacking({
      workspaceId: args.workspaceId,
      userId: args.userId,
      workflowId: args.alias.workflowId,
      workflowName: args.alias.workflowName,
    })
  } else if (args.userId && args.alias.scope === 'workspace') {
    await ensureWorkspacePlanBacking({
      workspaceId: args.workspaceId,
      userId: args.userId,
    })
  }

  if (args.alias.kind === 'changelog') {
    const folderSegments = [WORKFLOW_CHANGELOG_BACKING_FOLDER]
    const folderId = args.userId
      ? await ensureWorkspaceFileFolderPath({
          workspaceId: args.workspaceId,
          userId: args.userId,
          pathSegments: folderSegments,
        })
      : await findWorkspaceFileFolderIdByPath(args.workspaceId, folderSegments, {
          includeReservedSystemFolders: true,
        })
    if (!folderId) {
      throw new Error(
        `Workflow changelog backing folder is not provisioned for ${args.alias.aliasPath}`
      )
    }
    const fileName = `${args.alias.workflowId}.md`
    return {
      fileName,
      folderId,
      vfsPath: args.alias.aliasPath,
      existingFile: await getWorkspaceFileByName(args.workspaceId, fileName, { folderId }),
    }
  }

  const relativeSegments = decodeVfsPathSegments(args.alias.planRelativePath ?? '')
  if (relativeSegments.length === 0) {
    throw new Error(`Workflow plan alias must include a file path: ${args.alias.aliasPath}`)
  }
  const fileName = normalizeWorkspaceFileItemName(relativeSegments.at(-1) ?? '', 'File')
  const folderSegments = [
    WORKFLOW_PLANS_BACKING_FOLDER,
    args.alias.scope === 'workflow' ? args.alias.workflowId : WORKSPACE_PLANS_BACKING_FOLDER,
    ...relativeSegments.slice(0, -1),
  ].map((segment) => normalizeWorkspaceFileItemName(segment, 'Folder'))
  const folderId = args.userId
    ? await ensureWorkspaceFileFolderPath({
        workspaceId: args.workspaceId,
        userId: args.userId,
        pathSegments: folderSegments,
      })
    : await findWorkspaceFileFolderIdByPath(args.workspaceId, folderSegments, {
        includeReservedSystemFolders: true,
      })
  if (!folderId) {
    throw new Error(`Plan backing directory is not provisioned for ${args.alias.aliasPath}.`)
  }

  return {
    fileName,
    folderId,
    vfsPath: args.alias.aliasPath,
    existingFile: await getWorkspaceFileByName(args.workspaceId, fileName, { folderId }),
  }
}

export async function validateWorkspaceFileWriteTarget(args: {
  workspaceId: string
  userId?: string
  target: WorkspaceFileWriteTarget
}): Promise<WorkspaceFileWriteValidation> {
  const alias = await resolveWorkflowAliasForWorkspace({
    workspaceId: args.workspaceId,
    path: args.target.path,
  })
  if (!alias && isPlanAliasPath(args.target.path)) {
    throw new Error(`Unsupported plan alias path or missing workflow: ${args.target.path}`)
  }
  if (alias) {
    const resolved = await resolveWorkflowAliasFileTarget({
      workspaceId: args.workspaceId,
      userId: args.userId,
      alias,
    })
    if (args.target.mode === 'overwrite') {
      if (!resolved.existingFile) {
        throw new Error(`File not found for overwrite: ${alias.aliasPath}`)
      }
      return {
        mode: 'overwrite',
        vfsPath: alias.aliasPath,
        backingVfsPath: alias.backingPath,
        existingFileId: resolved.existingFile.id,
      }
    }
    if (resolved.existingFile) {
      throw new Error(
        `File already exists at ${alias.aliasPath}. Use mode "overwrite" to update it.`
      )
    }
    return {
      mode: 'create',
      vfsPath: alias.aliasPath,
      backingVfsPath: alias.backingPath,
      fileName: resolved.fileName,
      folderId: resolved.folderId,
    }
  }

  assertNotReservedWorkflowAliasBackingPath(args.target.path)

  if (args.target.mode === 'overwrite') {
    const existing = await resolveWorkspaceFileReference(args.workspaceId, args.target.path)
    if (!existing) {
      throw new Error(`File not found for overwrite: ${args.target.path}`)
    }
    return {
      mode: 'overwrite',
      vfsPath: vfsPathForRecord(existing),
      existingFileId: existing.id,
    }
  }

  const createTarget = await resolveCreateTarget(args.workspaceId, args.target.path)
  return {
    mode: 'create',
    vfsPath: createTarget.vfsPath,
    fileName: createTarget.fileName,
    folderId: createTarget.folderId,
  }
}

export async function writeWorkspaceFileByPath(args: {
  workspaceId: string
  userId: string
  target: WorkspaceFileWriteTarget
  buffer: Buffer
  inferredMimeType: string
}): Promise<WorkspaceFileWriteResult> {
  const contentType = args.target.mimeType || args.inferredMimeType
  const alias = await resolveWorkflowAliasForWorkspace({
    workspaceId: args.workspaceId,
    path: args.target.path,
  })
  if (!alias && isPlanAliasPath(args.target.path)) {
    throw new Error(`Unsupported plan alias path or missing workflow: ${args.target.path}`)
  }
  if (alias) {
    const resolved = await resolveWorkflowAliasFileTarget({
      workspaceId: args.workspaceId,
      userId: args.userId,
      alias,
    })

    if (args.target.mode === 'overwrite') {
      if (!resolved.existingFile) {
        throw new Error(`File not found for overwrite: ${alias.aliasPath}`)
      }
      const updated = await updateWorkspaceFileContent(
        args.workspaceId,
        resolved.existingFile.id,
        args.userId,
        args.buffer,
        contentType || resolved.existingFile.type
      )
      return {
        id: updated.id,
        name: updated.name,
        size: updated.size,
        contentType: updated.type,
        downloadUrl: updated.url,
        vfsPath: alias.aliasPath,
        backingVfsPath: vfsPathForRecord(updated),
        mode: 'overwrite',
      }
    }

    if (resolved.existingFile) {
      throw new Error(
        `File already exists at ${alias.aliasPath}. Use mode "overwrite" to update it.`
      )
    }
    const uploaded = await uploadWorkspaceFile(
      args.workspaceId,
      args.userId,
      args.buffer,
      resolved.fileName,
      contentType,
      { folderId: resolved.folderId, exactName: true }
    ).catch((error: unknown) => {
      if (error instanceof FileConflictError) {
        throw new Error(
          `File already exists at ${alias.aliasPath}. Use mode "overwrite" to update it.`
        )
      }
      throw error
    })
    return {
      id: uploaded.id,
      name: uploaded.name,
      size: uploaded.size,
      contentType: uploaded.type,
      downloadUrl: uploaded.url,
      vfsPath: alias.aliasPath,
      backingVfsPath: alias.backingPath,
      mode: 'create',
    }
  }

  assertNotReservedWorkflowAliasBackingPath(args.target.path)

  if (args.target.mode === 'overwrite') {
    const existing = await resolveWorkspaceFileReference(args.workspaceId, args.target.path)
    if (!existing) {
      throw new Error(`File not found for overwrite: ${args.target.path}`)
    }

    const updated = await updateWorkspaceFileContent(
      args.workspaceId,
      existing.id,
      args.userId,
      args.buffer,
      contentType || existing.type
    )

    return {
      id: updated.id,
      name: updated.name,
      size: updated.size,
      contentType: updated.type,
      downloadUrl: updated.url,
      vfsPath: vfsPathForRecord(updated),
      mode: 'overwrite',
    }
  }

  const createTarget = await resolveCreateTarget(args.workspaceId, args.target.path)
  const uploaded = await uploadWorkspaceFile(
    args.workspaceId,
    args.userId,
    args.buffer,
    createTarget.fileName,
    contentType,
    { folderId: createTarget.folderId }
  )

  return {
    id: uploaded.id,
    name: uploaded.name,
    size: uploaded.size,
    contentType: uploaded.type,
    downloadUrl: uploaded.url,
    vfsPath: createTarget.vfsPath,
    mode: 'create',
  }
}
