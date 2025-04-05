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
  triggerType: 'api' | 'webhook' | 'schedule' | 'manual' | 'webhook-poll'
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

      logger.debug('Block type:', log.blockType)
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
  triggerType:
    | 'api'
    | 'webhook'
    | 'schedule'
    | 'manual'
    | 'webhook-poll'
    | 'webhook-generic'
    | 'webhook-setup'
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

/**
 * Helper function to get trigger-specific success message
 */
function getTriggerSuccessMessage(triggerType: string): string {
  switch (triggerType) {
    case 'api':
      return 'API execution completed successfully'
    case 'webhook':
    case 'webhook-poll':
      return 'Webhook execution completed successfully'
    case 'schedule':
      return 'Scheduled execution completed successfully'
    case 'manual':
      return 'Manual execution completed successfully'
    default:
      return 'Execution completed successfully'
  }
}

/**
 * Helper function to get trigger-specific error prefix
 */
function getTriggerErrorPrefix(triggerType: string): string {
  switch (triggerType) {
    case 'api':
      return 'API'
    case 'webhook':
    case 'webhook-poll':
    case 'webhook-generic':
    case 'webhook-setup':
      return 'Webhook'
    case 'schedule':
      return 'Scheduled'
    case 'manual':
      return 'Manual'
    default:
      return 'Execution'
  }
}

/**
 * Tries various ways to extract duration from tool call data
 */
function extractDuration(toolCall: any): number {
  // Check for `duration`, `duration_ms`, `timing.duration`
  if (typeof toolCall.duration === 'number') return toolCall.duration
  if (typeof toolCall.durationMs === 'number') return toolCall.durationMs
  if (typeof toolCall.duration_ms === 'number') return toolCall.duration_ms
  if (toolCall.timing && typeof toolCall.timing.duration === 'number') {
    return toolCall.timing.duration
  }

  // Calculate from startTime and endTime if possible
  try {
    const start = toolCall.startTime || toolCall.timing?.startTime
    const end = toolCall.endTime || toolCall.timing?.endTime
    if (start && end) {
      const startTime = new Date(start)
      const endTime = new Date(end)
      if (!isNaN(startTime.getTime()) && !isNaN(endTime.getTime())) {
        return endTime.getTime() - startTime.getTime()
      }
    }
  } catch (e) {
    /* Ignore parsing errors */
  }

  return 0 // Default to 0 if no duration found
}

/**
 * Tries various ways to extract startTime and endTime from tool call data
 */
function extractTimingInfo(
  toolCall: any,
  defaultStartTime?: Date,
  defaultEndTime?: Date
): { startTime: string; endTime: string } {
  let startTime = defaultStartTime ? defaultStartTime.toISOString() : new Date().toISOString()
  let endTime = defaultEndTime ? defaultEndTime.toISOString() : new Date().toISOString()

  try {
    const start = toolCall.startTime || toolCall.timing?.startTime
    const end = toolCall.endTime || toolCall.timing?.endTime

    if (start && !isNaN(new Date(start).getTime())) {
      startTime = new Date(start).toISOString()
    }

    if (end && !isNaN(new Date(end).getTime())) {
      endTime = new Date(end).toISOString()
    } else if (start && toolCall.duration && typeof toolCall.duration === 'number') {
      // Calculate end time from start and duration
      const startMs = new Date(start).getTime()
      if (!isNaN(startMs)) {
        endTime = new Date(startMs + toolCall.duration).toISOString()
      }
    }
  } catch (e) {
    logger.warn('Error parsing timing info from tool call', {
      error: e,
      toolCallName: toolCall.name,
    })
  }

  return { startTime, endTime }
}

/**
 * Estimates missing start and end times for sequential tool calls within a block.
 */
function estimateToolCallTimings(
  toolCalls: ToolCall[],
  blockStartTimeStr: string | null | undefined,
  blockEndTimeStr: string | null | undefined,
  blockDurationMs: number
): ToolCall[] {
  // Ensure valid block start and end times
  const blockStartTime = blockStartTimeStr ? new Date(blockStartTimeStr) : null
  const blockEndTime = blockEndTimeStr ? new Date(blockEndTimeStr) : null
  const validBlockStart =
    blockStartTime && !isNaN(blockStartTime.getTime()) ? blockStartTime.getTime() : null
  const validBlockEnd =
    blockEndTime && !isNaN(blockEndTime.getTime()) ? blockEndTime.getTime() : null

  if (!validBlockStart || !validBlockEnd) {
    logger.warn('Cannot estimate tool call timings: Invalid block start/end time.')
    return toolCalls // Return original if block times are invalid
  }

  let currentTime = validBlockStart
  const estimatedCalls: ToolCall[] = []

  for (const call of toolCalls) {
    const duration = call.duration || 0 // Ensure duration is a number
    const startTime = new Date(currentTime).toISOString()
    const endTime = new Date(currentTime + duration).toISOString()

    estimatedCalls.push({
      ...call,
      startTime,
      endTime,
    })

    currentTime += duration // Move current time forward
  }

  // Optional: Distribute any remaining time if the sum of durations is less than block duration
  // (This is complex and might not be accurate, skipping for now)

  return estimatedCalls
}

/**
 * Redacts potential API keys from tool call inputs.
 */
function redactApiKeys(input: any): any {
  if (!input || typeof input !== 'object') {
    return input
  }

  const redactedInput = JSON.parse(JSON.stringify(input)) // Deep clone
  const apiKeyPatterns = [
    /(sk-[a-zA-Z0-9]{20}T3BlbkFJ[a-zA-Z0-9]{20})/, // OpenAI style
    /([a-zA-Z0-9_-]{30,})/, // General long alphanumeric strings (potential keys)
    /(key|token|secret)/i, // Keys containing common keywords
  ]

  function traverseAndRedact(obj: any) {
    for (const key in obj) {
      if (typeof obj[key] === 'string') {
        apiKeyPatterns.forEach((pattern) => {
          if (pattern.test(obj[key])) {
            // Check if the key itself suggests it's an API key
            if (/(key|token|secret|password|credential)/i.test(key)) {
              obj[key] = '[REDACTED]'
            }
            // Simple length check as a fallback
            else if (obj[key].length > 20) {
              obj[key] = '[REDACTED]'
            }
          }
        })
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        traverseAndRedact(obj[key])
      }
    }
  }

  traverseAndRedact(redactedInput)
  return redactedInput
}
