import { db } from '@sim/db'
import { workflow as workflowTable } from '@sim/db/schema'
import { task } from '@trigger.dev/sdk'
import { eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '@/lib/logs/console/logger'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
<<<<<<< HEAD
import { getWorkflowById } from '@/lib/workflows/utils'
import { executeWorkflow } from '@/app/api/workflows/[id]/execute/route'
=======
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { decryptSecret } from '@/lib/utils'
import { loadDeployedWorkflowState } from '@/lib/workflows/db-helpers'
import { updateWorkflowRunCounts } from '@/lib/workflows/utils'
import { filterEdgesFromTriggerBlocks } from '@/app/workspace/[workspaceId]/w/[workflowId]/lib/workflow-execution-utils'
import { Executor } from '@/executor'
import { Serializer } from '@/serializer'
import { mergeSubblockState } from '@/stores/workflows/server-utils'
>>>>>>> origin/improvement/sim-294

const logger = createLogger('TriggerWorkflowExecution')

export type WorkflowExecutionPayload = {
  workflowId: string
  userId: string
  input?: any
  triggerType?: 'api' | 'webhook' | 'schedule' | 'manual' | 'chat'
  metadata?: Record<string, any>
}

export async function executeWorkflowJob(payload: WorkflowExecutionPayload) {
  const workflowId = payload.workflowId
  const executionId = uuidv4()
  const requestId = executionId.slice(0, 8)

  logger.info(`[${requestId}] Starting workflow execution job: ${workflowId}`, {
    userId: payload.userId,
    triggerType: payload.triggerType,
    executionId,
  })

  // Initialize logging session
  const triggerType = payload.triggerType || 'api'
  const loggingSession = new LoggingSession(workflowId, executionId, triggerType, requestId)

  try {
    // Load workflow from database
    const workflow = await getWorkflowById(workflowId)
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`)
    }

    // Get workspace ID for the workflow
    const wfRows = await db
      .select({ workspaceId: workflowTable.workspaceId })
      .from(workflowTable)
      .where(eq(workflowTable.id, workflowId))
      .limit(1)
    const workspaceId = wfRows[0]?.workspaceId || undefined

<<<<<<< HEAD
    // Set workspace on workflow object for executeWorkflow function
    const workflowWithWorkspace = {
      ...workflow,
      workspaceId,
=======
    const { personalEncrypted, workspaceEncrypted } = await getPersonalAndWorkspaceEnv(
      payload.userId,
      workspaceId
    )
    const mergedEncrypted = { ...personalEncrypted, ...workspaceEncrypted }
    const decryptionPromises = Object.entries(mergedEncrypted).map(async ([key, encrypted]) => {
      const { decrypted } = await decryptSecret(encrypted)
      return [key, decrypted] as const
    })
    const decryptedPairs = await Promise.all(decryptionPromises)
    const decryptedEnvVars: Record<string, string> = Object.fromEntries(decryptedPairs)

    // Start logging session
    await loggingSession.safeStart({
      userId: payload.userId,
      workspaceId: workspaceId || '',
      variables: decryptedEnvVars,
    })

    // Filter out edges between trigger blocks - triggers are independent entry points
    const filteredEdges = filterEdgesFromTriggerBlocks(mergedStates, edges)

    // Create serialized workflow
    const serializer = new Serializer()
    const serializedWorkflow = serializer.serializeWorkflow(
      mergedStates,
      filteredEdges,
      loops || {},
      parallels || {},
      true // Enable validation during execution
    )

    // Create executor and execute
    const executor = new Executor({
      workflow: serializedWorkflow,
      currentBlockStates: processedBlockStates,
      envVarValues: decryptedEnvVars,
      workflowInput: payload.input || {},
      workflowVariables: {},
      contextExtensions: {
        executionId,
        workspaceId: workspaceId || '',
        isDeployedContext: true,
      },
    })

    // Set up logging on the executor
    loggingSession.setupExecutor(executor)

    const result = await executor.execute(workflowId)

    // Handle streaming vs regular result
    const executionResult = 'stream' in result && 'execution' in result ? result.execution : result

    logger.info(`[${requestId}] Workflow execution completed: ${workflowId}`, {
      success: executionResult.success,
      executionTime: executionResult.metadata?.duration,
      executionId,
    })

    // Update workflow run counts on success
    if (executionResult.success) {
      await updateWorkflowRunCounts(workflowId)
>>>>>>> origin/improvement/sim-294
    }

    // Use the unified executeWorkflow function (non-SSE for background jobs)
    const response = await executeWorkflow({
      requestId,
      workflowId,
      userId: payload.userId,
      workflow: workflowWithWorkspace,
      input: payload.input,
      triggerType: payload.triggerType || 'api',
      loggingSession,
      executionId,
      selectedOutputs: undefined,
    })

    // Extract JSON from NextResponse
    const result = await response.json()

    logger.info(`[${requestId}] Workflow execution completed: ${workflowId}`, {
      success: result.success,
      executionTime: result.metadata?.duration,
      executionId,
    })

    return {
      success: result.success,
      workflowId: payload.workflowId,
      executionId,
      output: result.output,
      executedAt: new Date().toISOString(),
      metadata: payload.metadata,
    }
  } catch (error: any) {
    logger.error(`[${requestId}] Workflow execution failed: ${workflowId}`, {
      error: error.message,
      executionId,
    })
    throw error
  }
}

// Trigger.dev task definition
export const workflowExecutionTask = task({
  id: 'workflow-execution',
  run: executeWorkflowJob,
})
