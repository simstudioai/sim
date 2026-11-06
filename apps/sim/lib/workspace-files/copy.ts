import { folder, type WorkspaceFileRow, workspaceFiles } from '@sim/db/schema'
import { and, asc, inArray, isNull, or } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbTransaction } from '@/lib/db/types'
import {
  assertFileFolderTarget,
  buildWorkspaceFileFolderPathMap,
  createFileFolderRow,
  listFileFolders,
} from '@/lib/uploads/contexts/workspace/file-folder-manager'
import {
  commitFileCreateInTx,
  mapFileRecord,
  type OwnedFileRecord,
  type PlannedFileIdentity,
  type StagedFileContent,
} from '@/lib/uploads/contexts/workspace/file-manager'
import {
  getBoundWorkspaceFileSecretProvenanceByMetadata,
  type WorkspaceFileSecretProvenance,
} from '@/lib/uploads/contexts/workspace/file-secret-provenance'
import { getWorkspaceFileSize, MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import { MAX_WORKSPACE_FILE_BULK_AFFECTED_ITEMS } from '@/lib/workspace-files/limits'
import type { EditableFileOwner } from '@/lib/workspace-files/ownership'
import { fileFolderOwnerCondition, fileOwnerCondition } from '@/lib/workspace-files/ownership-query'

interface CopySelection {
  owner: EditableFileOwner
  fileIds: readonly string[]
  folderIds: readonly string[]
}

interface CopyFolder {
  id: string
  name: string
  parentId: string | null
  updatedAt: Date
}

interface FileCopySnapshot {
  owner: EditableFileOwner
  files: WorkspaceFileRow[]
  folders: CopyFolder[]
  provenance: Map<string, WorkspaceFileSecretProvenance>
  bytes: number
}

export interface CopiedFileItems {
  files: OwnedFileRecord[]
  folders: Awaited<ReturnType<typeof listFileFolders>>
}

function requireBoundedSelection(size: number) {
  if (size > MAX_WORKSPACE_FILE_BULK_AFFECTED_ITEMS) {
    throw new OrchestrationError('validation', 'Copy expands beyond the file selection limit')
  }
}

/** Captures only explicit source selections and their bounded active descendants. */
export async function snapshotFileCopyInTx(
  tx: DbTransaction,
  source: CopySelection
): Promise<FileCopySnapshot> {
  if (!source.fileIds.length && !source.folderIds.length) {
    throw new OrchestrationError('validation', 'Copy requires a source selection')
  }
  const loadFolders = (ids: readonly string[], descendants: boolean, limit: number) =>
    tx
      .select({
        id: folder.id,
        name: folder.name,
        parentId: folder.parentId,
        updatedAt: folder.updatedAt,
      })
      .from(folder)
      .where(
        and(
          fileFolderOwnerCondition(source.owner),
          isNull(folder.deletedAt),
          inArray(descendants ? folder.parentId : folder.id, [...ids])
        )
      )
      .orderBy(asc(folder.id))
      .limit(limit)
  const candidates = source.folderIds.length
    ? await loadFolders(source.folderIds, false, MAX_WORKSPACE_FILE_BULK_AFFECTED_ITEMS + 1)
    : []
  const selectedFolders = new Set(candidates.map((row) => row.id))
  if (source.folderIds.some((id) => !selectedFolders.has(id)))
    throw new OrchestrationError('not_found', 'Source folder not found')
  let frontier = [...selectedFolders]
  while (frontier.length) {
    requireBoundedSelection(selectedFolders.size)
    const children = await loadFolders(frontier, true, MAX_WORKSPACE_FILE_BULK_AFFECTED_ITEMS + 1)
    frontier = []
    for (const child of children) {
      if (selectedFolders.has(child.id)) continue
      selectedFolders.add(child.id)
      candidates.push(child)
      frontier.push(child.id)
    }
    requireBoundedSelection(selectedFolders.size)
  }
  const files = await tx
    .select()
    .from(workspaceFiles)
    .where(
      and(
        fileOwnerCondition(source.owner),
        isNull(workspaceFiles.deletedAt),
        or(
          source.fileIds.length ? inArray(workspaceFiles.id, [...source.fileIds]) : undefined,
          selectedFolders.size ? inArray(workspaceFiles.folderId, [...selectedFolders]) : undefined
        )
      )
    )
    .orderBy(asc(workspaceFiles.id))
    .limit(MAX_WORKSPACE_FILE_BULK_AFFECTED_ITEMS + 1)
    .for('share')
  requireBoundedSelection(files.length + selectedFolders.size)
  const fileIds = new Set(files.map((row) => row.id))
  if (source.fileIds.some((id) => !fileIds.has(id))) {
    throw new OrchestrationError('not_found', 'Source file not found')
  }
  const bytes = files.reduce((sum, row) => sum + getWorkspaceFileSize(row), 0)
  if (!Number.isSafeInteger(bytes) || bytes > MAX_BUFFERED_TRANSFER_BYTES) {
    throw new OrchestrationError('payload_too_large', 'Copy exceeds the buffered transfer limit')
  }
  const folders = candidates.filter((row) => selectedFolders.has(row.id))
  const provenance = await getBoundWorkspaceFileSecretProvenanceByMetadata(tx, files)
  return { owner: source.owner, files, folders, provenance, bytes }
}

function snapshotIdentity(snapshot: FileCopySnapshot) {
  return JSON.stringify({
    owner: snapshot.owner,
    folders: snapshot.folders,
    files: snapshot.files.map((file) => ({
      id: file.id,
      key: file.key,
      name: file.originalName,
      folderId: file.folderId,
      size: getWorkspaceFileSize(file),
      type: file.contentType,
      updatedAt: file.updatedAt,
      contentUpdatedAt: file.contentUpdatedAt,
      provenance: snapshot.provenance.get(file.id),
    })),
  })
}

/** Refuses changed bytes, metadata, classification, or recursive membership after external staging. */
export function requireUnchangedFileCopy(prepared: FileCopySnapshot, current: FileCopySnapshot) {
  if (snapshotIdentity(prepared) !== snapshotIdentity(current)) {
    throw new OrchestrationError('conflict', 'Source selection changed during copy; retry')
  }
}

/** Commits a fresh tree and current heads through the shared identity/provenance writers. */
export async function commitFileCopyInTx(
  tx: DbTransaction,
  args: {
    snapshot: FileCopySnapshot
    destination: { owner: EditableFileOwner; folderId: string | null }
    userId: string
    staged: ReadonlyMap<string, StagedFileContent>
    identities: ReadonlyMap<string, PlannedFileIdentity>
  }
): Promise<CopiedFileItems> {
  const { snapshot, destination, userId } = args
  const targetFolderId = await assertFileFolderTarget(destination.owner, destination.folderId, tx)
  const pending = new Map(snapshot.folders.map((row) => [row.id, row]))
  const mapped = new Map<string, string>()
  while (pending.size) {
    let progressed = false
    for (const [id, source] of pending) {
      if (source.parentId && pending.has(source.parentId)) continue
      const created = await createFileFolderRow(
        {
          owner: destination.owner,
          userId,
          name: source.name,
          parentId: source.parentId
            ? (mapped.get(source.parentId) ?? targetFolderId)
            : targetFolderId,
          exactName: false,
        },
        tx
      )
      mapped.set(id, created.id)
      pending.delete(id)
      progressed = true
    }
    if (!progressed)
      throw new OrchestrationError('conflict', 'Source folder hierarchy contains a cycle')
  }
  const createdFiles: WorkspaceFileRow[] = []
  for (const source of snapshot.files) {
    const staged = args.staged.get(source.id)
    const secretProvenance = snapshot.provenance.get(source.id)
    const identity = args.identities.get(source.id)
    if (!staged || !secretProvenance || !identity)
      throw new Error('Copied file staging is incomplete')
    createdFiles.push(
      await commitFileCreateInTx(tx, {
        owner: destination.owner,
        staged,
        identity,
        userId,
        folderId: source.folderId
          ? (mapped.get(source.folderId) ?? targetFolderId)
          : targetFolderId,
        secretProvenance,
      })
    )
  }
  const destinationFolders = await listFileFolders(destination.owner, undefined, tx)
  const paths = buildWorkspaceFileFolderPathMap(destinationFolders)
  const folderById = new Map(destinationFolders.map((folder) => [folder.id, folder]))
  return {
    files: createdFiles.map((file) => mapFileRecord(file, destination.owner, paths)),
    folders: [...mapped.values()].map((id) => {
      const folder = folderById.get(id)
      if (!folder) throw new Error('Copied folder is missing from the destination')
      return folder
    }),
  }
}
