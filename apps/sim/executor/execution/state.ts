/**
 * ExecutionState
 *
 * Manages all mutable state during workflow execution.
 * Provides a clean interface for storing and retrieving execution data.
 */

import type { NormalizedBlockOutput } from '@/executor/types'

export interface LoopScope {
  iteration: number
  currentIterationOutputs: Map<string, NormalizedBlockOutput>
  allIterationOutputs: NormalizedBlockOutput[][]
  maxIterations?: number
  item?: any
  items?: any[]
  condition?: string
  skipFirstConditionCheck?: boolean
}

export interface ParallelScope {
  parallelId: string
  totalBranches: number
  branchOutputs: Map<number, NormalizedBlockOutput[]> // Map<branchIndex, array of outputs from all nodes in that branch>
  completedCount: number
  totalExpectedNodes: number
}

export class ExecutionState {
  readonly blockStates = new Map<string, { output: NormalizedBlockOutput; executed: boolean }>()
  readonly executedBlocks = new Set<string>()
  readonly loopScopes = new Map<string, LoopScope>()
  readonly parallelScopes = new Map<string, ParallelScope>()

  getBlockOutput(blockId: string): NormalizedBlockOutput | undefined {
    return this.blockStates.get(blockId)?.output
  }

  setBlockOutput(blockId: string, output: NormalizedBlockOutput): void {
    this.blockStates.set(blockId, { output, executed: true })
    this.executedBlocks.add(blockId)
  }

  hasExecuted(blockId: string): boolean {
    return this.executedBlocks.has(blockId)
  }

  getLoopScope(loopId: string): LoopScope | undefined {
    return this.loopScopes.get(loopId)
  }

  setLoopScope(loopId: string, scope: LoopScope): void {
    this.loopScopes.set(loopId, scope)
  }

  getParallelScope(parallelId: string): ParallelScope | undefined {
    return this.parallelScopes.get(parallelId)
  }

  setParallelScope(parallelId: string, scope: ParallelScope): void {
    this.parallelScopes.set(parallelId, scope)
  }
}
