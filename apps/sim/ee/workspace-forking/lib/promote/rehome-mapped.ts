import { knowledgeBase, userTableDefinitions, workspaceFiles } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { chunkArray } from '@sim/utils/helpers'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import { resolveForkFolderMapping } from '@/ee/workspace-forking/lib/copy/copy-workflows'
import type { ForkMappingRow } from '@/ee/workspace-forking/lib/mapping/mapping-store'

const logger = createLogger('WorkspaceForkRehomeMapped')

/**
 * Identity rows arrive in one shot from the promote plan, but the resource lookups they drive are
 * `IN (...)` filters whose length scales with the whole edge. Page them so a large fork can never
 * approach the bind-parameter ceiling or hand the planner a pathological list; matches the paging
 * the rest of the fork copy already uses.
 */
const REHOME_PAGE = 500

/**
 * The families whose copies predate folder-structure transit. Workflows are absent on purpose:
 * their folder placement has always been remapped, and a workflow sync rewrites `folder_id` on
 * every replace, so they are already self-healing.
 */
const REHOMED_FAMILIES = ['file', 'table', 'knowledge_base'] as const

type RehomedFamily = (typeof REHOMED_FAMILIES)[number]

export interface RehomeMappedResult {
  /** source folder id -> target folder id for any subtree mirrored while re-homing. */
  folderIdMap: Map<string, string>
  /** Rows actually moved per family, for the promote log line. */
  rehomed: Record<RehomedFamily, number>
}

/**
 * Re-home already-mapped files / tables / knowledge bases that an earlier sync flattened to the
 * target root, mirroring the source folder subtree they belong to and moving them into it.
 *
 * Deliberately narrow: only rows whose target `folder_id` is currently NULL are touched. Copies
 * made before folder structure transited a fork edge all landed at the root, so NULL is the exact
 * signature of the damage - and skipping non-NULL rows means a placement the user chose in the
 * target is never overwritten by a later sync. A resource that is legitimately at the source root
 * has nothing to map and stays put, so the pass converges to a no-op once healed.
 *
 * Runs inside the promote transaction, after the sync-blocker gate, so a blocked sync moves
 * nothing and a refusal from the folder-ceiling check rolls the whole sync back rather than
 * leaving a half-moved tree.
 */
export async function rehomeFlattenedForkResources(params: {
  tx: DbOrTx
  /** The edge's identity rows, reused from the promote plan rather than re-read. */
  mappingRows: readonly ForkMappingRow[]
  sourceWorkspaceId: string
  targetWorkspaceId: string
  direction: 'push' | 'pull'
  userId: string
  now: Date
  requestId?: string
}): Promise<RehomeMappedResult> {
  const { tx, mappingRows, sourceWorkspaceId, targetWorkspaceId, direction, userId, now } = params
  const folderIdMap = new Map<string, string>()
  const rehomed: Record<RehomedFamily, number> = { file: 0, table: 0, knowledge_base: 0 }

  // A pull copies parent -> child, so the parent side is the source; a push reverses it.
  const sourceIsParent = direction === 'pull'

  for (const family of REHOMED_FAMILIES) {
    /**
     * Source resource key -> target resource key for this family. Files map by STORAGE KEY (that
     * is what `file-upload` subblocks reference and what the mapping rows store); tables and
     * knowledge bases map by row id.
     */
    const sourceToTarget = new Map<string, string>()
    for (const row of mappingRows) {
      if (row.resourceType !== family || !row.childResourceId) continue
      const source = sourceIsParent ? row.parentResourceId : row.childResourceId
      const target = sourceIsParent ? row.childResourceId : row.parentResourceId
      sourceToTarget.set(source, target)
    }
    if (sourceToTarget.size === 0) continue

    const moves =
      family === 'file'
        ? await planFileRehome(tx, sourceWorkspaceId, targetWorkspaceId, sourceToTarget)
        : await planContainerRehome(
            tx,
            family,
            sourceWorkspaceId,
            targetWorkspaceId,
            sourceToTarget
          )
    if (moves.length === 0) continue

    const familyFolderIdMap = await resolveForkFolderMapping({
      tx,
      sourceWorkspaceId,
      targetWorkspaceId,
      userId,
      now,
      resourceType: family,
      contentFolderIds: moves.map((move) => move.sourceFolderId),
    })
    for (const [source, target] of familyFolderIdMap) folderIdMap.set(source, target)

    // Group by destination so each folder costs one UPDATE regardless of how many rows land in it.
    const targetIdsByFolder = new Map<string, string[]>()
    for (const move of moves) {
      const targetFolderId = familyFolderIdMap.get(move.sourceFolderId)
      if (!targetFolderId) continue
      const bucket = targetIdsByFolder.get(targetFolderId)
      if (bucket) bucket.push(move.targetId)
      else targetIdsByFolder.set(targetFolderId, [move.targetId])
    }

    for (const [targetFolderId, targetIds] of targetIdsByFolder) {
      for (const page of chunkArray(targetIds, REHOME_PAGE)) {
        // The `folder_id IS NULL` guard is re-asserted on the write: the read above is only a
        // plan, and this keeps the move idempotent under a concurrent placement.
        const moved =
          family === 'file'
            ? await tx
                .update(workspaceFiles)
                .set({ folderId: targetFolderId })
                .where(and(inArray(workspaceFiles.id, page), isNull(workspaceFiles.folderId)))
                .returning({ id: workspaceFiles.id })
            : family === 'table'
              ? await tx
                  .update(userTableDefinitions)
                  .set({ folderId: targetFolderId, updatedAt: now })
                  .where(
                    and(
                      inArray(userTableDefinitions.id, page),
                      isNull(userTableDefinitions.folderId)
                    )
                  )
                  .returning({ id: userTableDefinitions.id })
              : await tx
                  .update(knowledgeBase)
                  .set({ folderId: targetFolderId, updatedAt: now })
                  .where(and(inArray(knowledgeBase.id, page), isNull(knowledgeBase.folderId)))
                  .returning({ id: knowledgeBase.id })
        rehomed[family] += moved.length
      }
    }
  }

  const total = rehomed.file + rehomed.table + rehomed.knowledge_base
  if (total > 0) {
    logger.info(`[${params.requestId ?? 'unknown'}] Re-homed root-flattened fork resources`, {
      targetWorkspaceId,
      direction,
      ...rehomed,
    })
  }

  return { folderIdMap, rehomed }
}

interface RehomeMove {
  targetId: string
  sourceFolderId: string
}

/**
 * Files map by storage key, so the source lookup keys on `workspace_files.key` while the target
 * update keys on `workspace_files.id`. Only durable `workspace`-context rows participate, matching
 * what the copy is willing to duplicate in the first place.
 */
async function planFileRehome(
  tx: DbOrTx,
  sourceWorkspaceId: string,
  targetWorkspaceId: string,
  sourceToTarget: Map<string, string>
): Promise<RehomeMove[]> {
  const targetIdByKey = new Map<string, string>()
  for (const page of chunkArray(Array.from(sourceToTarget.values()), REHOME_PAGE)) {
    const rows = await tx
      .select({ id: workspaceFiles.id, key: workspaceFiles.key })
      .from(workspaceFiles)
      .where(
        and(
          inArray(workspaceFiles.key, page),
          eq(workspaceFiles.workspaceId, targetWorkspaceId),
          eq(workspaceFiles.context, 'workspace'),
          isNull(workspaceFiles.folderId),
          isNull(workspaceFiles.deletedAt)
        )
      )
    for (const row of rows) targetIdByKey.set(row.key, row.id)
  }
  if (targetIdByKey.size === 0) return []

  // Only the sources whose target is actually still flattened need their folder read.
  const wantedSourceKeys = Array.from(sourceToTarget)
    .filter(([, targetKey]) => targetIdByKey.has(targetKey))
    .map(([sourceKey]) => sourceKey)
  if (wantedSourceKeys.length === 0) return []

  const moves: RehomeMove[] = []
  for (const page of chunkArray(wantedSourceKeys, REHOME_PAGE)) {
    const rows = await tx
      .select({ key: workspaceFiles.key, folderId: workspaceFiles.folderId })
      .from(workspaceFiles)
      .where(
        and(
          inArray(workspaceFiles.key, page),
          eq(workspaceFiles.workspaceId, sourceWorkspaceId),
          eq(workspaceFiles.context, 'workspace'),
          isNull(workspaceFiles.deletedAt)
        )
      )
    for (const source of rows) {
      if (!source.folderId) continue
      const targetKey = sourceToTarget.get(source.key)
      const targetId = targetKey ? targetIdByKey.get(targetKey) : undefined
      if (targetId) moves.push({ targetId, sourceFolderId: source.folderId })
    }
  }
  return moves
}

/** Tables and knowledge bases both map by row id and differ only in table + soft-delete column. */
async function planContainerRehome(
  tx: DbOrTx,
  family: 'table' | 'knowledge_base',
  sourceWorkspaceId: string,
  targetWorkspaceId: string,
  sourceToTarget: Map<string, string>
): Promise<RehomeMove[]> {
  const flattenedTargetIds = new Set<string>()
  for (const page of chunkArray(Array.from(sourceToTarget.values()), REHOME_PAGE)) {
    const rows =
      family === 'table'
        ? await tx
            .select({ id: userTableDefinitions.id })
            .from(userTableDefinitions)
            .where(
              and(
                inArray(userTableDefinitions.id, page),
                eq(userTableDefinitions.workspaceId, targetWorkspaceId),
                isNull(userTableDefinitions.folderId),
                isNull(userTableDefinitions.archivedAt)
              )
            )
        : await tx
            .select({ id: knowledgeBase.id })
            .from(knowledgeBase)
            .where(
              and(
                inArray(knowledgeBase.id, page),
                eq(knowledgeBase.workspaceId, targetWorkspaceId),
                isNull(knowledgeBase.folderId),
                isNull(knowledgeBase.deletedAt)
              )
            )
    for (const row of rows) flattenedTargetIds.add(row.id)
  }
  if (flattenedTargetIds.size === 0) return []

  const wantedSourceIds = Array.from(sourceToTarget)
    .filter(([, targetId]) => flattenedTargetIds.has(targetId))
    .map(([sourceId]) => sourceId)
  if (wantedSourceIds.length === 0) return []

  const moves: RehomeMove[] = []
  for (const page of chunkArray(wantedSourceIds, REHOME_PAGE)) {
    const rows =
      family === 'table'
        ? await tx
            .select({ id: userTableDefinitions.id, folderId: userTableDefinitions.folderId })
            .from(userTableDefinitions)
            .where(
              and(
                inArray(userTableDefinitions.id, page),
                eq(userTableDefinitions.workspaceId, sourceWorkspaceId),
                isNull(userTableDefinitions.archivedAt)
              )
            )
        : await tx
            .select({ id: knowledgeBase.id, folderId: knowledgeBase.folderId })
            .from(knowledgeBase)
            .where(
              and(
                inArray(knowledgeBase.id, page),
                eq(knowledgeBase.workspaceId, sourceWorkspaceId),
                isNull(knowledgeBase.deletedAt)
              )
            )
    for (const source of rows) {
      if (!source.folderId) continue
      const targetId = sourceToTarget.get(source.id)
      if (targetId && flattenedTargetIds.has(targetId)) {
        moves.push({ targetId, sourceFolderId: source.folderId })
      }
    }
  }
  return moves
}
