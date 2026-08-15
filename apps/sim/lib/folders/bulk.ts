import { createLogger } from '@sim/logger'
import type { FolderResourceType } from '@/lib/api/contracts/folders'
import { MAX_FOLDERS_PER_WORKSPACE } from '@/lib/folders/constants'
import { deleteFolder, updateFolder } from '@/lib/folders/orchestration'
import { listActiveFolderRows } from '@/lib/folders/queries'
import { collectDescendantFolderIdsFrom, indexFolderChildren } from '@/lib/folders/subtree'
import { notifyFolderResourceChanged } from '@/lib/realtime/notify'

const logger = createLogger('FolderBulk')

export interface BulkFolderAffected {
  id: string
  name: string
}

export interface BulkFolderFailure extends BulkFolderAffected {
  reason: string
}

export interface FolderSelectionPlan {
  /** Selected folders that resolve to an active folder of this resource type, request order preserved. */
  selected: BulkFolderAffected[]
  /** Selected ids with no active folder of this resource type in the workspace. */
  notFound: string[]
  /**
   * Selected folders that sit inside another selected folder. They travel with
   * their ancestor — moving or deleting them again would either rip a subfolder
   * out of the parent it is moving with, or archive it under a second
   * timestamp that the parent's restore could never bring back.
   */
  contained: BulkFolderAffected[]
  /**
   * Every folder id the selection covers, including descendants. A resource
   * filed in one of these is already handled by its folder and must not be
   * acted on a second time.
   */
  covered: Set<string>
}

/**
 * Resolves a bulk folder selection against the workspace's live folder tree
 * once, before anything is written.
 *
 * Reads the whole active tree in a single query rather than one lookup per
 * selected id: the containment questions ("is this folder inside another
 * selected one", "is this resource inside a selected folder") need the tree
 * anyway, and a workspace's folder count is already bounded.
 */
export async function planFolderSelection(
  workspaceId: string,
  resourceType: FolderResourceType,
  folderIds: readonly string[]
): Promise<FolderSelectionPlan> {
  if (folderIds.length === 0) {
    return { selected: [], notFound: [], contained: [], covered: new Set() }
  }

  const rows = await listActiveFolderRows(workspaceId, resourceType, {
    maxRows: MAX_FOLDERS_PER_WORKSPACE,
  })
  const rowsById = new Map(rows.map((row) => [row.id, row]))

  const selected: BulkFolderAffected[] = []
  const notFound: string[] = []
  const contained: BulkFolderAffected[] = []
  const covered = new Set<string>()

  const requested = new Set<string>()
  for (const folderId of folderIds) {
    if (!rowsById.has(folderId)) {
      notFound.push(folderId)
      continue
    }
    requested.add(folderId)
  }

  /**
   * One `childrenByParent` index for the whole plan. Building it per requested
   * folder would be O(rows) each time — up to `MAX_FOLDERS_PER_WORKSPACE` Map
   * writes per selected folder, all but the first thrown away.
   */
  const childrenByParent = indexFolderChildren(rows)
  const descendantsOf = new Map<string, string[]>()
  for (const folderId of requested) {
    descendantsOf.set(folderId, collectDescendantFolderIdsFrom(childrenByParent, folderId))
  }

  const insideAnotherSelection = new Set<string>()
  for (const [folderId, descendants] of descendantsOf) {
    for (const descendantId of descendants) {
      if (requested.has(descendantId)) insideAnotherSelection.add(descendantId)
    }
  }

  const reported = new Set<string>()
  for (const folderId of folderIds) {
    const row = rowsById.get(folderId)
    if (!row || reported.has(folderId)) continue
    reported.add(folderId)
    const entry = { id: row.id, name: row.name }
    /**
     * Containment is tested before `covered`, and that order matters: an explicitly requested
     * folder that sits inside another selected folder must always be reported. Testing
     * `covered` first made the outcome order-dependent — an ancestor processed earlier marked
     * the descendant covered, so the descendant fell out of every outcome category and the
     * same id set produced different results depending on the order it arrived in.
     */
    if (insideAnotherSelection.has(folderId)) {
      contained.push(entry)
      continue
    }
    if (covered.has(folderId)) continue
    selected.push(entry)
    covered.add(folderId)
    for (const descendantId of descendantsOf.get(folderId) ?? []) covered.add(descendantId)
  }

  /**
   * A contained folder's subtree is covered by its ancestor, but record it
   * anyway: the ancestor's descendant walk and this one are the same set, and
   * an explicit add keeps `covered` correct even if the tree contains a cycle
   * the walk had to cut short.
   */
  for (const folder of contained) {
    covered.add(folder.id)
    for (const descendantId of descendantsOf.get(folder.id) ?? []) covered.add(descendantId)
  }

  return { selected, notFound, contained, covered }
}

/**
 * The halves of a plan a caller's bulk outcome absorbs verbatim: ids nothing
 * resolved to, and folders a selected ancestor already carries.
 *
 * Declared as push sinks rather than concrete arrays so each domain can pass
 * its own outcome arrays, whose element unions (`'table' | 'folder'`,
 * `'knowledgeBase' | 'folder'`) are wider than the folder entries written into
 * them.
 */
export interface FolderPlanSink {
  notFound: { push(entry: { kind: 'folder'; id: string }): unknown }
  skipped: { push(entry: { kind: 'folder'; id: string; name: string }): unknown }
}

/** Projects a plan's unactionable halves into a bulk outcome. */
export function foldFolderPlan(plan: FolderSelectionPlan, outcome: FolderPlanSink): void {
  for (const id of plan.notFound) outcome.notFound.push({ kind: 'folder', id })
  for (const folder of plan.contained) outcome.skipped.push({ kind: 'folder', ...folder })
}

export interface BulkFolderOutcome {
  succeeded: BulkFolderAffected[]
  failed: BulkFolderFailure[]
}

export interface BulkFolderDeleteOutcome extends BulkFolderOutcome {
  /** Folders archived across every cascade, including the selected folders themselves. */
  folderCount: number
  /** Resources of `resourceType` archived by the cascades. */
  resourceCount: number
}

/**
 * Re-parents each selected folder under `targetParentId`.
 *
 * Best-effort per folder, matching the resource half of the same request.
 * `updateFolder` owns the invariants a caller must not be trusted with — a
 * folder cannot become its own parent, cannot move under one of its own
 * descendants, and cannot cross into another workspace — and reports them as
 * `validation` failures, which surface here as a per-folder reason.
 *
 * Per-folder realtime notification is suppressed and one batch notification is
 * sent instead: every per-item notify carries an identical body and triggers an
 * identical workspace-wide invalidation, so a 100-folder move would otherwise
 * cost 100 sequential internal round trips and make every connected client
 * refetch the same list 100 times for one gesture. The batch notify runs in a
 * `finally`, so a batch that ends early on an internal fault still tells the
 * clients about the folders it did move.
 */
export async function bulkMoveFolders(params: {
  workspaceId: string
  resourceType: FolderResourceType
  userId: string
  folders: readonly BulkFolderAffected[]
  targetParentId: string | null
}): Promise<BulkFolderOutcome> {
  const succeeded: BulkFolderAffected[] = []
  const failed: BulkFolderFailure[] = []

  try {
    for (const folder of params.folders) {
      const result = await updateFolder(
        {
          resourceType: params.resourceType,
          folderId: folder.id,
          workspaceId: params.workspaceId,
          userId: params.userId,
          parentId: params.targetParentId,
        },
        { notify: false }
      )
      if (result.success && result.folder) {
        succeeded.push({ id: result.folder.id, name: result.folder.name })
        continue
      }
      if (result.errorCode === 'internal') throw new Error(result.error ?? 'Failed to move folder')
      failed.push({ ...folder, reason: result.error ?? 'Failed to move folder' })
    }
  } finally {
    if (succeeded.length > 0) {
      await notifyFolderResourceChanged(params.resourceType, params.workspaceId)
    }
  }

  logger.info('Bulk moved folders', {
    workspaceId: params.workspaceId,
    resourceType: params.resourceType,
    succeeded: succeeded.length,
    failed: failed.length,
  })
  return { succeeded, failed }
}

/**
 * Archives each selected folder and everything under it.
 *
 * `projectAudit: false` — the calling application use case projects
 * `FOLDER_DELETED` from the authoritative result with full principal
 * attribution, which the orchestration's own `actorId: userId` entry cannot
 * express for a non-human principal.
 *
 * `notify: false` for the same reason as {@link bulkMoveFolders}: one batch
 * notification replaces a per-folder storm of identical invalidations, and it
 * fires from a `finally` so a batch cut short by an internal fault still
 * announces the folders it did archive.
 */
export async function bulkDeleteFolders(params: {
  workspaceId: string
  resourceType: FolderResourceType
  userId: string
  folders: readonly BulkFolderAffected[]
  countKey: 'tables' | 'knowledgeBases'
}): Promise<BulkFolderDeleteOutcome> {
  const succeeded: BulkFolderAffected[] = []
  const failed: BulkFolderFailure[] = []
  let folderCount = 0
  let resourceCount = 0

  try {
    for (const folder of params.folders) {
      const result = await deleteFolder(
        {
          resourceType: params.resourceType,
          folderId: folder.id,
          workspaceId: params.workspaceId,
          userId: params.userId,
          folderName: folder.name,
        },
        { projectAudit: false, notify: false }
      )
      if (result.success) {
        succeeded.push(folder)
        folderCount += result.deletedItems?.folders ?? 0
        resourceCount += result.deletedItems?.[params.countKey] ?? 0
        continue
      }
      if (result.errorCode === 'internal')
        throw new Error(result.error ?? 'Failed to delete folder')
      failed.push({ ...folder, reason: result.error ?? 'Failed to delete folder' })
    }
  } finally {
    if (succeeded.length > 0) {
      await notifyFolderResourceChanged(params.resourceType, params.workspaceId)
    }
  }

  logger.info('Bulk deleted folders', {
    workspaceId: params.workspaceId,
    resourceType: params.resourceType,
    succeeded: succeeded.length,
    failed: failed.length,
    folderCount,
    resourceCount,
  })
  return { succeeded, failed, folderCount, resourceCount }
}
