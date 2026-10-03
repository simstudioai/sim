import { db } from '@sim/db'
import {
  pausedExecutions,
  resumeQueue,
  workflow,
  workflowDeploymentVersion,
  workflowExecutionLogs,
} from '@sim/db/schema'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { getJobQueue } from '@/lib/core/async-jobs'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { WORKFLOW_EXECUTION_JOB_ID_PREFIX } from '@/lib/workflows/executor/execution-job-ids'
import { loadActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

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

export interface ActiveWorkflowExecutionApplicationContext
  extends ActiveWorkflowRunApplicationContext {
  deploymentVersionId: string | null
}

export interface ActiveWorkflowDeploymentVersionApplicationContext
  extends ActiveWorkflowApplicationContext {
  deploymentVersionId: string
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

/**
 * Canonical context for a workflow that may be archived.
 *
 * Separate from {@link resolveActiveWorkflowApplicationContext}, which excludes
 * archived rows by construction — a restore has to reach exactly the rows that
 * one hides.
 */
export async function resolveArchivedWorkflowApplicationContext(input: {
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
    .where(eq(workflow.id, input.workflowId))
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

/** Resolves an execution that is currently running or waiting to resume from its durable log. */
export async function resolveActiveWorkflowExecutionApplicationContext(input: {
  runId: string
  assertedWorkflowId?: string
}): Promise<ActiveWorkflowExecutionApplicationContext> {
  const projection = {
    workflowId: workflowExecutionLogs.workflowId,
    workspaceId: workflowExecutionLogs.workspaceId,
    deploymentVersionId: workflowExecutionLogs.deploymentVersionId,
  }
  const [directRows, resumedRows] = await Promise.all([
    db
      .select(projection)
      .from(workflowExecutionLogs)
      .where(
        and(
          eq(workflowExecutionLogs.executionId, input.runId),
          inArray(workflowExecutionLogs.status, ['running', 'pending', 'paused'])
        )
      )
      .limit(1),
    db
      .select(projection)
      .from(resumeQueue)
      .innerJoin(
        workflowExecutionLogs,
        eq(resumeQueue.parentExecutionId, workflowExecutionLogs.executionId)
      )
      .where(
        and(
          eq(resumeQueue.newExecutionId, input.runId),
          eq(resumeQueue.status, 'claimed'),
          inArray(workflowExecutionLogs.status, ['running', 'pending', 'paused'])
        )
      )
      .limit(1),
  ])
  const direct = directRows[0]
  const resumed = resumedRows[0]
  if (
    direct &&
    resumed &&
    (resumed.workflowId !== direct.workflowId ||
      resumed.workspaceId !== direct.workspaceId ||
      resumed.deploymentVersionId !== direct.deploymentVersionId)
  ) {
    throw new Error(`Execution ${input.runId} has conflicting durable authority bindings`)
  }
  const run = direct ?? resumed

  if (
    !run?.workflowId ||
    (input.assertedWorkflowId !== undefined && input.assertedWorkflowId !== run.workflowId)
  ) {
    throw new OrchestrationError('not_found', 'Run not found')
  }

  const context = await resolveActiveWorkflowApplicationContext({
    workflowId: run.workflowId,
    assertedWorkspaceId: run.workspaceId,
  })
  return {
    ...context,
    runId: input.runId,
    deploymentVersionId: run.deploymentVersionId,
  }
}

/** Resolves an immutable deployment version without requiring it to remain active. */
export async function resolveActiveWorkflowDeploymentVersionApplicationContext(input: {
  workflowId: string
  deploymentVersionId: string
  assertedWorkspaceId: string
}): Promise<ActiveWorkflowDeploymentVersionApplicationContext> {
  const context = await resolveActiveWorkflowApplicationContext({
    workflowId: input.workflowId,
    assertedWorkspaceId: input.assertedWorkspaceId,
  })
  const [version] = await db
    .select({ deploymentVersionId: workflowDeploymentVersion.id })
    .from(workflowDeploymentVersion)
    .where(
      and(
        eq(workflowDeploymentVersion.id, input.deploymentVersionId),
        eq(workflowDeploymentVersion.workflowId, context.workflowId)
      )
    )
    .limit(1)

  if (!version) {
    throw new OrchestrationError('not_found', 'Workflow deployment version not found')
  }
  return { ...context, deploymentVersionId: version.deploymentVersionId }
}
