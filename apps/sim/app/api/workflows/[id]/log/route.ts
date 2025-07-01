import type { NextRequest } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '@/lib/logs/console-logger'
import { enhancedExecutionLogger } from '@/lib/logs/enhanced-execution-logger'
import { persistExecutionLogs, persistLog } from '@/lib/logs/execution-logger'
import { validateWorkflowAccess } from '../../middleware'
import { createErrorResponse, createSuccessResponse } from '../../utils'

const logger = createLogger('WorkflowLogAPI')

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const { id } = await params

  try {
    const validation = await validateWorkflowAccess(request, id, false)
    if (validation.error) {
      logger.warn(`[${requestId}] Workflow access validation failed: ${validation.error.message}`)
      return createErrorResponse(validation.error.message, validation.error.status)
    }

    const body = await request.json()
    const { logs, executionId, result } = body

    // If result is provided, use persistExecutionLogs for full tool call extraction
    if (result) {
      logger.info(`[${requestId}] Persisting execution result for workflow: ${id}`, {
        executionId,
        success: result.success,
      })

      // Check if this execution is from chat using only the explicit source flag
      const isChatExecution = result.metadata?.source === 'chat'

      // Use persistExecutionLogs which handles tool call extraction
      // Use 'chat' trigger type for chat executions, otherwise 'manual'
      await persistExecutionLogs(id, executionId, result, isChatExecution ? 'chat' : 'manual')

      // Also log to enhanced system
      try {
        const trigger = {
          type: (isChatExecution ? 'chat' : 'manual') as const,
          source: isChatExecution ? 'chat' : 'manual',
          timestamp: new Date().toISOString(),
        }

        const environment = {
          variables: {},
          workflowId: id,
          executionId,
          userId: '', // TODO: Get from session
          workspaceId: '', // TODO: Get from workflow
        }

        // Create a basic workflow state - we don't have the full state here
        const workflowState = {
          blocks: {},
          edges: [],
          loops: {},
          parallels: {},
        }

        // Start enhanced logging
        await enhancedExecutionLogger.startWorkflowExecution({
          workflowId: id,
          executionId,
          trigger,
          environment,
          workflowState,
        })

        // Extract and log individual block executions from result.logs
        if (result.logs && Array.isArray(result.logs)) {
          for (const blockLog of result.logs) {
            try {
              // Extract cost data from block output
              let blockCost
              if (blockLog.output?.response?.cost) {
                const cost = blockLog.output.response.cost
                blockCost = {
                  input: Number(cost.input) || 0,
                  output: Number(cost.output) || 0,
                  total: Number(cost.total) || 0,
                  tokens: {
                    prompt: blockLog.output.response.tokens?.prompt || 0,
                    completion: blockLog.output.response.tokens?.completion || 0,
                    total: blockLog.output.response.tokens?.total || 0,
                  },
                  model: blockLog.output.response.model || '',
                  pricing: cost.pricing || {},
                }
              }

              await enhancedExecutionLogger.logBlockExecution({
                executionId,
                workflowId: id,
                blockId: blockLog.blockId,
                blockName: blockLog.blockName || '',
                blockType: blockLog.blockType || 'unknown',
                input: blockLog.input || {},
                output: blockLog.output || {},
                timing: {
                  startedAt: blockLog.startedAt,
                  endedAt: blockLog.endedAt || blockLog.startedAt,
                  durationMs: blockLog.durationMs || 0,
                },
                status: blockLog.success ? 'success' : 'error',
                error: blockLog.success
                  ? undefined
                  : {
                      message: blockLog.error || 'Block execution failed',
                      stackTrace: undefined,
                    },
                cost: blockCost,
                metadata: {
                  toolCalls: blockLog.toolCalls || [],
                },
              })
            } catch (blockLogError) {
              logger.error(
                `[${requestId}] Failed to log block execution ${blockLog.blockId}:`,
                blockLogError
              )
            }
          }
        }

        // Calculate stats from result
        const blockStats = {
          total: result.logs?.length || 0,
          success: result.logs?.filter((log) => log.success).length || 0,
          error: result.logs?.filter((log) => !log.success).length || 0,
          skipped: 0,
        }

        // Extract cost data from block logs
        const costSummary = {
          totalCost: 0,
          totalInputCost: 0,
          totalOutputCost: 0,
          totalTokens: 0,
          totalPromptTokens: 0,
          totalCompletionTokens: 0,
          models: new Map(), // Track individual model costs
        }

        // Aggregate costs from all blocks
        if (result.logs && Array.isArray(result.logs)) {
          for (const blockLog of result.logs) {
            if (blockLog.output?.response?.cost) {
              const cost = blockLog.output.response.cost
              const model = blockLog.output.response.model

              costSummary.totalCost += Number(cost.total) || 0
              costSummary.totalInputCost += Number(cost.input) || 0
              costSummary.totalOutputCost += Number(cost.output) || 0

              if (blockLog.output.response.tokens) {
                const tokens = blockLog.output.response.tokens
                costSummary.totalTokens += tokens.total || 0
                costSummary.totalPromptTokens += tokens.prompt || 0
                costSummary.totalCompletionTokens += tokens.completion || 0
              }

              // Track per-model costs
              if (model) {
                if (!costSummary.models.has(model)) {
                  costSummary.models.set(model, {
                    input: 0,
                    output: 0,
                    total: 0,
                    tokens: { prompt: 0, completion: 0, total: 0 },
                  })
                }
                const modelCost = costSummary.models.get(model)!
                modelCost.input += Number(cost.input) || 0
                modelCost.output += Number(cost.output) || 0
                modelCost.total += Number(cost.total) || 0
                if (blockLog.output.response.tokens) {
                  const tokens = blockLog.output.response.tokens
                  modelCost.tokens.prompt += tokens.prompt || 0
                  modelCost.tokens.completion += tokens.completion || 0
                  modelCost.tokens.total += tokens.total || 0
                }
              }
            }
          }
        }

        // Build trace spans from block logs for sidebar compatibility
        const traceSpans = (result.logs || []).map((blockLog: any, index: number) => {
          // For error cases, create an output object with error details
          let output = blockLog.output
          if (!blockLog.success && blockLog.error) {
            output = {
              error: blockLog.error,
              success: false,
              ...(blockLog.output || {}),
            }
          }

          return {
            id: blockLog.blockId,
            name: `Block ${blockLog.blockName || blockLog.blockType} (${blockLog.blockType || 'unknown'})`,
            type: blockLog.blockType || 'unknown',
            duration: blockLog.durationMs || 0,
            startTime: blockLog.startedAt,
            endTime: blockLog.endedAt || blockLog.startedAt,
            status: blockLog.success ? 'success' : 'error',
            blockId: blockLog.blockId,
            input: blockLog.input,
            output: output,
            tokens: blockLog.output?.response?.tokens?.total || 0,
            relativeStartMs: index * 100,
            children: [],
            toolCalls: blockLog.toolCalls || [],
          }
        })

        logger.debug(
          `[${requestId}] Built ${traceSpans.length} trace spans for execution ${executionId}:`,
          {
            traceSpans: traceSpans.map((span) => ({
              id: span.id,
              name: span.name,
              status: span.status,
              hasInput: !!span.input,
              hasOutput: !!span.output,
              input: span.input,
              output: span.output,
            })),
          }
        )

        await enhancedExecutionLogger.completeWorkflowExecution({
          executionId,
          endedAt: new Date().toISOString(),
          totalDurationMs: result.metadata?.duration || 0,
          blockStats,
          costSummary: {
            totalCost: costSummary.totalCost,
            totalInputCost: costSummary.totalInputCost,
            totalOutputCost: costSummary.totalOutputCost,
            totalTokens: costSummary.totalTokens,
            primaryModel: '', // No longer used
          },
          finalOutput: result.output || {},
          traceSpans,
        })

        logger.debug(`[${requestId}] Enhanced logging completed for execution ${executionId}`)
      } catch (enhancedError) {
        logger.error(`[${requestId}] Failed to create enhanced logs:`, enhancedError)
        // Continue with normal execution even if enhanced logging fails
      }

      return createSuccessResponse({
        message: 'Execution logs persisted successfully',
      })
    }

    // Fall back to the original log format if 'result' isn't provided
    if (!logs || !Array.isArray(logs) || logs.length === 0) {
      logger.warn(`[${requestId}] No logs provided for workflow: ${id}`)
      return createErrorResponse('No logs provided', 400)
    }

    logger.info(`[${requestId}] Persisting ${logs.length} logs for workflow: ${id}`, {
      executionId,
    })

    // Persist each log using the original method
    for (const log of logs) {
      await persistLog({
        id: uuidv4(),
        workflowId: id,
        executionId,
        level: log.level,
        message: log.message,
        duration: log.duration,
        trigger: log.trigger || 'manual',
        createdAt: new Date(log.createdAt || new Date()),
        metadata: log.metadata,
      })
    }

    return createSuccessResponse({ message: 'Logs persisted successfully' })
  } catch (error: any) {
    logger.error(`[${requestId}] Error persisting logs for workflow: ${id}`, error)
    return createErrorResponse(error.message || 'Failed to persist logs', 500)
  }
}
