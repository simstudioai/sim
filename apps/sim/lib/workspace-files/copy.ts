import { folder, type WorkspaceFileRow, workspaceFiles } from '@sim/db/schema'
import { compareStrings } from '@sim/utils/string'
import { and, asc, inArray, isNull, or } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbTransaction } from '@/lib/db/types'
import { acquireFolderMutationLock } from '@/lib/folders/locks'
import { collectDescendantFolderIdsFrom, indexFolderChildren } from '@/lib/folders/subtree'
import {
  assertFileFolderTarget,
  buildWorkspaceFileFolderPathMap,
  createFileFolder,
  listFileFolders,
} from '@/lib/uploads/contexts/workspace/workspace-file-folder-manager'
import {
  commitFileCreateInTx,
  mapFileRecord,
  type OwnedFileRecord,
  type PlannedFileIdentity,
  type StagedFileContent,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import {
  getBoundWorkspaceFileSecretProvenanceByMetadata,
  type WorkspaceFileSecretProvenance,
} from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
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

/** Takes owner-qualified directory locks after the caller holds every involved Project mutex. */
export async function lockFileCopyDirectories(tx: DbTransaction, owners: EditableFileOwner[]) {
  const keys = [
    ...new Set(
      owners.map((owner) =>
        owner.entityType === 'workspace' ? owner.entityId : `project:${owner.entityId}`
      )
    ),
  ].sort(compareStrings)
  for (const key of keys) await acquireFolderMutationLock(tx, key, 'file')
}

/** Captures only explicit source selections and their bounded active descendants. */
export async function snapshotFileCopyInTx(
  tx: DbTransaction,
  source: CopySelection
): Promise<FileCopySnapshot> {
  if (!source.fileIds.length && !source.folderIds.length) {
    throw new OrchestrationError('validation', 'Copy requires a source selection')
  }
  const candidates = source.folderIds.length
    ? await tx
        .select({
          id: folder.id,
          name: folder.name,
          parentId: folder.parentId,
          updatedAt: folder.updatedAt,
        })
        .from(folder)
        .where(and(fileFolderOwnerCondition(source.owner), isNull(folder.deletedAt)))
        .orderBy(asc(folder.id))
        .limit(MAX_WORKSPACE_FILE_BULK_AFFECTED_ITEMS + 1)
    : []
  requireBoundedSelection(candidates.length)
  const byId = new Map(candidates.map((row) => [row.id, row]))
  const children = indexFolderChildren(candidates)
  const selectedFolders = new Set<string>()
  for (const id of source.folderIds) {
    if (!byId.has(id)) throw new OrchestrationError('not_found', 'Source folder not found')
    selectedFolders.add(id)
    for (const childId of collectDescendantFolderIdsFrom(children, id)) selectedFolders.add(childId)
  }
  requireBoundedSelection(selectedFolders.size)
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
  const folders: CopiedFileItems['folders'] = []
  while (pending.size) {
    let progressed = false
    for (const [id, source] of pending) {
      if (source.parentId && pending.has(source.parentId)) continue
      const created = await createFileFolder(
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
      folders.push(created)
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
  const paths = buildWorkspaceFileFolderPathMap(
    await listFileFolders(destination.owner, undefined, tx)
  )
  return {
    files: createdFiles.map((file) => mapFileRecord(file, destination.owner, paths)),
    folders,
  }
}
