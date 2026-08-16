import { knowledgeBase, userTableDefinitions, workspaceFiles } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import { resolveForkFolderMapping } from '@/ee/workspace-forking/lib/copy/copy-workflows'
import type { ForkEdge } from '@/ee/workspace-forking/lib/lineage/lineage'
import { getEdgeMappingRows } from '@/ee/workspace-forking/lib/mapping/mapping-store'

const logger = createLogger('WorkspaceForkRehomeMapped')

/**
 * The families whose copies predate folder-structure transit. Workflows are absent on purpose:
 * their folder placement has always been remapped, and a workflow sync rewrites `folder_id` on
 * every replace, so they are already self-healing.
 */
const REHOMED_FAMILIES = ['file', 'table', 'knowledge_base'] as const

export interface RehomeMappedResult {
  /** source folder id -> target folder id for any subtree mirrored while re-homing. */
  folderIdMap: Map<string, string>
  /** Rows re-homed per family, for the promote log line. */
  rehomed: Record<(typeof REHOMED_FAMILIES)[number], number>
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
 * Runs inside the promote transaction, after the folder mapping for workflows, so a refusal from
 * the folder-ceiling check rolls the whole sync back rather than leaving a half-moved tree.
 */
export async function rehomeFlattenedForkResources(params: {
  tx: DbOrTx
  edge: ForkEdge
  sourceWorkspaceId: string
  targetWorkspaceId: string
  direction: 'push' | 'pull'
  userId: string
  now: Date
  requestId?: string
}): Promise<RehomeMappedResult> {
  const { tx, edge, sourceWorkspaceId, targetWorkspaceId, direction, userId, now } = params
  const folderIdMap = new Map<string, string>()
  const rehomed = { file: 0, table: 0, knowledge_base: 0 }

  const mappingRows = await getEdgeMappingRows(tx, edge.childWorkspaceId)
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

    // Group by destination so each folder is one UPDATE regardless of how many rows land in it.
    const targetIdsByFolder = new Map<string, string[]>()
    for (const move of moves) {
      const targetFolderId = familyFolderIdMap.get(move.sourceFolderId)
      if (!targetFolderId) continue
      const bucket = targetIdsByFolder.get(targetFolderId)
      if (bucket) bucket.push(move.targetId)
      else targetIdsByFolder.set(targetFolderId, [move.targetId])
    }

    for (const [targetFolderId, targetIds] of targetIdsByFolder) {
      if (family === 'file') {
        await tx
          .update(workspaceFiles)
          .set({ folderId: targetFolderId })
          .where(and(inArray(workspaceFiles.id, targetIds), isNull(workspaceFiles.folderId)))
      } else if (family === 'table') {
        await tx
          .update(userTableDefinitions)
          .set({ folderId: targetFolderId, updatedAt: now })
          .where(
            and(inArray(userTableDefinitions.id, targetIds), isNull(userTableDefinitions.folderId))
          )
      } else {
        await tx
          .update(knowledgeBase)
          .set({ folderId: targetFolderId, updatedAt: now })
          .where(and(inArray(knowledgeBase.id, targetIds), isNull(knowledgeBase.folderId)))
      }
      rehomed[family] += targetIds.length
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
  const targetRows = await tx
    .select({ id: workspaceFiles.id, key: workspaceFiles.key })
    .from(workspaceFiles)
    .where(
      and(
        inArray(workspaceFiles.key, Array.from(sourceToTarget.values())),
        eq(workspaceFiles.workspaceId, targetWorkspaceId),
        eq(workspaceFiles.context, 'workspace'),
        isNull(workspaceFiles.folderId),
        isNull(workspaceFiles.deletedAt)
      )
    )
  if (targetRows.length === 0) return []
  const targetIdByKey = new Map(targetRows.map((row) => [row.key, row.id]))

  // Only the sources whose target is actually still flattened need their folder read.
  const wantedSourceKeys = Array.from(sourceToTarget)
    .filter(([, targetKey]) => targetIdByKey.has(targetKey))
    .map(([sourceKey]) => sourceKey)
  if (wantedSourceKeys.length === 0) return []

  const sourceRows = await tx
    .select({ key: workspaceFiles.key, folderId: workspaceFiles.folderId })
    .from(workspaceFiles)
    .where(
      and(
        inArray(workspaceFiles.key, wantedSourceKeys),
        eq(workspaceFiles.workspaceId, sourceWorkspaceId),
        eq(workspaceFiles.context, 'workspace'),
        isNull(workspaceFiles.deletedAt)
      )
    )

  const moves: RehomeMove[] = []
  for (const source of sourceRows) {
    if (!source.folderId) continue
    const targetKey = sourceToTarget.get(source.key)
    const targetId = targetKey ? targetIdByKey.get(targetKey) : undefined
    if (targetId) moves.push({ targetId, sourceFolderId: source.folderId })
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
  const targetIds = Array.from(sourceToTarget.values())
  const sourceIds = Array.from(sourceToTarget.keys())

  const [targetRows, sourceRows] =
    family === 'table'
      ? await Promise.all([
          tx
            .select({ id: userTableDefinitions.id })
            .from(userTableDefinitions)
            .where(
              and(
                inArray(userTableDefinitions.id, targetIds),
                eq(userTableDefinitions.workspaceId, targetWorkspaceId),
                isNull(userTableDefinitions.folderId),
                isNull(userTableDefinitions.archivedAt)
              )
            ),
          tx
            .select({ id: userTableDefinitions.id, folderId: userTableDefinitions.folderId })
            .from(userTableDefinitions)
            .where(
              and(
                inArray(userTableDefinitions.id, sourceIds),
                eq(userTableDefinitions.workspaceId, sourceWorkspaceId),
                isNull(userTableDefinitions.archivedAt)
              )
            ),
        ])
      : await Promise.all([
          tx
            .select({ id: knowledgeBase.id })
            .from(knowledgeBase)
            .where(
              and(
                inArray(knowledgeBase.id, targetIds),
                eq(knowledgeBase.workspaceId, targetWorkspaceId),
                isNull(knowledgeBase.folderId),
                isNull(knowledgeBase.deletedAt)
              )
            ),
          tx
            .select({ id: knowledgeBase.id, folderId: knowledgeBase.folderId })
            .from(knowledgeBase)
            .where(
              and(
                inArray(knowledgeBase.id, sourceIds),
                eq(knowledgeBase.workspaceId, sourceWorkspaceId),
                isNull(knowledgeBase.deletedAt)
              )
            ),
        ])

  const flattenedTargetIds = new Set(targetRows.map((row) => row.id))
  if (flattenedTargetIds.size === 0) return []

  const moves: RehomeMove[] = []
  for (const source of sourceRows) {
    if (!source.folderId) continue
    const targetId = sourceToTarget.get(source.id)
    if (targetId && flattenedTargetIds.has(targetId)) {
      moves.push({ targetId, sourceFolderId: source.folderId })
    }
  }
  return moves
}
