import { db } from '@sim/db'
import { permissions, workflow, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import type { PermissionType } from '@sim/platform-authz/workspace'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import type { Workspace } from '@/lib/api/contracts/workspaces'
import { buildDefaultWorkflowArtifacts } from '@/lib/workflows/defaults'
import { saveWorkflowToNormalizedTables } from '@/lib/workflows/persistence/utils'
import {
  finishBackgroundWork,
  startBackgroundWork,
} from '@/lib/workspaces/fork/background-work/store'
import {
  type ForkContentCopyPayload,
  hasForkContentToCopy,
  scheduleForkContentCopy,
  serializeContentRefMaps,
} from '@/lib/workspaces/fork/copy/content-copy-runner'
import { planForkFileCopies } from '@/lib/workspaces/fork/copy/copy-files'
import {
  copyForkResourceContainers,
  type ForkCopiedResourceNames,
} from '@/lib/workspaces/fork/copy/copy-resources'
import {
  copyWorkflowStateIntoTarget,
  loadWorkflowNameRegistry,
  resolveForkFolderMapping,
} from '@/lib/workspaces/fork/copy/copy-workflows'
import { loadSourceDeployedStates } from '@/lib/workspaces/fork/copy/deploy-bridge'
import { buildForkWorkflowIdMap } from '@/lib/workspaces/fork/copy/workflow-id-map'
import { setForkLockTimeout } from '@/lib/workspaces/fork/lineage/lineage'
import {
  type ForkBlockPair,
  reconcileForkBlockPairs,
  toForkBlockPairs,
} from '@/lib/workspaces/fork/mapping/block-map-store'
import {
  type ForkMappingUpsert,
  type ForkResourceType,
  seedEdgeMappings,
} from '@/lib/workspaces/fork/mapping/mapping-store'
import { createForkBootstrapTransform } from '@/lib/workspaces/fork/remap/fork-bootstrap'
import { collectReferencedDocumentIds } from '@/lib/workspaces/fork/remap/reference-scan'
import type { ForkRemapKind } from '@/lib/workspaces/fork/remap/remap-references'
import type { WorkspaceWithOwner } from '@/lib/workspaces/permissions/utils'
import type { WorkspaceCreationPolicy } from '@/lib/workspaces/policy'
import { WORKSPACE_MODE } from '@/lib/workspaces/policy'

const logger = createLogger('WorkspaceForkCreate')

/** Source resource ids the user selected to copy into the child, by kind. */
export interface ForkResourceSelection {
  files: string[]
  tables: string[]
  knowledgeBases: string[]
  customTools: string[]
  skills: string[]
  /** Workflow-publishing MCP servers (copied as config-only shells); external MCP is never copied. */
  workflowMcpServers: string[]
}

const EMPTY_SELECTION: ForkResourceSelection = {
  files: [],
  tables: [],
  knowledgeBases: [],
  customTools: [],
  skills: [],
  workflowMcpServers: [],
}

export interface CreateForkParams {
  source: WorkspaceWithOwner
  policy: WorkspaceCreationPolicy
  userId: string
  /** Display name of the user forking, recorded on the activity entry. */
  actorName?: string
  name?: string
  selection?: ForkResourceSelection
  requestId?: string
}

export interface CreateForkResult {
  /** Full child workspace row so callers can merge it into the workspace-list cache. */
  workspace: Workspace
  workflowsCopied: number
}

// External MCP servers are intentionally absent: a fork never copies them, so their
// references resolve to null here and are cleared on remap (re-add + re-auth in the child).
const FORK_KIND_TO_RESOURCE_TYPE: Partial<Record<ForkRemapKind, ForkResourceType>> = {
  'custom-tool': 'custom_tool',
  skill: 'skill',
  table: 'table',
  'knowledge-base': 'knowledge_base',
  'knowledge-document': 'knowledge_document',
}

/**
 * Create a fork of `source`: a new child workspace that copies the parent's
 * **deployed** workflows (left undeployed in the child), snapshots the parent's
 * member list, copies the user-selected resources (files, tables, knowledge bases,
 * custom tools, skills, MCP server configs) with fresh ids, and records the
 * source→child identity for each. Workflow references to copied resources are
 * rewritten to the child ids; references to resources that were not copied (and
 * all credential references) are cleared; env-var references are preserved.
 */
export async function createFork(params: CreateForkParams): Promise<CreateForkResult> {
  const { source, policy, userId, requestId = 'unknown' } = params
  const selection = params.selection ?? EMPTY_SELECTION
  const childName = params.name?.trim() || `${source.name} (fork)`

  // Read the source's deployed workflows + states BEFORE the transaction so these
  // global-pool reads don't check out a second pooled connection from inside the
  // fork tx (which can deadlock the pool at saturation).
  const { deployedWorkflows, sourceStates } = await loadSourceDeployedStates(source.id)

  // Documents the copied workflows reference (document-selector values + nested documentId
  // tool params). Those whose parent KB is being copied get a placeholder + id map inside the
  // fork tx so their references remap to the copied document instead of being cleared.
  const referencedDocumentIds = collectReferencedDocumentIds(
    deployedWorkflows.flatMap((wf) => {
      const sourceState = sourceStates.get(wf.id)
      return sourceState ? [sourceState] : []
    })
  )

  const forkedWorkflowNames: string[] = []
  let forkedResourceNames: ForkCopiedResourceNames = {
    tables: [],
    knowledgeBases: [],
    customTools: [],
    skills: [],
    workflowMcpServers: [],
  }
  const { result, blobTasks, contentPlan, contentRefMaps } = await db.transaction(async (tx) => {
    await setForkLockTimeout(tx)
    const now = new Date()
    const childWorkspaceId = generateId()

    await tx.insert(workspace).values({
      id: childWorkspaceId,
      name: childName,
      ownerId: userId,
      organizationId: policy.organizationId,
      workspaceMode: policy.workspaceMode,
      billedAccountUserId: policy.billedAccountUserId,
      allowPersonalApiKeys: true,
      forkedFromWorkspaceId: source.id,
      createdAt: now,
      updatedAt: now,
    })

    const sourcePermissions = await tx
      .select({ userId: permissions.userId, permissionType: permissions.permissionType })
      .from(permissions)
      .where(and(eq(permissions.entityType, 'workspace'), eq(permissions.entityId, source.id)))

    const permissionByUser = new Map<string, PermissionType>()
    for (const row of sourcePermissions) {
      permissionByUser.set(row.userId, row.permissionType)
    }
    permissionByUser.set(userId, 'admin')
    if (
      policy.workspaceMode === WORKSPACE_MODE.ORGANIZATION &&
      policy.billedAccountUserId &&
      policy.billedAccountUserId !== userId
    ) {
      permissionByUser.set(policy.billedAccountUserId, 'admin')
    }

    await tx.insert(permissions).values(
      Array.from(permissionByUser.entries()).map(([memberUserId, permissionType]) => ({
        id: generateId(),
        entityType: 'workspace' as const,
        entityId: childWorkspaceId,
        userId: memberUserId,
        permissionType,
        createdAt: now,
        updatedAt: now,
      }))
    )

    // The id map (and the identity seed below) covers only the workflows ACTUALLY copied -
    // those whose deployed state loaded. A deployed source whose state failed to load is
    // skipped by the copy loop, so it must be excluded here too: keeping it would (1) remap a
    // copied workflow's reference to a child id that is never created (a dangling ref) instead
    // of clearing it, and (2) seed a `workspace_fork_resource_map` workflow row pointing at
    // that never-created target, which a later push would treat as an orphan and archive the
    // parent's real workflow. Mirrors promote's writtenItems-only identity seed.
    const workflowIdMap = buildForkWorkflowIdMap(deployedWorkflows, new Set(sourceStates.keys()))

    const fileResult = await planForkFileCopies({
      tx,
      sourceWorkspaceId: source.id,
      childWorkspaceId,
      userId,
      fileIds: selection.files,
      now,
    })

    // Source -> child folder id map: remaps folder references in the copied workflows below and
    // feeds the post-commit content-ref rewrite (`sim:folder/<id>` mentions in skill/file bodies).
    const folderIdMap = await resolveForkFolderMapping({
      tx,
      sourceWorkspaceId: source.id,
      targetWorkspaceId: childWorkspaceId,
      userId,
      now,
    })

    const resourceResult = await copyForkResourceContainers({
      tx,
      sourceWorkspaceId: source.id,
      childWorkspaceId,
      userId,
      now,
      selection: {
        customTools: selection.customTools,
        skills: selection.skills,
        workflowMcpServers: selection.workflowMcpServers,
        tables: selection.tables,
        knowledgeBases: selection.knowledgeBases,
      },
      workflowIdMap,
      referencedDocumentIds: Array.from(referencedDocumentIds),
    })
    forkedResourceNames = resourceResult.names

    const resolveCopied = (kind: ForkRemapKind, sourceId: string): string | null => {
      if (kind === 'file') return fileResult.keyMap.get(sourceId) ?? null
      const resourceType = FORK_KIND_TO_RESOURCE_TYPE[kind]
      if (!resourceType) return null
      return resourceResult.idMap.get(resourceType)?.get(sourceId) ?? null
    }
    const transform = createForkBootstrapTransform(resolveCopied)

    // The child is brand new, so this loads an empty registry; name collisions can only
    // arise among the copied workflows themselves, which the in-loop claims resolve.
    const nameRegistry = await loadWorkflowNameRegistry(tx, childWorkspaceId)

    let workflowsCopied = 0
    // Seed the block-identity map (parent block -> derived child block) so a later push of
    // this fork resolves each child block back to the parent's ORIGINAL id instead of
    // re-deriving and re-keying the parent's webhook URLs.
    const blockPairs: ForkBlockPair[] = []
    const sourceWorkflowIds: string[] = []
    for (const wf of deployedWorkflows) {
      const sourceState = sourceStates.get(wf.id)
      if (!sourceState) continue
      const targetWorkflowId = workflowIdMap.get(wf.id)!
      const copyResult = await copyWorkflowStateIntoTarget({
        tx,
        targetWorkflowId,
        targetWorkspaceId: childWorkspaceId,
        userId,
        mode: 'create',
        now,
        sourceState,
        sourceMeta: {
          name: wf.name,
          description: wf.description,
          folderId: wf.folderId,
          sortOrder: wf.sortOrder,
        },
        workflowIdMap,
        folderIdMap,
        transformSubBlocks: transform,
        nameRegistry,
        requestId,
      })
      // Creation copies parent -> child, so the source side is the parent.
      blockPairs.push(...toForkBlockPairs(copyResult.blockIdMapping, true, wf.id, targetWorkflowId))
      sourceWorkflowIds.push(wf.id)
      workflowsCopied += 1
      forkedWorkflowNames.push(wf.name)
    }
    await reconcileForkBlockPairs(tx, childWorkspaceId, true, sourceWorkflowIds, blockPairs)

    // A fork carries only DEPLOYED workflows. When the source has none (e.g. it was
    // itself just forked and never redeployed), seed a default workflow so the child
    // is a usable workspace rather than a blank one with no workflow at all - the same
    // starter "New workspace" creates. Any copied resources still land alongside it.
    if (workflowsCopied === 0) {
      const defaultWorkflowId = generateId()
      await tx.insert(workflow).values({
        id: defaultWorkflowId,
        userId,
        workspaceId: childWorkspaceId,
        folderId: null,
        name: 'default-agent',
        description: 'Your first workflow - start building here!',
        lastSynced: now,
        createdAt: now,
        updatedAt: now,
        isDeployed: false,
        runCount: 0,
        variables: {},
      })
      const { workflowState } = buildDefaultWorkflowArtifacts()
      await saveWorkflowToNormalizedTables(defaultWorkflowId, workflowState, tx)
    }

    const seedEntries: ForkMappingUpsert[] = []
    for (const [sourceWorkflowId, childWorkflowId] of workflowIdMap.entries()) {
      seedEntries.push({
        resourceType: 'workflow',
        parentResourceId: sourceWorkflowId,
        childResourceId: childWorkflowId,
      })
    }
    seedEntries.push(...resourceResult.mappingEntries)
    await seedEdgeMappings(tx, childWorkspaceId, userId, seedEntries)

    logger.info(`[${requestId}] Created fork ${childWorkspaceId} from ${source.id}`, {
      workflowsCopied,
      mappingsSeeded: seedEntries.length,
    })

    // Serialized in-content reference maps so the post-commit content copy can rewrite
    // `sim:` links + embedded URLs inside copied skill bodies and markdown file blobs. Maps
    // become Records to cross the background-job payload boundary.
    const contentRefMaps = serializeContentRefMaps({
      workspaceId: { from: source.id, to: childWorkspaceId },
      fileKeys: fileResult.keyMap,
      fileIds: fileResult.idMap,
      workflows: workflowIdMap,
      folders: folderIdMap,
      knowledgeBases: resourceResult.idMap.get('knowledge_base'),
      tables: resourceResult.idMap.get('table'),
      skills: resourceResult.idMap.get('skill'),
    })

    return {
      result: {
        workspace: {
          id: childWorkspaceId,
          name: childName,
          ownerId: userId,
          organizationId: policy.organizationId,
          workspaceMode: policy.workspaceMode,
          billedAccountUserId: policy.billedAccountUserId,
          allowPersonalApiKeys: true,
          forkedFromWorkspaceId: source.id,
        },
        workflowsCopied,
      },
      blobTasks: fileResult.blobTasks,
      contentPlan: resourceResult.contentPlan,
      contentRefMaps,
    }
  })

  // Bulk content (table rows, KB documents + embeddings) and file blobs are copied
  // AFTER the fork commits, in the background, so the fork request returns as soon
  // as the workflows exist and is never blocked on (or timed out by) heavy I/O.
  // Trigger.dev runs it out-of-process (surviving deploys); without it, runDetached
  // runs it inline best-effort. Both are batched/bounded internally.
  const hasContent = hasForkContentToCopy(contentPlan, blobTasks)

  // Record a durable job for EVERY fork (the fork already committed), scoped to the
  // SOURCE workspace - that's where the fork was initiated and where its Activity tab
  // lives, so the record survives a reload of the fork modal. When there is heavy
  // content to copy in the background the row stays `processing` until the runner
  // finishes it (merging in copied/failed); otherwise the fork is already complete.
  const forkedName = result.workspace.name
  // The fork already committed; failing to record the tracking row must not turn it into
  // a 500. Log and continue without a status row - the background content copy below still
  // runs (its runner no-ops the status update when statusId is absent).
  let statusId: string | undefined
  try {
    statusId = await startBackgroundWork(db, {
      workspaceId: source.id,
      kind: 'fork_content_copy',
      // Append-only: each fork is a distinct entry in the source workspace's fork history.
      supersede: false,
      message: hasContent ? `Copying resources to "${forkedName}"` : `Forked into "${forkedName}"`,
      metadata: {
        childWorkspaceId: result.workspace.id,
        childWorkspaceName: forkedName,
        actorName: params.actorName,
        workflowsCopied: result.workflowsCopied,
        tables: contentPlan.tables.length,
        knowledgeBases: contentPlan.knowledgeBases.length,
        files: blobTasks.length,
        workflowNames: forkedWorkflowNames,
        tableNames: forkedResourceNames.tables,
        knowledgeBaseNames: forkedResourceNames.knowledgeBases,
        fileNames: blobTasks.map((task) => task.fileName),
        customToolNames: forkedResourceNames.customTools,
        skillNames: forkedResourceNames.skills,
        workflowMcpServerNames: forkedResourceNames.workflowMcpServers,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Failed to record fork background-work status`, {
      childWorkspaceId: result.workspace.id,
      error: getErrorMessage(error),
    })
  }

  if (!hasContent) {
    if (statusId) {
      await finishBackgroundWork(db, statusId, {
        status: 'completed',
        message: `Forked into "${forkedName}"`,
        metadata: { copied: 0, failed: 0 },
      }).catch(() => {})
    }
    return result
  }

  const payload: ForkContentCopyPayload = {
    contentPlan,
    blobTasks,
    contentRefMaps,
    statusId,
    requestId,
  }
  await scheduleForkContentCopy(payload, { detachedLabel: 'fork-content-copy', requestId })

  return result
}
