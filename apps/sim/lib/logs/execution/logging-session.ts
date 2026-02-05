import { db } from '@sim/db'
import { workflowExecutionLogs } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq, sql } from 'drizzle-orm'
import { BASE_EXECUTION_CHARGE } from '@/lib/billing/constants'
import { executionLogger } from '@/lib/logs/execution/logger'
import {
  calculateCostSummary,
  createEnvironmentObject,
  createTriggerObject,
  loadDeployedWorkflowStateForLogging,
  loadWorkflowStateForExecution,
} from '@/lib/logs/execution/logging-factory'
import type {
  ExecutionEnvironment,
  ExecutionTrigger,
  TraceSpan,
  WorkflowState,
} from '@/lib/logs/types'

const logger = createLogger('LoggingSession')

export interface SessionStartParams {
  userId?: string
  workspaceId: string
  variables?: Record<string, string>
  triggerData?: Record<string, unknown>
  skipLogCreation?: boolean // For resume executions - reuse existing log entry
  deploymentVersionId?: string // ID of the deployment version used (null for manual/editor executions)
}

export interface SessionCompleteParams {
  endedAt?: string
  totalDurationMs?: number
  finalOutput?: any
  traceSpans?: TraceSpan[]
  workflowInput?: any
}

export interface SessionErrorCompleteParams {
  endedAt?: string
  totalDurationMs?: number
  error?: {
    message?: string
    stackTrace?: string
  }
  traceSpans?: TraceSpan[]
  skipCost?: boolean
}

export interface SessionCancelledParams {
  endedAt?: string
  totalDurationMs?: number
  traceSpans?: TraceSpan[]
}

export interface SessionPausedParams {
  endedAt?: string
  totalDurationMs?: number
  traceSpans?: TraceSpan[]
  workflowInput?: any
}

interface AccumulatedCost {
  total: number
  input: number
  output: number
  tokens: { input: number; output: number; total: number }
  models: Record<
    string,
    {
      input: number
      output: number
      total: number
      tokens: { input: number; output: number; total: number }
    }
  >
}

export class LoggingSession {
  private workflowId: string
  private executionId: string
  private triggerType: ExecutionTrigger['type']
  private requestId?: string
  private trigger?: ExecutionTrigger
  private environment?: ExecutionEnvironment
  private workflowState?: WorkflowState
  private isResume = false
  private completed = false
  private accumulatedCost: AccumulatedCost = {
    total: BASE_EXECUTION_CHARGE,
    input: 0,
    output: 0,
    tokens: { input: 0, output: 0, total: 0 },
    models: {},
  }
  private costFlushed = false

  constructor(
    workflowId: string,
    executionId: string,
    triggerType: ExecutionTrigger['type'],
    requestId?: string
  ) {
    this.workflowId = workflowId
    this.executionId = executionId
    this.triggerType = triggerType
    this.requestId = requestId
  }

  async onBlockComplete(
    blockId: string,
    blockName: string,
    blockType: string,
    output: any
  ): Promise<void> {
    if (!output?.cost || typeof output.cost.total !== 'number' || output.cost.total <= 0) {
      return
    }

    const { cost, tokens, model } = output

    this.accumulatedCost.total += cost.total || 0
    this.accumulatedCost.input += cost.input || 0
    this.accumulatedCost.output += cost.output || 0

    if (tokens) {
      this.accumulatedCost.tokens.input += tokens.input || 0
      this.accumulatedCost.tokens.output += tokens.output || 0
      this.accumulatedCost.tokens.total += tokens.total || 0
    }

    if (model) {
      if (!this.accumulatedCost.models[model]) {
        this.accumulatedCost.models[model] = {
          input: 0,
          output: 0,
          total: 0,
          tokens: { input: 0, output: 0, total: 0 },
        }
      }
      this.accumulatedCost.models[model].input += cost.input || 0
      this.accumulatedCost.models[model].output += cost.output || 0
      this.accumulatedCost.models[model].total += cost.total || 0
      if (tokens) {
        this.accumulatedCost.models[model].tokens.input += tokens.input || 0
        this.accumulatedCost.models[model].tokens.output += tokens.output || 0
        this.accumulatedCost.models[model].tokens.total += tokens.total || 0
      }
    }

    await this.flushAccumulatedCost()
  }

  private async flushAccumulatedCost(): Promise<void> {
    try {
      await db
        .update(workflowExecutionLogs)
        .set({
          cost: {
            total: this.accumulatedCost.total,
            input: this.accumulatedCost.input,
            output: this.accumulatedCost.output,
            tokens: this.accumulatedCost.tokens,
            models: this.accumulatedCost.models,
          },
        })
        .where(eq(workflowExecutionLogs.executionId, this.executionId))

      this.costFlushed = true
    } catch (error) {
      logger.error(`Failed to flush accumulated cost for execution ${this.executionId}:`, {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private async loadExistingCost(): Promise<void> {
    try {
      const [existing] = await db
        .select({ cost: workflowExecutionLogs.cost })
        .from(workflowExecutionLogs)
        .where(eq(workflowExecutionLogs.executionId, this.executionId))
        .limit(1)

      if (existing?.cost) {
        const cost = existing.cost as any
        this.accumulatedCost = {
          total: cost.total || BASE_EXECUTION_CHARGE,
          input: cost.input || 0,
          output: cost.output || 0,
          tokens: {
            input: cost.tokens?.input || 0,
            output: cost.tokens?.output || 0,
            total: cost.tokens?.total || 0,
          },
          models: cost.models || {},
        }
      }
    } catch (error) {
      logger.error(`Failed to load existing cost for execution ${this.executionId}:`, {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  async start(params: SessionStartParams): Promise<void> {
    const { userId, workspaceId, variables, triggerData, skipLogCreation, deploymentVersionId } =
      params

    try {
      this.trigger = createTriggerObject(this.triggerType, triggerData)
      this.environment = createEnvironmentObject(
        this.workflowId,
        this.executionId,
        userId,
        workspaceId,
        variables
      )
      // Use deployed state if deploymentVersionId is provided (non-manual execution)
      // Otherwise fall back to loading from normalized tables (manual/draft execution)
      this.workflowState = deploymentVersionId
        ? await loadDeployedWorkflowStateForLogging(this.workflowId)
        : await loadWorkflowStateForExecution(this.workflowId)

      if (!skipLogCreation) {
        await executionLogger.startWorkflowExecution({
          workflowId: this.workflowId,
          workspaceId,
          executionId: this.executionId,
          trigger: this.trigger,
          environment: this.environment,
          workflowState: this.workflowState,
          deploymentVersionId,
        })

        if (this.requestId) {
          logger.debug(`[${this.requestId}] Started logging for execution ${this.executionId}`)
        }
      } else {
        this.isResume = true
        await this.loadExistingCost()
        if (this.requestId) {
          logger.debug(
            `[${this.requestId}] Resuming logging for existing execution ${this.executionId}`
          )
        }
      }
    } catch (error) {
      if (this.requestId) {
        logger.error(`[${this.requestId}] Failed to start logging:`, error)
      }
      throw error
    }
  }

  /**
   * Set up logging on an executor instance
   * Note: Logging now works through trace spans only, no direct executor integration needed
   */
  setupExecutor(executor: any): void {
    if (this.requestId) {
      logger.debug(`[${this.requestId}] Logging session ready for execution ${this.executionId}`)
    }
  }

  async complete(params: SessionCompleteParams = {}): Promise<void> {
    if (this.completed) {
      return
    }

    const { endedAt, totalDurationMs, finalOutput, traceSpans, workflowInput } = params

    try {
      const costSummary = calculateCostSummary(traceSpans || [])
      const endTime = endedAt || new Date().toISOString()
      const duration = totalDurationMs || 0

      await executionLogger.completeWorkflowExecution({
        executionId: this.executionId,
        endedAt: endTime,
        totalDurationMs: duration,
        costSummary,
        finalOutput: finalOutput || {},
        traceSpans: traceSpans || [],
        workflowInput,
        isResume: this.isResume,
      })

      this.completed = true

      if (traceSpans && traceSpans.length > 0) {
        try {
          const { PlatformEvents, createOTelSpansForWorkflowExecution } = await import(
            '@/lib/core/telemetry'
          )

          const hasErrors = traceSpans.some((span: any) => {
            const checkForErrors = (s: any): boolean => {
              if (s.status === 'error') return true
              if (s.children && Array.isArray(s.children)) {
                return s.children.some(checkForErrors)
              }
              return false
            }
            return checkForErrors(span)
          })

          PlatformEvents.workflowExecuted({
            workflowId: this.workflowId,
            durationMs: duration,
            status: hasErrors ? 'error' : 'success',
            trigger: this.triggerType,
            blocksExecuted: traceSpans.length,
            hasErrors,
            totalCost: costSummary.totalCost || 0,
          })

          const startTime = new Date(new Date(endTime).getTime() - duration).toISOString()
          createOTelSpansForWorkflowExecution({
            workflowId: this.workflowId,
            workflowName: this.workflowState?.metadata?.name,
            executionId: this.executionId,
            traceSpans,
            trigger: this.triggerType,
            startTime,
            endTime,
            totalDurationMs: duration,
            status: hasErrors ? 'error' : 'success',
          })
        } catch (_e) {
          // Silently fail
        }
      }

      if (this.requestId) {
        logger.debug(`[${this.requestId}] Completed logging for execution ${this.executionId}`)
      }
    } catch (error) {
      logger.error(`Failed to complete logging for execution ${this.executionId}:`, {
        requestId: this.requestId,
        workflowId: this.workflowId,
        executionId: this.executionId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      })
      throw error
    }
  }

  async completeWithError(params: SessionErrorCompleteParams = {}): Promise<void> {
    if (this.completed) {
      return
    }

    try {
      const { endedAt, totalDurationMs, error, traceSpans, skipCost } = params

      const endTime = endedAt ? new Date(endedAt) : new Date()
      const durationMs = typeof totalDurationMs === 'number' ? totalDurationMs : 0
      const startTime = new Date(endTime.getTime() - Math.max(1, durationMs))

      const hasProvidedSpans = Array.isArray(traceSpans) && traceSpans.length > 0

      const costSummary = skipCost
        ? {
            totalCost: 0,
            totalInputCost: 0,
            totalOutputCost: 0,
            totalTokens: 0,
            totalPromptTokens: 0,
            totalCompletionTokens: 0,
            baseExecutionCharge: 0,
            modelCost: 0,
            models: {},
          }
        : hasProvidedSpans
          ? calculateCostSummary(traceSpans)
          : {
              totalCost: BASE_EXECUTION_CHARGE,
              totalInputCost: 0,
              totalOutputCost: 0,
              totalTokens: 0,
              totalPromptTokens: 0,
              totalCompletionTokens: 0,
              baseExecutionCharge: BASE_EXECUTION_CHARGE,
              modelCost: 0,
              models: {},
            }

      const message = error?.message || 'Execution failed before starting blocks'

      const errorSpan: TraceSpan = {
        id: 'workflow-error-root',
        name: 'Workflow Error',
        type: 'workflow',
        duration: Math.max(1, durationMs),
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        status: 'error',
        ...(hasProvidedSpans ? {} : { children: [] }),
        output: { error: message },
      }

      const spans = hasProvidedSpans ? traceSpans : [errorSpan]

      await executionLogger.completeWorkflowExecution({
        executionId: this.executionId,
        endedAt: endTime.toISOString(),
        totalDurationMs: Math.max(1, durationMs),
        costSummary,
        finalOutput: { error: message },
        traceSpans: spans,
      })

      this.completed = true

      try {
        const { PlatformEvents, createOTelSpansForWorkflowExecution } = await import(
          '@/lib/core/telemetry'
        )
        PlatformEvents.workflowExecuted({
          workflowId: this.workflowId,
          durationMs: Math.max(1, durationMs),
          status: 'error',
          trigger: this.triggerType,
          blocksExecuted: spans.length,
          hasErrors: true,
          errorMessage: message,
        })

        createOTelSpansForWorkflowExecution({
          workflowId: this.workflowId,
          workflowName: this.workflowState?.metadata?.name,
          executionId: this.executionId,
          traceSpans: spans,
          trigger: this.triggerType,
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          totalDurationMs: Math.max(1, durationMs),
          status: 'error',
          error: message,
        })
      } catch (_e) {
        // Silently fail
      }

      if (this.requestId) {
        logger.debug(
          `[${this.requestId}] Completed error logging for execution ${this.executionId}`
        )
      }
    } catch (enhancedError) {
      logger.error(`Failed to complete error logging for execution ${this.executionId}:`, {
        requestId: this.requestId,
        workflowId: this.workflowId,
        executionId: this.executionId,
        error: enhancedError instanceof Error ? enhancedError.message : String(enhancedError),
        stack: enhancedError instanceof Error ? enhancedError.stack : undefined,
      })
      throw enhancedError
    }
  }

  async completeWithCancellation(params: SessionCancelledParams = {}): Promise<void> {
    if (this.completed) {
      return
    }

    try {
      const { endedAt, totalDurationMs, traceSpans } = params

      const endTime = endedAt ? new Date(endedAt) : new Date()
      const durationMs = typeof totalDurationMs === 'number' ? totalDurationMs : 0

      const costSummary = traceSpans?.length
        ? calculateCostSummary(traceSpans)
        : {
            totalCost: BASE_EXECUTION_CHARGE,
            totalInputCost: 0,
            totalOutputCost: 0,
            totalTokens: 0,
            totalPromptTokens: 0,
            totalCompletionTokens: 0,
            baseExecutionCharge: BASE_EXECUTION_CHARGE,
            modelCost: 0,
            models: {},
          }

      await executionLogger.completeWorkflowExecution({
        executionId: this.executionId,
        endedAt: endTime.toISOString(),
        totalDurationMs: Math.max(1, durationMs),
        costSummary,
        finalOutput: { cancelled: true },
        traceSpans: traceSpans || [],
        status: 'cancelled',
      })

      this.completed = true

      try {
        const { PlatformEvents, createOTelSpansForWorkflowExecution } = await import(
          '@/lib/core/telemetry'
        )
        PlatformEvents.workflowExecuted({
          workflowId: this.workflowId,
          durationMs: Math.max(1, durationMs),
          status: 'cancelled',
          trigger: this.triggerType,
          blocksExecuted: traceSpans?.length || 0,
          hasErrors: false,
        })

        if (traceSpans && traceSpans.length > 0) {
          const startTime = new Date(endTime.getTime() - Math.max(1, durationMs))
          createOTelSpansForWorkflowExecution({
            workflowId: this.workflowId,
            workflowName: this.workflowState?.metadata?.name,
            executionId: this.executionId,
            traceSpans,
            trigger: this.triggerType,
            startTime: startTime.toISOString(),
            endTime: endTime.toISOString(),
            totalDurationMs: Math.max(1, durationMs),
            status: 'success', // Cancelled executions are not errors
          })
        }
      } catch (_e) {
        // Silently fail
      }

      if (this.requestId) {
        logger.debug(
          `[${this.requestId}] Completed cancelled logging for execution ${this.executionId}`
        )
      }
    } catch (cancelError) {
      logger.error(`Failed to complete cancelled logging for execution ${this.executionId}:`, {
        requestId: this.requestId,
        workflowId: this.workflowId,
        executionId: this.executionId,
        error: cancelError instanceof Error ? cancelError.message : String(cancelError),
        stack: cancelError instanceof Error ? cancelError.stack : undefined,
      })
      throw cancelError
    }
  }

  async completeWithPause(params: SessionPausedParams = {}): Promise<void> {
    try {
      const { endedAt, totalDurationMs, traceSpans, workflowInput } = params

      const endTime = endedAt ? new Date(endedAt) : new Date()
      const durationMs = typeof totalDurationMs === 'number' ? totalDurationMs : 0

      const costSummary = traceSpans?.length
        ? calculateCostSummary(traceSpans)
        : {
            totalCost: BASE_EXECUTION_CHARGE,
            totalInputCost: 0,
            totalOutputCost: 0,
            totalTokens: 0,
            totalPromptTokens: 0,
            totalCompletionTokens: 0,
            baseExecutionCharge: BASE_EXECUTION_CHARGE,
            modelCost: 0,
            models: {},
          }

      await executionLogger.completeWorkflowExecution({
        executionId: this.executionId,
        endedAt: endTime.toISOString(),
        totalDurationMs: Math.max(1, durationMs),
        costSummary,
        finalOutput: { paused: true },
        traceSpans: traceSpans || [],
        workflowInput,
        status: 'pending',
      })

      try {
        const { PlatformEvents, createOTelSpansForWorkflowExecution } = await import(
          '@/lib/core/telemetry'
        )
        PlatformEvents.workflowExecuted({
          workflowId: this.workflowId,
          durationMs: Math.max(1, durationMs),
          status: 'paused',
          trigger: this.triggerType,
          blocksExecuted: traceSpans?.length || 0,
          hasErrors: false,
          totalCost: costSummary.totalCost || 0,
        })

        if (traceSpans && traceSpans.length > 0) {
          const startTime = new Date(endTime.getTime() - Math.max(1, durationMs))
          createOTelSpansForWorkflowExecution({
            workflowId: this.workflowId,
            workflowName: this.workflowState?.metadata?.name,
            executionId: this.executionId,
            traceSpans,
            trigger: this.triggerType,
            startTime: startTime.toISOString(),
            endTime: endTime.toISOString(),
            totalDurationMs: Math.max(1, durationMs),
            status: 'success', // Paused executions are not errors
          })
        }
      } catch (_e) {}

      if (this.requestId) {
        logger.debug(
          `[${this.requestId}] Completed paused logging for execution ${this.executionId}`
        )
      }
    } catch (pauseError) {
      logger.error(`Failed to complete paused logging for execution ${this.executionId}:`, {
        requestId: this.requestId,
        workflowId: this.workflowId,
        executionId: this.executionId,
        error: pauseError instanceof Error ? pauseError.message : String(pauseError),
        stack: pauseError instanceof Error ? pauseError.stack : undefined,
      })
      throw pauseError
    }
  }

  async safeStart(params: SessionStartParams): Promise<boolean> {
    try {
      await this.start(params)
      return true
    } catch (error) {
      if (this.requestId) {
        logger.warn(
          `[${this.requestId}] Logging start failed - falling back to minimal session:`,
          error
        )
      }

      // Fallback: create a minimal logging session without full workflow state
      try {
        const { userId, workspaceId, variables, triggerData, deploymentVersionId } = params
        this.trigger = createTriggerObject(this.triggerType, triggerData)
        this.environment = createEnvironmentObject(
          this.workflowId,
          this.executionId,
          userId,
          workspaceId,
          variables
        )
        // Minimal workflow state when normalized/deployed data is unavailable
        this.workflowState = {
          blocks: {},
          edges: [],
          loops: {},
          parallels: {},
        } as unknown as WorkflowState

        await executionLogger.startWorkflowExecution({
          workflowId: this.workflowId,
          workspaceId,
          executionId: this.executionId,
          trigger: this.trigger,
          environment: this.environment,
          workflowState: this.workflowState,
          deploymentVersionId,
        })

        if (this.requestId) {
          logger.debug(
            `[${this.requestId}] Started minimal logging for execution ${this.executionId}`
          )
        }
        return true
      } catch (fallbackError) {
        if (this.requestId) {
          logger.error(`[${this.requestId}] Minimal logging start also failed:`, fallbackError)
        }
        return false
      }
    }
  }

  async safeComplete(params: SessionCompleteParams = {}): Promise<void> {
    try {
      await this.complete(params)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      logger.warn(
        `[${this.requestId || 'unknown'}] Complete failed for execution ${this.executionId}, attempting fallback`,
        { error: errorMsg }
      )
      await this.completeWithCostOnlyLog({
        traceSpans: params.traceSpans,
        endedAt: params.endedAt,
        totalDurationMs: params.totalDurationMs,
        errorMessage: `Failed to store trace spans: ${errorMsg}`,
        isError: false,
      })
    }
  }

  async safeCompleteWithError(params?: SessionErrorCompleteParams): Promise<void> {
    try {
      await this.completeWithError(params)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      logger.warn(
        `[${this.requestId || 'unknown'}] CompleteWithError failed for execution ${this.executionId}, attempting fallback`,
        { error: errorMsg }
      )
      await this.completeWithCostOnlyLog({
        traceSpans: params?.traceSpans,
        endedAt: params?.endedAt,
        totalDurationMs: params?.totalDurationMs,
        errorMessage:
          params?.error?.message || `Execution failed to store trace spans: ${errorMsg}`,
        isError: true,
        status: 'failed',
      })
    }
  }

  async safeCompleteWithCancellation(params?: SessionCancelledParams): Promise<void> {
    try {
      await this.completeWithCancellation(params)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      logger.warn(
        `[${this.requestId || 'unknown'}] CompleteWithCancellation failed for execution ${this.executionId}, attempting fallback`,
        { error: errorMsg }
      )
      await this.completeWithCostOnlyLog({
        traceSpans: params?.traceSpans,
        endedAt: params?.endedAt,
        totalDurationMs: params?.totalDurationMs,
        errorMessage: 'Execution was cancelled',
        isError: false,
        status: 'cancelled',
      })
    }
  }

  async safeCompleteWithPause(params?: SessionPausedParams): Promise<void> {
    try {
      await this.completeWithPause(params)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      logger.warn(
        `[${this.requestId || 'unknown'}] CompleteWithPause failed for execution ${this.executionId}, attempting fallback`,
        { error: errorMsg }
      )
      await this.completeWithCostOnlyLog({
        traceSpans: params?.traceSpans,
        endedAt: params?.endedAt,
        totalDurationMs: params?.totalDurationMs,
        errorMessage: 'Execution paused but failed to store full trace spans',
        isError: false,
        status: 'pending',
      })
    }
  }

  async markAsFailed(errorMessage?: string): Promise<void> {
    await LoggingSession.markExecutionAsFailed(this.executionId, errorMessage, this.requestId)
  }

  static async markExecutionAsFailed(
    executionId: string,
    errorMessage?: string,
    requestId?: string
  ): Promise<void> {
    try {
      const message = errorMessage || 'Execution failed'
      await db
        .update(workflowExecutionLogs)
        .set({
          level: 'error',
          status: 'failed',
          executionData: sql`jsonb_set(
            jsonb_set(
              COALESCE(execution_data, '{}'::jsonb),
              ARRAY['error'],
              to_jsonb(${message}::text)
            ),
            ARRAY['finalOutput'],
            jsonb_build_object('error', ${message}::text)
          )`,
        })
        .where(eq(workflowExecutionLogs.executionId, executionId))

      logger.info(`[${requestId || 'unknown'}] Marked execution ${executionId} as failed`)
    } catch (error) {
      logger.error(`Failed to mark execution ${executionId} as failed:`, {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private async completeWithCostOnlyLog(params: {
    traceSpans?: TraceSpan[]
    endedAt?: string
    totalDurationMs?: number
    errorMessage: string
    isError: boolean
    status?: 'completed' | 'failed' | 'cancelled' | 'pending'
  }): Promise<void> {
    if (this.completed) {
      return
    }

    logger.warn(
      `[${this.requestId || 'unknown'}] Logging completion failed for execution ${this.executionId} - attempting cost-only fallback`
    )

    try {
      const costSummary = params.traceSpans?.length
        ? calculateCostSummary(params.traceSpans)
        : {
            totalCost: BASE_EXECUTION_CHARGE,
            totalInputCost: 0,
            totalOutputCost: 0,
            totalTokens: 0,
            totalPromptTokens: 0,
            totalCompletionTokens: 0,
            baseExecutionCharge: BASE_EXECUTION_CHARGE,
            modelCost: 0,
            models: {},
          }

      await executionLogger.completeWorkflowExecution({
        executionId: this.executionId,
        endedAt: params.endedAt || new Date().toISOString(),
        totalDurationMs: params.totalDurationMs || 0,
        costSummary,
        finalOutput: { _fallback: true, error: params.errorMessage },
        traceSpans: [],
        isResume: this.isResume,
        level: params.isError ? 'error' : 'info',
        status: params.status,
      })

      this.completed = true

      logger.info(
        `[${this.requestId || 'unknown'}] Cost-only fallback succeeded for execution ${this.executionId}`
      )
    } catch (fallbackError) {
      logger.error(
        `[${this.requestId || 'unknown'}] Cost-only fallback also failed for execution ${this.executionId}:`,
        { error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError) }
      )
    }
  }
}
