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
  readDeployedState,
} from '@/lib/workspaces/fork/copy/deploy-bridge'
import { acquireForkEdgeLock, type ForkEdge } from '@/lib/workspaces/fork/lineage/lineage'
import {
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
  unmappedRequired: Array<Pick<ForkReference, 'kind' | 'sourceId' | 'required' | 'blockName'>>
  drift: boolean
  blocked: 'unmapped' | 'drift' | null
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
  willUpdate: number
  willCreate: number
  willArchive: number
  drift: boolean
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

  const txResult: PromoteTxBlocked | PromoteTxApplied = await db.transaction(async (tx) => {
    await acquireForkEdgeLock(tx, edge.childWorkspaceId)

    const plan = await computeForkPromotePlan({
      executor: tx,
      edge,
      sourceWorkspaceId,
      targetWorkspaceId,
      direction,
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
      // Re-read the source's deployed state one workflow at a time so peak memory
      // stays at a single workflow state. Only items actually written below feed
      // the snapshot, identity rows, and deploy list - a source that lost its
      // active deployment between plan and copy is skipped cleanly (no phantom
      // mapping/deploy of a never-created target).
      const sourceState = await readDeployedState(item.sourceWorkflowId, sourceWorkspaceId)
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
    await upsertEdgeMappings(tx, edge.childWorkspaceId, userId, identityEntries)

    const credentialPairs = collectCredentialPairs(plan)
    const propagationTargetIds = credentialPairs.map(([, targetCredId]) => targetCredId)
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

    const validPairs = credentialPairs.filter(([, targetCredId]) =>
      validTargetCredentialIds.has(targetCredId)
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

    return {
      blocked: null,
      promoteRunId,
      deployTargetIds: writtenItems.map((item) => item.targetWorkflowId),
      willUpdate: plan.willUpdate,
      willCreate: plan.willCreate,
      willArchive: plan.willArchive,
      drift: plan.drift,
    }
  })

  if (txResult.blocked !== null) {
    return {
      promoteRunId: '',
      updated: 0,
      created: 0,
      archived: 0,
      redeployed: 0,
      unmappedRequired: txResult.blocked === 'unmapped' ? txResult.unmappedRequired : [],
      drift: txResult.drift,
      blocked: txResult.blocked,
    }
  }

  let redeployed = 0
  for (const targetWorkflowId of txResult.deployTargetIds) {
    try {
      const result = await performFullDeploy({ workflowId: targetWorkflowId, userId, requestId })
      if (result.success) {
        redeployed += 1
      } else {
        logger.warn(`[${requestId}] Deploy after promote failed`, {
          workflowId: targetWorkflowId,
          error: result.error,
        })
        void notifyForkWorkflowChanged(targetWorkflowId)
      }
    } catch (error) {
      logger.error(`[${requestId}] Deploy after promote threw`, {
        workflowId: targetWorkflowId,
        error: getErrorMessage(error),
      })
      void notifyForkWorkflowChanged(targetWorkflowId)
    }
  }

  logger.info(`[${requestId}] Promoted ${sourceWorkspaceId} -> ${targetWorkspaceId}`, {
    updated: txResult.willUpdate,
    created: txResult.willCreate,
    archived: txResult.willArchive,
    redeployed,
  })

  return {
    promoteRunId: txResult.promoteRunId,
    updated: txResult.willUpdate,
    created: txResult.willCreate,
    archived: txResult.willArchive,
    redeployed,
    unmappedRequired: [],
    drift: txResult.drift,
    blocked: null,
  }
}
