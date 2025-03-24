import { eq, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { userStats, workflow, workflowLogs } from '@/db/schema'
import { ExecutionResult as ExecutorResult } from '@/executor/types'

const logger = createLogger('ExecutionLogger')

export interface LogEntry {
  id: string
  workflowId: string
  executionId: string
  level: string
  message: string
  createdAt: Date
  duration?: string
  trigger?: string
  metadata?: ToolCallMetadata | Record<string, any>
}

// Define types for tool call tracking
export interface ToolCallMetadata {
  toolCalls?: ToolCall[]
  cost?: {
    model?: string
    input?: number
    output?: number
    total?: number
    tokens?: {
      prompt?: number
      completion?: number
      total?: number
    }
    pricing?: {
      input: number
      output: number
      cachedInput?: number
      updatedAt: string
    }
  }
}

export interface ToolCall {
  name: string
  duration: number // in milliseconds
  startTime: string // ISO timestamp
  endTime: string // ISO timestamp
  status: 'success' | 'error' // Status of the tool call
  input?: Record<string, any> // Input parameters (optional)
  output?: Record<string, any> // Output data (optional)
  error?: string // Error message if status is 'error'
}

export async function persistLog(log: LogEntry) {
  await db.insert(workflowLogs).values(log)
}

/**
 * Persists logs for a workflow execution, including individual block logs and the final result
 * @param workflowId - The ID of the workflow
 * @param executionId - The ID of the execution
 * @param result - The execution result
 * @param triggerType - The type of trigger (api, webhook, schedule, manual)
 */
export async function persistExecutionLogs(
  workflowId: string,
  executionId: string,
  result: ExecutorResult,
  triggerType: 'api' | 'webhook' | 'schedule' | 'manual'
) {
  try {
    // Get the workflow record to get the userId
    const [workflowRecord] = await db
      .select()
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)

    if (!workflowRecord) {
      logger.error(`Workflow ${workflowId} not found`)
      return
    }

    const userId = workflowRecord.userId

    // Track accumulated cost data across all agent blocks
    let totalCost = 0
    let totalInputCost = 0
    let totalOutputCost = 0
    let totalPromptTokens = 0
    let totalCompletionTokens = 0
    let totalTokens = 0
    let modelCounts: Record<string, number> = {}
    let primaryModel = ''

    // Log each execution step
    for (const log of result.logs || []) {
      // Check for agent block and tool calls
      let metadata: ToolCallMetadata | undefined = undefined

      logger.debug('block type', log.blockType)
      // If this is an agent block
      if (log.blockType === 'agent' && log.output) {
        logger.debug('Processing agent block output for tool calls', {
          blockId: log.blockId,
          blockName: log.blockName,
          outputKeys: Object.keys(log.output),
          hasToolCalls: !!log.output.toolCalls,
          hasResponse: !!log.output.response,
        })

        // Extract tool calls and other metadata
        if (log.output.response) {
          const response = log.output.response

          // Process tool calls
          if (response.toolCalls && response.toolCalls.list) {
            metadata = {
              toolCalls: response.toolCalls.list.map((tc: any) => ({
                name: tc.name,
                duration: tc.duration || 0,
                startTime: tc.startTime || new Date().toISOString(),
                endTime: tc.endTime || new Date().toISOString(),
                status: tc.error ? 'error' : 'success',
                input: tc.input || tc.arguments,
                output: tc.output || tc.result,
                error: tc.error,
              })),
            }
          }

          // Add cost information if available
          if (response.cost) {
            if (!metadata) metadata = {}
            metadata.cost = {
              model: response.model,
              input: response.cost.input,
              output: response.cost.output,
              total: response.cost.total,
              tokens: response.tokens,
              pricing: response.cost.pricing,
            }

            // Accumulate costs for workflow-level summary
            if (response.cost.total) {
              totalCost += response.cost.total
              totalInputCost += response.cost.input || 0
              totalOutputCost += response.cost.output || 0

              // Track tokens
              if (response.tokens) {
                totalPromptTokens += response.tokens.prompt || 0
                totalCompletionTokens += response.tokens.completion || 0
                totalTokens += response.tokens.total || 0
              }

              // Track model usage
              if (response.model) {
                modelCounts[response.model] = (modelCounts[response.model] || 0) + 1
                // Set the most frequently used model as primary
                if (!primaryModel || modelCounts[response.model] > modelCounts[primaryModel]) {
                  primaryModel = response.model
                }
              }
            }
          }
        }

        // Extract timing info - try various formats that providers might use
        const blockStartTime = log.startedAt
        const blockEndTime = log.endedAt || new Date().toISOString()
        const blockDuration = log.durationMs || 0
        let toolCallData: any[] = []

        // Case 1: Direct toolCalls array
        if (Array.isArray(log.output.toolCalls)) {
          logger.debug('Found direct toolCalls array', {
            count: log.output.toolCalls.length,
          })

          // Log raw timing data for debugging
          log.output.toolCalls.forEach((tc: any, idx: number) => {
            logger.debug(`Tool call ${idx} raw timing data:`, {
              name: tc.name,
              startTime: tc.startTime,
              endTime: tc.endTime,
              duration: tc.duration,
              timing: tc.timing,
              argumentKeys: tc.arguments ? Object.keys(tc.arguments) : undefined,
            })
          })

          toolCallData = log.output.toolCalls.map((toolCall: any) => {
            // Extract timing info - try various formats that providers might use
            const duration = extractDuration(toolCall)
            const timing = extractTimingInfo(
              toolCall,
              blockStartTime ? new Date(blockStartTime) : undefined,
              blockEndTime ? new Date(blockEndTime) : undefined
            )

            // Log what we extracted
            logger.debug(`Tool call timing extracted:`, {
              name: toolCall.name,
              extracted_duration: duration,
              extracted_startTime: timing.startTime,
              extracted_endTime: timing.endTime,
            })

            return {
              name: toolCall.name,
              duration: duration,
              startTime: timing.startTime,
              endTime: timing.endTime,
              status: toolCall.error ? 'error' : 'success',
              input: toolCall.input || toolCall.arguments,
              output: toolCall.output || toolCall.result,
              error: toolCall.error,
            }
          })
        }
        // Case 2: toolCalls with a list array (as seen in the screenshot)
        else if (log.output.toolCalls && Array.isArray(log.output.toolCalls.list)) {
          logger.debug('Found toolCalls with list array', {
            count: log.output.toolCalls.list.length,
          })

          // Log raw timing data for debugging
          log.output.toolCalls.list.forEach((tc: any, idx: number) => {
            logger.debug(`Tool call list ${idx} raw timing data:`, {
              name: tc.name,
              startTime: tc.startTime,
              endTime: tc.endTime,
              duration: tc.duration,
              timing: tc.timing,
              argumentKeys: tc.arguments ? Object.keys(tc.arguments) : undefined,
            })
          })

          toolCallData = log.output.toolCalls.list.map((toolCall: any) => {
            // Extract timing info - try various formats that providers might use
            const duration = extractDuration(toolCall)
            const timing = extractTimingInfo(
              toolCall,
              blockStartTime ? new Date(blockStartTime) : undefined,
              blockEndTime ? new Date(blockEndTime) : undefined
            )

            // Log what we extracted
            logger.debug(`Tool call list timing extracted:`, {
              name: toolCall.name,
              extracted_duration: duration,
              extracted_startTime: timing.startTime,
              extracted_endTime: timing.endTime,
            })

            return {
              name: toolCall.name,
              duration: duration,
              startTime: timing.startTime,
              endTime: timing.endTime,
              status: toolCall.error ? 'error' : 'success',
              input: toolCall.arguments || toolCall.input,
              output: toolCall.result || toolCall.output,
              error: toolCall.error,
            }
          })
        }
        // Case 3: Response has toolCalls
        else if (log.output.response && log.output.response.toolCalls) {
          const toolCalls = Array.isArray(log.output.response.toolCalls)
            ? log.output.response.toolCalls
            : log.output.response.toolCalls.list || []

          logger.debug('Found toolCalls in response', {
            count: toolCalls.length,
          })

          // Log raw timing data for debugging
          toolCalls.forEach((tc: any, idx: number) => {
            logger.debug(`Response tool call ${idx} raw timing data:`, {
              name: tc.name,
              startTime: tc.startTime,
              endTime: tc.endTime,
              duration: tc.duration,
              timing: tc.timing,
              argumentKeys: tc.arguments ? Object.keys(tc.arguments) : undefined,
            })
          })

          toolCallData = toolCalls.map((toolCall: any) => {
            // Extract timing info - try various formats that providers might use
            const duration = extractDuration(toolCall)
            const timing = extractTimingInfo(
              toolCall,
              blockStartTime ? new Date(blockStartTime) : undefined,
              blockEndTime ? new Date(blockEndTime) : undefined
            )

            // Log what we extracted
            logger.debug(`Response tool call timing extracted:`, {
              name: toolCall.name,
              extracted_duration: duration,
              extracted_startTime: timing.startTime,
              extracted_endTime: timing.endTime,
            })

            return {
              name: toolCall.name,
              duration: duration,
              startTime: timing.startTime,
              endTime: timing.endTime,
              status: toolCall.error ? 'error' : 'success',
              input: toolCall.arguments || toolCall.input,
              output: toolCall.result || toolCall.output,
              error: toolCall.error,
            }
          })
        }
        // Case 4: toolCalls is an object and has a list property
        else if (
          log.output.toolCalls &&
          typeof log.output.toolCalls === 'object' &&
          log.output.toolCalls.list
        ) {
          const toolCalls = log.output.toolCalls

          logger.debug('Found toolCalls object with list property', {
            count: toolCalls.list.length,
          })

          // Log raw timing data for debugging
          toolCalls.list.forEach((tc: any, idx: number) => {
            logger.debug(`toolCalls object list ${idx} raw timing data:`, {
              name: tc.name,
              startTime: tc.startTime,
              endTime: tc.endTime,
              duration: tc.duration,
              timing: tc.timing,
              argumentKeys: tc.arguments ? Object.keys(tc.arguments) : undefined,
            })
          })

          toolCallData = toolCalls.list.map((toolCall: any) => {
            // Extract timing info - try various formats that providers might use
            const duration = extractDuration(toolCall)
            const timing = extractTimingInfo(
              toolCall,
              blockStartTime ? new Date(blockStartTime) : undefined,
              blockEndTime ? new Date(blockEndTime) : undefined
            )

            // Log what we extracted
            logger.debug(`toolCalls object list timing extracted:`, {
              name: toolCall.name,
              extracted_duration: duration,
              extracted_startTime: timing.startTime,
              extracted_endTime: timing.endTime,
            })

            return {
              name: toolCall.name,
              duration: duration,
              startTime: timing.startTime,
              endTime: timing.endTime,
              status: toolCall.error ? 'error' : 'success',
              input: toolCall.arguments || toolCall.input,
              output: toolCall.result || toolCall.output,
              error: toolCall.error,
            }
          })
        }
        // Case 5: Parse the response string for toolCalls as a last resort
        else if (typeof log.output.response === 'string') {
          const match = log.output.response.match(/"toolCalls"\s*:\s*({[^}]*}|(\[.*?\]))/s)
          if (match) {
            try {
              const toolCallsJson = JSON.parse(`{${match[0]}}`)
              const list = Array.isArray(toolCallsJson.toolCalls)
                ? toolCallsJson.toolCalls
                : toolCallsJson.toolCalls.list || []

              logger.debug('Found toolCalls in parsed response string', {
                count: list.length,
              })

              // Log raw timing data for debugging
              list.forEach((tc: any, idx: number) => {
                logger.debug(`Parsed response ${idx} raw timing data:`, {
                  name: tc.name,
                  startTime: tc.startTime,
                  endTime: tc.endTime,
                  duration: tc.duration,
                  timing: tc.timing,
                  argumentKeys: tc.arguments ? Object.keys(tc.arguments) : undefined,
                })
              })

              toolCallData = list.map((toolCall: any) => {
                // Extract timing info - try various formats that providers might use
                const duration = extractDuration(toolCall)
                const timing = extractTimingInfo(
                  toolCall,
                  blockStartTime ? new Date(blockStartTime) : undefined,
                  blockEndTime ? new Date(blockEndTime) : undefined
                )

                // Log what we extracted
                logger.debug(`Parsed response timing extracted:`, {
                  name: toolCall.name,
                  extracted_duration: duration,
                  extracted_startTime: timing.startTime,
                  extracted_endTime: timing.endTime,
                })

                return {
                  name: toolCall.name,
                  duration: duration,
                  startTime: timing.startTime,
                  endTime: timing.endTime,
                  status: toolCall.error ? 'error' : 'success',
                  input: toolCall.arguments || toolCall.input,
                  output: toolCall.result || toolCall.output,
                  error: toolCall.error,
                }
              })
            } catch (error) {
              logger.error('Error parsing toolCalls from response string', {
                error,
                response: log.output.response,
              })
            }
          }
        }
        // Verbose output debugging as a fallback
        else {
          logger.debug('Could not find tool calls in standard formats, output data:', {
            outputSample: JSON.stringify(log.output).substring(0, 500) + '...',
          })
        }

        // Fill in missing timing information
        if (toolCallData.length > 0) {
          const estimatedToolCalls = estimateToolCallTimings(
            toolCallData,
            blockStartTime,
            blockEndTime,
            blockDuration
          )

          const redactedToolCalls = estimatedToolCalls.map((toolCall) => ({
            ...toolCall,
            input: redactApiKeys(toolCall.input),
          }))

          metadata = {
            toolCalls: redactedToolCalls,
          }

          logger.debug('Created metadata with tool calls', {
            count: redactedToolCalls.length,
          })
        }
      }

      await persistLog({
        id: uuidv4(),
        workflowId,
        executionId,
        level: log.success ? 'info' : 'error',
        message: log.success
          ? `Block ${log.blockName || log.blockId} (${log.blockType || 'unknown'}): ${JSON.stringify(log.output?.response || {})}`
          : `Block ${log.blockName || log.blockId} (${log.blockType || 'unknown'}): ${log.error || 'Failed'}`,
        duration: log.success ? `${log.durationMs}ms` : 'NA',
        trigger: triggerType,
        createdAt: new Date(log.endedAt || log.startedAt),
        metadata,
      })

      if (metadata) {
        logger.debug('Persisted log with metadata', {
          logId: uuidv4(),
          executionId,
          toolCallCount: metadata.toolCalls?.length || 0,
        })
      }
    }

    // Calculate total duration from successful block logs
    const totalDuration = (result.logs || [])
      .filter((log) => log.success)
      .reduce((sum, log) => sum + log.durationMs, 0)

    // Get trigger-specific message
    const successMessage = getTriggerSuccessMessage(triggerType)
    const errorPrefix = getTriggerErrorPrefix(triggerType)

    // Create workflow-level metadata with aggregated cost information
    const workflowMetadata: any = {
      traceSpans: (result as any).traceSpans || [],
      totalDuration: (result as any).totalDuration || totalDuration,
    }

    // Add accumulated cost data to workflow-level log
    if (totalCost > 0) {
      workflowMetadata.cost = {
        model: primaryModel,
        input: totalInputCost,
        output: totalOutputCost,
        total: totalCost,
        tokens: {
          prompt: totalPromptTokens,
          completion: totalCompletionTokens,
          total: totalTokens,
        },
      }

      // Include pricing info if we have a model
      if (primaryModel && result.logs && result.logs.length > 0) {
        // Find the first agent log with pricing info
        for (const log of result.logs) {
          if (log.output?.response?.cost?.pricing) {
            workflowMetadata.cost.pricing = log.output.response.cost.pricing
            break
          }
        }
      }

      if (userId) {
        try {
          const userStatsRecords = await db
            .select()
            .from(userStats)
            .where(eq(userStats.userId, userId))

          if (userStatsRecords.length === 0) {
            await db.insert(userStats).values({
              id: crypto.randomUUID(),
              userId: userId,
              totalManualExecutions: 0,
              totalApiCalls: 0,
              totalWebhookTriggers: 0,
              totalScheduledExecutions: 0,
              totalTokensUsed: totalTokens,
              totalCost: totalCost.toString(),
              lastActive: new Date(),
            })
          } else {
            await db
              .update(userStats)
              .set({
                totalTokensUsed: sql`total_tokens_used + ${totalTokens}`,
                totalCost: sql`total_cost + ${totalCost}`,
                lastActive: new Date(),
              })
              .where(eq(userStats.userId, userId))
          }
        } catch (error) {
          logger.error(`Error upserting user stats:`, error)
        }
      }
    }

    // Log the final execution result
    await persistLog({
      id: uuidv4(),
      workflowId,
      executionId,
      level: result.success ? 'info' : 'error',
      message: result.success ? successMessage : `${errorPrefix} execution failed: ${result.error}`,
      duration: result.success ? `${totalDuration}ms` : 'NA',
      trigger: triggerType,
      createdAt: new Date(),
      metadata: workflowMetadata,
    })
  } catch (error: any) {
    logger.error(`Error persisting execution logs: ${error.message}`, {
      error,
    })
  }
}

/**
 * Persists an error log for a workflow execution
 * @param workflowId - The ID of the workflow
 * @param executionId - The ID of the execution
 * @param error - The error that occurred
 * @param triggerType - The type of trigger (api, webhook, schedule, manual)
 */
export async function persistExecutionError(
  workflowId: string,
  executionId: string,
  error: Error,
  triggerType: 'api' | 'webhook' | 'schedule' | 'manual'
) {
  try {
    const errorPrefix = getTriggerErrorPrefix(triggerType)

    await persistLog({
      id: uuidv4(),
      workflowId,
      executionId,
      level: 'error',
      message: `${errorPrefix} execution failed: ${error.message}`,
      duration: 'NA',
      trigger: triggerType,
      createdAt: new Date(),
    })
  } catch (logError: any) {
    logger.error(`Error persisting execution error log: ${logError.message}`, {
      logError,
    })
  }
}

// Helper functions for trigger-specific messages
function getTriggerSuccessMessage(triggerType: 'api' | 'webhook' | 'schedule' | 'manual'): string {
  switch (triggerType) {
    case 'api':
      return 'API workflow executed successfully'
    case 'webhook':
      return 'Webhook workflow executed successfully'
    case 'schedule':
      return 'Scheduled workflow executed successfully'
    case 'manual':
      return 'Manual workflow executed successfully'
    default:
      return 'Workflow executed successfully'
  }
}

function getTriggerErrorPrefix(triggerType: 'api' | 'webhook' | 'schedule' | 'manual'): string {
  switch (triggerType) {
    case 'api':
      return 'API workflow'
    case 'webhook':
      return 'Webhook workflow'
    case 'schedule':
      return 'Scheduled workflow'
    case 'manual':
      return 'Manual workflow'
    default:
      return 'Workflow'
  }
}

/**
 * Extracts duration information for tool calls
 * This function preserves actual timing data while ensuring duration is calculated
 */
function estimateToolCallTimings(
  toolCalls: any[],
  blockStart: string,
  blockEnd: string,
  totalDuration: number
): any[] {
  if (!toolCalls || toolCalls.length === 0) return []

  logger.debug('Estimating tool call timings', {
    toolCallCount: toolCalls.length,
    blockStartTime: blockStart,
    blockEndTime: blockEnd,
    totalDuration,
  })

  // First, try to preserve any existing timing data
  const result = toolCalls.map((toolCall, index) => {
    // Start with the original tool call
    const enhancedToolCall = { ...toolCall }

    // If we don't have timing data, set it from the block timing info
    // Divide block duration evenly among tools as a fallback
    const toolDuration = totalDuration / toolCalls.length
    const toolStartOffset = index * toolDuration

    // Force a minimum duration of 1000ms if none exists
    if (!enhancedToolCall.duration || enhancedToolCall.duration === 0) {
      enhancedToolCall.duration = Math.max(1000, toolDuration)
      logger.debug(`Setting minimum duration for tool ${toolCall.name}`, {
        duration: enhancedToolCall.duration,
      })
    }

    // Force reasonable startTime and endTime if missing
    if (!enhancedToolCall.startTime) {
      const startTimestamp = new Date(blockStart).getTime() + toolStartOffset
      enhancedToolCall.startTime = new Date(startTimestamp).toISOString()
      logger.debug(`Setting startTime for tool ${toolCall.name}`, {
        startTime: enhancedToolCall.startTime,
      })
    }

    if (!enhancedToolCall.endTime) {
      const endTimestamp =
        new Date(enhancedToolCall.startTime).getTime() + enhancedToolCall.duration
      enhancedToolCall.endTime = new Date(endTimestamp).toISOString()
      logger.debug(`Setting endTime for tool ${toolCall.name}`, {
        endTime: enhancedToolCall.endTime,
      })
    }

    return enhancedToolCall
  })

  logger.debug('Finished estimating tool call timings', {
    originalTools: toolCalls.map((t) => ({
      name: t.name,
      hadDuration: !!t.duration,
      hadStartTime: !!t.startTime,
      hadEndTime: !!t.endTime,
    })),
    enhancedTools: result.map((t) => ({
      name: t.name,
      duration: t.duration,
      startTime: t.startTime,
      endTime: t.endTime,
    })),
  })

  return result
}

/**
 * Extracts the duration from a tool call object, trying various property formats
 * that different agent providers might use
 */
function extractDuration(toolCall: any): number {
  if (!toolCall) return 0

  // Direct duration fields (various formats providers might use)
  if (typeof toolCall.duration === 'number' && toolCall.duration > 0) return toolCall.duration
  if (typeof toolCall.durationMs === 'number' && toolCall.durationMs > 0) return toolCall.durationMs
  if (typeof toolCall.duration_ms === 'number' && toolCall.duration_ms > 0)
    return toolCall.duration_ms
  if (typeof toolCall.executionTime === 'number' && toolCall.executionTime > 0)
    return toolCall.executionTime
  if (typeof toolCall.execution_time === 'number' && toolCall.execution_time > 0)
    return toolCall.execution_time
  if (typeof toolCall.timing?.duration === 'number' && toolCall.timing.duration > 0)
    return toolCall.timing.duration

  // Try to calculate from timestamps if available
  if (toolCall.startTime && toolCall.endTime) {
    try {
      const start = new Date(toolCall.startTime).getTime()
      const end = new Date(toolCall.endTime).getTime()
      if (!isNaN(start) && !isNaN(end) && end >= start) {
        return end - start
      }
    } catch (e) {
      // Silently fail if date parsing fails
    }
  }

  // Also check for startedAt/endedAt format
  if (toolCall.startedAt && toolCall.endedAt) {
    try {
      const start = new Date(toolCall.startedAt).getTime()
      const end = new Date(toolCall.endedAt).getTime()
      if (!isNaN(start) && !isNaN(end) && end >= start) {
        return end - start
      }
    } catch (e) {
      // Silently fail if date parsing fails
    }
  }

  // For some providers, timing info might be in a separate object
  if (toolCall.timing) {
    if (toolCall.timing.startTime && toolCall.timing.endTime) {
      try {
        const start = new Date(toolCall.timing.startTime).getTime()
        const end = new Date(toolCall.timing.endTime).getTime()
        if (!isNaN(start) && !isNaN(end) && end >= start) {
          return end - start
        }
      } catch (e) {
        // Silently fail if date parsing fails
      }
    }
  }

  // No duration info found
  return 0
}

/**
 * Extract timing information from a tool call object
 * @param toolCall The tool call object
 * @param blockStartTime Optional block start time (for reference, not used as fallback anymore)
 * @param blockEndTime Optional block end time (for reference, not used as fallback anymore)
 * @returns Object with startTime and endTime properties
 */
function extractTimingInfo(
  toolCall: any,
  blockStartTime?: Date,
  blockEndTime?: Date
): { startTime?: Date; endTime?: Date } {
  logger.debug('Extracting timing info from tool call', {
    tool: toolCall.name,
    hasStartTime: !!toolCall.startTime,
    hasEndTime: !!toolCall.endTime,
    hasTiming: !!toolCall.timing,
    blockStartRef: blockStartTime?.toISOString(),
    blockEndRef: blockEndTime?.toISOString(),
  })

  let startTime: Date | undefined = undefined
  let endTime: Date | undefined = undefined

  // Try to get direct timing properties
  if (toolCall.startTime && isValidDate(toolCall.startTime)) {
    startTime = new Date(toolCall.startTime)
  } else if (toolCall.timing?.startTime && isValidDate(toolCall.timing.startTime)) {
    startTime = new Date(toolCall.timing.startTime)
  } else if (toolCall.timing?.start && isValidDate(toolCall.timing.start)) {
    startTime = new Date(toolCall.timing.start)
  } else if (toolCall.startedAt && isValidDate(toolCall.startedAt)) {
    startTime = new Date(toolCall.startedAt)
  }

  if (toolCall.endTime && isValidDate(toolCall.endTime)) {
    endTime = new Date(toolCall.endTime)
  } else if (toolCall.timing?.endTime && isValidDate(toolCall.timing.endTime)) {
    endTime = new Date(toolCall.timing.endTime)
  } else if (toolCall.timing?.end && isValidDate(toolCall.timing.end)) {
    endTime = new Date(toolCall.timing.end)
  } else if (toolCall.completedAt && isValidDate(toolCall.completedAt)) {
    endTime = new Date(toolCall.completedAt)
  }

  // If we have start time but no end time, calculate end time from duration
  if (startTime && !endTime) {
    const duration = extractDuration(toolCall)
    if (duration > 0) {
      endTime = new Date(startTime.getTime() + duration)
      logger.debug('Calculated end time from start time and duration', {
        tool: toolCall.name,
        startTime: startTime.toISOString(),
        duration,
        calculatedEndTime: endTime.toISOString(),
      })
    }
  }

  // Log the final timing information
  logger.debug('Final extracted timing info', {
    tool: toolCall.name,
    startTime: startTime?.toISOString(),
    endTime: endTime?.toISOString(),
    hasStartTime: !!startTime,
    hasEndTime: !!endTime,
  })

  return { startTime, endTime }
}

/**
 * Helper function to check if a string is a valid date
 */
function isValidDate(dateString: string): boolean {
  if (!dateString) return false

  try {
    const timestamp = Date.parse(dateString)
    return !isNaN(timestamp)
  } catch (e) {
    return false
  }
}

// Add this utility function for redacting API keys in tool call inputs
function redactApiKeys(obj: any): any {
  if (!obj || typeof obj !== 'object') {
    return obj
  }

  if (Array.isArray(obj)) {
    return obj.map(redactApiKeys)
  }

  const result: Record<string, any> = {}

  for (const [key, value] of Object.entries(obj)) {
    // Check if the key is 'apiKey' (case insensitive) or related keys
    if (
      key.toLowerCase() === 'apikey' ||
      key.toLowerCase() === 'api_key' ||
      key.toLowerCase() === 'access_token'
    ) {
      result[key] = '***REDACTED***'
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redactApiKeys(value)
    } else {
      result[key] = value
    }
  }

  return result
}
