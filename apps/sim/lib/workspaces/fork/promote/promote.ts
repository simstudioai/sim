import { db } from '@sim/db'
import { credential, credentialMember, workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray } from 'drizzle-orm'
import { performFullDeploy } from '@/lib/workflows/orchestration/deploy'
import { undeployWorkflow } from '@/lib/workflows/persistence/utils'
import {
  copyWorkflowStateIntoTarget,
  resolveForkFolderMapping,
} from '@/lib/workspaces/fork/copy/copy-workflows'
import {
  getActiveDeploymentVersionNumber,
  loadSourceDeployedStates,
} from '@/lib/workspaces/fork/copy/deploy-bridge'
import {
  acquireForkEdgeLock,
  acquireForkTargetLock,
  type ForkEdge,
} from '@/lib/workspaces/fork/lineage/lineage'
import {
  deleteWorkflowIdentityByIds,
  type ForkMappingUpsert,
  upsertEdgeMappings,
} from '@/lib/workspaces/fork/mapping/mapping-store'
import {
  computeForkPromotePlan,
  type ForkPromotePlan,
} from '@/lib/workspaces/fork/promote/promote-plan'
import {
  type PromoteRunWorkflowSnapshot,
  upsertPromoteRun,
} from '@/lib/workspaces/fork/promote/promote-run-store'
import {
  createForkSubBlockTransform,
  type ForkReference,
} from '@/lib/workspaces/fork/remap/remap-references'
import { notifyForkWorkflowChanged } from '@/lib/workspaces/fork/socket'
import { getUsersWithPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('WorkspaceForkPromote')

export interface PromoteForkParams {
  edge: ForkEdge
  sourceWorkspaceId: string
  targetWorkspaceId: string
  direction: 'push' | 'pull'
  force: boolean
  userId: string
  requestId?: string
}

export interface PromoteForkResult {
  promoteRunId: string
  updated: number
  created: number
  archived: number
  redeployed: number
  /**
   * Targets whose state was written but whose post-transaction deploy failed. The
   * draft holds the synced state; the active deployment still runs the prior version
   * until a redeploy. Surfaced (rather than swallowed) so the caller can warn.
   */
  deployFailed: number
  unmappedRequired: Array<Pick<ForkReference, 'kind' | 'sourceId' | 'required' | 'blockName'>>
  drift: boolean
  blocked: 'unmapped' | 'drift' | null
  /** Names of the workflows the sync changed, by action, for the activity report. */
  updatedNames: string[]
  createdNames: string[]
  archivedNames: string[]
}

function collectCredentialPairs(plan: ForkPromotePlan): Array<[string, string]> {
  const pairs = new Map<string, string>()
  for (const reference of plan.references) {
    if (reference.kind !== 'credential') continue
    const target = plan.resolver('credential', reference.sourceId)
    if (target) pairs.set(reference.sourceId, target)
  }
  return Array.from(pairs.entries())
}

interface PromoteTxBlocked {
  blocked: 'unmapped' | 'drift'
  unmappedRequired: PromoteForkResult['unmappedRequired']
  drift: boolean
}

interface PromoteTxApplied {
  blocked: null
  promoteRunId: string
  deployTargetIds: string[]
  /** Actual written/archived counts (post-skip), not the pre-copy plan totals. */
  updated: number
  created: number
  archived: number
  drift: boolean
  /** Source workflows skipped because their deployment vanished between plan and apply. */
  skippedItems: Array<{ id: string; name: string }>
  /** Target workflow id -> source name, so the deploy-failure report can show names. */
  writtenNames: Record<string, string>
}

/**
 * Execute a force promote along the edge. Only the source's deployed workflows
 * participate: each one's active deployed state is remapped into the target
 * (replacing mapped targets in place with deterministic block ids, creating new
 * ones, archiving previously-mapped orphans whose source is no longer deployed),
 * a version-reference rollback snapshot is captured, credential access is
 * propagated, and every promoted target is deployed. The plan is computed inside
 * the edge lock so concurrent promotes serialize. Blocks (without mutating) when
 * required references are unmapped, or the target has drifted and `force` is not
 * set.
 */
export async function promoteFork(params: PromoteForkParams): Promise<PromoteForkResult> {
  const { edge, sourceWorkspaceId, targetWorkspaceId, direction, force, userId } = params
  const requestId = params.requestId ?? 'unknown'

  const targetMembers = (await getUsersWithPermissions(targetWorkspaceId)).map((m) => m.userId)

  // Read the source's deployed workflows + states BEFORE the transaction so these
  // heavy per-workflow reads never check out a second pooled connection from inside
  // the promote tx (which can deadlock the pool at saturation). The source is
  // read-only here, so this pre-tx snapshot is exactly what gets force-pushed.
  const { deployedWorkflows, sourceStates } = await loadSourceDeployedStates(sourceWorkspaceId)

  const txResult: PromoteTxBlocked | PromoteTxApplied = await db.transaction(async (tx) => {
    // Target lock before edge lock (consistent ordering): the target lock serializes
    // every sync into this target so sibling forks can't interleave writes, and so
    // rollback's "newest sync" check stays race-free against a concurrent promote.
    await acquireForkTargetLock(tx, targetWorkspaceId)
    await acquireForkEdgeLock(tx, edge.childWorkspaceId)

    const plan = await computeForkPromotePlan({
      executor: tx,
      edge,
      sourceWorkspaceId,
      targetWorkspaceId,
      direction,
      deployedSourceWorkflows: deployedWorkflows,
      sourceStates,
    })

    if (plan.unmappedRequired.length > 0) {
      return {
        blocked: 'unmapped',
        unmappedRequired: plan.unmappedRequired.map((reference) => ({
          kind: reference.kind,
          sourceId: reference.sourceId,
          required: reference.required,
          blockName: reference.blockName,
        })),
        drift: plan.drift,
      }
    }

    if (plan.drift && !force) {
      return { blocked: 'drift', unmappedRequired: [], drift: true }
    }

    const now = new Date()
    const transform = createForkSubBlockTransform(plan.resolver)
    const folderIdMap = await resolveForkFolderMapping({
      tx,
      sourceWorkspaceId,
      targetWorkspaceId,
      userId,
      now,
    })

    const updatedSnapshots: PromoteRunWorkflowSnapshot[] = []
    const createdTargetIds: string[] = []
    const writtenItems: typeof plan.items = []
    for (const item of plan.items) {
      // Use the pre-read source state (loaded above, before the tx). An item only
      // exists when its state was present at read time, so this lookup hits; the
      // guard stays as defense so the written counts below never over-report.
      const sourceState = sourceStates.get(item.sourceWorkflowId)
      if (!sourceState) continue
      if (item.mode === 'replace') {
        const priorVersion = await getActiveDeploymentVersionNumber(tx, item.targetWorkflowId)
        updatedSnapshots.push({ workflowId: item.targetWorkflowId, priorVersion })
      } else {
        createdTargetIds.push(item.targetWorkflowId)
      }
      await copyWorkflowStateIntoTarget({
        tx,
        targetWorkflowId: item.targetWorkflowId,
        targetWorkspaceId,
        userId,
        mode: item.mode,
        now,
        sourceState,
        sourceMeta: item.sourceMeta,
        workflowIdMap: plan.workflowIdMap,
        folderIdMap,
        transformSubBlocks: transform,
        requestId,
      })
      writtenItems.push(item)
    }

    const archivedNames =
      plan.archivedTargetIds.length > 0
        ? (
            await tx
              .select({ name: workflow.name })
              .from(workflow)
              .where(inArray(workflow.id, plan.archivedTargetIds))
          ).map((row) => row.name)
        : []

    const archivedSnapshots: PromoteRunWorkflowSnapshot[] = []
    for (const targetWorkflowId of plan.archivedTargetIds) {
      const priorVersion = await getActiveDeploymentVersionNumber(tx, targetWorkflowId)
      archivedSnapshots.push({ workflowId: targetWorkflowId, priorVersion })
      await undeployWorkflow({ workflowId: targetWorkflowId, tx })
      await tx
        .update(workflow)
        .set({ archivedAt: now, updatedAt: now })
        .where(eq(workflow.id, targetWorkflowId))
    }

    const identityEntries: ForkMappingUpsert[] = writtenItems.map((item) => ({
      resourceType: 'workflow' as const,
      parentResourceId: direction === 'pull' ? item.sourceWorkflowId : item.targetWorkflowId,
      childResourceId: direction === 'pull' ? item.targetWorkflowId : item.sourceWorkflowId,
    }))
    // The identity upsert keys on the parent side, which on push is the TARGET. A
    // source whose previously-mapped target was archived gets a freshly-generated
    // target id here, so its old (stale-target) identity row wouldn't be overwritten
    // and would leak a second mapping for the same source. Delete every prior identity
    // row for these sources (by the source side) first so exactly one row per source
    // remains - this also converges any pre-existing duplicates.
    await deleteWorkflowIdentityByIds(
      tx,
      edge.childWorkspaceId,
      direction === 'pull' ? 'parent' : 'child',
      writtenItems.map((item) => item.sourceWorkflowId)
    )
    await upsertEdgeMappings(tx, edge.childWorkspaceId, userId, identityEntries)

    const credentialPairs = collectCredentialPairs(plan)
    const propagationTargetIds = credentialPairs.map(([, targetCredId]) => targetCredId)
    const propagationSourceIds = credentialPairs.map(([sourceCredId]) => sourceCredId)
    const validTargetCredentialIds = new Set<string>()
    if (propagationTargetIds.length > 0) {
      const validRows = await tx
        .select({ id: credential.id })
        .from(credential)
        .where(
          and(
            inArray(credential.id, propagationTargetIds),
            eq(credential.workspaceId, targetWorkspaceId)
          )
        )
      for (const row of validRows) validTargetCredentialIds.add(row.id)
    }

    const validSourceCredentialIds = new Set<string>()
    if (propagationSourceIds.length > 0) {
      const validRows = await tx
        .select({ id: credential.id })
        .from(credential)
        .where(
          and(
            inArray(credential.id, propagationSourceIds),
            eq(credential.workspaceId, sourceWorkspaceId)
          )
        )
      for (const row of validRows) validSourceCredentialIds.add(row.id)
    }

    const validPairs = credentialPairs.filter(
      ([sourceCredId, targetCredId]) =>
        validSourceCredentialIds.has(sourceCredId) && validTargetCredentialIds.has(targetCredId)
    )
    if (validPairs.length > 0) {
      // Batch all source credentials' active members in one query (instead of one
      // per pair), then build a single insert. `targetMembers` becomes a Set for
      // O(1) membership checks.
      const targetMemberSet = new Set(targetMembers)
      const memberRows = await tx
        .select({
          credentialId: credentialMember.credentialId,
          userId: credentialMember.userId,
          role: credentialMember.role,
        })
        .from(credentialMember)
        .where(
          and(
            inArray(
              credentialMember.credentialId,
              validPairs.map(([sourceCredId]) => sourceCredId)
            ),
            eq(credentialMember.status, 'active')
          )
        )
      const membersBySource = new Map<
        string,
        Array<Pick<(typeof memberRows)[number], 'userId' | 'role'>>
      >()
      for (const row of memberRows) {
        if (!targetMemberSet.has(row.userId)) continue
        const list = membersBySource.get(row.credentialId)
        if (list) list.push({ userId: row.userId, role: row.role })
        else membersBySource.set(row.credentialId, [{ userId: row.userId, role: row.role }])
      }
      const memberInserts = validPairs.flatMap(([sourceCredId, targetCredId]) =>
        (membersBySource.get(sourceCredId) ?? []).map((member) => ({
          id: generateId(),
          credentialId: targetCredId,
          userId: member.userId,
          role: member.role,
          status: 'active' as const,
          joinedAt: now,
          createdAt: now,
          updatedAt: now,
        }))
      )
      if (memberInserts.length > 0) {
        await tx
          .insert(credentialMember)
          .values(memberInserts)
          .onConflictDoNothing({
            target: [credentialMember.credentialId, credentialMember.userId],
          })
      }
    }

    const promoteRunId = await upsertPromoteRun(tx, {
      childWorkspaceId: edge.childWorkspaceId,
      sourceWorkspaceId,
      targetWorkspaceId,
      direction,
      userId,
      snapshot: {
        updated: updatedSnapshots,
        created: createdTargetIds,
        archived: archivedSnapshots,
      },
    })

    // A source whose active deployment vanished between plan and copy is skipped
    // above, so report what was actually written - the plan totals would overstate.
    const writtenSourceIds = new Set(writtenItems.map((item) => item.sourceWorkflowId))
    const skippedItems = plan.items
      .filter((item) => !writtenSourceIds.has(item.sourceWorkflowId))
      .map((item) => ({ id: item.sourceWorkflowId, name: item.sourceMeta.name }))
    if (skippedItems.length > 0) {
      logger.warn(
        `[${requestId}] Promote skipped ${skippedItems.length} source workflow(s) whose deployment disappeared between plan and apply`,
        { sourceWorkspaceId, targetWorkspaceId, skipped: skippedItems.length }
      )
    }

    return {
      blocked: null,
      promoteRunId,
      deployTargetIds: writtenItems.map((item) => item.targetWorkflowId),
      updated: updatedSnapshots.length,
      created: createdTargetIds.length,
      archived: archivedSnapshots.length,
      drift: plan.drift,
      skippedItems,
      writtenNames: Object.fromEntries(
        writtenItems.map((item) => [item.targetWorkflowId, item.sourceMeta.name])
      ),
      updatedNames: writtenItems
        .filter((item) => item.mode === 'replace')
        .map((item) => item.sourceMeta.name),
      createdNames: writtenItems
        .filter((item) => item.mode !== 'replace')
        .map((item) => item.sourceMeta.name),
      archivedNames,
    }
  })

  if (txResult.blocked !== null) {
    const unmappedRequired = txResult.blocked === 'unmapped' ? txResult.unmappedRequired : []
    return {
      promoteRunId: '',
      updated: 0,
      created: 0,
      archived: 0,
      redeployed: 0,
      deployFailed: 0,
      unmappedRequired,
      drift: txResult.drift,
      blocked: txResult.blocked,
      updatedNames: [],
      createdNames: [],
      archivedNames: [],
    }
  }

  let redeployed = 0
  const deployFailures: string[] = []
  const deployWarnings: string[] = []
  // Deploy in a deterministic (sorted) order so this UNLOCKED loop acquires workflow
  // row locks in the same order as a concurrent rollback's atomic tx (and a sibling
  // promote's deploy loop), avoiding deadlocks - see rollback.ts lock ordering.
  const deployTargetIds = [...txResult.deployTargetIds].sort((a, b) => a.localeCompare(b))
  for (const targetWorkflowId of deployTargetIds) {
    // The transaction already force-replaced this target's draft state, so connected
    // canvas clients must adopt it (mothership-edit semantics) whether or not the
    // subsequent deploy succeeds - otherwise they keep, and may clobber, stale state.
    void notifyForkWorkflowChanged(targetWorkflowId)
    try {
      const result = await performFullDeploy({ workflowId: targetWorkflowId, userId, requestId })
      if (result.success) {
        redeployed += 1
        // A deploy can succeed but defer/queue some side-effects (trigger/schedule/MCP
        // sync). Surface those instead of swallowing them into a clean success.
        if (result.warnings?.length) {
          const name = txResult.writtenNames[targetWorkflowId] ?? targetWorkflowId
          for (const warning of result.warnings) deployWarnings.push(`${name}: ${warning}`)
        }
      } else {
        deployFailures.push(targetWorkflowId)
        logger.warn(`[${requestId}] Deploy after promote failed`, {
          workflowId: targetWorkflowId,
          error: result.error,
        })
      }
    } catch (error) {
      deployFailures.push(targetWorkflowId)
      logger.error(`[${requestId}] Deploy after promote threw`, {
        workflowId: targetWorkflowId,
        error: getErrorMessage(error),
      })
    }
  }

  if (deployFailures.length > 0) {
    logger.warn(`[${requestId}] Promote wrote state but some targets failed to deploy`, {
      sourceWorkspaceId,
      targetWorkspaceId,
      deployFailed: deployFailures.length,
      deployFailures,
    })
  }

  if (deployWarnings.length > 0) {
    logger.warn(`[${requestId}] Promote deploys emitted warnings`, { deployWarnings })
  }
  if (txResult.skippedItems.length > 0) {
    logger.warn(`[${requestId}] Promote skipped undeployed source workflows`, {
      skipped: txResult.skippedItems.map((item) => item.name),
    })
  }
  logger.info(`[${requestId}] Promoted ${sourceWorkspaceId} -> ${targetWorkspaceId}`, {
    updated: txResult.updated,
    created: txResult.created,
    archived: txResult.archived,
    redeployed,
    deployFailed: deployFailures.length,
  })

  return {
    promoteRunId: txResult.promoteRunId,
    updated: txResult.updated,
    created: txResult.created,
    archived: txResult.archived,
    redeployed,
    deployFailed: deployFailures.length,
    unmappedRequired: [],
    drift: txResult.drift,
    blocked: null,
    updatedNames: txResult.updatedNames,
    createdNames: txResult.createdNames,
    archivedNames: txResult.archivedNames,
  }
}
