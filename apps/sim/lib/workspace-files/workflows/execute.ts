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
  type FileWorkflowRunKey,
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

function emptySnapshot(
  run: FileWorkflowRun | null,
  deploymentVersionId: string,
  audience: string
): FileWorkflowSnapshot {
  const current = run?.deploymentVersionId === deploymentVersionId && run.audience === audience
  return {
    status: current && run.status !== 'completed' ? run.status : 'empty',
    executionId: current ? run.executionId : null,
    deploymentVersionId: current ? run.deploymentVersionId : null,
    generatedAt: current ? (run.finishedAt?.toISOString() ?? null) : null,
    nextRunAt:
      current && run
        ? new Date(run.startedAt.getTime() + FILE_WORKFLOW_INTERVAL_MS).toISOString()
        : null,
    output: null,
    error:
      current && run.status === 'failed'
        ? 'Workflow execution failed. Inspect the workflow run for details.'
        : null,
  }
}

async function readSnapshot(key: FileWorkflowRunKey, deploymentVersionId: string) {
  const run = await readFileWorkflowRun(key)
  if (
    run?.deploymentVersionId === deploymentVersionId &&
    run.audience === key.audience &&
    run.status === 'completed'
  ) {
    const cached = await readFileWorkflowResult(key.audience, run.executionId)
    if (cached) return cached
  }
  return emptySnapshot(run, deploymentVersionId, key.audience)
}

/** Called only after application authorization, and reauthorized before executing and delivering results. */
export async function accessFileWorkflow(args: {
  fileId: string
  workflow: ActiveWorkflowApplicationContext
  principal: WorkflowExecutionPrincipal
  userId: string
  audience: string
  inputHash: string
  input: Record<string, unknown>
  deploymentVersionId: string
  run: boolean
  publicAccess: boolean
  reauthorize(): Promise<void>
}): Promise<FileWorkflowSnapshot> {
  const { fileId, workflow, audience, inputHash, deploymentVersionId } = args
  const key = { fileId, workflowId: workflow.workflowId, audience, inputHash }
  if (args.run) await reconcileFileWorkflowRun(key)
  const snapshot = await readSnapshot(key, deploymentVersionId)
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
    ...key,
    executionId: generateId(),
    deploymentVersionId,
  })
  if (!admission) {
    const current = await readSnapshot(key, deploymentVersionId)
    await args.reauthorize()
    return current
  }
  let result: FileWorkflowSnapshot = {
    ...emptySnapshot(admission, deploymentVersionId, audience),
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
      input: args.input,
      triggerType: 'file',
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
