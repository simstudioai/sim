import { AuditAction, AuditResourceType } from '@sim/audit'
import { type Principal, resolvePrincipalAttribution } from '@sim/auth/principal'
import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import type { BlockState, WorkflowState } from '@sim/workflow-types/workflow'
import { and, eq, isNull } from 'drizzle-orm'
import { principalAuditSource } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { notifyWorkflowUpdated } from '@/lib/realtime/notify'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { assertedWorkflowWorkspaceId } from '@/lib/workflows/application/principal-scope'
import { requireMutableWorkflow } from '@/lib/workflows/application/workflow-mutability'
import {
  coerceWorkflowVariableValue,
  normalizeWorkflowVariables,
  type WorkflowVariable,
} from '@/lib/workflows/application/workflow-variables'
import {
  type BlockEnablementRefusal,
  decideBlockEnablement,
} from '@/lib/workflows/editing/block-enablement'
import { replaceWorkflowNormalizedState } from '@/lib/workflows/persistence/replace-normalized-state'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'
import { generateLoopBlocks, generateParallelBlocks } from '@/stores/workflows/workflow/utils'

const MAX_WORKFLOW_VARIABLE_OPERATIONS = 100

/** How each protection refusal is classified when a single block toggle is the whole request. */
const BLOCK_ENABLEMENT_REFUSAL_CODES: Record<
  BlockEnablementRefusal['reason'],
  'not_found' | 'locked' | 'validation'
> = {
  not_found: 'not_found',
  locked: 'locked',
  disabled_ancestor: 'validation',
}

interface WorkflowContentInput {
  workflowId: string
  assertedWorkspaceId?: string
}

function resolveWorkflowContentContext<I extends WorkflowContentInput>({
  principal,
  input,
}: {
  principal: Principal
  input: I
}) {
  return resolveActiveWorkflowApplicationContext({
    workflowId: input.workflowId,
    assertedWorkspaceId: assertedWorkflowWorkspaceId(principal, input.assertedWorkspaceId),
  })
}

export interface WorkflowVariableOperation {
  name: string
  operation: 'add' | 'edit' | 'delete'
  value?: unknown
  type?: string
}

export interface ApplyWorkflowVariableOperationsInput extends WorkflowContentInput {
  operations: WorkflowVariableOperation[]
}

function applyVariableOperations(
  workflowId: string,
  currentVariables: unknown,
  operations: readonly WorkflowVariableOperation[]
): { variables: Record<string, WorkflowVariable>; changed: boolean } {
  const byName = new Map<string, WorkflowVariable>()
  for (const variable of Object.values(normalizeWorkflowVariables(currentVariables))) {
    byName.set(variable.name, variable)
  }

  let changed = false
  for (const operation of operations) {
    const name = String(operation.name || '')
    if (!name) continue
    const existing = byName.get(name)
    if (operation.operation === 'delete') {
      changed = byName.delete(name) || changed
      continue
    }

    const type = operation.type || existing?.type || 'plain'
    const value = coerceWorkflowVariableValue(operation.value, type)
    if (operation.operation === 'add' || !existing) {
      byName.set(name, { id: generateId(), workflowId, name, type, value })
    } else {
      byName.set(name, { ...existing, type, value })
    }
    changed = true
  }

  return { variables: normalizeWorkflowVariables([...byName.values()]), changed }
}

export const applyWorkflowVariableOperations = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.applyVariableOperations,
  resolveContext: resolveWorkflowContentContext<ApplyWorkflowVariableOperationsInput>,
  async execute({ input, context }) {
    if (input.operations.length > MAX_WORKFLOW_VARIABLE_OPERATIONS) {
      throw new OrchestrationError(
        'validation',
        `Workflow variable updates cannot exceed ${MAX_WORKFLOW_VARIABLE_OPERATIONS} operations`
      )
    }
    await requireMutableWorkflow(context.workflowId)

    return db.transaction(async (tx) => {
      const [current] = await tx
        .select({ variables: workflow.variables })
        .from(workflow)
        .where(
          and(
            eq(workflow.id, context.workflowId),
            eq(workflow.workspaceId, context.workspaceId),
            isNull(workflow.archivedAt)
          )
        )
        .limit(1)
        .for('update')
      if (!current) throw new OrchestrationError('not_found', 'Workflow not found')

      const transformed = applyVariableOperations(
        context.workflowId,
        current.variables,
        input.operations
      )
      if (!transformed.changed) {
        return { updated: Object.keys(transformed.variables).length, changed: false }
      }

      const [updated] = await tx
        .update(workflow)
        .set({ variables: transformed.variables, updatedAt: new Date() })
        .where(
          and(
            eq(workflow.id, context.workflowId),
            eq(workflow.workspaceId, context.workspaceId),
            isNull(workflow.archivedAt)
          )
        )
        .returning({ id: workflow.id })
      if (!updated) throw new OrchestrationError('not_found', 'Workflow not found')
      return { updated: Object.keys(transformed.variables).length, changed: true }
    })
  },
  projectAudit: ({ principal, input, context, result }) =>
    result.changed
      ? {
          action: AuditAction.WORKFLOW_VARIABLES_UPDATED,
          resourceType: AuditResourceType.WORKFLOW,
          resourceId: context.workflowId,
          resourceName: context.workflow.name,
          description: 'Updated workflow variables',
          metadata: {
            operationCount: input.operations.length,
            source: principalAuditSource(principal),
          },
        }
      : [],
  afterSuccess: ({ context, result }) =>
    result.changed ? notifyWorkflowUpdated(context.workflowId) : undefined,
})

export interface SetWorkflowBlockEnabledInput extends WorkflowContentInput {
  blockId: string
  enabled: boolean
}

/**
 * Toggles one block, or a container and its unlocked descendants.
 *
 * The write goes through {@link replaceWorkflowNormalizedState}, the same door
 * `replaceWorkflowState` and `applyWorkflowOperations` use, so this toggle
 * cannot acquire different persistence behavior by being a different entry
 * point: it gets the same state preparation, the same row-locked replace
 * transaction, the same `lastSynced` stamp, and the same custom-tool
 * extraction. Writing the graph here directly was how those diverged.
 */
export const setWorkflowBlockEnabled = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.setBlockEnabled,
  resolveContext: resolveWorkflowContentContext<SetWorkflowBlockEnabledInput>,
  async execute({ principal, input, context }) {
    await requireMutableWorkflow(context.workflowId)

    const normalized = await loadWorkflowFromNormalizedTables(context.workflowId)
    if (!normalized) {
      throw new OrchestrationError(
        'validation',
        `Workflow ${context.workflowId} has no normalized state`
      )
    }
    const currentState: WorkflowState = {
      blocks: normalized.blocks as Record<string, BlockState>,
      edges: normalized.edges || [],
      loops: normalized.loops || {},
      parallels: normalized.parallels || {},
      lastSaved: Date.now(),
    }
    const decision = decideBlockEnablement(currentState.blocks, input.blockId, input.enabled)
    if (decision.outcome === 'refused') {
      throw new OrchestrationError(
        BLOCK_ENABLEMENT_REFUSAL_CODES[decision.refusal.reason],
        decision.refusal.reason === 'not_found'
          ? `Block ${input.blockId} not found in workflow ${context.workflowId}`
          : decision.refusal.message
      )
    }
    if (decision.outcome === 'unchanged') {
      return {
        changed: false,
        workflowName: context.workflow.name,
        affectedBlockIds: decision.affectedBlockIds,
        state: currentState,
      }
    }

    const attribution = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    })
    /**
     * The graph is re-read and the toggle re-decided inside the row lock.
     *
     * The read above is advisory: it answers "is this a refusal or a no-op"
     * cheaply, but a graph read outside the lock cannot be written back safely.
     * The editor's own save takes the same lock, so between that read and this
     * write a canvas autosave can commit — and this operation writes a whole
     * graph, not a delta, so persisting the stale copy would discard it wholly.
     */
    const persisted = await replaceWorkflowNormalizedState({
      workflowId: context.workflowId,
      workspaceId: context.workspaceId,
      attributedUserId: attribution.attributedUserId,
      state: async (tx) => {
        const locked = await loadWorkflowFromNormalizedTables(context.workflowId, tx)
        if (!locked) {
          throw new OrchestrationError(
            'validation',
            `Workflow ${context.workflowId} has no normalized state`
          )
        }
        const lockedBlocks = locked.blocks as Record<string, BlockState>
        const lockedDecision = decideBlockEnablement(lockedBlocks, input.blockId, input.enabled)
        if (lockedDecision.outcome === 'refused') {
          throw new OrchestrationError(
            BLOCK_ENABLEMENT_REFUSAL_CODES[lockedDecision.refusal.reason],
            lockedDecision.refusal.reason === 'not_found'
              ? `Block ${input.blockId} not found in workflow ${context.workflowId}`
              : lockedDecision.refusal.message
          )
        }
        return {
          blocks: lockedDecision.outcome === 'unchanged' ? lockedBlocks : lockedDecision.blocks,
          edges: locked.edges || [],
        }
      },
    })

    const blocks = persisted.state.blocks as Record<string, BlockState>
    return {
      changed: true,
      workflowName: context.workflow.name,
      affectedBlockIds: decision.affectedBlockIds,
      state: {
        blocks,
        edges: persisted.state.edges,
        loops: generateLoopBlocks(blocks),
        parallels: generateParallelBlocks(blocks),
        lastSaved: Date.now(),
      } satisfies WorkflowState,
    }
  },
  projectAudit: ({ principal, input, context, result }) =>
    result.changed
      ? {
          action: AuditAction.WORKFLOW_UPDATED,
          resourceType: AuditResourceType.WORKFLOW,
          resourceId: context.workflowId,
          resourceName: result.workflowName,
          description: `${input.enabled ? 'Enabled' : 'Disabled'} workflow block "${input.blockId}"`,
          metadata: {
            op: 'set_block_enabled',
            blockId: input.blockId,
            enabled: input.enabled,
            affectedBlockIds: result.affectedBlockIds,
            source: principalAuditSource(principal),
          },
        }
      : [],
  afterSuccess: ({ context, result }) =>
    result.changed ? notifyWorkflowUpdated(context.workflowId) : undefined,
})
