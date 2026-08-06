import type { BlockStateController } from '@/executor/execution/types'
import type { BlockState, NormalizedBlockOutput } from '@/executor/types'
import type { ResolvedSecretTraceProvenanceV1 } from '@/executor/utils/resolved-secret-trace-registry'
import { SubflowNodeIdCodec } from '@/executor/utils/subflow-node-id-codec'
import {
  buildOuterBranchScopedId,
  extractOuterBranchIndex,
  stripCloneSuffixes,
} from '@/executor/utils/subflow-utils'

function normalizeLookupId(id: string): string {
  return SubflowNodeIdCodec.normalizeLookupId(id)
}

function extractBranchSuffix(id: string): string {
  return SubflowNodeIdCodec.extractBranchSuffix(id)
}

function extractLoopSuffix(id: string): string {
  return SubflowNodeIdCodec.extractLoopSuffix(id)
}
export interface LoopScope {
  iteration: number
  currentIterationOutputs: Map<string, NormalizedBlockOutput>
  allIterationOutputs: NormalizedBlockOutput[][]
  maxIterations?: number
  item?: any
  items?: any[]
  condition?: string
  loopType?: 'for' | 'forEach' | 'while' | 'doWhile'
  skipFirstConditionCheck?: boolean
  skippedAtStart?: boolean
  /** Error message if loop validation failed (e.g., exceeded max iterations) */
  validationError?: string
  inputResolvedSecretTraceProvenance?: ResolvedSecretTraceProvenanceV1
  resolvedSecretTraceProvenance?: ResolvedSecretTraceProvenanceV1
}

export interface ParallelScope {
  parallelId: string
  totalBranches: number
  batchSize?: number
  currentBatchStart?: number
  currentBatchSize?: number
  accumulatedOutputs?: Map<number, NormalizedBlockOutput[]>
  branchOutputs: Map<number, NormalizedBlockOutput[]>
  items?: any[]
  /** Error message if parallel validation failed (e.g., exceeded max branches) */
  validationError?: string
  /** Whether the parallel has an empty distribution and should be skipped */
  isEmpty?: boolean
  inputResolvedSecretTraceProvenance?: ResolvedSecretTraceProvenanceV1
  resolvedSecretTraceProvenance?: ResolvedSecretTraceProvenanceV1
}

export class ExecutionState implements BlockStateController {
  private readonly blockStates: Map<string, BlockState>
  private readonly executedBlocks: Set<string>

  constructor(blockStates?: Map<string, BlockState>, executedBlocks?: Set<string>) {
    this.blockStates = blockStates ?? new Map()
    this.executedBlocks = executedBlocks ?? new Set()
  }

  getBlockStates(): ReadonlyMap<string, BlockState> {
    return this.blockStates
  }

  getExecutedBlocks(): ReadonlySet<string> {
    return this.executedBlocks
  }

  getBlockState(blockId: string, currentNodeId?: string): BlockState | undefined {
    const normalizedId = normalizeLookupId(blockId)
    if (normalizedId !== blockId) {
      return this.blockStates.get(blockId)
    }

    if (currentNodeId) {
      const scopedState = this.getScopedBlockState(blockId, currentNodeId)
      if (scopedState !== undefined) {
        return scopedState
      }

      if (extractOuterBranchIndex(currentNodeId) !== undefined) {
        return undefined
      }
    }

    const direct = this.blockStates.get(blockId)
    if (direct !== undefined) {
      return direct
    }

    if (currentNodeId && extractBranchSuffix(currentNodeId) === '') {
      const stableBranchZeroState = this.blockStates.get(buildOuterBranchScopedId(blockId, 0))
      if (stableBranchZeroState !== undefined) {
        return stableBranchZeroState
      }

      const branchZeroState = this.blockStates.get(
        `${blockId}₍0₎${extractLoopSuffix(currentNodeId)}`
      )
      if (branchZeroState !== undefined) {
        return branchZeroState
      }
    }

    for (const [storedId, state] of this.blockStates.entries()) {
      if (normalizeLookupId(storedId) === blockId) {
        return state
      }
    }

    return undefined
  }

  getBlockOutput(blockId: string, currentNodeId?: string): NormalizedBlockOutput | undefined {
    return this.getBlockState(blockId, currentNodeId)?.output
  }

  private getScopedBlockState(blockId: string, currentNodeId: string): BlockState | undefined {
    const currentBranchSuffix = extractBranchSuffix(currentNodeId)
    const loopSuffix = extractLoopSuffix(currentNodeId)

    const currentOuterBranchIndex = extractOuterBranchIndex(currentNodeId)
    if (currentOuterBranchIndex !== undefined) {
      for (const [storedId, state] of this.blockStates.entries()) {
        if (stripCloneSuffixes(storedId) !== blockId) continue
        if (extractOuterBranchIndex(storedId) !== currentOuterBranchIndex) continue
        if (extractBranchSuffix(storedId) !== currentBranchSuffix) continue
        if (extractLoopSuffix(storedId) !== loopSuffix) continue

        return state
      }

      const siblingBranchState = this.blockStates.get(`${blockId}₍${currentOuterBranchIndex}₎`)
      if (siblingBranchState !== undefined) {
        return siblingBranchState
      }
    } else {
      const withSuffix = `${blockId}${currentBranchSuffix}${loopSuffix}`
      const suffixedState = this.blockStates.get(withSuffix)
      if (suffixedState !== undefined) {
        return suffixedState
      }
    }

    return undefined
  }

  setBlockOutput(
    blockId: string,
    output: NormalizedBlockOutput,
    executionTime = 0,
    resolvedSecretTraceProvenance?: BlockState['resolvedSecretTraceProvenance']
  ): void {
    const existingState = this.blockStates.get(blockId)
    const effectiveProvenance =
      resolvedSecretTraceProvenance ??
      (existingState?.output === output ? existingState.resolvedSecretTraceProvenance : undefined)
    this.blockStates.set(blockId, {
      output,
      executed: true,
      executionTime,
      ...(effectiveProvenance ? { resolvedSecretTraceProvenance: effectiveProvenance } : {}),
    })
    this.executedBlocks.add(blockId)
  }

  setBlockState(blockId: string, state: BlockState): void {
    this.blockStates.set(blockId, state)
    if (state.executed) {
      this.executedBlocks.add(blockId)
    } else {
      this.executedBlocks.delete(blockId)
    }
  }

  deleteBlockState(blockId: string): void {
    this.blockStates.delete(blockId)
    this.executedBlocks.delete(blockId)
  }

  unmarkExecuted(blockId: string): void {
    this.executedBlocks.delete(blockId)
  }

  hasExecuted(blockId: string): boolean {
    return this.executedBlocks.has(blockId)
  }
}
