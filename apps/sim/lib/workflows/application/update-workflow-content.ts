import { AuditAction, AuditResourceType } from '@sim/audit'
import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import { assertWorkflowMutable, WorkflowLockedError } from '@sim/platform-authz/workflow'
import type { WorkflowState } from '@sim/workflow-types/workflow'
import { and, eq, isNull } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { notifyWorkflowUpdated } from '@/lib/realtime/notify'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { assertedWorkflowWorkspaceId } from '@/lib/workflows/application/principal-scope'
import { saveWorkflowToNormalizedTables } from '@/lib/workflows/persistence/utils'

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

export interface UpdateWorkflowVariablesInput extends WorkflowContentInput {
  variables: Record<string, unknown>
  operationCount: number
  source: 'copilot'
}

export const updateWorkflowVariables = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.updateVariables,
  resolveContext: resolveWorkflowContentContext<UpdateWorkflowVariablesInput>,
  async execute({ input, context }) {
    await requireMutableWorkflow(context.workflowId)
    const [updated] = await db
      .update(workflow)
      .set({ variables: input.variables, updatedAt: new Date() })
      .where(
        and(
          eq(workflow.id, context.workflowId),
          eq(workflow.workspaceId, context.workspaceId),
          isNull(workflow.archivedAt)
        )
      )
      .returning({ id: workflow.id })
    if (!updated) throw new OrchestrationError('not_found', 'Workflow not found')
    return { updated: Object.keys(input.variables).length }
  },
  projectAudit: ({ input, context }) => ({
    action: AuditAction.WORKFLOW_VARIABLES_UPDATED,
    resourceType: AuditResourceType.WORKFLOW,
    resourceId: context.workflowId,
    resourceName: context.workflow.name,
    description: 'Updated workflow variables',
    metadata: { operationCount: input.operationCount, source: input.source },
  }),
  afterSuccess: ({ context }) => notifyWorkflowUpdated(context.workflowId),
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
