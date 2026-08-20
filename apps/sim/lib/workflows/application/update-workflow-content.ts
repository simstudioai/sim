import { AuditAction, AuditResourceType } from '@sim/audit'
import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
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
  type BlockEnablementRefusal,
  decideBlockEnablement,
} from '@/lib/workflows/editing/block-enablement'
import {
  loadWorkflowFromNormalizedTables,
  saveWorkflowToNormalizedTables,
} from '@/lib/workflows/persistence/utils'

const logger = createLogger('UpdateWorkflowContent')
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

interface WorkflowVariable {
  id: string
  workflowId?: string
  name: string
  type: string
  value?: unknown
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

function coerceWorkflowVariableValue(value: unknown, type: string): unknown {
  if (value === undefined) return value
  if (type === 'number') {
    const number = Number(value)
    return Number.isNaN(number) ? value : number
  }
  if (type === 'boolean') {
    const normalized = String(value).trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
    return value
  }
  if (type !== 'array' && type !== 'object') return value

  try {
    const parsed: unknown = JSON.parse(String(value))
    if (type === 'array' && Array.isArray(parsed)) return parsed
    if (type === 'object' && isRecordLike(parsed)) {
      return parsed
    }
  } catch (error) {
    logger.warn('Failed to parse JSON value for workflow variable coercion', {
      error: getErrorMessage(error),
    })
  }
  return value
}

function applyVariableOperations(
  workflowId: string,
  currentVariables: unknown,
  operations: readonly WorkflowVariableOperation[]
): { variables: Record<string, WorkflowVariable>; changed: boolean } {
  const current = isRecordLike(currentVariables)
    ? (currentVariables as Record<string, unknown>)
    : {}
  const byName = new Map<string, WorkflowVariable>()
  for (const value of Object.values(current)) {
    if (
      value &&
      typeof value === 'object' &&
      'id' in value &&
      typeof value.id === 'string' &&
      'name' in value &&
      typeof value.name === 'string'
    ) {
      byName.set(value.name, {
        ...value,
        id: value.id,
        name: value.name,
        type: 'type' in value && typeof value.type === 'string' ? value.type : 'plain',
      })
    }
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

  return {
    variables: Object.fromEntries([...byName.values()].map((variable) => [variable.id, variable])),
    changed,
  }
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

export const setWorkflowBlockEnabled = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.setBlockEnabled,
  resolveContext: resolveWorkflowContentContext<SetWorkflowBlockEnabledInput>,
  async execute({ input, context }) {
    await requireMutableWorkflow(context.workflowId)
    return db.transaction(async (tx) => {
      const [active] = await tx
        .select({ id: workflow.id, name: workflow.name })
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
      if (!active) throw new OrchestrationError('not_found', 'Workflow not found')

      const normalized = await loadWorkflowFromNormalizedTables(context.workflowId, tx)
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
          workflowName: active.name,
          affectedBlockIds: decision.affectedBlockIds,
          state: currentState,
        }
      }

      const nextState: WorkflowState = {
        ...currentState,
        blocks: decision.blocks,
        lastSaved: Date.now(),
      }
      const saveResult = await saveWorkflowToNormalizedTables(context.workflowId, nextState, tx)
      if (!saveResult.success) {
        throw new Error(saveResult.error || 'Failed to save workflow state')
      }
      const [updated] = await tx
        .update(workflow)
        .set({ lastSynced: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(workflow.id, context.workflowId),
            eq(workflow.workspaceId, context.workspaceId),
            isNull(workflow.archivedAt)
          )
        )
        .returning({ id: workflow.id })
      if (!updated) throw new OrchestrationError('not_found', 'Workflow not found')
      return {
        changed: true,
        workflowName: active.name,
        affectedBlockIds: decision.affectedBlockIds,
        state: nextState,
      }
    })
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
