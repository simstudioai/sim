import { AuditAction, AuditResourceType } from '@sim/audit'
import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { assertWorkflowMutable, WorkflowLockedError } from '@sim/platform-authz/workflow'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import type { WorkflowState } from '@sim/workflow-types/workflow'
import { and, eq, isNull } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { notifyWorkflowUpdated } from '@/lib/realtime/notify'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { assertedWorkflowWorkspaceId } from '@/lib/workflows/application/principal-scope'
import { saveWorkflowToNormalizedTables } from '@/lib/workflows/persistence/utils'

const logger = createLogger('UpdateWorkflowContent')
const MAX_WORKFLOW_VARIABLE_OPERATIONS = 100

interface WorkflowContentInput {
  workflowId: string
  assertedWorkspaceId?: string
}

async function requireMutableWorkflow(workflowId: string): Promise<void> {
  try {
    await assertWorkflowMutable(workflowId)
  } catch (error) {
    if (error instanceof WorkflowLockedError) {
      throw new OrchestrationError('locked', error.message)
    }
    throw error
  }
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
    if (type === 'object' && parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
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
  const current =
    currentVariables && typeof currentVariables === 'object' && !Array.isArray(currentVariables)
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
  projectAudit: ({ input, context, result }) =>
    result.changed
      ? {
          action: AuditAction.WORKFLOW_VARIABLES_UPDATED,
          resourceType: AuditResourceType.WORKFLOW,
          resourceId: context.workflowId,
          resourceName: context.workflow.name,
          description: 'Updated workflow variables',
          metadata: { operationCount: input.operations.length, source: 'copilot' },
        }
      : [],
  afterSuccess: ({ context, result }) =>
    result.changed ? notifyWorkflowUpdated(context.workflowId) : undefined,
})

export interface UpdateWorkflowStateInput extends WorkflowContentInput {
  state: WorkflowState
}

export const updateWorkflowState = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.updateState,
  resolveContext: resolveWorkflowContentContext<UpdateWorkflowStateInput>,
  async execute({ input, context }) {
    await requireMutableWorkflow(context.workflowId)
    await db.transaction(async (tx) => {
      const [active] = await tx
        .select({ id: workflow.id })
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

      const saveResult = await saveWorkflowToNormalizedTables(context.workflowId, input.state, tx)
      if (!saveResult.success) {
        throw new Error(saveResult.error || 'Failed to save workflow state')
      }
      await tx
        .update(workflow)
        .set({ lastSynced: new Date(), updatedAt: new Date() })
        .where(eq(workflow.id, context.workflowId))
    })
    return { workflowName: context.workflow.name }
  },
  afterSuccess: ({ context }) => notifyWorkflowUpdated(context.workflowId),
})
