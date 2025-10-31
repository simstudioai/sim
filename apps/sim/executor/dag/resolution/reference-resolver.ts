/**
 * ReferenceResolver Interface
 * 
 * Strategy interface for resolving different types of variable references.
 * Each implementation handles a specific reference type (block, loop, parallel, etc.)
 */

import type { ExecutionContext } from '@/executor/types'
import type { ExecutionState, LoopScope } from '../execution-state'

/**
 * Context needed for reference resolution
 */
export interface ResolutionContext {
  executionContext: ExecutionContext
  executionState: ExecutionState
  currentNodeId: string
  loopScope?: LoopScope
}

/**
 * Strategy interface for resolving references
 */
export interface ReferenceResolver {
  /**
   * Determine if this resolver can handle the given reference
   * 
   * @param reference - The reference string (e.g., "<block.output>", "<loop.index>")
   * @returns True if this resolver can handle this reference
   */
  canResolve(reference: string): boolean

  /**
   * Resolve the reference to its actual value
   * 
   * @param reference - The reference string to resolve
   * @param context - Resolution context with execution state and metadata
   * @returns The resolved value, or undefined if not found
   */
  resolve(reference: string, context: ResolutionContext): any
}

