/**
 * SubflowManager
 * 
 * Manages loop and parallel execution logic.
 * Handles iteration tracking, backwards edges, and result aggregation.
 */

import { createLogger } from '@/lib/logs/console/logger'
import type { ExecutionContext, NormalizedBlockOutput } from '@/executor/types'
import type { SerializedWorkflow } from '@/serializer/types'
import type { DAG } from './dag-builder'
import type { ExecutionState, LoopScope, ParallelScope } from './execution-state'
import type { VariableResolver } from './variable-resolver'

const logger = createLogger('SubflowManager')

export class SubflowManager {
  constructor(
    private workflow: SerializedWorkflow,
    private dag: DAG,
    private state: ExecutionState,
    private resolver: VariableResolver
  ) {}

  initializeLoopScope(loopId: string, context: ExecutionContext): LoopScope {
    const loopConfig = this.dag.loopConfigs.get(loopId) as any
    if (!loopConfig) {
      throw new Error(`Loop config not found: ${loopId}`)
    }

    const scope: LoopScope = {
      iteration: 0,
      currentIterationOutputs: new Map(),
      allIterationOutputs: [],
    }

    const loopType = loopConfig.loopType

    if (loopType === 'for') {
      scope.maxIterations = loopConfig.iterations || 1
    } else if (loopType === 'forEach') {
      const items = this.resolveForEachItems(loopConfig.forEachItems, context)
      scope.items = items
      scope.maxIterations = items.length
    }

    this.state.setLoopScope(loopId, scope)
    return scope
  }

  initializeParallelScope(parallelId: string, totalBranches: number): ParallelScope {
    const scope: ParallelScope = {
      parallelId,
      totalBranches,
      branchOutputs: new Map(),
    }

    this.state.setParallelScope(parallelId, scope)
    return scope
  }

  handleLoopIteration(
    loopId: string,
    lastNodeId: string,
    output: NormalizedBlockOutput,
    context: ExecutionContext
  ): { shouldContinue: boolean; nextNodeId?: string } {
    const scope = this.state.getLoopScope(loopId)
    if (!scope) {
      return { shouldContinue: false }
    }

    const baseId = this.extractBaseId(lastNodeId)
    scope.currentIterationOutputs.set(baseId, output)

    const loopConfig = this.dag.loopConfigs.get(loopId)
    if (!loopConfig) {
      return { shouldContinue: false }
    }

    const isLastNodeInLoop = loopConfig.nodes[loopConfig.nodes.length - 1] === lastNodeId

    if (!isLastNodeInLoop) {
      return { shouldContinue: true }
    }

    const iterationResults: NormalizedBlockOutput[] = []
    for (const blockOutput of scope.currentIterationOutputs.values()) {
      iterationResults.push(blockOutput)
    }

    if (iterationResults.length > 0) {
      scope.allIterationOutputs.push(iterationResults)
    }

    scope.currentIterationOutputs.clear()

    const shouldContinue = this.shouldLoopContinue(loopId, scope, context)

    if (shouldContinue) {
      scope.iteration++
      
      if (scope.items && scope.iteration < scope.items.length) {
        scope.item = scope.items[scope.iteration]
      }

      const firstNodeId = loopConfig.nodes[0]
      return { shouldContinue: true, nextNodeId: firstNodeId }
    }

    this.aggregateLoopResults(loopId, scope)
    return { shouldContinue: false }
  }

  handleParallelBranch(
    parallelId: string,
    nodeId: string,
    output: NormalizedBlockOutput
  ): boolean {
    const scope = this.state.getParallelScope(parallelId)
    if (!scope) {
      return false
    }

    const branchIndex = this.extractBranchIndex(nodeId)
    if (branchIndex === null) {
      return false
    }

    scope.branchOutputs.set(branchIndex, output)

    const allBranchesComplete = scope.branchOutputs.size === scope.totalBranches

    if (allBranchesComplete) {
      this.aggregateParallelResults(parallelId, scope)
    }

    return allBranchesComplete
  }

  private shouldLoopContinue(loopId: string, scope: LoopScope, context: ExecutionContext): boolean {
    const loopConfig = this.dag.loopConfigs.get(loopId) as any
    if (!loopConfig) {
      return false
    }

    const loopType = loopConfig.loopType

    if (loopType === 'while') {
      const whileCondition = loopConfig.whileCondition
      return this.evaluateWhileCondition(whileCondition, scope, context)
    }

    if (scope.maxIterations === undefined) {
      return false
    }

    return scope.iteration < scope.maxIterations - 1
  }

  evaluateWhileCondition(condition: string, scope: LoopScope, context: ExecutionContext): boolean {
    if (!condition) {
      return false
    }

    try {
      let evaluatedCondition = condition

      evaluatedCondition = evaluatedCondition.replace(/<loop\.iteration>/g, String(scope.iteration))
      evaluatedCondition = evaluatedCondition.replace(/<loop\.item>/g, JSON.stringify(scope.item))

      const variablePattern = /<variable\.(\w+)>/g
      const variableMatches = evaluatedCondition.match(variablePattern)
      
      if (variableMatches) {
        for (const match of variableMatches) {
          const resolved = this.resolver.resolveSingleReference(match, '', context)
          if (resolved !== undefined) {
            evaluatedCondition = evaluatedCondition.replace(match, String(resolved))
          }
        }
      }

      return Boolean(eval(`(${evaluatedCondition})`))
    } catch (error) {
      logger.error('Failed to evaluate while condition', { condition, error })
      return false
    }
  }

  private aggregateLoopResults(loopId: string, scope: LoopScope): void {
    const results = scope.allIterationOutputs

    this.state.setBlockOutput(loopId, {
      results,
    })

    logger.debug('Aggregated loop results', {
      loopId,
      totalIterations: scope.allIterationOutputs.length,
    })
  }

  private aggregateParallelResults(parallelId: string, scope: ParallelScope): void {
    const results: NormalizedBlockOutput[] = []

    for (let i = 0; i < scope.totalBranches; i++) {
      const branchOutput = scope.branchOutputs.get(i)
      if (branchOutput) {
        results.push(branchOutput)
      }
    }

    this.state.setBlockOutput(parallelId, {
      results,
    })

    logger.debug('Aggregated parallel results', {
      parallelId,
      totalBranches: scope.totalBranches,
    })
  }

  private resolveForEachItems(items: any, context: ExecutionContext): any[] {
    const resolved = this.resolver.resolveInputs({ items }, '', context).items

    if (Array.isArray(resolved)) {
      return resolved
    }

    if (typeof resolved === 'object' && resolved !== null) {
      return Object.entries(resolved)
    }

    return []
  }

  private extractBaseId(nodeId: string): string {
    return nodeId.replace(/₍\d+₎$/, '')
  }

  private extractBranchIndex(nodeId: string): number | null {
    const match = nodeId.match(/₍(\d+)₎$/)
    return match ? parseInt(match[1], 10) : null
  }
}

