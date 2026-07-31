import { canonicalWorkspaceFilePath, decodeVfsPathSegments } from '@/lib/copilot/vfs/path-utils'
import {
  ensureWorkspaceFileFolderPath,
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
      /** Null for root targets AND for parent chains that don't exist yet — validation is read-only; missing folders are created at write time. */
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

/**
 * Resolve a create-mode write target. Pass `createFolders` (the write path) to
 * create missing parent folders; without it (the validation path) resolution
 * is read-only — a missing parent chain yields `folderId: null`, since the
 * folders are created at write time and nothing can conflict there yet.
 */
async function resolveCreateTarget(
  workspaceId: string,
  path: string,
  createFolders?: { userId: string }
): Promise<ResolvedCreateTarget> {
  const parsed = parseWorkspaceFileCreatePath(path)
  let folderId: string | null = null
  if (parsed.folderSegments.length > 0) {
    if (createFolders) {
      folderId = await ensureWorkspaceFileFolderPath({
        workspaceId,
        userId: createFolders.userId,
        pathSegments: parsed.folderSegments,
      })
      if (!folderId) {
        throw new Error(`Failed to create directory: ${displayFolderPath(parsed.folderSegments)}`)
      }
    } else {
      folderId = await findWorkspaceFileFolderIdByPath(workspaceId, parsed.folderSegments)
      if (!folderId) {
        return {
          fileName: parsed.fileName,
          folderId: null,
          vfsPath: parsed.vfsPath,
        }
      }
    }
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
  userId?: string
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

  const createTarget = await resolveCreateTarget(args.workspaceId, args.target.path, {
    userId: args.userId,
  })
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
