/**
 * VariableResolver
 * 
 * Coordinator for variable resolution that delegates to specialized resolvers.
 * Uses the Strategy Pattern to handle different reference types:
 * - Block references: <blockName.output.field>
 * - Loop references: <loop.iteration>, <loop.item>
 * - Parallel references: <parallel.index>, <parallel.currentItem>
 * - Workflow variables: <variable.name>
 * - Environment variables: {{env.VAR_NAME}}
 * 
 * This class orchestrates resolution and template string replacement.
 */

import { createLogger } from '@/lib/logs/console/logger'
import type { ExecutionContext } from '@/executor/types'
import type { SerializedWorkflow, SerializedBlock } from '@/serializer/types'
import type { ExecutionState, LoopScope } from './execution-state'
import type { ReferenceResolver, ResolutionContext } from './resolution/reference-resolver'
import { BlockReferenceResolver } from './resolution/block-reference-resolver'
import { LoopReferenceResolver } from './resolution/loop-reference-resolver'
import { ParallelReferenceResolver } from './resolution/parallel-reference-resolver'
import { WorkflowVariableResolver } from './resolution/workflow-variable-resolver'
import { EnvVariableResolver } from './resolution/env-variable-resolver'

const logger = createLogger('VariableResolver')

const REFERENCE_START = '<'
const REFERENCE_END = '>'
const ENV_VAR_START = '{{'
const ENV_VAR_END = '}}'

/**
 * Coordinates variable resolution using specialized resolver strategies
 */
export class VariableResolver {
  private resolvers: ReferenceResolver[]

  constructor(
    private workflow: SerializedWorkflow,
    private workflowVariables: Record<string, any>,
    private state: ExecutionState
  ) {
    // Initialize all resolver strategies
    // Order matters: more specific resolvers first
    this.resolvers = [
      new LoopReferenceResolver(workflow),
      new ParallelReferenceResolver(workflow),
      new WorkflowVariableResolver(workflowVariables),
      new EnvVariableResolver(),
      new BlockReferenceResolver(workflow), // Most general, goes last
    ]
  }

  /**
   * Resolve all inputs for a block
   * Recursively resolves all references in the input parameters
   */
  resolveInputs(
    params: Record<string, any>,
    currentNodeId: string,
    context: ExecutionContext,
    block?: SerializedBlock
  ): Record<string, any> {
    if (!params) {
      return {}
    }

    const resolved: Record<string, any> = {}

    for (const [key, value] of Object.entries(params)) {
      resolved[key] = this.resolveValue(value, currentNodeId, context, undefined, block)
    }

    return resolved
  }

  /**
   * Resolve a single reference
   * Exposed for use by other components (e.g., LoopOrchestrator)
   */
  resolveSingleReference(
    reference: string,
    currentNodeId: string,
    context: ExecutionContext,
    loopScope?: LoopScope
  ): any {
    return this.resolveValue(reference, currentNodeId, context, loopScope)
  }

  /**
   * PRIVATE METHODS
   */

  /**
   * Resolve a value (recursively for objects and arrays)
   */
  private resolveValue(
    value: any,
    currentNodeId: string,
    context: ExecutionContext,
    loopScope?: LoopScope,
    block?: SerializedBlock
  ): any {
    if (value === null || value === undefined) {
      return value
    }

    // Handle arrays recursively
    if (Array.isArray(value)) {
      return value.map((v) => this.resolveValue(v, currentNodeId, context, loopScope, block))
    }

    // Handle objects recursively
    if (typeof value === 'object') {
      return Object.entries(value).reduce(
        (acc, [key, val]) => ({
          ...acc,
          [key]: this.resolveValue(val, currentNodeId, context, loopScope, block),
        }),
        {}
      )
    }

    // Handle strings (may contain templates)
    if (typeof value === 'string') {
      return this.resolveTemplate(value, currentNodeId, context, loopScope, block)
    }

    // Return primitives as-is
    return value
  }

  /**
   * Resolve a template string that may contain references
   * Handles both <references> and {{env.vars}}
   */
  private resolveTemplate(
    template: string,
    currentNodeId: string,
    context: ExecutionContext,
    loopScope?: LoopScope,
    block?: SerializedBlock
  ): string {
    let result = template

    // Build resolution context
    const resolutionContext: ResolutionContext = {
      executionContext: context,
      executionState: this.state,
      currentNodeId,
      loopScope,
    }

    // Resolve <references>
    const referenceRegex = /<([^>]+)>/g
    result = result.replace(referenceRegex, (match) => {
      const resolved = this.resolveReference(match, resolutionContext)

      if (resolved === undefined) {
        return match // Keep original if not resolved
      }

      // For function blocks, quote string values so they become string literals in code
      const isFunctionBlock = block?.metadata?.id === 'function'

      if (typeof resolved === 'string') {
        if (isFunctionBlock) {
          return JSON.stringify(resolved)
        }
        return resolved
      }

      if (typeof resolved === 'number' || typeof resolved === 'boolean') {
        return String(resolved)
      }

      return JSON.stringify(resolved)
    })

    // Resolve {{env.vars}}
    const envRegex = /\{\{([^}]+)\}\}/g
    result = result.replace(envRegex, (match) => {
      const resolved = this.resolveReference(match, resolutionContext)
      return typeof resolved === 'string' ? resolved : match
    })

    return result
  }

  /**
   * Resolve a reference using the strategy pattern
   * Delegates to the first resolver that can handle the reference
   */
  private resolveReference(reference: string, context: ResolutionContext): any {
    // Try each resolver in order
    for (const resolver of this.resolvers) {
      if (resolver.canResolve(reference)) {
        logger.debug('Resolving reference with strategy', {
          reference,
          resolver: resolver.constructor.name,
        })

        const result = resolver.resolve(reference, context)

        logger.debug('Reference resolved', {
          reference,
          resolver: resolver.constructor.name,
          result,
        })

        return result
      }
    }

    logger.warn('No resolver found for reference', { reference })
    return undefined
  }

  /**
   * Check if a value contains any references or templates
   */
  private hasTemplate(value: string): boolean {
    return value.includes(REFERENCE_START) || value.includes(ENV_VAR_START)
  }
}
