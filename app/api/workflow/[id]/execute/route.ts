import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { persistExecutionError, persistExecutionLogs } from '@/lib/logging'
import { decryptSecret } from '@/lib/utils'
import { mergeSubblockState } from '@/stores/workflows/utils'
import { WorkflowState } from '@/stores/workflows/workflow/types'
import { db } from '@/db'
import { environment } from '@/db/schema'
import { Executor } from '@/executor'
import { Serializer } from '@/serializer'
import { validateWorkflowAccess } from '../../middleware'
import { createErrorResponse, createSuccessResponse } from '../../utils'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Define the schema for environment variables
const EnvVarsSchema = z.record(z.string())

// Keep track of running executions to prevent overlap
const runningExecutions = new Set<string>()

async function executeWorkflow(workflow: any, input?: any) {
  const workflowId = workflow.id
  const executionId = uuidv4()

  // Skip if this workflow is already running
  if (runningExecutions.has(workflowId)) {
    throw new Error('Workflow is already running')
  }

  try {
    runningExecutions.add(workflowId)

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
                    console.error('Error decrypting value:', error)
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
        console.error(`Failed to decrypt ${key}:`, error)
        throw new Error(`Failed to decrypt environment variable "${key}": ${error.message}`)
      }
    }

    // Process the block states to ensure response formats are properly parsed
    // This is crucial for agent blocks with response format
    const processedBlockStates = Object.entries(currentBlockStates).reduce(
      (acc, [blockId, blockState]) => {
        // Check if this block has a responseFormat that needs to be parsed
        if (blockState.responseFormat && typeof blockState.responseFormat === 'string') {
          try {
            console.log(
              `[API Debug] Block ${blockId} has responseFormat as string:`,
              blockState.responseFormat
            )
            // Attempt to parse the responseFormat if it's a string
            const parsedResponseFormat = JSON.parse(blockState.responseFormat)
            console.log(
              `[API Debug] Successfully parsed responseFormat for block ${blockId}:`,
              parsedResponseFormat
            )

            acc[blockId] = {
              ...blockState,
              responseFormat: parsedResponseFormat,
            }
          } catch (error) {
            console.warn(`Failed to parse responseFormat for block ${blockId}:`, error)
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
    const serializedWorkflow = new Serializer().serializeWorkflow(mergedStates, edges, loops)
    const executor = new Executor(serializedWorkflow, processedBlockStates, decryptedEnvVars, input)
    const result = await executor.execute(workflowId)

    // Log each execution step and the final result
    await persistExecutionLogs(workflowId, executionId, result, 'api')

    return result
  } catch (error: any) {
    // Log the error
    await persistExecutionError(workflowId, executionId, error, 'api')
    throw error
  } finally {
    runningExecutions.delete(workflowId)
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  try {
    const validation = await validateWorkflowAccess(request, id)
    if (validation.error) {
      return createErrorResponse(validation.error.message, validation.error.status)
    }

    const result = await executeWorkflow(validation.workflow)
    return createSuccessResponse(result)
  } catch (error: any) {
    console.error('Error executing workflow:', error)
    return createErrorResponse(
      error.message || 'Failed to execute workflow',
      500,
      'EXECUTION_ERROR'
    )
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  try {
    const validation = await validateWorkflowAccess(request, id)
    if (validation.error) {
      return createErrorResponse(validation.error.message, validation.error.status)
    }

    const body = await request.json().catch(() => ({}))
    const result = await executeWorkflow(validation.workflow, body)
    return createSuccessResponse(result)
  } catch (error: any) {
    console.error('Error executing workflow:', error)
    return createErrorResponse(
      error.message || 'Failed to execute workflow',
      500,
      'EXECUTION_ERROR'
    )
  }
}
