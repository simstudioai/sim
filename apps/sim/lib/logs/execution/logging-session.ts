import { BASE_EXECUTION_CHARGE } from '@/lib/billing/constants'
import { createLogger } from '@/lib/logs/console/logger'
import { executionLogger } from '@/lib/logs/execution/logger'
import {
  calculateCostSummary,
  createEnvironmentObject,
  createTriggerObject,
  loadWorkflowStateForExecution,
} from '@/lib/logs/execution/logging-factory'
import type { ExecutionEnvironment, ExecutionTrigger, WorkflowState } from '@/lib/logs/types'

const logger = createLogger('LoggingSession')

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

export class LoggingSession {
  private workflowId: string
  private executionId: string
  private triggerType: ExecutionTrigger['type']
  private requestId?: string
  private trigger?: ExecutionTrigger
  private environment?: ExecutionEnvironment
  private workflowState?: WorkflowState

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

      await executionLogger.startWorkflowExecution({
        workflowId: this.workflowId,
        executionId: this.executionId,
        trigger: this.trigger,
        environment: this.environment,
        workflowState: this.workflowState,
      })

      if (this.requestId) {
        logger.debug(`[${this.requestId}] Started logging for execution ${this.executionId}`)
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
    const { endedAt, totalDurationMs, finalOutput, traceSpans } = params

    try {
      const costSummary = calculateCostSummary(traceSpans || [])

      await executionLogger.completeWorkflowExecution({
        executionId: this.executionId,
        endedAt: endedAt || new Date().toISOString(),
        totalDurationMs: totalDurationMs || 0,
        costSummary,
        finalOutput: finalOutput || {},
        traceSpans: traceSpans || [],
      })

      if (this.requestId) {
        logger.debug(`[${this.requestId}] Completed logging for execution ${this.executionId}`)
      }
    } catch (error) {
      if (this.requestId) {
        logger.error(`[${this.requestId}] Failed to complete logging:`, error)
      }
    }
  }

  async completeWithError(error?: any): Promise<void> {
    try {
      const costSummary = {
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
        endedAt: new Date().toISOString(),
        totalDurationMs: 0,
        costSummary,
        finalOutput: null,
        traceSpans: [],
      })

      if (this.requestId) {
        logger.debug(`[${this.requestId}] Completed logging for execution ${this.executionId}`)
      }
    } catch (enhancedError) {
      if (this.requestId) {
        logger.error(`[${this.requestId}] Failed to complete logging:`, enhancedError)
      }
    }
  }

  async safeStart(params: SessionStartParams = {}): Promise<boolean> {
    try {
      await this.start(params)
      return true
    } catch (error) {
      if (this.requestId) {
        logger.error(`[${this.requestId}] Logging start failed:`, error)
      }
      return false
    }
  }

  async safeComplete(params: SessionCompleteParams = {}): Promise<void> {
    try {
      await this.complete(params)
    } catch (error) {
      if (this.requestId) {
        logger.error(`[${this.requestId}] Logging completion failed:`, error)
      }
    }
  }

  async safeCompleteWithError(error?: any): Promise<void> {
    try {
      await this.completeWithError(error)
    } catch (enhancedError) {
      if (this.requestId) {
        logger.error(`[${this.requestId}] Logging error completion failed:`, enhancedError)
      }
    }
  }
}
