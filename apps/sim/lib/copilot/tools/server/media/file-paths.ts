import { resolveChatUpload } from '@/lib/copilot/tools/handlers/upload-file-reader'
import {
  validateWorkspaceFileWriteTarget,
  type WorkspaceFileWriteMode,
} from '@/lib/copilot/vfs/resource-writer'
import {
  resolveWorkspaceFileReference,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'

const UPLOADS_PREFIX = 'uploads/'
const FILES_PREFIX = 'files/'

interface MediaOutputDeclaration {
  path: string
  mode?: WorkspaceFileWriteMode
  mimeType?: string
}

export function getSingleMediaFileDeclaration<T extends { path: string }>(
  files: T[] | undefined,
  label: 'Input' | 'Output'
): T {
  if (files?.length !== 1) {
    throw new Error(`${label} requires exactly one file; received ${files?.length ?? 0}`)
  }
  return files[0]
}

export function requireMediaFileDeclarations<T extends { path: string }>(
  files: T[] | undefined,
  label: 'Input' | 'Output'
): T[] {
  if (!files?.length) {
    throw new Error(`${label} requires at least one file`)
  }
  return files
}

/**
 * Resolve a media input from either persistent workspace files or chat-scoped uploads.
 */
export async function resolveMediaInputFile(args: {
  workspaceId: string
  chatId?: string
  path: string
}): Promise<WorkspaceFileRecord> {
  const path = args.path.trim()
  let file: WorkspaceFileRecord | null

  if (path.startsWith(UPLOADS_PREFIX)) {
    const filename = path.slice(UPLOADS_PREFIX.length)
    if (!filename || filename.includes('/')) {
      throw new Error(`Upload input path must identify a file: ${args.path}`)
    }
    if (!args.chatId) {
      throw new Error(`Chat context is required for upload input: ${path}`)
    }
    file = await resolveChatUpload(filename, args.chatId)
  } else {
    file = await resolveWorkspaceFileReference(args.workspaceId, path)
  }

  if (!file) {
    throw new Error(`Input file not found: ${args.path}`)
  }
  return file
}

/**
 * Preflight a user-supplied media output through the canonical workspace writer policy.
 */
export async function validateMediaOutputFile(args: {
  workspaceId: string
  userId: string
  path: string
  mode: WorkspaceFileWriteMode
  mimeType?: string
}): Promise<void> {
  if (!args.path.trim().startsWith(FILES_PREFIX)) {
    throw new Error(
      `Media output paths must start with "files/"; uploads/ paths are read-only: ${args.path}`
    )
  }
  await validateWorkspaceFileWriteTarget({
    workspaceId: args.workspaceId,
    userId: args.userId,
    target: { path: args.path, mode: args.mode, mimeType: args.mimeType },
  })
}

export async function prepareMediaOutput<T extends MediaOutputDeclaration>(args: {
  output?: { files?: T[] }
  workspaceId: string
  userId: string
}): Promise<(T & { mode: WorkspaceFileWriteMode }) | undefined> {
  if (!args.output) return undefined

  const file = getSingleMediaFileDeclaration(args.output.files, 'Output')
  const output = { ...file, mode: file.mode ?? 'create' }
  await validateMediaOutputFile({
    workspaceId: args.workspaceId,
    userId: args.userId,
    path: output.path,
    mode: output.mode,
    mimeType: output.mimeType,
  })
  return output
}
