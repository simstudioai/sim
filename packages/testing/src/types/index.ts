/**
 * Core types for the testing package.
 *
 * These are intentionally loose/permissive types that accept any shape of data
 * from the app. The testing package should not try to mirror app types exactly -
 * that creates maintenance burden and type drift issues.
 *
 * Tests themselves provide type safety through their actual usage of app types.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface Position {
  x: number
  y: number
}

export interface BlockData {
  parentId?: string
  extent?: string
  width?: number
  height?: number
  count?: number
  loopType?: string
  parallelType?: string
  collection?: any
  whileCondition?: string
  doWhileCondition?: string
  type?: string
  [key: string]: any
}

export type BlockOutput = any

export interface ExecutionContext {
  workflowId: string
  executionId?: string
  blockStates: Map<string, any>
  executedBlocks: Set<string>
  blockLogs: any[]
  metadata: {
    duration: number
    startTime?: string
    endTime?: string
  }
  environmentVariables: Record<string, string>
  workflowVariables?: Record<string, any>
  decisions: {
    router: Map<string, any>
    condition: Map<string, any>
  }
  loopExecutions: Map<string, any>
  completedLoops: Set<string>
  activeExecutionPath: Set<string>
  abortSignal?: AbortSignal
  [key: string]: any
}
