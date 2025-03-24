import { NextRequest } from 'next/server'
import { eq, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console-logger'
import { persistExecutionError, persistExecutionLogs } from '@/lib/logs/execution-logger'
import { buildTraceSpans } from '@/lib/logs/trace-spans'
import { decryptSecret } from '@/lib/utils'
import { updateWorkflowRunCounts } from '@/lib/workflows/utils'
import { mergeSubblockState } from '@/stores/workflows/utils'
import { WorkflowState } from '@/stores/workflows/workflow/types'
import { db } from '@/db'
import { environment, userStats } from '@/db/schema'
import { Executor } from '@/executor'
import { Serializer } from '@/serializer'
import { validateWorkflowAccess } from '../../middleware'
import { createErrorResponse, createSuccessResponse } from '../../utils'

const logger = createLogger('WorkflowExecuteAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Define the schema for environment variables
const EnvVarsSchema = z.record(z.string())

// Keep track of running executions to prevent overlap
const runningExecutions = new Set<string>()

async function executeWorkflow(workflow: any, requestId: string, input?: any) {
  const workflowId = workflow.id
  const executionId = uuidv4()

  // Skip if this workflow is already running
  if (runningExecutions.has(workflowId)) {
    logger.warn(`[${requestId}] Workflow is already running: ${workflowId}`)
    throw new Error('Workflow is already running')
  }

  try {
    runningExecutions.add(workflowId)
    logger.info(`[${requestId}] Starting workflow execution: ${workflowId}`)

    // Get the workflow state
    const state = workflow.state as WorkflowState
    const { blocks, edges, loops } = state

    // Use the same execution flow as in scheduled executions
    const mergedStates = mergeSubblockState(blocks)

    // Retrieve environment variables for this user
    const [userEnv] = await db
      .select()
      .from(environment)
      .where(eq(environment.userId, workflow.userId))
      .limit(1)

    if (!userEnv) {
      logger.error(`[${requestId}] No environment variables found for user: ${workflow.userId}`)
      throw new Error('No environment variables found for this user')
    }

    // Parse and validate environment variables
    const variables = EnvVarsSchema.parse(userEnv.variables)

    // Replace environment variables in the block states
    const currentBlockStates = await Object.entries(mergedStates).reduce(
      async (accPromise, [id, block]) => {
        const acc = await accPromise
        acc[id] = await Object.entries(block.subBlocks).reduce(
          async (subAccPromise, [key, subBlock]) => {
            const subAcc = await subAccPromise
            let value = subBlock.value

            // If the value is a string and contains environment variable syntax
            if (typeof value === 'string' && value.includes('{{') && value.includes('}}')) {
              const matches = value.match(/{{([^}]+)}}/g)
              if (matches) {
                // Process all matches sequentially
                for (const match of matches) {
                  const varName = match.slice(2, -2) // Remove {{ and }}
                  const encryptedValue = variables[varName]
                  if (!encryptedValue) {
                    throw new Error(`Environment variable "${varName}" was not found`)
                  }

                  try {
                    const { decrypted } = await decryptSecret(encryptedValue)
                    value = (value as string).replace(match, decrypted)
                  } catch (error: any) {
                    logger.error(
                      `[${requestId}] Error decrypting environment variable "${varName}"`,
                      error
                    )
                    throw new Error(
                      `Failed to decrypt environment variable "${varName}": ${error.message}`
                    )
                  }
                }
              }
            }

            subAcc[key] = value
            return subAcc
          },
          Promise.resolve({} as Record<string, any>)
        )
        return acc
      },
      Promise.resolve({} as Record<string, Record<string, any>>)
    )

    // Create a map of decrypted environment variables
    const decryptedEnvVars: Record<string, string> = {}
    for (const [key, encryptedValue] of Object.entries(variables)) {
      try {
        const { decrypted } = await decryptSecret(encryptedValue)
        decryptedEnvVars[key] = decrypted
      } catch (error: any) {
        logger.error(`[${requestId}] Failed to decrypt environment variable "${key}"`, error)
        throw new Error(`Failed to decrypt environment variable "${key}": ${error.message}`)
      }
    }

    // Process the block states to ensure response formats are properly parsed
    const processedBlockStates = Object.entries(currentBlockStates).reduce(
      (acc, [blockId, blockState]) => {
        // Check if this block has a responseFormat that needs to be parsed
        if (blockState.responseFormat && typeof blockState.responseFormat === 'string') {
          try {
            logger.debug(`[${requestId}] Parsing responseFormat for block ${blockId}`)
            // Attempt to parse the responseFormat if it's a string
            const parsedResponseFormat = JSON.parse(blockState.responseFormat)

            acc[blockId] = {
              ...blockState,
              responseFormat: parsedResponseFormat,
            }
          } catch (error) {
            logger.warn(`[${requestId}] Failed to parse responseFormat for block ${blockId}`, error)
            acc[blockId] = blockState
          }
        } else {
          acc[blockId] = blockState
        }
        return acc
      },
      {} as Record<string, Record<string, any>>
    )

    // Serialize and execute the workflow
    logger.debug(`[${requestId}] Serializing workflow: ${workflowId}`)
    const serializedWorkflow = new Serializer().serializeWorkflow(mergedStates, edges, loops)

    const executor = new Executor(serializedWorkflow, processedBlockStates, decryptedEnvVars, input)
    const result = await executor.execute(workflowId)

    logger.info(`[${requestId}] Workflow execution completed: ${workflowId}`, {
      success: result.success,
      executionTime: result.metadata?.duration,
    })

    // Update workflow run counts if execution was successful
    if (result.success) {
      await updateWorkflowRunCounts(workflowId)

      // Track API call in user stats
      await db
        .update(userStats)
        .set({
          totalApiCalls: sql`total_api_calls + 1`,
          lastActive: new Date(),
        })
        .where(eq(userStats.userId, workflow.userId))
    }

    // Build trace spans from execution logs
    const { traceSpans, totalDuration } = buildTraceSpans(result)

    // Add trace spans to the execution result
    const enrichedResult = {
      ...result,
      traceSpans,
      totalDuration,
    }

    // Log each execution step and the final result
    await persistExecutionLogs(workflowId, executionId, enrichedResult, 'api')

    return result
  } catch (error: any) {
    logger.error(`[${requestId}] Workflow execution failed: ${workflowId}`, error)
    // Log the error
    await persistExecutionError(workflowId, executionId, error, 'api')
    throw error
  } finally {
    runningExecutions.delete(workflowId)
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const { id } = await params

  try {
    logger.debug(`[${requestId}] GET execution request for workflow: ${id}`)
    const validation = await validateWorkflowAccess(request, id)
    if (validation.error) {
      logger.warn(`[${requestId}] Workflow access validation failed: ${validation.error.message}`)
      return createErrorResponse(validation.error.message, validation.error.status)
    }

    const result = await executeWorkflow(validation.workflow, requestId)
    return createSuccessResponse(result)
  } catch (error: any) {
    logger.error(`[${requestId}] Error executing workflow: ${id}`, error)
    return createErrorResponse(
      error.message || 'Failed to execute workflow',
      500,
      'EXECUTION_ERROR'
    )
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const { id } = await params

  try {
    logger.debug(`[${requestId}] POST execution request for workflow: ${id}`)
    const validation = await validateWorkflowAccess(request, id)
    if (validation.error) {
      logger.warn(`[${requestId}] Workflow access validation failed: ${validation.error.message}`)
      return createErrorResponse(validation.error.message, validation.error.status)
    }

    const body = await request.json().catch(() => ({}))
    const result = await executeWorkflow(validation.workflow, requestId, body)
    return createSuccessResponse(result)
  } catch (error: any) {
    logger.error(`[${requestId}] Error executing workflow: ${id}`, error)
    return createErrorResponse(
      error.message || 'Failed to execute workflow',
      500,
      'EXECUTION_ERROR'
    )
  }
}
