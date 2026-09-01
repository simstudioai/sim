import { type Principal, resolvePrincipalAttribution } from '@sim/auth/principal'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { ensureWorkspaceFileFolderPath } from '@/lib/uploads/contexts/workspace/workspace-file-folder-manager'
import { loadActiveWorkspaceContext } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import type { WorkspaceFileSecretProvenance } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { encodeVfsPathSegments, encodeVfsSegment } from '@/lib/vfs/path'
import {
  admitCreateWorkspaceFile,
  createWorkspaceFile,
  createWorkspaceFileFromBuffer,
} from '@/lib/workspace-files/application/create-workspace-file'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { resolveWorkspaceFileReference } from '@/lib/workspace-files/application/resolve-workspace-file-reference'
import {
  updateWorkspaceFileContent,
  updateWorkspaceFileContentFromBuffer,
} from '@/lib/workspace-files/application/update-workspace-file-content'
import { parseWorkspaceFileFolderDisplayPath } from '@/lib/workspace-files/folder-display-path'
import { parseWorkspaceFileCreatePath } from '@/lib/workspace-files/workspace-file-path'

export interface WriteWorkspaceFileByPathInput {
  workspaceId: string
  path: string
  content: string
  encoding: 'utf-8' | 'base64'
  contentType: string
  mode: 'create' | 'overwrite'
  exactName?: boolean
  syncLiveDoc?: boolean
  secretProvenance?: WorkspaceFileSecretProvenance
}

export interface WriteWorkspaceFileBufferByPathInput
  extends Omit<WriteWorkspaceFileByPathInput, 'content' | 'encoding'> {
  content: Buffer
}

export interface WriteWorkspaceFileByPathResult {
  id: string
  name: string
  size: number
  contentType: string
  downloadUrl?: string
  vfsPath: string
  mode: WriteWorkspaceFileByPathInput['mode']
}

function toResult(
  file: {
    id: string
    name: string
    size: number
    type: string
    url?: string
    folderPath?: string | null
  },
  mode: WriteWorkspaceFileByPathInput['mode']
): WriteWorkspaceFileByPathResult {
  const folderPath = file.folderPath ?? ''
  const encodedFolderPath = folderPath
    ? encodeVfsPathSegments(parseWorkspaceFileFolderDisplayPath(folderPath))
    : ''
  return {
    id: file.id,
    name: file.name,
    size: file.size,
    contentType: file.type,
    downloadUrl: file.url,
    vfsPath: `files/${encodedFolderPath ? `${encodedFolderPath}/` : ''}${encodeVfsSegment(file.name)}`,
    mode,
  }
}

async function executeCreate({
  principal,
  input,
}: {
  principal: Principal
  input: WriteWorkspaceFileByPathInput
}): Promise<WriteWorkspaceFileByPathResult> {
  const parsed = parseWorkspaceFileCreatePath(input.path)
  await admitCreateWorkspaceFile(principal, input.workspaceId)

  const folderUserId = await resolveFolderAttributionUserId(principal, input.workspaceId)

  const { folderId } = await ensureWorkspaceFileFolderPath({
    workspaceId: input.workspaceId,
    userId: folderUserId,
    pathSegments: parsed.folderSegments,
  })
  const result = await createWorkspaceFile.execute({
    principal,
    input: {
      workspaceId: input.workspaceId,
      name: parsed.fileName,
      contentType: input.contentType,
      content: input.content,
      encoding: input.encoding,
      folderId,
      exactName: input.exactName ?? true,
      secretProvenance: input.secretProvenance,
    },
  })
  return toResult(result.file, 'create')
}

async function executeOverwrite({
  principal,
  input,
}: {
  principal: Principal
  input: WriteWorkspaceFileByPathInput
}): Promise<WriteWorkspaceFileByPathResult> {
  const existing = await resolveWorkspaceFileReference({
    principal,
    operation: fileOperations.updateContent,
    workspaceId: input.workspaceId,
    reference: input.path,
  })
  const result = await updateWorkspaceFileContent.execute({
    principal,
    input: {
      fileId: existing.id,
      assertedWorkspaceId: input.workspaceId,
      content: input.content,
      encoding: input.encoding,
      contentType: input.contentType,
      provenanceMode: 'replace_empty',
      syncLiveDoc: input.syncLiveDoc,
      secretProvenance: input.secretProvenance,
    },
  })
  return toResult(result.file, 'overwrite')
}

async function executeCreateBuffer({
  principal,
  input,
}: {
  principal: Principal
  input: WriteWorkspaceFileBufferByPathInput
}): Promise<WriteWorkspaceFileByPathResult> {
  const parsed = parseWorkspaceFileCreatePath(input.path)
  await admitCreateWorkspaceFile(principal, input.workspaceId)
  const folderUserId = await resolveFolderAttributionUserId(principal, input.workspaceId)
  const { folderId } = await ensureWorkspaceFileFolderPath({
    workspaceId: input.workspaceId,
    userId: folderUserId,
    pathSegments: parsed.folderSegments,
  })
  const result = await createWorkspaceFileFromBuffer.execute({
    principal,
    input: {
      workspaceId: input.workspaceId,
      name: parsed.fileName,
      contentType: input.contentType,
      content: input.content,
      folderId,
      exactName: input.exactName ?? true,
      secretProvenance: input.secretProvenance,
    },
  })
  return toResult(result.file, 'create')
}

async function executeOverwriteBuffer({
  principal,
  input,
}: {
  principal: Principal
  input: WriteWorkspaceFileBufferByPathInput
}): Promise<WriteWorkspaceFileByPathResult> {
  const existing = await resolveWorkspaceFileReference({
    principal,
    operation: fileOperations.updateContent,
    workspaceId: input.workspaceId,
    reference: input.path,
  })
  const result = await updateWorkspaceFileContentFromBuffer.execute({
    principal,
    input: {
      fileId: existing.id,
      assertedWorkspaceId: input.workspaceId,
      content: input.content,
      contentType: input.contentType,
      provenanceMode: 'replace_empty',
      syncLiveDoc: input.syncLiveDoc,
      secretProvenance: input.secretProvenance,
    },
  })
  return toResult(result.file, 'overwrite')
}

async function resolveFolderAttributionUserId(
  principal: Principal,
  workspaceId: string
): Promise<string> {
  let workspaceBillingOwnerUserId: string | undefined
  if (principal.kind === 'workspace_api_key') {
    const workspace = await loadActiveWorkspaceContext(workspaceId)
    if (!workspace) throw new OrchestrationError('not_found', 'Workspace not found')
    workspaceBillingOwnerUserId = workspace.billedAccountUserId
  }
  return resolvePrincipalAttribution(principal, { workspaceBillingOwnerUserId }).attributedUserId
}

export const createWorkspaceFileByPath = {
  operation: fileOperations.create,
  execute: executeCreate,
} as const

export const updateWorkspaceFileContentByPath = {
  operation: fileOperations.updateContent,
  execute: executeOverwrite,
} as const

export const createWorkspaceFileBufferByPath = {
  operation: fileOperations.create,
  execute: executeCreateBuffer,
} as const

export const updateWorkspaceFileContentBufferByPath = {
  operation: fileOperations.updateContent,
  execute: executeOverwriteBuffer,
} as const
