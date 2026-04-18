import { createLogger } from '@sim/logger'
import { toError } from '@/lib/core/utils/helpers'
import { generateRequestId } from '@/lib/core/utils/request'
import { isExecutionCancelled, isRedisCancellationEnabled } from '@/lib/execution/cancellation'
import { executeInIsolatedVM } from '@/lib/execution/isolated-vm'
import { buildLoopIndexCondition, DEFAULTS, EDGE, PARALLEL } from '@/executor/constants'
import type { DAG } from '@/executor/dag/builder'
import type { EdgeManager } from '@/executor/execution/edge-manager'
import type { LoopScope } from '@/executor/execution/state'
import type { BlockStateController, ContextExtensions } from '@/executor/execution/types'
import type { ExecutionContext, NormalizedBlockOutput } from '@/executor/types'
import type { LoopConfigWithNodes } from '@/executor/types/loop'
import { replaceValidReferences } from '@/executor/utils/reference-validation'
import {
  addSubflowErrorLog,
  buildParallelSentinelEndId,
  buildParallelSentinelStartId,
  buildSentinelEndId,
  buildSentinelStartId,
  emitEmptySubflowEvents,
  emitSubflowSuccessEvents,
  extractBaseBlockId,
  resolveArrayInput,
  validateMaxCount,
} from '@/executor/utils/subflow-utils'
import type { VariableResolver } from '@/executor/variables/resolver'
import type { SerializedLoop } from '@/serializer/types'

const logger = createLogger('LoopOrchestrator')

const LOOP_CONDITION_TIMEOUT_MS = 5000

export type LoopRoute = typeof EDGE.LOOP_CONTINUE | typeof EDGE.LOOP_EXIT

export interface LoopContinuationResult {
  shouldContinue: boolean
  shouldExit: boolean
  selectedRoute: LoopRoute
  aggregatedResults?: NormalizedBlockOutput[][]
}

export class LoopOrchestrator {
  constructor(
    private dag: DAG,
    private state: BlockStateController,
    private resolver: VariableResolver,
    private contextExtensions: ContextExtensions | null = null,
    private edgeManager: EdgeManager | null = null
  ) {}

  async initializeLoopScope(ctx: ExecutionContext, loopId: string): Promise<LoopScope> {
    const loopConfig = this.dag.loopConfigs.get(loopId) as SerializedLoop | undefined
    if (!loopConfig) {
      throw new Error(`Loop config not found: ${loopId}`)
    }

    if (loopConfig.nodes.length === 0) {
      const errorMessage =
        'Loop has no executable blocks inside. Add or enable at least one block in the loop.'
      const loopType = loopConfig.loopType || 'for'
      logger.error(errorMessage, { loopId })
      await this.addLoopErrorLog(ctx, loopId, loopType, errorMessage, {})
      const errorScope: LoopScope = {
        iteration: 0,
        maxIterations: 0,
        loopType,
        currentIterationOutputs: new Map(),
        allIterationOutputs: [],
        condition: 'false',
        validationError: errorMessage,
      }
      if (!ctx.loopExecutions) {
        ctx.loopExecutions = new Map()
      }
      ctx.loopExecutions.set(loopId, errorScope)
      throw new Error(errorMessage)
    }

    const scope: LoopScope = {
      iteration: 0,
      currentIterationOutputs: new Map(),
      allIterationOutputs: [],
    }

    const loopType = loopConfig.loopType

    switch (loopType) {
      case 'for': {
        scope.loopType = 'for'
        const requestedIterations = loopConfig.iterations || DEFAULTS.MAX_LOOP_ITERATIONS

        const iterationError = validateMaxCount(
          requestedIterations,
          DEFAULTS.MAX_LOOP_ITERATIONS,
          'For loop iterations'
        )
        if (iterationError) {
          logger.error(iterationError, { loopId, requestedIterations })
          await this.addLoopErrorLog(ctx, loopId, loopType, iterationError, {
            iterations: requestedIterations,
          })
          scope.maxIterations = 0
          scope.validationError = iterationError
          scope.condition = buildLoopIndexCondition(0)
          ctx.loopExecutions?.set(loopId, scope)
          throw new Error(iterationError)
        }

        scope.maxIterations = requestedIterations
        scope.condition = buildLoopIndexCondition(scope.maxIterations)
        break
      }

      case 'forEach': {
        scope.loopType = 'forEach'
        if (
          loopConfig.forEachItems === undefined ||
          loopConfig.forEachItems === null ||
          loopConfig.forEachItems === ''
        ) {
          const errorMessage =
            'ForEach loop collection is empty. Provide an array or a reference that resolves to a collection.'
          logger.error(errorMessage, { loopId })
          await this.addLoopErrorLog(ctx, loopId, loopType, errorMessage, {
            forEachItems: loopConfig.forEachItems,
          })
          scope.items = []
          scope.maxIterations = 0
          scope.validationError = errorMessage
          scope.condition = buildLoopIndexCondition(0)
          ctx.loopExecutions?.set(loopId, scope)
          throw new Error(errorMessage)
        }
        let items: any[]
        try {
          items = resolveArrayInput(ctx, loopConfig.forEachItems, this.resolver)
        } catch (error) {
          const errorMessage = `ForEach loop resolution failed: ${toError(error).message}`
          logger.error(errorMessage, { loopId, forEachItems: loopConfig.forEachItems })
          await this.addLoopErrorLog(ctx, loopId, loopType, errorMessage, {
            forEachItems: loopConfig.forEachItems,
          })
          scope.items = []
          scope.maxIterations = 0
          scope.validationError = errorMessage
          scope.condition = buildLoopIndexCondition(0)
          ctx.loopExecutions?.set(loopId, scope)
          throw new Error(errorMessage)
        }

        const sizeError = validateMaxCount(
          items.length,
          DEFAULTS.MAX_FOREACH_ITEMS,
          'ForEach loop collection size'
        )
        if (sizeError) {
          logger.error(sizeError, { loopId, collectionSize: items.length })
          await this.addLoopErrorLog(ctx, loopId, loopType, sizeError, {
            forEachItems: loopConfig.forEachItems,
            collectionSize: items.length,
          })
          scope.items = []
          scope.maxIterations = 0
          scope.validationError = sizeError
          scope.condition = buildLoopIndexCondition(0)
          ctx.loopExecutions?.set(loopId, scope)
          throw new Error(sizeError)
        }

        scope.items = items
        scope.maxIterations = items.length
        scope.item = items[0]
        scope.condition = buildLoopIndexCondition(scope.maxIterations)
        break
      }

      case 'while':
        scope.loopType = 'while'
        scope.condition = loopConfig.whileCondition
        break

      case 'doWhile': {
        scope.loopType = 'doWhile'
        if (loopConfig.doWhileCondition) {
          scope.condition = loopConfig.doWhileCondition
        } else {
          const requestedIterations = loopConfig.iterations || DEFAULTS.MAX_LOOP_ITERATIONS

          const iterationError = validateMaxCount(
            requestedIterations,
            DEFAULTS.MAX_LOOP_ITERATIONS,
            'Do-While loop iterations'
          )
          if (iterationError) {
            logger.error(iterationError, { loopId, requestedIterations })
            await this.addLoopErrorLog(ctx, loopId, loopType, iterationError, {
              iterations: requestedIterations,
            })
            scope.maxIterations = 0
            scope.validationError = iterationError
            scope.condition = buildLoopIndexCondition(0)
            ctx.loopExecutions?.set(loopId, scope)
            throw new Error(iterationError)
          }

          scope.maxIterations = requestedIterations
          scope.condition = buildLoopIndexCondition(scope.maxIterations)
        }
        break
      }

      default:
        throw new Error(`Unknown loop type: ${loopType}`)
    }

    if (!ctx.loopExecutions) {
      ctx.loopExecutions = new Map()
    }
    ctx.loopExecutions.set(loopId, scope)
    return scope
  }

  private async addLoopErrorLog(
    ctx: ExecutionContext,
    loopId: string,
    loopType: string,
    errorMessage: string,
    inputData?: any
  ): Promise<void> {
    await addSubflowErrorLog(
      ctx,
      loopId,
      'loop',
      errorMessage,
      { loopType, ...inputData },
      this.contextExtensions
    )
  }

  storeLoopNodeOutput(
    ctx: ExecutionContext,
    loopId: string,
    nodeId: string,
    output: NormalizedBlockOutput
  ): void {
    const scope = ctx.loopExecutions?.get(loopId)
    if (!scope) {
      logger.warn('Loop scope not found for node output storage', { loopId, nodeId })
      return
    }

    const baseId = extractBaseBlockId(nodeId)
    scope.currentIterationOutputs.set(baseId, output)
  }

  async evaluateLoopContinuation(
    ctx: ExecutionContext,
    loopId: string
  ): Promise<LoopContinuationResult> {
    const scope = ctx.loopExecutions?.get(loopId)
    if (!scope) {
      logger.error('Loop scope not found during continuation evaluation', { loopId })
      return {
        shouldContinue: false,
        shouldExit: true,
        selectedRoute: EDGE.LOOP_EXIT,
      }
    }

    const useRedis = isRedisCancellationEnabled() && !!ctx.executionId
    let isCancelled = false
    if (useRedis) {
      isCancelled = await isExecutionCancelled(ctx.executionId!)
    } else {
      isCancelled = ctx.abortSignal?.aborted ?? false
    }
    if (isCancelled) {
      logger.info('Loop execution cancelled', { loopId, iteration: scope.iteration })
      return await this.createExitResult(ctx, loopId, scope)
    }

    const iterationResults: NormalizedBlockOutput[] = []
    for (const blockOutput of scope.currentIterationOutputs.values()) {
      iterationResults.push(blockOutput)
    }

    if (iterationResults.length > 0) {
      scope.allIterationOutputs.push(iterationResults)
    }

    scope.currentIterationOutputs.clear()

    if (!(await this.evaluateCondition(ctx, scope, scope.iteration + 1))) {
      return await this.createExitResult(ctx, loopId, scope)
    }

    scope.iteration++

    if (scope.items && scope.iteration < scope.items.length) {
      scope.item = scope.items[scope.iteration]
    }

    return {
      shouldContinue: true,
      shouldExit: false,
      selectedRoute: EDGE.LOOP_CONTINUE,
    }
  }

  private async createExitResult(
    ctx: ExecutionContext,
    loopId: string,
    scope: LoopScope
  ): Promise<LoopContinuationResult> {
    const results = scope.allIterationOutputs
    const output = { results }
    this.state.setBlockOutput(loopId, output, DEFAULTS.EXECUTION_TIME)

    await emitSubflowSuccessEvents(ctx, loopId, 'loop', output, this.contextExtensions)

    return {
      shouldContinue: false,
      shouldExit: true,
      selectedRoute: EDGE.LOOP_EXIT,
      aggregatedResults: results,
    }
  }

  private async evaluateCondition(
    ctx: ExecutionContext,
    scope: LoopScope,
    iteration?: number
  ): Promise<boolean> {
    if (!scope.condition) {
      logger.warn('No condition defined for loop')
      return false
    }

    const currentIteration = scope.iteration
    if (iteration !== undefined) {
      scope.iteration = iteration
    }

    const result = await this.evaluateWhileCondition(ctx, scope.condition, scope)

    if (iteration !== undefined) {
      scope.iteration = currentIteration
    }

    return result
  }

  clearLoopExecutionState(loopId: string, ctx: ExecutionContext): void {
    const allNodeIds = this.collectAllLoopNodeIds(loopId)

    for (const nodeId of allNodeIds) {
      this.state.unmarkExecuted(nodeId)
    }

    this.resetNestedLoopScopes(loopId, ctx)
    this.resetNestedParallelScopes(loopId, ctx)
  }

  /**
   * Deletes loop scopes for any nested loops so they re-initialize
   * on the next outer iteration.
   */
  private resetNestedLoopScopes(loopId: string, ctx: ExecutionContext): void {
    const loopConfig = this.dag.loopConfigs.get(loopId) as LoopConfigWithNodes | undefined
    if (!loopConfig) return

    for (const nodeId of loopConfig.nodes) {
      if (this.dag.loopConfigs.has(nodeId)) {
        ctx.loopExecutions?.delete(nodeId)
        // Delete cloned loop variants (__obranch-N and __clone*) but not original
        // subflowParentMap entries which are needed for SSE iteration context.
        if (ctx.loopExecutions) {
          const obranchPrefix = `${nodeId}__obranch-`
          const cloneSeqPrefix = `${nodeId}__clone`
          for (const key of ctx.loopExecutions.keys()) {
            if (key.startsWith(obranchPrefix) || key.startsWith(cloneSeqPrefix)) {
              ctx.loopExecutions.delete(key)
              ctx.subflowParentMap?.delete(key)
            }
          }
        }
        this.resetNestedLoopScopes(nodeId, ctx)
      }
    }
  }

  /**
   * Deletes parallel scopes for any nested parallels (including cloned
   * subflows with `__obranch-N` suffixes) so they re-initialize on the
   * next outer loop iteration.
   */
  private resetNestedParallelScopes(loopId: string, ctx: ExecutionContext): void {
    const loopConfig = this.dag.loopConfigs.get(loopId) as LoopConfigWithNodes | undefined
    if (!loopConfig) return

    for (const nodeId of loopConfig.nodes) {
      if (this.dag.parallelConfigs.has(nodeId)) {
        this.deleteParallelScopeAndClones(nodeId, ctx)
      } else if (this.dag.loopConfigs.has(nodeId)) {
        this.resetNestedParallelScopes(nodeId, ctx)
      }
    }
  }

  /**
   * Deletes a parallel scope and any cloned variants (`__obranch-N`),
   * recursively handling nested subflows within the parallel.
   */
  private deleteParallelScopeAndClones(parallelId: string, ctx: ExecutionContext): void {
    ctx.parallelExecutions?.delete(parallelId)
    // Delete cloned scopes (__obranch-N and __clone*) but not original subflowParentMap entries
    if (ctx.parallelExecutions) {
      const obranchPrefix = `${parallelId}__obranch-`
      const clonePrefix = `${parallelId}__clone`
      for (const key of ctx.parallelExecutions.keys()) {
        if (key.startsWith(obranchPrefix) || key.startsWith(clonePrefix)) {
          ctx.parallelExecutions.delete(key)
          ctx.subflowParentMap?.delete(key)
        }
      }
    }

    const parallelConfig = this.dag.parallelConfigs.get(parallelId)
    if (parallelConfig?.nodes) {
      for (const nodeId of parallelConfig.nodes) {
        if (this.dag.parallelConfigs.has(nodeId)) {
          this.deleteParallelScopeAndClones(nodeId, ctx)
        } else if (this.dag.loopConfigs.has(nodeId)) {
          ctx.loopExecutions?.delete(nodeId)
          // Also delete cloned loop scopes (__obranch-N and __clone*) created by expandParallel
          if (ctx.loopExecutions) {
            const obranchPrefix = `${nodeId}__obranch-`
            const cloneSeqPrefix = `${nodeId}__clone`
            for (const key of ctx.loopExecutions.keys()) {
              if (key.startsWith(obranchPrefix) || key.startsWith(cloneSeqPrefix)) {
                ctx.loopExecutions.delete(key)
                ctx.subflowParentMap?.delete(key)
              }
            }
          }
          this.resetNestedParallelScopes(nodeId, ctx)
        }
      }
    }
  }

  /**
   * Collects all effective DAG node IDs for a loop, recursively including
   * sentinel IDs for any nested subflow blocks (loops and parallels).
   */
  private collectAllLoopNodeIds(loopId: string, visited = new Set<string>()): Set<string> {
    if (visited.has(loopId)) return new Set()
    visited.add(loopId)

    const loopConfig = this.dag.loopConfigs.get(loopId) as LoopConfigWithNodes | undefined
    if (!loopConfig) return new Set()

    const sentinelStartId = buildSentinelStartId(loopId)
    const sentinelEndId = buildSentinelEndId(loopId)
    const result = new Set([sentinelStartId, sentinelEndId])

    for (const nodeId of loopConfig.nodes) {
      if (this.dag.loopConfigs.has(nodeId)) {
        for (const id of this.collectAllLoopNodeIds(nodeId, visited)) {
          result.add(id)
        }
        this.collectClonedSubflowNodes(nodeId, result, visited)
      } else if (this.dag.parallelConfigs.has(nodeId)) {
        for (const id of this.collectAllParallelNodeIds(nodeId, visited)) {
          result.add(id)
        }
        this.collectClonedSubflowNodes(nodeId, result, visited)
      } else {
        result.add(nodeId)
      }
    }

    return result
  }

  /**
   * Collects all effective DAG node IDs for a parallel, including
   * sentinel IDs and branch template nodes, recursively handling nested subflows.
   */
  private collectAllParallelNodeIds(parallelId: string, visited = new Set<string>()): Set<string> {
    if (visited.has(parallelId)) return new Set()
    visited.add(parallelId)

    const parallelConfig = this.dag.parallelConfigs.get(parallelId)
    if (!parallelConfig) return new Set()

    const sentinelStartId = buildParallelSentinelStartId(parallelId)
    const sentinelEndId = buildParallelSentinelEndId(parallelId)
    const result = new Set([sentinelStartId, sentinelEndId])

    for (const nodeId of parallelConfig.nodes) {
      if (this.dag.loopConfigs.has(nodeId)) {
        for (const id of this.collectAllLoopNodeIds(nodeId, visited)) {
          result.add(id)
        }
        this.collectClonedSubflowNodes(nodeId, result, visited)
      } else if (this.dag.parallelConfigs.has(nodeId)) {
        for (const id of this.collectAllParallelNodeIds(nodeId, visited)) {
          result.add(id)
        }
        this.collectClonedSubflowNodes(nodeId, result, visited)
      } else {
        result.add(nodeId)
        this.collectAllBranchNodes(nodeId, result)
      }
    }

    return result
  }

  /**
   * Collects all branch nodes for a given base block ID by scanning the DAG.
   * This captures dynamically created branches (1, 2, ...) beyond the template (0).
   */
  private collectAllBranchNodes(baseNodeId: string, result: Set<string>): void {
    const prefix = `${baseNodeId}${PARALLEL.BRANCH.PREFIX}`
    for (const dagNodeId of this.dag.nodes.keys()) {
      if (dagNodeId.startsWith(prefix)) {
        result.add(dagNodeId)
      }
    }
  }

  /**
   * Collects all cloned subflow variants (e.g., loop-1__obranch-N) and their
   * descendant nodes by scanning the DAG configs.
   */
  private collectClonedSubflowNodes(
    originalId: string,
    result: Set<string>,
    visited: Set<string>
  ): void {
    const obranchPrefix = `${originalId}__obranch-`
    const clonePrefix = `${originalId}__clone`
    for (const loopId of this.dag.loopConfigs.keys()) {
      if (loopId.startsWith(obranchPrefix) || loopId.startsWith(clonePrefix)) {
        for (const id of this.collectAllLoopNodeIds(loopId, visited)) {
          result.add(id)
        }
      }
    }
    for (const parallelId of this.dag.parallelConfigs.keys()) {
      if (parallelId.startsWith(obranchPrefix) || parallelId.startsWith(clonePrefix)) {
        for (const id of this.collectAllParallelNodeIds(parallelId, visited)) {
          result.add(id)
        }
      }
    }
  }

  restoreLoopEdges(loopId: string): void {
    const loopConfig = this.dag.loopConfigs.get(loopId) as LoopConfigWithNodes | undefined
    if (!loopConfig) {
      logger.warn('Loop config not found for edge restoration', { loopId })
      return
    }

    const allLoopNodeIds = this.collectAllLoopNodeIds(loopId)

    if (this.edgeManager) {
      this.edgeManager.clearDeactivatedEdgesForNodes(allLoopNodeIds)
    }

    for (const nodeId of allLoopNodeIds) {
      const nodeToRestore = this.dag.nodes.get(nodeId)
      if (!nodeToRestore) continue

      for (const potentialSourceId of allLoopNodeIds) {
        const potentialSourceNode = this.dag.nodes.get(potentialSourceId)
        if (!potentialSourceNode) continue

        for (const [, edge] of potentialSourceNode.outgoingEdges) {
          if (edge.target === nodeId) {
            const isBackwardEdge =
              edge.sourceHandle === EDGE.LOOP_CONTINUE ||
              edge.sourceHandle === EDGE.LOOP_CONTINUE_ALT

            if (!isBackwardEdge) {
              nodeToRestore.incomingEdges.add(potentialSourceId)
            }
          }
        }
      }
    }
  }

  getLoopScope(ctx: ExecutionContext, loopId: string): LoopScope | undefined {
    return ctx.loopExecutions?.get(loopId)
  }

  /**
   * Evaluates the initial condition for loops at the sentinel start.
   * - For while loops, the condition must be checked BEFORE the first iteration.
   * - For forEach loops, skip if the items array is empty.
   * - For for loops, skip if maxIterations is 0.
   * - For doWhile loops, always execute at least once.
   *
   * @returns true if the loop should execute, false if it should be skipped
   */
  async evaluateInitialCondition(ctx: ExecutionContext, loopId: string): Promise<boolean> {
    const scope = ctx.loopExecutions?.get(loopId)
    if (!scope) {
      logger.warn('Loop scope not found for initial condition evaluation', { loopId })
      return true
    }

    if (scope.loopType === 'forEach') {
      if (!scope.items || scope.items.length === 0) {
        logger.info('ForEach loop has empty collection, skipping loop body', { loopId })
        this.state.setBlockOutput(loopId, { results: [] }, DEFAULTS.EXECUTION_TIME)
        await emitEmptySubflowEvents(ctx, loopId, 'loop', this.contextExtensions)
        return false
      }
      return true
    }

    if (scope.loopType === 'for') {
      if (scope.maxIterations === 0) {
        logger.info('For loop has 0 iterations, skipping loop body', { loopId })
        this.state.setBlockOutput(loopId, { results: [] }, DEFAULTS.EXECUTION_TIME)
        await emitEmptySubflowEvents(ctx, loopId, 'loop', this.contextExtensions)
        return false
      }
      return true
    }

    if (scope.loopType === 'doWhile') {
      return true
    }

    if (scope.loopType === 'while') {
      if (!scope.condition) {
        logger.warn('No condition defined for while loop', { loopId })
        this.state.setBlockOutput(loopId, { results: [] }, DEFAULTS.EXECUTION_TIME)
        await emitEmptySubflowEvents(ctx, loopId, 'loop', this.contextExtensions)
        return false
      }

      const result = await this.evaluateWhileCondition(ctx, scope.condition, scope)
      logger.info('While loop initial condition evaluation', {
        loopId,
        condition: scope.condition,
        result,
      })

      if (!result) {
        this.state.setBlockOutput(loopId, { results: [] }, DEFAULTS.EXECUTION_TIME)
        await emitEmptySubflowEvents(ctx, loopId, 'loop', this.contextExtensions)
      }

      return result
    }

    return true
  }

  private async evaluateWhileCondition(
    ctx: ExecutionContext,
    condition: string,
    scope: LoopScope
  ): Promise<boolean> {
    if (!condition) {
      return false
    }

    try {
      logger.info('Evaluating loop condition', {
        originalCondition: condition,
        iteration: scope.iteration,
        workflowVariables: ctx.workflowVariables,
      })

      const evaluatedCondition = replaceValidReferences(condition, (match) => {
        const resolved = this.resolver.resolveSingleReference(ctx, '', match, scope)
        logger.debug('Resolved variable reference in loop condition', {
          reference: match,
          resolvedValue: resolved,
        })
        if (resolved !== undefined) {
          if (typeof resolved === 'boolean' || typeof resolved === 'number') {
            return String(resolved)
          }
          if (typeof resolved === 'string') {
            const lower = resolved.toLowerCase().trim()
            if (lower === 'true' || lower === 'false') {
              return lower
            }
            return `"${resolved}"`
          }
          return JSON.stringify(resolved)
        }
        return match
      })

      const requestId = generateRequestId()
      const code = `return Boolean(${evaluatedCondition})`

      const vmResult = await executeInIsolatedVM({
        code,
        params: {},
        envVars: {},
        contextVariables: {},
        timeoutMs: LOOP_CONDITION_TIMEOUT_MS,
        requestId,
        ownerKey: `user:${ctx.userId}`,
        ownerWeight: 1,
      })

      if (vmResult.error) {
        logger.error('Failed to evaluate loop condition', {
          condition,
          evaluatedCondition,
          error: vmResult.error,
        })
        return false
      }

      const result = Boolean(vmResult.result)

      logger.info('Loop condition evaluation result', {
        originalCondition: condition,
        evaluatedCondition,
        result,
      })

      return result
    } catch (error) {
      logger.error('Failed to evaluate loop condition', { condition, error })
      return false
    }
  }
}
