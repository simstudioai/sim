/**
 * DAG Input Resolver
 * Handles scoped resolution for loops and parallels
 */

import { createLogger } from '@/lib/logs/console/logger'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'
import type { ExecutionContext, NormalizedBlockOutput } from '@/executor/types'

const logger = createLogger('DAGResolver')

interface LoopScope {
  iteration: number
  maxIterations?: number
  item?: any
  items?: any[]
  currentIterationOutputs: Map<string, NormalizedBlockOutput>
  allIterationOutputs: NormalizedBlockOutput[]
}

/**
 * Resolves block inputs with proper scoping for DAG execution
 */
export class DAGResolver {
  private workflow: SerializedWorkflow
  private environmentVariables: Record<string, string>
  private workflowVariables: Record<string, any>
  private loopNodes: Map<string, string> // blockId → loopId
  private parallelNodes: Map<string, string> // blockId → parallelId

  constructor(
    workflow: SerializedWorkflow,
    environmentVariables: Record<string, string>,
    workflowVariables: Record<string, any>
  ) {
    this.workflow = workflow
    this.environmentVariables = environmentVariables
    this.workflowVariables = workflowVariables
    this.loopNodes = new Map()
    this.parallelNodes = new Map()

    // Build loop/parallel membership maps
    if (workflow.loops) {
      for (const [loopId, loopConfig] of Object.entries(workflow.loops)) {
        for (const nodeId of (loopConfig as any).nodes || []) {
          this.loopNodes.set(nodeId, loopId)
        }
      }
    }

    if (workflow.parallels) {
      for (const [parallelId, parallelConfig] of Object.entries(workflow.parallels)) {
        for (const nodeId of (parallelConfig as any).nodes || []) {
          this.parallelNodes.set(parallelId, parallelId)
        }
      }
    }
  }

  /**
   * Resolve inputs for a block with DAG scoping
   */
  resolveInputs(
    block: SerializedBlock,
    currentNodeId: string, // May include branch suffix: "A₍2₎"
    context: ExecutionContext,
    loopScopes: Map<string, LoopScope>
  ): Record<string, any> {
    const params = block.config.params || {}
    const resolved: Record<string, any> = {}

    for (const [key, value] of Object.entries(params)) {
      resolved[key] = this.resolveValue(value, currentNodeId, context, loopScopes)
    }

    return resolved
  }

  /**
   * Resolve a single value with scoping
   */
  private resolveValue(
    value: any,
    currentNodeId: string,
    context: ExecutionContext,
    loopScopes: Map<string, LoopScope>
  ): any {
    if (typeof value !== 'string') {
      return value
    }

    // Check for variable references
    if (value.startsWith('<') && value.endsWith('>')) {
      return this.resolveReference(value, currentNodeId, context, loopScopes)
    }

    // Check for template strings with multiple references
    if (value.includes('<') && value.includes('>')) {
      return this.resolveTemplateString(value, currentNodeId, context, loopScopes)
    }

    // Check for environment variables
    if (value.startsWith('{{') && value.endsWith('}}')) {
      const varName = value.slice(2, -2)
      return this.environmentVariables[varName] || value
    }

    return value
  }

  /**
   * Resolve a reference like <blockName.output>
   */
  private resolveReference(
    reference: string,
    currentNodeId: string,
    context: ExecutionContext,
    loopScopes: Map<string, LoopScope>
  ): any {
    const refContent = reference.slice(1, -1) // Remove < >
    const parts = refContent.split('.')

    // Special: loop variables
    if (parts[0] === 'loop') {
      return this.resolveLoopVariable(parts, currentNodeId, loopScopes)
    }

    // Special: parallel variables
    if (parts[0] === 'parallel') {
      return this.resolveParallelVariable(parts, currentNodeId, context)
    }

    // Block output reference
    const targetBlockName = parts[0]
    const path = parts.slice(1)

    // Find target block ID
    const targetBlockId = this.findBlockId(targetBlockName)
    if (!targetBlockId) {
      logger.warn(`Block not found: ${targetBlockName}`)
      return undefined
    }

    // Resolve with scoping
    const output = this.resolveScopedOutput(targetBlockId, currentNodeId, context, loopScopes)

    if (!output) {
      logger.warn(`Output not found for block: ${targetBlockName}`)
      return undefined
    }

    // Navigate path
    return this.navigatePath(output, path)
  }

  /**
   * Resolve output with proper scoping
   */
  private resolveScopedOutput(
    targetBlockId: string,
    currentNodeId: string,
    context: ExecutionContext,
    loopScopes: Map<string, LoopScope>
  ): any {
    // Extract branch index if current node is in parallel
    const currentBranchIndex = this.extractBranchIndex(currentNodeId)

    // Extract base ID (remove branch suffix)
    const currentBaseId = this.extractBaseId(currentNodeId)

    // Check if target is in same parallel as current
    if (currentBranchIndex !== null) {
      const currentParallelId = this.parallelNodes.get(currentBaseId)
      const targetParallelId = this.parallelNodes.get(targetBlockId)

      if (currentParallelId === targetParallelId) {
        // Same parallel - use same branch index
        const scopedId = `${targetBlockId}₍${currentBranchIndex}₎`
        return context.blockStates.get(scopedId)?.output
      }
    }

    // Check if target is in same loop as current
    const currentLoopId = this.loopNodes.get(currentBaseId)
    const targetLoopId = this.loopNodes.get(targetBlockId)

    if (currentLoopId && currentLoopId === targetLoopId) {
      // Same loop - get from current iteration's outputs
      const loopScope = loopScopes.get(currentLoopId)
      if (loopScope) {
        return loopScope.currentIterationOutputs.get(targetBlockId)
      }
    }

    // Outside scope - use global context
    // For parallel branches, use the branch-suffixed ID
    const lookupId = currentBranchIndex !== null ? currentNodeId : targetBlockId
    return context.blockStates.get(lookupId)?.output
  }

  /**
   * Resolve loop-scoped variables like <loop.iteration>, <loop.item>
   */
  private resolveLoopVariable(
    parts: string[],
    currentNodeId: string,
    loopScopes: Map<string, LoopScope>
  ): any {
    const currentBaseId = this.extractBaseId(currentNodeId)
    const loopId = this.loopNodes.get(currentBaseId)

    if (!loopId) {
      logger.warn('Loop variable referenced outside loop:', parts.join('.'))
      return undefined
    }

    const loopScope = loopScopes.get(loopId)
    if (!loopScope) {
      logger.warn('Loop scope not found:', loopId)
      return undefined
    }

    const variable = parts[1]
    switch (variable) {
      case 'iteration':
      case 'index':
        return loopScope.iteration
      case 'item':
        return loopScope.item
      case 'items':
        return loopScope.items
      case 'results':
        return loopScope.allIterationOutputs
      default:
        return undefined
    }
  }

  /**
   * Resolve parallel-scoped variables like <parallel.results>
   */
  private resolveParallelVariable(
    parts: string[],
    currentNodeId: string,
    context: ExecutionContext
  ): any {
    const variable = parts[1]

    if (variable === 'results') {
      // TODO: Collect all branch results
      return []
    }

    return undefined
  }

  /**
   * Find block ID by name
   */
  private findBlockId(blockName: string): string | null {
    const normalized = blockName.toLowerCase().replace(/\s+/g, '')

    for (const block of this.workflow.blocks) {
      const blockNameNormalized = (block.metadata?.name || '')
        .toLowerCase()
        .replace(/\s+/g, '')

      if (blockNameNormalized === normalized || block.id === blockName) {
        return block.id
      }
    }

    return null
  }

  /**
   * Extract branch index from node ID
   * "A₍2₎" → 2
   * "A" → null
   */
  private extractBranchIndex(nodeId: string): number | null {
    const match = nodeId.match(/₍(\d+)₎$/)
    return match ? parseInt(match[1], 10) : null
  }

  /**
   * Extract base block ID (remove branch suffix)
   * "A₍2₎" → "A"
   * "A" → "A"
   */
  private extractBaseId(nodeId: string): string {
    return nodeId.replace(/₍\d+₎$/, '')
  }

  /**
   * Navigate object path
   */
  private navigatePath(obj: any, path: string[]): any {
    let current = obj

    for (const key of path) {
      if (current == null) return undefined
      current = current[key]
    }

    return current
  }

  /**
   * Resolve template string with multiple references
   */
  private resolveTemplateString(
    template: string,
    currentNodeId: string,
    context: ExecutionContext,
    loopScopes: Map<string, LoopScope>
  ): string {
    let result = template

    const matches = template.match(/<[^>]+>/g)
    if (!matches) return template

    for (const match of matches) {
      const resolved = this.resolveReference(match, currentNodeId, context, loopScopes)
      result = result.replace(match, String(resolved ?? ''))
    }

    return result
  }
}

