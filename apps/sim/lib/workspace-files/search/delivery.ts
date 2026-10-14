import type { WorkspaceFileRow } from '@sim/db/schema'
import { workspaceFileSearchRevision, workspaceFiles } from '@sim/db/schema'
import { compareStrings } from '@sim/utils/string'
import { and, asc, inArray, isNull, or } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbTransaction } from '@/lib/db/types'
import type { FolderIdScope } from '@/lib/folders/scope'
import type { listFileFolders } from '@/lib/uploads/contexts/workspace'
import {
  getBoundWorkspaceFileSecretProvenanceByMetadata,
  mergeWorkspaceFileSecretProvenance,
  type WorkspaceFileSecretProvenance,
} from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { toWorkspaceFileFolderPathView } from '@/lib/workspace-files/folder-display-path'
import { resolveFolderIdsForPaths } from '@/lib/workspace-files/folder-path-selection'
import type { EditableFileOwner } from '@/lib/workspace-files/ownership'
import type { FileSearchResult } from '@/lib/workspace-files/search/repository'
import {
  fileSearchInputCondition,
  searchableFileCondition,
} from '@/lib/workspace-files/search/scope'
import { configureFileSearchTransaction } from '@/lib/workspace-files/search/transaction'

/**
 * Absent paths leave search unscoped; an explicit empty selection matches nothing. Resolves
 * descendants unless disabled and rejects missing paths instead of broadening the scope.
 */
export function resolveFileSearchFolderScope(
  folders: Awaited<ReturnType<typeof listFileFolders>>,
  input: { folderPaths?: readonly string[]; includeSubfolders?: boolean }
): FolderIdScope | undefined {
  if (input.folderPaths === undefined) return undefined
  const selection = resolveFolderIdsForPaths(
    folders.map((folder) => ({
      ...toWorkspaceFileFolderPathView(folder),
      id: folder.id,
      parentId: folder.parentId,
    })),
    input.folderPaths,
    { includeSubfolders: input.includeSubfolders }
  )
  if (selection.missingPath !== undefined)
    throw new OrchestrationError('not_found', `Folder not found: ${selection.missingPath}`)
  return { folderIds: selection.folderIds, includeRootItems: selection.includeRootItems }
}

/** Validates a private index snapshot against current rows after its caller authorizes the owner. */
export async function loadFileSearchDelivery(
  tx: DbTransaction,
  {
    owner,
    prepared,
    scope,
    signal,
    classify,
  }: {
    owner: EditableFileOwner
    prepared: FileSearchResult
    scope?: FolderIdScope
    signal?: AbortSignal
    classify: boolean
  }
): Promise<{
  provenance: Map<string, WorkspaceFileSecretProvenance>
  inputs: { fileId: string; fileContext: string }[]
}> {
  signal?.throwIfAborted()
  const sourceIds = new Set(prepared.sources.map((source) => source.identity.fileId))
  const dependencyIds = new Set(
    prepared.sources.flatMap((source) => source.dependencies.map((input) => input.fileId))
  )
  const ids = [...new Set([...sourceIds, ...dependencyIds])]
  ids.sort(compareStrings)
  await configureFileSearchTransaction(tx)
  const rows: Pick<
    WorkspaceFileRow,
    'id' | 'key' | 'context' | 'contentUpdatedAt' | 'secretProvenanceVersion' | 'folderId'
  >[] = []
  for (let offset = 0; offset < ids.length; offset += 1_000) {
    signal?.throwIfAborted()
    const batchIds = ids.slice(offset, offset + 1_000)
    rows.push(
      ...(await tx
        .select({
          id: workspaceFiles.id,
          key: workspaceFiles.key,
          context: workspaceFiles.context,
          contentUpdatedAt: workspaceFiles.contentUpdatedAt,
          secretProvenanceVersion: workspaceFiles.secretProvenanceVersion,
          folderId: workspaceFiles.folderId,
        })
        .from(workspaceFiles)
        .where(
          and(
            or(
              and(
                inArray(
                  workspaceFiles.id,
                  batchIds.filter((id) => sourceIds.has(id))
                ),
                searchableFileCondition(owner)
              ),
              and(
                inArray(
                  workspaceFiles.id,
                  batchIds.filter((id) => dependencyIds.has(id))
                ),
                fileSearchInputCondition(owner)
              )
            ),
            isNull(workspaceFiles.deletedAt)
          )
        )
        .orderBy(asc(workspaceFiles.id))
        .for('share'))
    )
  }
  const byId = new Map(rows.map((row) => [row.id, row]))
  const states =
    prepared.sources.length === 0
      ? []
      : await tx
          .select({
            fileId: workspaceFileSearchRevision.fileId,
            buildId: workspaceFileSearchRevision.buildId,
            status: workspaceFileSearchRevision.status,
          })
          .from(workspaceFileSearchRevision)
          .where(
            inArray(
              workspaceFileSearchRevision.fileId,
              prepared.sources.map((source) => source.identity.fileId)
            )
          )
  const statesById = new Map(states.map((state) => [state.fileId, state]))
  for (const source of prepared.sources) {
    const current = byId.get(source.identity.fileId)
    const state = statesById.get(source.identity.fileId)
    if (
      !current ||
      current.context !== owner.entityType ||
      current.key !== source.identity.key ||
      current.contentUpdatedAt.getTime() !== source.identity.contentUpdatedAt?.getTime() ||
      state?.status !== 'ready' ||
      state.buildId !== source.buildId ||
      (scope &&
        (current.folderId ? !scope.folderIds.has(current.folderId) : !scope.includeRootItems))
    )
      throw new OrchestrationError(
        'conflict',
        'A matching file changed during search. Retry the search.'
      )
    for (const dependency of source.dependencies) {
      const currentInput = byId.get(dependency.fileId)
      if (
        !currentInput ||
        currentInput.key !== dependency.key ||
        currentInput.contentUpdatedAt.getTime() !== dependency.sourceContentUpdatedAt.getTime()
      )
        throw new OrchestrationError(
          'conflict',
          'A matching document input changed during search. Retry the search.'
        )
    }
  }
  const sources = new Map<string, WorkspaceFileSecretProvenance>()
  if (classify) {
    const provenance = await getBoundWorkspaceFileSecretProvenanceByMetadata(tx, rows)
    for (const source of prepared.sources) {
      let secretProvenance: WorkspaceFileSecretProvenance = { status: 'exact', entries: [] }
      for (const id of [
        source.identity.fileId,
        ...source.dependencies.map((input) => input.fileId),
      ])
        secretProvenance = mergeWorkspaceFileSecretProvenance(
          secretProvenance,
          provenance.get(id) ?? { status: 'unknown' }
        )
      sources.set(source.identity.fileId, secretProvenance)
    }
  }
  signal?.throwIfAborted()
  return {
    provenance: sources,
    inputs: rows
      .filter((row) => row.context !== owner.entityType)
      .map((row) => ({ fileId: row.id, fileContext: row.context })),
  }
}
