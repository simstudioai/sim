import type { WorkflowExecutionPrincipal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { notifyWorkspaceFilesChanged } from '@/lib/realtime/notify'
import type { ActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { executeWorkflowService } from '@/lib/workflows/executor/execute-service'
import {
  assertFileWorkflowCacheAvailable,
  cacheFileWorkflowResult,
  claimFileWorkflowRun,
  type FileWorkflowRun,
  finishFileWorkflowRun,
  readFileWorkflowResult,
  readFileWorkflowRun,
  reconcileFileWorkflowRun,
} from '@/lib/workspace-files/workflows/run-store'
import {
  FILE_WORKFLOW_INTERVAL_MS,
  type FileWorkflowSnapshot,
} from '@/lib/workspace-files/workflows/types'

const logger = createLogger('FileWorkflowExecution')

function emptySnapshot(run: FileWorkflowRun | null, audience: string): FileWorkflowSnapshot {
  const own = run?.audience === audience
  return {
    status: own && run.status !== 'completed' ? run.status : 'empty',
    executionId: own ? run.executionId : null,
    deploymentVersionId: own ? run.deploymentVersionId : null,
    generatedAt: own ? (run.finishedAt?.toISOString() ?? null) : null,
    nextRunAt: run
      ? new Date(run.startedAt.getTime() + FILE_WORKFLOW_INTERVAL_MS).toISOString()
      : null,
    output: null,
    error:
      own && run.status === 'failed'
        ? 'Workflow execution failed. Inspect the workflow run for details.'
        : null,
  }
}

async function readSnapshot(fileId: string, workflowId: string, audience: string) {
  const run = await readFileWorkflowRun(fileId, workflowId)
  if (run?.audience === audience && run.status === 'completed') {
    const cached = await readFileWorkflowResult(audience, run.executionId)
    if (cached) return cached
  }
  return emptySnapshot(run, audience)
}

/** Called only after application authorization, and reauthorized before executing and delivering results. */
export async function accessFileWorkflow(args: {
  fileId: string
  workflow: ActiveWorkflowApplicationContext
  principal: WorkflowExecutionPrincipal
  userId: string
  audience: string
  run: boolean
  publicAccess: boolean
  reauthorize(): Promise<void>
}): Promise<FileWorkflowSnapshot> {
  const { fileId, workflow, audience } = args
  if (args.run) await reconcileFileWorkflowRun(fileId, workflow.workflowId)
  const snapshot = await readSnapshot(fileId, workflow.workflowId, audience)
  if (
    !args.run ||
    snapshot.status === 'running' ||
    (snapshot.nextRunAt && Date.parse(snapshot.nextRunAt) > Date.now())
  ) {
    await args.reauthorize()
    return snapshot
  }
  await assertFileWorkflowCacheAvailable()
  await args.reauthorize()
  const admission = await claimFileWorkflowRun({
    fileId,
    workflowId: workflow.workflowId,
    executionId: generateId(),
    audience,
  })
  if (!admission) {
    const current = await readSnapshot(fileId, workflow.workflowId, audience)
    await args.reauthorize()
    return current
  }
  let result: FileWorkflowSnapshot = {
    ...emptySnapshot(admission, audience),
    status: 'failed',
    error: 'Workflow execution failed. Inspect the workflow run for details.',
  }
  let mayStillRun = false
  try {
    await args.reauthorize()
    mayStillRun = true
    const execution = await executeWorkflowService({
      workflowId: workflow.workflowId,
      principal: args.principal,
      userId: args.userId,
      input: {},
      triggerType: 'api',
      requestId: generateId(),
      executionId: admission.executionId,
      workflowRecord: workflow.workflow,
      useAuthenticatedUserAsActor:
        !args.publicAccess && args.principal.kind !== 'workspace_api_key',
      isPublicApiAccess: args.publicAccess,
      rejectLargeInlineOutput: true,
      mode: 'sync',
    })
    mayStillRun = execution.ok && (!('status' in execution) || execution.status === 'paused')
    if (!execution.ok || !('status' in execution))
      throw new OrchestrationError(
        'conflict',
        'Workflow could not complete. Inspect the workflow run for details.'
      )
    result = {
      ...result,
      deploymentVersionId: execution.deploymentVersionId ?? null,
      generatedAt: new Date().toISOString(),
      status:
        execution.status === 'completed'
          ? 'completed'
          : execution.status === 'paused'
            ? 'running'
            : 'failed',
      output: execution.status === 'completed' ? (execution.output ?? null) : null,
      error:
        execution.status === 'completed' || execution.status === 'paused' ? null : result.error,
    }
    await args.reauthorize()
    if (result.status === 'completed') await cacheFileWorkflowResult(audience, result)
  } catch (error) {
    result = { ...result, status: mayStillRun ? 'running' : 'failed', output: null }
    logger.error('File workflow call failed', {
      fileId,
      workflowId: workflow.workflowId,
      executionId: admission.executionId,
      error,
    })
    throw error
  } finally {
    await finishFileWorkflowRun(admission, result)
    await notifyWorkspaceFilesChanged(workflow.workspaceId)
  }
  return result
}
