import type { ExecutionContext } from '../types'

/**
 * Fluent builder for creating execution contexts.
 *
 * Use this for complex execution scenarios where you need
 * fine-grained control over the context state.
 *
 * @example
 * ```ts
 * const ctx = new ExecutionContextBuilder()
 *   .forWorkflow('my-workflow')
 *   .withBlockState('block-1', { output: 'hello' })
 *   .markExecuted('block-1')
 *   .withEnvironment({ API_KEY: 'test' })
 *   .build()
 * ```
 */
export class ExecutionContextBuilder {
  private workflowId = 'test-workflow'
  private executionId = `exec-${Math.random().toString(36).substring(2, 10)}`
  private blockStates = new Map<string, any>()
  private executedBlocks = new Set<string>()
  private blockLogs: any[] = []
  private metadata: { duration: number; startTime?: string; endTime?: string } = { duration: 0 }
  private environmentVariables: Record<string, string> = {}
  private workflowVariables: Record<string, any> = {}
  private routerDecisions = new Map<string, any>()
  private conditionDecisions = new Map<string, any>()
  private loopExecutions = new Map<string, any>()
  private completedLoops = new Set<string>()
  private activeExecutionPath = new Set<string>()
  private abortSignal?: AbortSignal

  /**
   * Sets the workflow ID.
   */
  forWorkflow(workflowId: string): this {
    this.workflowId = workflowId
    return this
  }

  /**
   * Sets a custom execution ID.
   */
  withExecutionId(executionId: string): this {
    this.executionId = executionId
    return this
  }

  /**
   * Adds a block state.
   */
  withBlockState(blockId: string, state: any): this {
    this.blockStates.set(blockId, state)
    return this
  }

  /**
   * Adds multiple block states at once.
   */
  withBlockStates(states: Record<string, any>): this {
    Object.entries(states).forEach(([id, state]) => {
      this.blockStates.set(id, state)
    })
    return this
  }

  /**
   * Marks a block as executed.
   */
  markExecuted(blockId: string): this {
    this.executedBlocks.add(blockId)
    return this
  }

  /**
   * Marks multiple blocks as executed.
   */
  markAllExecuted(...blockIds: string[]): this {
    blockIds.forEach((id) => this.executedBlocks.add(id))
    return this
  }

  /**
   * Adds a log entry.
   */
  addLog(log: any): this {
    this.blockLogs.push(log)
    return this
  }

  /**
   * Sets execution metadata.
   */
  withMetadata(metadata: { duration?: number; startTime?: string; endTime?: string }): this {
    if (metadata.duration !== undefined) this.metadata.duration = metadata.duration
    if (metadata.startTime) this.metadata.startTime = metadata.startTime
    if (metadata.endTime) this.metadata.endTime = metadata.endTime
    return this
  }

  /**
   * Adds environment variables.
   */
  withEnvironment(vars: Record<string, string>): this {
    this.environmentVariables = { ...this.environmentVariables, ...vars }
    return this
  }

  /**
   * Adds workflow variables.
   */
  withVariables(vars: Record<string, any>): this {
    this.workflowVariables = { ...this.workflowVariables, ...vars }
    return this
  }

  /**
   * Sets a router decision.
   */
  withRouterDecision(blockId: string, decision: any): this {
    this.routerDecisions.set(blockId, decision)
    return this
  }

  /**
   * Sets a condition decision.
   */
  withConditionDecision(blockId: string, decision: boolean): this {
    this.conditionDecisions.set(blockId, decision)
    return this
  }

  /**
   * Marks a loop as completed.
   */
  completeLoop(loopId: string): this {
    this.completedLoops.add(loopId)
    return this
  }

  /**
   * Adds a block to the active execution path.
   */
  activatePath(blockId: string): this {
    this.activeExecutionPath.add(blockId)
    return this
  }

  /**
   * Sets an abort signal (for cancellation testing).
   */
  withAbortSignal(signal: AbortSignal): this {
    this.abortSignal = signal
    return this
  }

  /**
   * Creates a context that is already cancelled.
   */
  cancelled(): this {
    this.abortSignal = AbortSignal.abort()
    return this
  }

  /**
   * Creates a context with a timeout.
   */
  withTimeout(ms: number): this {
    this.abortSignal = AbortSignal.timeout(ms)
    return this
  }

  /**
   * Builds and returns the execution context.
   */
  build(): ExecutionContext {
    return {
      workflowId: this.workflowId,
      executionId: this.executionId,
      blockStates: this.blockStates,
      executedBlocks: this.executedBlocks,
      blockLogs: this.blockLogs,
      metadata: this.metadata,
      environmentVariables: this.environmentVariables,
      workflowVariables: this.workflowVariables,
      decisions: {
        router: this.routerDecisions,
        condition: this.conditionDecisions,
      },
      loopExecutions: this.loopExecutions,
      completedLoops: this.completedLoops,
      activeExecutionPath: this.activeExecutionPath,
      abortSignal: this.abortSignal,
    }
  }

  /**
   * Creates a fresh context builder for a workflow.
   */
  static createForWorkflow(workflowId: string): ExecutionContextBuilder {
    return new ExecutionContextBuilder().forWorkflow(workflowId)
  }

  /**
   * Creates a cancelled context.
   */
  static createCancelled(workflowId?: string): ExecutionContext {
    const builder = new ExecutionContextBuilder()
    if (workflowId) builder.forWorkflow(workflowId)
    return builder.cancelled().build()
  }

  /**
   * Creates a context with a timeout.
   */
  static createWithTimeout(ms: number, workflowId?: string): ExecutionContext {
    const builder = new ExecutionContextBuilder()
    if (workflowId) builder.forWorkflow(workflowId)
    return builder.withTimeout(ms).build()
  }
}
