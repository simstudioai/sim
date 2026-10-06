import type { CleanupJobPayload } from '@/lib/billing/cleanup-dispatcher'
import {
  DEFAULT_DELETE_CHUNK_SIZE,
  DEFAULT_MAX_BATCHES_PER_TABLE,
} from '@/lib/cleanup/batch-delete'
import { prepareLegacyFileArchiveCleanup } from '@/lib/file-retention/legacy-archive'
import type {
  FileArchiveCleanup,
  FileArchiveDeletion,
  FileRetentionOptions,
  FileVersionCleanupResult,
} from '@/lib/file-retention/types'
import { cleanupWorkspaceFileVersions } from '@/lib/file-retention/workspace-versions'
import {
  cleanupArchivedProjectFileFolders,
  cleanupArchivedProjectFiles,
  cleanupProjectFileVersions,
} from '@/lib/projects/files/retention'
import {
  type FileOwnerAdapters,
  requireFileOwnerAdapter,
} from '@/lib/workspace-files/owner-adapters'
import type { FileOwner } from '@/lib/workspace-files/ownership'

interface RetentionAdapter {
  versions?(
    ids: string[],
    options: FileRetentionOptions,
    limit: number
  ): Promise<FileVersionCleanupResult>
  archive(ids: string[], options: FileRetentionOptions): Promise<FileArchiveCleanup>
}

const OWNER_ADAPTERS: FileOwnerAdapters<RetentionAdapter> = {
  workspace: {
    versions: cleanupWorkspaceFileVersions,
    archive: (ids, options) => prepareLegacyFileArchiveCleanup({ kind: 'workspace', ids }, options),
  },
  organization: {
    archive: (ids, options) =>
      prepareLegacyFileArchiveCleanup({ kind: 'organization', ids }, options),
  },
  project: {
    async versions(ids, _options, limit) {
      let deleted = 0
      for (const id of ids) {
        if (deleted >= limit) break
        deleted += await cleanupProjectFileVersions(id, limit - deleted)
      }
      return { deleted, attempted: deleted }
    },
    async archive(ids, { budgets }) {
      const files = budgets?.files ?? {
        remaining: DEFAULT_DELETE_CHUNK_SIZE * DEFAULT_MAX_BATCHES_PER_TABLE,
      }
      const folders = budgets?.folders ?? {
        remaining: DEFAULT_DELETE_CHUNK_SIZE * DEFAULT_MAX_BATCHES_PER_TABLE,
      }
      let deleted = 0
      for (const id of ids) {
        if (files.remaining <= 0 && folders.remaining <= 0) break
        deleted += await cleanupArchivedProjectFiles(id, files)
        deleted += await cleanupArchivedProjectFileFolders(id, folders)
      }
      return {
        cleanupStorage: async () => ({ filesDeleted: 0, deleteRows: async () => deleted }),
      }
    },
  },
}

/** Keep queued payloads compatible while file operations consume one owner interface. */
export function fileRetentionOwners(
  payload: Pick<CleanupJobPayload, 'projectIds' | 'workspaceIds' | 'organizationIds'>
): FileOwner[] {
  return [
    ...(payload.projectIds ?? []).map(
      (entityId): FileOwner => ({ entityType: 'project', entityId })
    ),
    ...payload.workspaceIds.map((entityId): FileOwner => ({ entityType: 'workspace', entityId })),
    ...(payload.organizationIds ?? []).map(
      (entityId): FileOwner => ({ entityType: 'organization', entityId })
    ),
  ]
}

function ownerBatches(owners: FileOwner[], operation: 'versions' | 'archive') {
  const batches = new Map<
    FileOwner['entityType'],
    { adapter: RetentionAdapter; ids: Set<string> }
  >()
  for (const owner of owners) {
    const adapter = requireFileOwnerAdapter(OWNER_ADAPTERS, owner)
    if (!adapter[operation])
      throw new Error(`File ${operation} retention does not support this owner`)
    const batch = batches.get(owner.entityType)
    if (batch) batch.ids.add(owner.entityId)
    else batches.set(owner.entityType, { adapter, ids: new Set([owner.entityId]) })
  }
  return [...batches.entries()].map(([type, { adapter, ids }]) => ({
    adapter,
    ids: type === 'project' ? [...ids].sort() : [...ids],
  }))
}

/** Validate every owner before destructive work and share one attempt cap across batches. */
export async function cleanupFileVersions(
  owners: FileOwner[],
  options: FileRetentionOptions,
  limit: number
): Promise<number> {
  const batches = ownerBatches(owners, 'versions')
  let deleted = 0
  let attempted = 0
  for (const { adapter, ids } of batches) {
    if (attempted >= limit) break
    if (!adapter.versions) throw new Error('File version retention is unavailable')
    const result = await adapter.versions(ids, options, limit - attempted)
    deleted += result.deleted
    attempted += result.attempted
  }
  return deleted
}

/** Begin owner cleanup; Project commits immediately, while legacy storage and row phases stay ordered. */
export async function beginFileArchiveCleanup(
  owners: FileOwner[],
  options: FileRetentionOptions
): Promise<FileArchiveCleanup> {
  const batches = ownerBatches(owners, 'archive')
  const cleanups: FileArchiveCleanup[] = []
  for (const { adapter, ids } of batches) cleanups.push(await adapter.archive(ids, options))
  return {
    async cleanupStorage() {
      const deletions: FileArchiveDeletion[] = []
      for (const cleanup of cleanups) deletions.push(await cleanup.cleanupStorage())
      return {
        filesDeleted: deletions.reduce((sum, deletion) => sum + deletion.filesDeleted, 0),
        async deleteRows() {
          let deleted = 0
          for (const deletion of deletions) deleted += await deletion.deleteRows()
          return deleted
        },
      }
    },
  }
}
