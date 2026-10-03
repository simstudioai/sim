import { AuditAction, AuditResourceType } from '@sim/audit'
import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, isNull } from 'drizzle-orm'
import { principalAuditSource } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { notifyWorkflowUpdated } from '@/lib/realtime/notify'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { resolvePrincipalWorkflowContext } from '@/lib/workflows/application/principal-scope'
import { requireMutableWorkflow } from '@/lib/workflows/application/workflow-mutability'
import {
  coerceWorkflowVariableValue,
  normalizeWorkflowVariables,
  type WorkflowVariable,
} from '@/lib/workflows/application/workflow-variables'

const MAX_WORKFLOW_VARIABLE_OPERATIONS = 100

interface WorkflowContentInput {
  workflowId: string
  assertedWorkspaceId?: string
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
  resolveContext: resolvePrincipalWorkflowContext<ApplyWorkflowVariableOperationsInput>,
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
