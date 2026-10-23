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
} from '@/lib/uploads/contexts/workspace/file-secret-provenance'
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
  return selection.scope
}

/**
 * Validates a private index snapshot against current rows after its caller authorizes the owner.
 * Each source is judged on its own: one that left the folder scope is listed in `outOfScope` for
 * the caller to drop, and only one whose file, revision, and inputs are unchanged since the search
 * is listed in `current`; any other has a stale preview to withhold. `classify` adds the merged
 * provenance of each current source. Only inputs of current sources are returned for access checks.
 */
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
  current: Set<string>
  provenance: Map<string, WorkspaceFileSecretProvenance>
  outOfScope: Set<string>
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
        .orderBy(asc(workspaceFiles.id)))
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
  const outOfScope = new Set<string>()
  const current: FileSearchResult['sources'] = []
  for (const source of prepared.sources) {
    const row = byId.get(source.identity.fileId)
    const state = statesById.get(source.identity.fileId)
    if (
      row &&
      scope &&
      (row.folderId ? !scope.folderIds.has(row.folderId) : !scope.includeRootItems)
    ) {
      outOfScope.add(source.identity.fileId)
      continue
    }
    const unchanged =
      row !== undefined &&
      row.context === owner.entityType &&
      row.key === source.identity.key &&
      row.contentUpdatedAt.getTime() === source.identity.contentUpdatedAt?.getTime() &&
      state?.status === 'ready' &&
      state.buildId === source.buildId &&
      source.dependencies.every((dependency) => {
        const input = byId.get(dependency.fileId)
        return (
          input !== undefined &&
          input.key === dependency.key &&
          input.contentUpdatedAt.getTime() === dependency.sourceContentUpdatedAt.getTime()
        )
      })
    if (unchanged) current.push(source)
  }
  const sources = new Map<string, WorkspaceFileSecretProvenance>()
  if (classify) {
    const provenance = await getBoundWorkspaceFileSecretProvenanceByMetadata(tx, rows)
    for (const source of current) {
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
  const inputIds = new Set(
    current.flatMap((source) => source.dependencies.map((input) => input.fileId))
  )
  return {
    current: new Set(current.map((source) => source.identity.fileId)),
    provenance: sources,
    outOfScope,
    inputs: rows
      .filter((row) => row.context !== owner.entityType && inputIds.has(row.id))
      .map((row) => ({ fileId: row.id, fileContext: row.context })),
  }
}
