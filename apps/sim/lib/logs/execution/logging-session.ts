import { BASE_EXECUTION_CHARGE } from '@/lib/billing/constants'
import { createLogger } from '@/lib/logs/console/logger'
import { executionLogger } from '@/lib/logs/execution/logger'
import {
  calculateCostSummary,
  createEnvironmentObject,
  createTriggerObject,
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
  workspaceId?: string
  variables?: Record<string, string>
  triggerData?: Record<string, unknown>
  skipLogCreation?: boolean // For resume executions - reuse existing log entry
  deploymentVersionId?: string // ID of the deployment version used (null for manual/editor executions)
}

export interface SessionCompleteParams {
  endedAt?: string
  totalDurationMs?: number
  finalOutput?: any
  traceSpans?: any[]
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
}

export class LoggingSession {
  private workflowId: string
  private executionId: string
  private triggerType: ExecutionTrigger['type']
  private requestId?: string
  private trigger?: ExecutionTrigger
  private environment?: ExecutionEnvironment
  private workflowState?: WorkflowState
  private isResume = false // Track if this is a resume execution

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

  async start(params: SessionStartParams = {}): Promise<void> {
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
      this.workflowState = await loadWorkflowStateForExecution(this.workflowId)

      // Only create a new log entry if not resuming
      if (!skipLogCreation) {
        await executionLogger.startWorkflowExecution({
          workflowId: this.workflowId,
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
        this.isResume = true // Mark as resume
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
    // No longer setting logger on executor - trace spans handle everything
    if (this.requestId) {
      logger.debug(`[${this.requestId}] Logging session ready for execution ${this.executionId}`)
    }
  }

  async complete(params: SessionCompleteParams = {}): Promise<void> {
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

      // Track workflow execution outcome
      if (traceSpans && traceSpans.length > 0) {
        try {
          const { trackPlatformEvent } = await import('@/lib/core/telemetry')

          // Determine status from trace spans
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

          trackPlatformEvent('platform.workflow.executed', {
            'workflow.id': this.workflowId,
            'execution.duration_ms': duration,
            'execution.status': hasErrors ? 'error' : 'success',
            'execution.trigger': this.triggerType,
            'execution.blocks_executed': traceSpans.length,
            'execution.has_errors': hasErrors,
            'execution.total_cost': costSummary.totalCost || 0,
          })
        } catch (_e) {
          // Silently fail
        }
      }

      if (this.requestId) {
        logger.debug(`[${this.requestId}] Completed logging for execution ${this.executionId}`)
      }
    } catch (error) {
      // Always log completion failures with full details - these should not be silent
      logger.error(`Failed to complete logging for execution ${this.executionId}:`, {
        requestId: this.requestId,
        workflowId: this.workflowId,
        executionId: this.executionId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      })
      // Rethrow so safeComplete can decide what to do
      throw error
    }
  }

  async completeWithError(params: SessionErrorCompleteParams = {}): Promise<void> {
    try {
      const { endedAt, totalDurationMs, error, traceSpans } = params

      const endTime = endedAt ? new Date(endedAt) : new Date()
      const durationMs = typeof totalDurationMs === 'number' ? totalDurationMs : 0
      const startTime = new Date(endTime.getTime() - Math.max(1, durationMs))

      const hasProvidedSpans = Array.isArray(traceSpans) && traceSpans.length > 0

      const costSummary = hasProvidedSpans
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

      // Track workflow execution error outcome
      try {
        const { trackPlatformEvent } = await import('@/lib/core/telemetry')
        trackPlatformEvent('platform.workflow.executed', {
          'workflow.id': this.workflowId,
          'execution.duration_ms': Math.max(1, durationMs),
          'execution.status': 'error',
          'execution.trigger': this.triggerType,
          'execution.blocks_executed': spans.length,
          'execution.has_errors': true,
          'execution.error_message': message,
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
      // Always log completion failures with full details
      logger.error(`Failed to complete error logging for execution ${this.executionId}:`, {
        requestId: this.requestId,
        workflowId: this.workflowId,
        executionId: this.executionId,
        error: enhancedError instanceof Error ? enhancedError.message : String(enhancedError),
        stack: enhancedError instanceof Error ? enhancedError.stack : undefined,
      })
      // Rethrow so safeCompleteWithError can decide what to do
      throw enhancedError
    }
  }

  async safeStart(params: SessionStartParams = {}): Promise<boolean> {
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
        // Minimal workflow state when normalized data is unavailable
        this.workflowState = {
          blocks: {},
          edges: [],
          loops: {},
          parallels: {},
        } as unknown as WorkflowState

        await executionLogger.startWorkflowExecution({
          workflowId: this.workflowId,
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
      logger.warn(
        `[${this.requestId || 'unknown'}] Logging completion failed for execution ${this.executionId} - attempting cost-only fallback`
      )

      try {
        const costSummary = calculateCostSummary(params.traceSpans || [])
        const endTime = params.endedAt || new Date().toISOString()
        const duration = params.totalDurationMs || 0

        await executionLogger.completeWorkflowExecution({
          executionId: this.executionId,
          endedAt: endTime,
          totalDurationMs: duration,
          costSummary,
          finalOutput: { _fallback: true, error: 'Trace spans too large to store' },
          traceSpans: [],
          isResume: this.isResume,
        })

        logger.info(
          `[${this.requestId || 'unknown'}] Cost-only fallback succeeded for execution ${this.executionId}`
        )
      } catch (fallbackError) {
        logger.error(
          `[${this.requestId || 'unknown'}] Cost-only fallback also failed for execution ${this.executionId}:`,
          {
            error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          }
        )
      }
    }
  }

  async safeCompleteWithError(params?: SessionErrorCompleteParams): Promise<void> {
    try {
      await this.completeWithError(params)
    } catch (error) {
      logger.warn(
        `[${this.requestId || 'unknown'}] Error logging completion failed for execution ${this.executionId} - attempting cost-only fallback`
      )

      try {
        const costSummary = params?.traceSpans
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

        const endTime = params?.endedAt || new Date().toISOString()
        const duration = params?.totalDurationMs || 0

        await executionLogger.completeWorkflowExecution({
          executionId: this.executionId,
          endedAt: endTime,
          totalDurationMs: duration,
          costSummary,
          finalOutput: {
            _fallback: true,
            error: params?.error?.message || 'Execution failed, trace spans too large to store',
          },
          traceSpans: [],
        })

        logger.info(
          `[${this.requestId || 'unknown'}] Cost-only fallback succeeded for execution ${this.executionId}`
        )
      } catch (fallbackError) {
        logger.error(
          `[${this.requestId || 'unknown'}] Cost-only fallback also failed for execution ${this.executionId}:`,
          {
            error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          }
        )
      }
    }
  }
}
