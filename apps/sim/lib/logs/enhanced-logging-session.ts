import { createLogger } from '@/lib/logs/console-logger'
import { enhancedExecutionLogger } from './enhanced-execution-logger'
import {
  createTriggerObject,
  createEnvironmentObject,
  loadWorkflowStateForExecution,
  calculateBlockStats,
  calculateCostSummary,
} from './enhanced-logging-factory'
import type { ExecutionTrigger, ExecutionEnvironment, WorkflowState } from './types'

const logger = createLogger('EnhancedLoggingSession')

export interface SessionStartParams {
  userId?: string
  workspaceId?: string
  variables?: Record<string, string>
  triggerData?: Record<string, unknown>
}

export interface SessionCompleteParams {
  endedAt?: string
  totalDurationMs?: number
  finalOutput?: any
  traceSpans?: any[]
}

export class EnhancedLoggingSession {
  private workflowId: string
  private executionId: string
  private triggerType: ExecutionTrigger['type']
  private requestId?: string
  private trigger?: ExecutionTrigger
  private environment?: ExecutionEnvironment
  private workflowState?: WorkflowState
  private enhancedLogger = enhancedExecutionLogger

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
    const { userId, workspaceId, variables, triggerData } = params

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

      await enhancedExecutionLogger.startWorkflowExecution({
        workflowId: this.workflowId,
        executionId: this.executionId,
        trigger: this.trigger,
        environment: this.environment,
        workflowState: this.workflowState,
      })

      if (this.requestId) {
        logger.debug(`[${this.requestId}] Started enhanced logging for execution ${this.executionId}`)
      }
    } catch (error) {
      if (this.requestId) {
        logger.error(`[${this.requestId}] Failed to start enhanced logging:`, error)
      }
      throw error
    }
  }

  /**
   * Set up enhanced logging on an executor instance
   */
  setupExecutor(executor: any): void {
    executor.setEnhancedLogger(this.enhancedLogger, this.executionId)
    if (this.requestId) {
      logger.debug(`[${this.requestId}] Enhanced logger set on executor for execution ${this.executionId}`)
    }
  }

  async complete(params: SessionCompleteParams = {}): Promise<void> {
    const { endedAt, totalDurationMs, finalOutput, traceSpans } = params

    try {
      const blockStats = calculateBlockStats(traceSpans || [])
      const costSummary = calculateCostSummary(traceSpans || [])

      await enhancedExecutionLogger.completeWorkflowExecution({
        executionId: this.executionId,
        endedAt: endedAt || new Date().toISOString(),
        totalDurationMs: totalDurationMs || 0,
        blockStats,
        costSummary,
        finalOutput: finalOutput || {},
        traceSpans: traceSpans || [],
      })

      if (this.requestId) {
        logger.debug(`[${this.requestId}] Completed enhanced logging for execution ${this.executionId}`)
      }
    } catch (error) {
      if (this.requestId) {
        logger.error(`[${this.requestId}] Failed to complete enhanced logging:`, error)
      }
    }
  }

  async completeWithError(error?: any): Promise<void> {
    try {
      const blockStats = { total: 0, success: 0, error: 1, skipped: 0 }
      const costSummary = { totalCost: 0, totalInputCost: 0, totalOutputCost: 0, totalTokens: 0 }

      await enhancedExecutionLogger.completeWorkflowExecution({
        executionId: this.executionId,
        endedAt: new Date().toISOString(),
        totalDurationMs: 0,
        blockStats,
        costSummary,
        finalOutput: null,
        traceSpans: [],
      })

      if (this.requestId) {
        logger.debug(`[${this.requestId}] Completed enhanced logging with error for execution ${this.executionId}`)
      }
    } catch (enhancedError) {
      if (this.requestId) {
        logger.error(`[${this.requestId}] Failed to complete enhanced logging for error:`, enhancedError)
      }
    }
  }

  async safeStart(params: SessionStartParams = {}): Promise<boolean> {
    try {
      await this.start(params)
      return true
    } catch (error) {
      if (this.requestId) {
        logger.error(`[${this.requestId}] Enhanced logging start failed, continuing execution:`, error)
      }
      return false
    }
  }

  async safeComplete(params: SessionCompleteParams = {}): Promise<void> {
    try {
      await this.complete(params)
    } catch (error) {
      if (this.requestId) {
        logger.error(`[${this.requestId}] Enhanced logging completion failed:`, error)
      }
    }
  }

  async safeCompleteWithError(error?: any): Promise<void> {
    try {
      await this.completeWithError(error)
    } catch (enhancedError) {
      if (this.requestId) {
        logger.error(`[${this.requestId}] Enhanced logging error completion failed:`, enhancedError)
      }
    }
  }
}
