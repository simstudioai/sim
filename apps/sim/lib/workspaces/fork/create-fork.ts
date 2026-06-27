import { db } from '@sim/db'
import { permissions, workflow, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import type { PermissionType } from '@sim/platform-authz/workspace'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import type { Workspace } from '@/lib/api/contracts/workspaces'
import { isTriggerDevEnabled } from '@/lib/core/config/env-flags'
import { runDetached } from '@/lib/core/utils/background'
import { buildDefaultWorkflowArtifacts } from '@/lib/workflows/defaults'
import { saveWorkflowToNormalizedTables } from '@/lib/workflows/persistence/utils'
import {
  finishBackgroundWork,
  startBackgroundWork,
} from '@/lib/workspaces/fork/background-work/store'
import {
  type ForkContentCopyPayload,
  runForkContentCopy,
} from '@/lib/workspaces/fork/copy/content-copy-runner'
import { planForkFileCopies } from '@/lib/workspaces/fork/copy/copy-files'
import {
  copyForkResourceContainers,
  type ForkCopiedResourceNames,
} from '@/lib/workspaces/fork/copy/copy-resources'
import {
  copyWorkflowStateIntoTarget,
  resolveForkFolderMapping,
} from '@/lib/workspaces/fork/copy/copy-workflows'
import { loadSourceDeployedStates } from '@/lib/workspaces/fork/copy/deploy-bridge'
import {
  type ForkMappingUpsert,
  type ForkResourceType,
  seedEdgeMappings,
} from '@/lib/workspaces/fork/mapping/mapping-store'
import { createForkBootstrapTransform } from '@/lib/workspaces/fork/remap/fork-bootstrap'
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
  mcpServers: string[]
}

const EMPTY_SELECTION: ForkResourceSelection = {
  files: [],
  tables: [],
  knowledgeBases: [],
  customTools: [],
  skills: [],
  mcpServers: [],
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

const FORK_KIND_TO_RESOURCE_TYPE: Partial<Record<ForkRemapKind, ForkResourceType>> = {
  'custom-tool': 'custom_tool',
  skill: 'skill',
  'mcp-server': 'mcp_server',
  table: 'table',
  'knowledge-base': 'knowledge_base',
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

  const forkedWorkflowNames: string[] = []
  let forkedResourceNames: ForkCopiedResourceNames = {
    tables: [],
    knowledgeBases: [],
    customTools: [],
    skills: [],
    mcpServers: [],
  }
  const { result, blobTasks, contentPlan } = await db.transaction(async (tx) => {
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

    const workflowIdMap = new Map<string, string>()
    for (const wf of deployedWorkflows) workflowIdMap.set(wf.id, generateId())

    const fileResult = await planForkFileCopies({
      tx,
      sourceWorkspaceId: source.id,
      childWorkspaceId,
      userId,
      fileIds: selection.files,
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
        mcpServers: selection.mcpServers,
        tables: selection.tables,
        knowledgeBases: selection.knowledgeBases,
      },
      workflowIdMap,
    })
    forkedResourceNames = resourceResult.names

    const resolveCopied = (kind: ForkRemapKind, sourceId: string): string | null => {
      if (kind === 'file') return fileResult.keyMap.get(sourceId) ?? null
      const resourceType = FORK_KIND_TO_RESOURCE_TYPE[kind]
      if (!resourceType) return null
      return resourceResult.idMap.get(resourceType)?.get(sourceId) ?? null
    }
    const transform = createForkBootstrapTransform(resolveCopied)

    const folderIdMap = await resolveForkFolderMapping({
      tx,
      sourceWorkspaceId: source.id,
      targetWorkspaceId: childWorkspaceId,
      userId,
      now,
    })

    let workflowsCopied = 0
    for (const wf of deployedWorkflows) {
      const sourceState = sourceStates.get(wf.id)
      if (!sourceState) continue
      await copyWorkflowStateIntoTarget({
        tx,
        targetWorkflowId: workflowIdMap.get(wf.id)!,
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
        requestId,
      })
      workflowsCopied += 1
      forkedWorkflowNames.push(wf.name)
    }

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
    }
  })

  // Bulk content (table rows, KB documents + embeddings) and file blobs are copied
  // AFTER the fork commits, in the background, so the fork request returns as soon
  // as the workflows exist and is never blocked on (or timed out by) heavy I/O.
  // Trigger.dev runs it out-of-process (surviving deploys); without it, runDetached
  // runs it inline best-effort. Both are batched/bounded internally.
  const hasContent =
    contentPlan.tables.length > 0 || contentPlan.knowledgeBases.length > 0 || blobTasks.length > 0

  // Record a durable job for EVERY fork (the fork already committed), scoped to the
  // SOURCE workspace - that's where the fork was initiated and where its Activity tab
  // lives, so the record survives a reload of the fork modal. When there is heavy
  // content to copy in the background the row stays `processing` until the runner
  // finishes it (merging in copied/failed); otherwise the fork is already complete.
  const forkedName = result.workspace.name
  const statusId = await startBackgroundWork(db, {
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
      mcpServerNames: forkedResourceNames.mcpServers,
    },
  })

  if (!hasContent) {
    await finishBackgroundWork(db, statusId, {
      status: 'completed',
      message: `Forked into "${forkedName}"`,
      metadata: { copied: 0, failed: 0 },
    }).catch(() => {})
    return result
  }

  const payload: ForkContentCopyPayload = { contentPlan, blobTasks, statusId, requestId }
  try {
    if (isTriggerDevEnabled) {
      const [{ forkContentCopyTask }, { tasks }, { resolveTriggerRegion }] = await Promise.all([
        import('@/background/fork-content-copy'),
        import('@trigger.dev/sdk'),
        import('@/lib/core/async-jobs/region'),
      ])
      await tasks.trigger<typeof forkContentCopyTask>('fork-content-copy', payload, {
        region: await resolveTriggerRegion(),
      })
    } else {
      runDetached('fork-content-copy', () => runForkContentCopy(payload))
    }
  } catch (error) {
    // The fork itself succeeded; only scheduling the background copy failed. Surface
    // it on the status row instead of failing the (committed) fork response.
    logger.error(`[${requestId}] Failed to schedule fork content copy`, {
      childWorkspaceId: result.workspace.id,
      error: getErrorMessage(error),
    })
    await finishBackgroundWork(db, statusId, {
      status: 'failed',
      error: getErrorMessage(error, 'Could not start the background copy'),
    }).catch(() => {})
  }

  return result
}
