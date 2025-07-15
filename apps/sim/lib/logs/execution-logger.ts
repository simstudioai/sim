import { eq, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { getCostMultiplier } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console-logger'
import { redactApiKeys } from '@/lib/utils'
import { stripCustomToolPrefix } from '@/lib/workflows/utils'
import { db } from '@/db'
import { userStats, workflow, workflowLogs } from '@/db/schema'
import type { ExecutionResult as ExecutorResult } from '@/executor/types'
import { calculateCost } from '@/providers/utils'

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
 * @param triggerType - The type of trigger (api, webhook, schedule, manual, chat)
 */
export async function persistExecutionLogs(
  workflowId: string,
  executionId: string,
  result: ExecutorResult,
  triggerType: 'api' | 'webhook' | 'schedule' | 'manual' | 'chat'
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

    // Track accumulated cost data across all LLM blocks (agent, router, and evaluator)
    let totalCost = 0
    let totalInputCost = 0
    let totalOutputCost = 0
    let totalPromptTokens = 0
    let totalCompletionTokens = 0
    let totalTokens = 0
    const modelCounts: Record<string, number> = {}
    let primaryModel = ''

    // Log each execution step
    for (const log of result.logs || []) {
      // Check for agent block and tool calls
      let metadata: ToolCallMetadata | undefined

      // If this is an agent, router, or evaluator block (all use LLM providers and generate costs)
      if (
        (log.blockType === 'agent' ||
          log.blockType === 'router' ||
          log.blockType === 'evaluator') &&
        log.output
      ) {
        logger.debug('Processing LLM-based block output for tool calls and cost tracking', {
          blockId: log.blockId,
          blockName: log.blockName,
          blockType: log.blockType,
          outputKeys: Object.keys(log.output),
          hasToolCalls: !!log.output.toolCalls,
          hasResponse: !!log.output,
        })

        // FIRST PASS - Check if this is a no-tool scenario with tokens data not propagated
        // In some cases, the token data from the streaming callback doesn't properly get into
        // the agent block response. This ensures we capture it.
        if (
          log.output &&
          (!log.output.tokens?.completion || log.output.tokens.completion === 0) &&
          (!log.output.toolCalls ||
            !log.output.toolCalls.list ||
            log.output.toolCalls.list.length === 0)
        ) {
          // Check if output has providerTiming - this indicates it's a streaming response
          if (log.output.providerTiming) {
            logger.debug('Processing streaming response without tool calls for token extraction', {
              blockId: log.blockId,
              hasTokens: !!log.output.tokens,
              hasProviderTiming: !!log.output.providerTiming,
            })

            // Only for no-tool streaming cases, extract content length and estimate token count
            const contentLength = log.output.content?.length || 0
            if (contentLength > 0) {
              // Estimate completion tokens based on content length as a fallback
              const estimatedCompletionTokens = Math.ceil(contentLength / 4)
              const promptTokens = log.output.tokens?.prompt || 8

              // Update the tokens object
              log.output.tokens = {
                prompt: promptTokens,
                completion: estimatedCompletionTokens,
                total: promptTokens + estimatedCompletionTokens,
              }

              // Update cost information using the provider's cost model
              const model = log.output.model || 'gpt-4o'
              const costInfo = calculateCost(model, promptTokens, estimatedCompletionTokens)
              log.output.cost = {
                input: costInfo.input,
                output: costInfo.output,
                total: costInfo.total,
                pricing: costInfo.pricing,
              }

              logger.debug('Updated token information for streaming no-tool response', {
                blockId: log.blockId,
                contentLength,
                estimatedCompletionTokens,
                tokens: log.output.tokens,
              })
            }
          }
        }

        // Special case for streaming responses from LLM blocks (agent, router, and evaluator)
        // This format has both stream and executionData properties
        if (log.output.stream && log.output.executionData) {
          logger.debug('Found streaming response with executionData', {
            blockId: log.blockId,
            hasExecutionData: !!log.output.executionData,
            executionDataKeys: log.output.executionData
              ? Object.keys(log.output.executionData)
              : [],
          })

          // Extract the executionData and use it as our primary source of information
          const executionData = log.output.executionData

          // If executionData has output, merge it with our output
          // This is especially important for streaming responses where the final content
          // is set in the executionData structure by the executor
          if (executionData.output) {
            log.output = { ...log.output, ...executionData.output }
            logger.debug('Using output from executionData', {
              outputKeys: Object.keys(log.output),
              hasContent: !!log.output.content,
              contentLength: log.output.content?.length || 0,
              hasToolCalls: !!log.output.toolCalls,
              hasTokens: !!log.output.tokens,
              hasCost: !!log.output.cost,
            })
          }
        }

        // Add cost information if available
        if (log.output?.cost) {
          const output = log.output
          if (!metadata) metadata = {}
          metadata.cost = {
            model: output.model,
            input: output.cost.input,
            output: output.cost.output,
            total: output.cost.total,
            tokens: output.tokens,
            pricing: output.cost.pricing,
          }

          // Accumulate costs for workflow-level summary
          if (output.cost.total) {
            totalCost += output.cost.total
            totalInputCost += output.cost.input || 0
            totalOutputCost += output.cost.output || 0

            // Track tokens
            if (output.tokens) {
              totalPromptTokens += output.tokens.prompt || 0
              totalCompletionTokens += output.tokens.completion || 0
              totalTokens += output.tokens.total || 0
            }

            // Track model usage
            if (output.model) {
              modelCounts[output.model] = (modelCounts[output.model] || 0) + 1
              // Set the most frequently used model as primary
              if (!primaryModel || modelCounts[output.model] > modelCounts[primaryModel]) {
                primaryModel = output.model
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
          // Log raw timing data for debugging
          log.output.toolCalls.forEach((tc: any, idx: number) => {
            logger.debug(`Tool call ${idx} raw timing data:`, {
              name: stripCustomToolPrefix(tc.name),
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
          // Log raw timing data for debugging
          log.output.toolCalls.list.forEach((tc: any, idx: number) => {
            logger.debug(`Tool call list ${idx} raw timing data:`, {
              name: stripCustomToolPrefix(tc.name),
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
            logger.debug('Tool call list timing extracted:', {
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
        // Case 3: toolCalls is an object and has a list property
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
              name: stripCustomToolPrefix(tc.name),
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
            logger.debug('toolCalls object list timing extracted:', {
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
        // Case 4: Look in executionData.output for streaming responses
        else if (log.output.executionData?.output?.toolCalls) {
          const toolCallsObj = log.output.executionData.output.toolCalls
          const list = Array.isArray(toolCallsObj) ? toolCallsObj : toolCallsObj.list || []

          logger.debug('Found toolCalls in executionData output response', {
            count: list.length,
          })

          // Log raw timing data for debugging
          list.forEach((tc: any, idx: number) => {
            logger.debug(`executionData toolCalls ${idx} raw timing data:`, {
              name: stripCustomToolPrefix(tc.name),
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
        // Case 5: Parse the output string for toolCalls as a last resort
        else if (typeof log.output === 'string') {
          const match = log.output.match(/"toolCalls"\s*:\s*({[^}]*}|(\[.*?\]))/s)
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
                  name: stripCustomToolPrefix(tc.name),
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
                logger.debug('Parsed response timing extracted:', {
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
              logger.error('Error parsing toolCalls from output string', {
                error,
                output: log.output,
              })
            }
          }
        }
        // Verbose output debugging as a fallback
        else {
          logger.debug('Could not find tool calls in standard formats, output data:', {
            outputSample: `${JSON.stringify(log.output).substring(0, 500)}...`,
          })
        }

        // Fill in missing timing information and merge with existing metadata
        if (toolCallData.length > 0) {
          const getToolCalls = getToolCallTimings(
            toolCallData,
            blockStartTime,
            blockEndTime,
            blockDuration
          )

          const redactedToolCalls = getToolCalls.map((toolCall) => ({
            ...toolCall,
            input: redactApiKeys(toolCall.input),
          }))

          // Merge with existing metadata instead of overwriting
          if (!metadata) metadata = {}
          metadata.toolCalls = redactedToolCalls

          logger.debug('Added tool calls to metadata', {
            count: redactedToolCalls.length,
            existingMetadata: Object.keys(metadata).filter((k) => k !== 'toolCalls'),
          })
        }
      }

      await persistLog({
        id: uuidv4(),
        workflowId,
        executionId,
        level: log.success ? 'info' : 'error',
        message: log.success
          ? `Block ${log.blockName || log.blockId} (${log.blockType || 'unknown'}): ${
              log.output?.content ||
              log.output?.executionData?.output?.content ||
              JSON.stringify(log.output || {})
            }`
          : `Block ${log.blockName || log.blockId} (${log.blockType || 'unknown'}): ${log.error || 'Failed'}`,
        duration: log.success ? `${log.durationMs}ms` : 'NA',
        trigger: triggerType,
        createdAt: new Date(log.endedAt || log.startedAt),
        metadata: {
          ...metadata,
          ...(log.input ? { blockInput: log.input } : {}),
        },
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

    // For parallel execution, calculate the actual duration from start to end times
    let actualDuration = totalDuration
    if (result.metadata?.startTime && result.metadata?.endTime) {
      const startTime = result.metadata.startTime
        ? new Date(result.metadata.startTime).getTime()
        : 0
      const endTime = new Date(result.metadata.endTime).getTime()
      actualDuration = endTime - startTime
    }

    // Get trigger-specific message
    const successMessage = getTriggerSuccessMessage(triggerType)
    const errorPrefix = getTriggerErrorPrefix(triggerType)

    // Create workflow-level metadata with aggregated cost information
    const workflowMetadata: any = {
      traceSpans: (result as any).traceSpans || [],
      totalDuration: (result as any).totalDuration || actualDuration,
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
          if (log.output?.cost?.pricing) {
            workflowMetadata.cost.pricing = log.output.cost.pricing
            break
          }
        }
      }

      // If result has a direct cost field (for streaming responses completed with calculated cost),
      // use that as a safety check to ensure we have cost data
      if (
        result.metadata &&
        'cost' in result.metadata &&
        (!workflowMetadata.cost || workflowMetadata.cost.total <= 0)
      ) {
        const resultCost = (result.metadata as any).cost
        workflowMetadata.cost = {
          model: primaryModel,
          total: typeof resultCost === 'number' ? resultCost : resultCost?.total || 0,
          input: resultCost?.input || 0,
          output: resultCost?.output || 0,
          tokens: {
            prompt: totalPromptTokens,
            completion: totalCompletionTokens,
            total: totalTokens,
          },
        }
      }

      if (userId) {
        try {
          const userStatsRecords = await db
            .select()
            .from(userStats)
            .where(eq(userStats.userId, userId))

          const costMultiplier = getCostMultiplier()
          const costToStore = totalCost * costMultiplier

          if (userStatsRecords.length === 0) {
            await db.insert(userStats).values({
              id: crypto.randomUUID(),
              userId: userId,
              totalManualExecutions: 0,
              totalApiCalls: 0,
              totalWebhookTriggers: 0,
              totalScheduledExecutions: 0,
              totalChatExecutions: 0,
              totalTokensUsed: totalTokens,
              totalCost: costToStore.toString(),
              currentPeriodCost: costToStore.toString(), // Initialize current period usage
              lastActive: new Date(),
            })
          } else {
            await db
              .update(userStats)
              .set({
                totalTokensUsed: sql`total_tokens_used + ${totalTokens}`,
                totalCost: sql`total_cost + ${costToStore}`,
                currentPeriodCost: sql`current_period_cost + ${costToStore}`, // Track current billing period usage
                lastActive: new Date(),
              })
              .where(eq(userStats.userId, userId))
          }
        } catch (error) {
          logger.error('Error upserting user stats:', error)
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
      duration: result.success ? `${actualDuration}ms` : 'NA',
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
 * @param triggerType - The type of trigger (api, webhook, schedule, manual, chat)
 */
export async function persistExecutionError(
  workflowId: string,
  executionId: string,
  error: Error,
  triggerType: 'api' | 'webhook' | 'schedule' | 'manual' | 'chat'
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
function getTriggerSuccessMessage(
  triggerType: 'api' | 'webhook' | 'schedule' | 'manual' | 'chat'
): string {
  switch (triggerType) {
    case 'api':
      return 'API workflow executed successfully'
    case 'webhook':
      return 'Webhook workflow executed successfully'
    case 'schedule':
      return 'Scheduled workflow executed successfully'
    case 'manual':
      return 'Manual workflow executed successfully'
    case 'chat':
      return 'Chat workflow executed successfully'
    default:
      return 'Workflow executed successfully'
  }
}

function getTriggerErrorPrefix(
  triggerType: 'api' | 'webhook' | 'schedule' | 'manual' | 'chat'
): string {
  switch (triggerType) {
    case 'api':
      return 'API workflow'
    case 'webhook':
      return 'Webhook workflow'
    case 'schedule':
      return 'Scheduled workflow'
    case 'manual':
      return 'Manual workflow'
    case 'chat':
      return 'Chat workflow'
    default:
      return 'Workflow'
  }
}

/**
 * Extracts duration information for tool calls
 * This function preserves actual timing data while ensuring duration is calculated
 */
function getToolCallTimings(
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
    }

    // Force reasonable startTime and endTime if missing
    if (!enhancedToolCall.startTime) {
      const startTimestamp = new Date(blockStart).getTime() + toolStartOffset
      enhancedToolCall.startTime = new Date(startTimestamp).toISOString()
    }

    if (!enhancedToolCall.endTime) {
      const endTimestamp =
        new Date(enhancedToolCall.startTime).getTime() + enhancedToolCall.duration
      enhancedToolCall.endTime = new Date(endTimestamp).toISOString()
    }

    return enhancedToolCall
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
      if (!Number.isNaN(start) && !Number.isNaN(end) && end >= start) {
        return end - start
      }
    } catch (_e) {
      // Silently fail if date parsing fails
    }
  }

  // Also check for startedAt/endedAt format
  if (toolCall.startedAt && toolCall.endedAt) {
    try {
      const start = new Date(toolCall.startedAt).getTime()
      const end = new Date(toolCall.endedAt).getTime()
      if (!Number.isNaN(start) && !Number.isNaN(end) && end >= start) {
        return end - start
      }
    } catch (_e) {
      // Silently fail if date parsing fails
    }
  }

  // For some providers, timing info might be in a separate object
  if (toolCall.timing) {
    if (toolCall.timing.startTime && toolCall.timing.endTime) {
      try {
        const start = new Date(toolCall.timing.startTime).getTime()
        const end = new Date(toolCall.timing.endTime).getTime()
        if (!Number.isNaN(start) && !Number.isNaN(end) && end >= start) {
          return end - start
        }
      } catch (_e) {
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
  let startTime: Date | undefined
  let endTime: Date | undefined

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

  if (startTime && !endTime) {
    const duration = extractDuration(toolCall)
    if (duration > 0) {
      endTime = new Date(startTime.getTime() + duration)
    }
  }

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
    return !Number.isNaN(timestamp)
  } catch (_e) {
    return false
  }
}
