import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { compactSubflowResults } from '@/lib/execution/payloads/serializer'
import { DEFAULTS } from '@/executor/constants'
import type { DAG } from '@/executor/dag/builder'
import type { EdgeManager } from '@/executor/execution/edge-manager'
import type { ParallelScope } from '@/executor/execution/state'
import type { BlockStateWriter, ContextExtensions } from '@/executor/execution/types'
import type { ExecutionContext, NormalizedBlockOutput } from '@/executor/types'
import { type ClonedSubflowInfo, ParallelExpander } from '@/executor/utils/parallel-expansion'
import {
  addSubflowErrorLog,
  buildBranchNodeId,
  buildParallelSentinelEndId,
  buildParallelSentinelStartId,
  buildSentinelEndId,
  buildSentinelStartId,
  emitSubflowSuccessEvents,
  extractBaseBlockId,
  extractBranchIndex,
} from '@/executor/utils/subflow-utils'
import { resolveArrayInputAsync } from '@/executor/utils/subflow-utils.server'
import type { VariableResolver } from '@/executor/variables/resolver'
import type { SerializedParallel } from '@/serializer/types'

const logger = createLogger('ParallelOrchestrator')
const DEFAULT_PARALLEL_BATCH_SIZE = 20

export interface ParallelBranchMetadata {
  branchIndex: number
  branchTotal: number
  distributionItem?: any
  parallelId: string
}

export interface ParallelAggregationResult {
  allBranchesComplete: boolean
  results?: unknown
  completedBranches?: number
  totalBranches?: number
}

export class ParallelOrchestrator {
  private expander = new ParallelExpander()

  constructor(
    private dag: DAG,
    private state: BlockStateWriter,
    private resolver: VariableResolver | null = null,
    private contextExtensions: ContextExtensions | null = null,
    private edgeManager: Pick<EdgeManager, 'clearDeactivatedEdgesForNodes'> | null = null
  ) {}

  async initializeParallelScope(ctx: ExecutionContext, parallelId: string): Promise<ParallelScope> {
    const parallelConfig = this.dag.parallelConfigs.get(parallelId)
    if (!parallelConfig) {
      throw new Error(`Parallel config not found: ${parallelId}`)
    }

    if (parallelConfig.nodes.length === 0) {
      const errorMessage =
        'Parallel has no executable blocks inside. Add or enable at least one block in the parallel.'
      logger.error(errorMessage, { parallelId })
      await this.addParallelErrorLog(ctx, parallelId, errorMessage, {})
      this.setErrorScope(ctx, parallelId, errorMessage)
      throw new Error(errorMessage)
    }

    let items: any[] | undefined
    let branchCount: number
    let isEmpty = false

    try {
      const resolved = await this.resolveBranchCount(ctx, parallelConfig, parallelId)
      branchCount = resolved.branchCount
      items = resolved.items
      isEmpty = resolved.isEmpty ?? false
    } catch (error) {
      const baseErrorMessage = toError(error).message
      const errorMessage = baseErrorMessage.startsWith('Parallel collection distribution is empty')
        ? baseErrorMessage
        : `Parallel Items did not resolve: ${baseErrorMessage}`
      logger.error(errorMessage, { parallelId, distribution: parallelConfig.distribution })
      await this.addParallelErrorLog(ctx, parallelId, errorMessage, {
        distribution: parallelConfig.distribution,
      })
      this.setErrorScope(ctx, parallelId, errorMessage)
      throw new Error(errorMessage)
    }

    if (isEmpty || branchCount === 0) {
      const scope: ParallelScope = {
        parallelId,
        totalBranches: 0,
        branchOutputs: new Map(),
        items: [],
        isEmpty: true,
      }

      if (!ctx.parallelExecutions) {
        ctx.parallelExecutions = new Map()
      }
      ctx.parallelExecutions.set(parallelId, scope)

      logger.info('Parallel scope initialized with empty distribution, skipping body', {
        parallelId,
        branchCount: 0,
      })

      return scope
    }

    const batchSize = this.resolveBatchSize(parallelConfig.batchSize)
    const currentBatchSize = Math.min(batchSize, branchCount)
    const scope: ParallelScope = {
      parallelId,
      totalBranches: branchCount,
      batchSize,
      currentBatchStart: 0,
      currentBatchSize,
      accumulatedOutputs: new Map(),
      branchOutputs: new Map(),
      items,
    }

    if (!ctx.parallelExecutions) {
      ctx.parallelExecutions = new Map()
    }
    ctx.parallelExecutions.set(parallelId, scope)

    logger.info('Parallel scope initialized', {
      parallelId,
      branchCount,
      batchSize,
      currentBatchSize,
    })

    return scope
  }

  prepareCurrentBatch(ctx: ExecutionContext, parallelId: string): void {
    const scope = ctx.parallelExecutions?.get(parallelId)
    if (!scope || scope.isEmpty) {
      return
    }

    const currentBatchStart = scope.currentBatchStart ?? 0
    const currentBatchSize =
      scope.currentBatchSize ??
      Math.min(scope.batchSize ?? DEFAULT_PARALLEL_BATCH_SIZE, scope.totalBranches)

    if (currentBatchSize <= 0) {
      return
    }

    const batchItems = scope.items?.slice(currentBatchStart, currentBatchStart + currentBatchSize)
    const { clonedSubflows, allBranchNodes, entryNodes, terminalNodes } =
      this.expander.expandParallel(this.dag, parallelId, currentBatchSize, batchItems, {
        branchIndexOffset: currentBatchStart,
        totalBranches: scope.totalBranches,
      })

    this.markRunFromBlockBatchDirty(
      ctx,
      parallelId,
      allBranchNodes,
      entryNodes,
      terminalNodes,
      clonedSubflows
    )
    this.registerClonedSubflows(ctx, parallelId, clonedSubflows)
    this.registerBranchMappings(ctx, parallelId, allBranchNodes)
    this.resetBatchExecutionState(allBranchNodes)
    this.edgeManager?.clearDeactivatedEdgesForNodes(new Set(allBranchNodes))

    logger.info('Prepared parallel batch', {
      parallelId,
      currentBatchStart,
      currentBatchSize,
      totalBranches: scope.totalBranches,
      branchNodeCount: allBranchNodes.length,
    })
  }

  private async resolveBranchCount(
    ctx: ExecutionContext,
    config: SerializedParallel,
    parallelId: string
  ): Promise<{ branchCount: number; items?: any[]; isEmpty?: boolean }> {
    if (config.parallelType === 'count') {
      return { branchCount: config.count ?? 1 }
    }

    const items = await this.resolveDistributionItems(ctx, config)
    if (items.length === 0) {
      logger.info('Parallel has empty distribution, skipping parallel body', { parallelId })
      return { branchCount: 0, items: [], isEmpty: true }
    }

    return { branchCount: items.length, items }
  }

  private async addParallelErrorLog(
    ctx: ExecutionContext,
    parallelId: string,
    errorMessage: string,
    inputData?: any
  ): Promise<void> {
    await addSubflowErrorLog(
      ctx,
      parallelId,
      'parallel',
      errorMessage,
      inputData || {},
      this.contextExtensions
    )
  }

  private setErrorScope(ctx: ExecutionContext, parallelId: string, errorMessage: string): void {
    const scope: ParallelScope = {
      parallelId,
      totalBranches: 0,
      branchOutputs: new Map(),
      items: [],
      validationError: errorMessage,
    }
    if (!ctx.parallelExecutions) {
      ctx.parallelExecutions = new Map()
    }
    ctx.parallelExecutions.set(parallelId, scope)
  }

  private async resolveDistributionItems(
    ctx: ExecutionContext,
    config: SerializedParallel
  ): Promise<any[]> {
    if (
      config.distribution === undefined ||
      config.distribution === null ||
      config.distribution === ''
    ) {
      throw new Error(
        'Parallel collection distribution is empty. Provide an array or a reference that resolves to a collection.'
      )
    }
    return resolveArrayInputAsync(
      ctx,
      config.distribution,
      this.resolver,
      buildParallelSentinelStartId(config.id)
    )
  }

  private resolveBatchSize(batchSize: unknown): number {
    const parsed =
      typeof batchSize === 'number' ? batchSize : Number.parseInt(String(batchSize), 10)
    if (Number.isNaN(parsed)) {
      return DEFAULT_PARALLEL_BATCH_SIZE
    }
    return Math.max(1, Math.min(DEFAULTS.MAX_PARALLEL_BRANCHES, parsed))
  }

  private registerClonedSubflows(
    ctx: ExecutionContext,
    parallelId: string,
    clonedSubflows: ClonedSubflowInfo[]
  ): void {
    if (clonedSubflows.length === 0 || !ctx.subflowParentMap) {
      return
    }

    const branchCloneMaps = new Map<number, Map<string, string>>()
    for (const clone of clonedSubflows) {
      let map = branchCloneMaps.get(clone.outerBranchIndex)
      if (!map) {
        map = new Map()
        branchCloneMaps.set(clone.outerBranchIndex, map)
      }
      map.set(clone.originalId, clone.clonedId)
    }

    for (const clone of clonedSubflows) {
      const originalEntry = ctx.subflowParentMap.get(clone.originalId)
      if (originalEntry) {
        const cloneMap = branchCloneMaps.get(clone.outerBranchIndex)
        const clonedParentId = cloneMap?.get(originalEntry.parentId)
        if (clonedParentId) {
          ctx.subflowParentMap.set(clone.clonedId, {
            parentId: clonedParentId,
            parentType: originalEntry.parentType,
            branchIndex: 0,
          })
        } else {
          ctx.subflowParentMap.set(clone.clonedId, {
            parentId: parallelId,
            parentType: 'parallel',
            branchIndex: clone.outerBranchIndex,
          })
        }
      } else {
        ctx.subflowParentMap.set(clone.clonedId, {
          parentId: parallelId,
          parentType: 'parallel',
          branchIndex: clone.outerBranchIndex,
        })
      }
    }
  }

  private markRunFromBlockBatchDirty(
    ctx: ExecutionContext,
    parallelId: string,
    allBranchNodes: string[],
    entryNodes: string[],
    terminalNodes: string[],
    clonedSubflows: ClonedSubflowInfo[]
  ): void {
    const dirtySet = ctx.runFromBlockContext?.dirtySet
    if (!dirtySet) return

    const parallelStartId = buildParallelSentinelStartId(parallelId)
    const parallelEndId = buildParallelSentinelEndId(parallelId)
    if (
      !dirtySet.has(parallelId) &&
      !dirtySet.has(parallelStartId) &&
      !dirtySet.has(parallelEndId)
    ) {
      return
    }

    for (const nodeId of allBranchNodes) dirtySet.add(nodeId)
    for (const nodeId of entryNodes) dirtySet.add(nodeId)
    for (const nodeId of terminalNodes) dirtySet.add(nodeId)

    const config = this.dag.parallelConfigs.get(parallelId)
    for (const nodeId of config?.nodes ?? []) {
      if (this.dag.parallelConfigs.has(nodeId) || this.dag.loopConfigs.has(nodeId)) {
        this.collectSubflowNodeIds(nodeId, dirtySet)
      }
    }

    for (const clone of clonedSubflows) {
      dirtySet.add(clone.clonedId)
      this.collectSubflowNodeIds(clone.clonedId, dirtySet)
    }
  }

  private collectSubflowNodeIds(
    subflowId: string,
    nodeIds: Set<string>,
    visited = new Set<string>()
  ): void {
    if (visited.has(subflowId)) return
    visited.add(subflowId)

    if (this.dag.parallelConfigs.has(subflowId)) {
      nodeIds.add(buildParallelSentinelStartId(subflowId))
      nodeIds.add(buildParallelSentinelEndId(subflowId))
      for (const childId of this.dag.parallelConfigs.get(subflowId)?.nodes ?? []) {
        if (this.dag.parallelConfigs.has(childId) || this.dag.loopConfigs.has(childId)) {
          this.collectSubflowNodeIds(childId, nodeIds, visited)
        } else {
          nodeIds.add(buildBranchNodeId(childId, 0))
        }
      }
      return
    }

    if (this.dag.loopConfigs.has(subflowId)) {
      nodeIds.add(buildSentinelStartId(subflowId))
      nodeIds.add(buildSentinelEndId(subflowId))
      for (const childId of this.dag.loopConfigs.get(subflowId)?.nodes ?? []) {
        if (this.dag.parallelConfigs.has(childId) || this.dag.loopConfigs.has(childId)) {
          this.collectSubflowNodeIds(childId, nodeIds, visited)
        } else {
          nodeIds.add(childId)
        }
      }
    }
  }

  /**
   * Stores a node's output in the branch outputs for later aggregation.
   * Aggregation is triggered by the sentinel-end node via the edge mechanism,
   * not by counting individual node completions. This avoids incorrect completion
   * detection when branches have conditional paths (error edges, conditions).
   */
  handleParallelBranchCompletion(
    ctx: ExecutionContext,
    parallelId: string,
    nodeId: string,
    output: NormalizedBlockOutput,
    branchIndexOverride?: number
  ): void {
    const scope = ctx.parallelExecutions?.get(parallelId)
    if (!scope) {
      logger.warn('Parallel scope not found for branch completion', { parallelId, nodeId })
      return
    }

    const mappedBranch = ctx.parallelBlockMapping?.get(nodeId)
    const branchIndex =
      branchIndexOverride ??
      (mappedBranch?.parallelId === parallelId
        ? mappedBranch.iterationIndex
        : (this.dag.nodes.get(nodeId)?.metadata.branchIndex ?? extractBranchIndex(nodeId)))
    if (branchIndex === null) {
      logger.warn('Could not extract branch index from node ID', { nodeId })
      return
    }

    if (!scope.branchOutputs.has(branchIndex)) {
      scope.branchOutputs.set(branchIndex, [])
    }
    scope.branchOutputs.get(branchIndex)!.push(output)
  }

  async aggregateParallelResults(
    ctx: ExecutionContext,
    parallelId: string
  ): Promise<ParallelAggregationResult> {
    const scope = ctx.parallelExecutions?.get(parallelId)
    if (!scope) {
      logger.error('Parallel scope not found for aggregation', { parallelId })
      return { allBranchesComplete: false }
    }

    const accumulatedOutputs =
      scope.accumulatedOutputs ?? new Map<number, NormalizedBlockOutput[]>()
    for (const [branchIndex, outputs] of scope.branchOutputs.entries()) {
      accumulatedOutputs.set(branchIndex, outputs)
    }
    scope.accumulatedOutputs = accumulatedOutputs
    scope.branchOutputs = new Map()

    const nextBatchStart =
      (scope.currentBatchStart ?? 0) + (scope.currentBatchSize ?? scope.totalBranches)
    if (nextBatchStart < scope.totalBranches) {
      /**
       * Compact accumulated outputs before scheduling the next batch. Each
       * block output is already individually compacted by `block-executor`, but
       * many below-threshold branch results can still exceed the aggregate
       * threshold over time. Re-running the existing subflow compactor over the
       * accumulated entries forces aggregate-size spills while existing
       * LargeValueRefs stay stable.
       */
      if (accumulatedOutputs.size > 0) {
        const accumulatedBranchIndexes = Array.from(accumulatedOutputs.keys()).sort((a, b) => a - b)
        const accumulatedResults = accumulatedBranchIndexes.map(
          (idx) => accumulatedOutputs.get(idx) ?? []
        )
        const compactedAccumulated = await compactSubflowResults(accumulatedResults, {
          workspaceId: ctx.workspaceId,
          workflowId: ctx.workflowId,
          executionId: ctx.executionId,
          largeValueExecutionIds: ctx.largeValueExecutionIds,
          largeValueKeys: ctx.largeValueKeys,
          allowLargeValueWorkflowScope: ctx.allowLargeValueWorkflowScope,
          userId: ctx.userId,
          requireDurable: true,
        })
        accumulatedBranchIndexes.forEach((branchIdx, position) => {
          accumulatedOutputs.set(branchIdx, compactedAccumulated[position])
        })
      }
      this.advanceToNextBatch(scope, nextBatchStart)
      return {
        allBranchesComplete: false,
        completedBranches: accumulatedOutputs.size,
        totalBranches: scope.totalBranches,
      }
    }

    const results: NormalizedBlockOutput[][] = []
    for (let i = 0; i < scope.totalBranches; i++) {
      const branchOutputs = accumulatedOutputs.get(i)
      if (!branchOutputs) {
        logger.warn('Missing branch output during parallel aggregation', { parallelId, branch: i })
      }
      results.push(branchOutputs ?? [])
    }
    const compactedResults = await compactSubflowResults(results, {
      workspaceId: ctx.workspaceId,
      workflowId: ctx.workflowId,
      executionId: ctx.executionId,
      largeValueExecutionIds: ctx.largeValueExecutionIds,
      largeValueKeys: ctx.largeValueKeys,
      allowLargeValueWorkflowScope: ctx.allowLargeValueWorkflowScope,
      userId: ctx.userId,
      requireDurable: true,
    })
    const output = { results: compactedResults }
    this.state.setBlockOutput(parallelId, output)
    scope.accumulatedOutputs = new Map()

    await emitSubflowSuccessEvents(ctx, parallelId, 'parallel', output, this.contextExtensions)

    return {
      allBranchesComplete: true,
      results: output.results,
      completedBranches: scope.totalBranches,
      totalBranches: scope.totalBranches,
    }
  }

  private advanceToNextBatch(scope: ParallelScope, nextBatchStart: number): void {
    const batchSize = scope.batchSize ?? DEFAULT_PARALLEL_BATCH_SIZE
    const remaining = scope.totalBranches - nextBatchStart
    const currentBatchSize = Math.min(batchSize, remaining)

    scope.currentBatchStart = nextBatchStart
    scope.currentBatchSize = currentBatchSize

    logger.info('Advanced to next parallel batch', {
      parallelId: scope.parallelId,
      nextBatchStart,
      currentBatchSize,
      totalBranches: scope.totalBranches,
    })
  }

  prepareForBatchContinuation(parallelId: string): void {
    this.state.unmarkExecuted(buildParallelSentinelStartId(parallelId))
    this.state.unmarkExecuted(buildParallelSentinelEndId(parallelId))
    this.state.deleteBlockState(buildParallelSentinelEndId(parallelId))
  }

  private resetBatchExecutionState(branchNodeIds: string[]): void {
    for (const nodeId of branchNodeIds) {
      const node = this.dag.nodes.get(nodeId)
      if (!node?.metadata.isParallelBranch) {
        continue
      }
      this.state.unmarkExecuted(nodeId)
      this.state.deleteBlockState(nodeId)
    }
  }

  private registerBranchMappings(
    ctx: ExecutionContext,
    parallelId: string,
    branchNodeIds: string[]
  ): void {
    if (branchNodeIds.length === 0) {
      return
    }

    if (!ctx.parallelBlockMapping) {
      ctx.parallelBlockMapping = new Map()
    }

    for (const nodeId of branchNodeIds) {
      const node = this.dag.nodes.get(nodeId)
      const branchIndex = node?.metadata.branchIndex ?? extractBranchIndex(nodeId)
      if (branchIndex === null || branchIndex === undefined) {
        continue
      }

      ctx.parallelBlockMapping.set(nodeId, {
        originalBlockId: node?.metadata.originalBlockId ?? extractBaseBlockId(nodeId),
        parallelId,
        iterationIndex: branchIndex,
      })
    }
  }

  extractBranchMetadata(nodeId: string): ParallelBranchMetadata | null {
    const node = this.dag.nodes.get(nodeId)
    if (!node?.metadata.isParallelBranch) {
      return null
    }

    const branchIndex = node.metadata.branchIndex ?? extractBranchIndex(nodeId)
    if (branchIndex === null) {
      return null
    }

    const parallelId =
      node.metadata.subflowType === 'parallel' ? node.metadata.subflowId : undefined
    if (!parallelId) {
      return null
    }

    return {
      branchIndex,
      branchTotal: node.metadata.branchTotal ?? 1,
      distributionItem: node.metadata.distributionItem,
      parallelId,
    }
  }

  getParallelScope(ctx: ExecutionContext, parallelId: string): ParallelScope | undefined {
    return ctx.parallelExecutions?.get(parallelId)
  }
}
