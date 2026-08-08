import { db } from '@sim/db'
import { pausedExecutions, resumeQueue, workflow, workflowExecutionLogs } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { getJobQueue } from '@/lib/core/async-jobs'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { WORKFLOW_EXECUTION_JOB_ID_PREFIX } from '@/lib/workflows/executor/execution-job-ids'
import {
  type ActiveWorkspaceApplicationContext,
  loadActiveWorkspaceApplicationContext,
} from '@/lib/workspaces/application/workspace-context'

export interface ActiveWorkflowApplicationContext {
  workflowId: string
  workflow: typeof workflow.$inferSelect
  workspaceId: string
  workspaceOrganizationId: string | null
  allowPersonalApiKeys: boolean
  billedAccountUserId: string
}

export interface ActiveWorkflowRunApplicationContext extends ActiveWorkflowApplicationContext {
  runId: string
}

export async function resolveActiveWorkspaceApplicationContext(
  workspaceId: string
): Promise<ActiveWorkspaceApplicationContext> {
  const context = await loadActiveWorkspaceApplicationContext(workspaceId)
  if (!context) throw new OrchestrationError('not_found', 'Workspace not found')
  return context
}

export async function resolveActiveWorkflowApplicationContext(input: {
  workflowId: string
  assertedWorkspaceId?: string
}): Promise<ActiveWorkflowApplicationContext> {
  const [canonicalWorkflow] = await db
    .select({
      workflowId: workflow.id,
      workflow,
      workspaceId: workflow.workspaceId,
    })
    .from(workflow)
    .where(and(eq(workflow.id, input.workflowId), isNull(workflow.archivedAt)))
    .limit(1)

  if (
    !canonicalWorkflow?.workspaceId ||
    (input.assertedWorkspaceId !== undefined &&
      input.assertedWorkspaceId !== canonicalWorkflow.workspaceId)
  ) {
    throw new OrchestrationError('not_found', 'Workflow not found')
  }
  const workspaceContext = await loadActiveWorkspaceApplicationContext(
    canonicalWorkflow.workspaceId
  )
  if (!workspaceContext) throw new OrchestrationError('not_found', 'Workflow not found')
  return { ...workspaceContext, ...canonicalWorkflow, workspaceId: workspaceContext.workspaceId }
}

async function resolveCanonicalRunWorkflowId(runId: string): Promise<string | null> {
  const [logRows, pausedRows, resumeRows] = await Promise.all([
    db
      .select({ workflowId: workflowExecutionLogs.workflowId })
      .from(workflowExecutionLogs)
      .where(eq(workflowExecutionLogs.executionId, runId))
      .limit(1),
    db
      .select({ workflowId: pausedExecutions.workflowId })
      .from(pausedExecutions)
      .where(eq(pausedExecutions.executionId, runId))
      .limit(1),
    db
      .select({ workflowId: pausedExecutions.workflowId })
      .from(resumeQueue)
      .innerJoin(pausedExecutions, eq(resumeQueue.pausedExecutionId, pausedExecutions.id))
      .where(eq(resumeQueue.newExecutionId, runId))
      .limit(1),
  ])

  const canonicalIds = new Set(
    [logRows[0]?.workflowId, pausedRows[0]?.workflowId, resumeRows[0]?.workflowId].filter(
      (value): value is string => typeof value === 'string'
    )
  )

  if (canonicalIds.size > 1) {
    throw new Error(`Run ${runId} has conflicting canonical workflow bindings`)
  }
  if (canonicalIds.size === 1) return [...canonicalIds][0]

  const queue = await getJobQueue()
  const job = await queue.getJob(`${WORKFLOW_EXECUTION_JOB_ID_PREFIX}${runId}`)
  return job?.metadata.workflowId ?? null
}

export async function resolveActiveWorkflowRunApplicationContext(input: {
  runId: string
  assertedWorkflowId?: string
  assertedWorkspaceId?: string
}): Promise<ActiveWorkflowRunApplicationContext> {
  const workflowId = await resolveCanonicalRunWorkflowId(input.runId)
  if (!workflowId || (input.assertedWorkflowId && input.assertedWorkflowId !== workflowId)) {
    throw new OrchestrationError('not_found', 'Run not found')
  }

  const context = await resolveActiveWorkflowApplicationContext({
    workflowId,
    assertedWorkspaceId: input.assertedWorkspaceId,
  })
  return { ...context, runId: input.runId }
}
