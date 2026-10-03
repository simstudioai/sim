import type { Principal } from '@sim/auth/principal'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import {
  type CopilotFileDelegationContext,
  resolveCopilotFilePrincipal,
} from '@/lib/mothership/auth/file-delegation'
import { canonicalWorkspaceFilePath } from '@/lib/mothership/vfs/path-utils'
import {
  findWorkspaceFileFolderIdByPath,
  listWorkspaceFileFolders,
} from '@/lib/uploads/contexts/workspace/workspace-file-folder-manager'
import {
  getWorkspaceFileByName,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import type { WorkspaceFileSecretProvenance } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { admitCreateWorkspaceFile } from '@/lib/workspace-files/application/create-workspace-file'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { resolveWorkspaceFileReference } from '@/lib/workspace-files/application/resolve-workspace-file-reference'
import {
  createWorkspaceFileBufferByPath,
  updateWorkspaceFileContentBufferByPath,
} from '@/lib/workspace-files/application/write-workspace-file-by-path'
import { parseWorkspaceFileCreatePath } from '@/lib/workspace-files/workspace-file-path'

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

/**
 * Refuses to recreate a folder that has moved.
 *
 * A create into a folder path that no longer exists is normally fine — missing
 * parents are created at write time — but when a folder of the same name lives
 * elsewhere the path is almost always stale rather than new: a tool remembering
 * `files/xp-files/…` after the user moved `xp-files` under `fx-archive`.
 * Creating a fresh top-level `xp-files` then splits the user's files across two
 * folders with one name. The error names where the folder went so the caller
 * can write there, and leaves creating a genuine namesake to an explicit mkdir.
 *
 * Only the leaf folder is checked: it is the folder the caller targeted, and
 * an ancestor with a namesake elsewhere is what a deliberate new tree looks like.
 */
async function assertTargetFolderNotMoved(
  workspaceId: string,
  parsed: { folderSegments: string[]; fileName: string }
): Promise<void> {
  const leafName = parsed.folderSegments.at(-1)
  if (!leafName) return
  const requestedFolderPath = parsed.folderSegments.join('/')
  const relocated = (await listWorkspaceFileFolders(workspaceId)).filter(
    (folder) => folder.name === leafName && folder.path !== requestedFolderPath
  )
  if (relocated.length === 0) return
  const locations = relocated.map((folder) => `/${folder.path}`).join(' or ')
  const writeTarget = canonicalWorkspaceFilePath({
    folderPath: relocated[0].path,
    name: parsed.fileName,
  })
  throw new Error(
    `Folder "${leafName}" now lives at ${locations}; write to ${writeTarget} or create the folder explicitly with files mkdir.`
  )
}

/**
 * Finds the create target's parent folder, or null when the chain does not exist
 * yet and may be created at write time — never for a folder that merely moved.
 */
async function resolveCreateFolderId(
  workspaceId: string,
  parsed: { folderSegments: string[]; fileName: string }
): Promise<string | null> {
  if (parsed.folderSegments.length === 0) return null
  const folderId = await findWorkspaceFileFolderIdByPath(workspaceId, parsed.folderSegments)
  if (folderId) return folderId
  await assertTargetFolderNotMoved(workspaceId, parsed)
  return null
}

/** Resolves a create-mode target without mutating missing parent folders. */
async function resolveCreateTarget(
  workspaceId: string,
  path: string
): Promise<ResolvedCreateTarget> {
  const parsed = parseWorkspaceFileCreatePath(path)
  let folderId: string | null = null
  if (parsed.folderSegments.length > 0) {
    folderId = await resolveCreateFolderId(workspaceId, parsed)
    if (!folderId) {
      return {
        fileName: parsed.fileName,
        folderId: null,
        vfsPath: parsed.vfsPath,
      }
    }
  }

  const existing = await getWorkspaceFileByName(workspaceId, parsed.fileName, { folderId })
  if (existing) {
    throw new Error(
      `File already exists at ${parsed.vfsPath}. Choose a different name to keep both files, or pass mode "overwrite" only if the user wants that existing file replaced.`
    )
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

async function assertWorkspaceFileWriteAccess(args: {
  workspaceId: string
  principal: Principal
  target: WorkspaceFileWriteTarget
}): Promise<void> {
  if (args.target.mode === 'create') {
    await admitCreateWorkspaceFile(args.principal, args.workspaceId)
    return
  }
  await resolveWorkspaceFileReference({
    principal: args.principal,
    operation: fileOperations.updateContent,
    workspaceId: args.workspaceId,
    reference: args.target.path,
  })
}

export async function validateWorkspaceFileWriteTarget(args: {
  workspaceId: string
  principal: Principal
  target: WorkspaceFileWriteTarget
}): Promise<WorkspaceFileWriteValidation> {
  if (args.target.mode === 'overwrite') {
    const existing = await resolveWorkspaceFileReference({
      principal: args.principal,
      operation: fileOperations.updateContent,
      workspaceId: args.workspaceId,
      reference: args.target.path,
    })
    return {
      mode: 'overwrite',
      vfsPath: vfsPathForRecord(existing),
      existingFileId: existing.id,
    }
  }

  await admitCreateWorkspaceFile(args.principal, args.workspaceId)
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
  principal: Principal
  target: WorkspaceFileWriteTarget
  buffer: Buffer
  inferredMimeType: string
  /**
   * Forwarded to {@link updateWorkspaceFileContent} on an overwrite. Defaults to `true` (stream a
   * markdown overwrite into any open collaborative editor). Pass `false` for a write whose content is
   * only a placeholder — e.g. `create_empty_file`'s empty shell, whose real content lands via a later write.
   */
  syncLiveDoc?: boolean
  /** Private provenance for the exact bytes being written. */
  secretProvenance?: WorkspaceFileSecretProvenance
}): Promise<WorkspaceFileWriteResult> {
  const contentType = args.target.mimeType || args.inferredMimeType
  if (args.target.mode === 'overwrite') {
    // Overwrite is an upsert: "put these bytes at this path". A missing target
    // falls through to create instead of failing — otherwise every generator
    // (generate_image, ffmpeg, downloads) forces the model through a
    // create-vs-overwrite guessing dance racing its own earlier writes.
    let missingTarget = false
    try {
      await assertWorkspaceFileWriteAccess(args)
    } catch (accessError) {
      if (asOrchestrationError(accessError)?.code !== 'not_found') throw accessError
      missingTarget = true
    }
    if (!missingTarget) {
      const updated = await updateWorkspaceFileContentBufferByPath.execute({
        principal: args.principal,
        input: {
          workspaceId: args.workspaceId,
          path: args.target.path,
          mode: 'overwrite',
          content: args.buffer,
          contentType,
          syncLiveDoc: args.syncLiveDoc,
          secretProvenance: args.secretProvenance,
        },
      })

      return {
        id: updated.id,
        name: updated.name,
        size: updated.size,
        contentType: updated.contentType,
        downloadUrl: updated.downloadUrl,
        vfsPath: updated.vfsPath,
        mode: 'overwrite',
      }
    }
    args = { ...args, target: { ...args.target, mode: 'create' } }
  }

  await assertWorkspaceFileWriteAccess(args)
  await resolveCreateFolderId(args.workspaceId, parseWorkspaceFileCreatePath(args.target.path))

  const created = await createWorkspaceFileBufferByPath.execute({
    principal: args.principal,
    input: {
      workspaceId: args.workspaceId,
      path: args.target.path,
      mode: 'create',
      content: args.buffer,
      contentType,
      exactName: true,
      secretProvenance: args.secretProvenance,
    },
  })

  return {
    id: created.id,
    name: created.name,
    size: created.size,
    contentType: created.contentType,
    downloadUrl: created.downloadUrl,
    vfsPath: created.vfsPath,
    mode: 'create',
  }
}

type CopilotWorkspaceFileWriteArgs = Omit<
  Parameters<typeof writeWorkspaceFileByPath>[0],
  'principal'
>

export function writeCopilotWorkspaceFileByPath(
  context: CopilotFileDelegationContext | undefined,
  args: CopilotWorkspaceFileWriteArgs
) {
  return writeWorkspaceFileByPath({
    ...args,
    principal: resolveCopilotFilePrincipal(context),
  })
}
