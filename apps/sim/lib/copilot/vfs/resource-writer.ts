import { canonicalWorkspaceFilePath, decodeVfsPathSegments } from '@/lib/copilot/vfs/path-utils'
import {
  findWorkspaceFileFolderIdByPath,
  normalizeWorkspaceFileItemName,
} from '@/lib/uploads/contexts/workspace/workspace-file-folder-manager'
import {
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
      fileName: string
      folderId: string | null
    }
  | {
      mode: 'overwrite'
      vfsPath: string
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
      ? await findWorkspaceFileFolderIdByPath(workspaceId, parsed.folderSegments)
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

export async function validateWorkspaceFileWriteTarget(args: {
  workspaceId: string
  target: WorkspaceFileWriteTarget
}): Promise<WorkspaceFileWriteValidation> {
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
