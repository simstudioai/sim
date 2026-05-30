import type { BlockStateController } from '@/executor/execution/types'
import type { BlockState, NormalizedBlockOutput } from '@/executor/types'
import {
  buildOuterBranchScopedId,
  extractOuterBranchIndex,
  stripCloneSuffixes,
} from '@/executor/utils/subflow-utils'

const BRANCH_SUFFIX_PATTERN = /₍\d+₎/u
const LOOP_SUFFIX_PATTERN = /_loop\d+/

function normalizeLookupId(id: string): string {
  return id.replace(/₍\d+₎/gu, '').replace(/_loop\d+/g, '')
}

function extractBranchSuffix(id: string): string {
  return id.match(BRANCH_SUFFIX_PATTERN)?.[0] ?? ''
}

function extractLoopSuffix(id: string): string {
  return id.match(LOOP_SUFFIX_PATTERN)?.[0] ?? ''
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

  getBlockOutput(blockId: string, currentNodeId?: string): NormalizedBlockOutput | undefined {
    const normalizedId = normalizeLookupId(blockId)
    if (normalizedId !== blockId) {
      return this.blockStates.get(blockId)?.output
    }

    if (currentNodeId) {
      const scopedOutput = this.getScopedBlockOutput(blockId, currentNodeId)
      if (scopedOutput !== undefined) {
        return scopedOutput
      }

      if (extractOuterBranchIndex(currentNodeId) !== undefined) {
        return undefined
      }
    }

    const direct = this.blockStates.get(blockId)?.output
    if (direct !== undefined) {
      return direct
    }

    if (currentNodeId && extractBranchSuffix(currentNodeId) === '') {
      const stableBranchZeroOutput = this.blockStates.get(
        buildOuterBranchScopedId(blockId, 0)
      )?.output
      if (stableBranchZeroOutput !== undefined) {
        return stableBranchZeroOutput
      }

      const branchZeroOutput = this.blockStates.get(
        `${blockId}₍0₎${extractLoopSuffix(currentNodeId)}`
      )?.output
      if (branchZeroOutput !== undefined) {
        return branchZeroOutput
      }
    }

    for (const [storedId, state] of this.blockStates.entries()) {
      if (normalizeLookupId(storedId) === blockId) {
        return state.output
      }
    }

    return undefined
  }

  private getScopedBlockOutput(
    blockId: string,
    currentNodeId: string
  ): NormalizedBlockOutput | undefined {
    const currentBranchSuffix = extractBranchSuffix(currentNodeId)
    const loopSuffix = extractLoopSuffix(currentNodeId)

    const currentOuterBranchIndex = extractOuterBranchIndex(currentNodeId)
    if (currentOuterBranchIndex !== undefined) {
      for (const [storedId, state] of this.blockStates.entries()) {
        if (stripCloneSuffixes(storedId) !== blockId) continue
        if (extractOuterBranchIndex(storedId) !== currentOuterBranchIndex) continue
        if (extractBranchSuffix(storedId) !== currentBranchSuffix) continue
        if (extractLoopSuffix(storedId) !== loopSuffix) continue

        return state.output
      }

      const siblingBranchOutput = this.blockStates.get(
        `${blockId}₍${currentOuterBranchIndex}₎`
      )?.output
      if (siblingBranchOutput !== undefined) {
        return siblingBranchOutput
      }
    } else {
      const withSuffix = `${blockId}${currentBranchSuffix}${loopSuffix}`
      const suffixedOutput = this.blockStates.get(withSuffix)?.output
      if (suffixedOutput !== undefined) {
        return suffixedOutput
      }
    }

    return undefined
  }

  setBlockOutput(blockId: string, output: NormalizedBlockOutput, executionTime = 0): void {
    this.blockStates.set(blockId, { output, executed: true, executionTime })
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
