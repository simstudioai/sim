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

    logger.debug('DAGResolver resolveInputs called:', {
      blockId: block.id,
      blockType: block.metadata?.id,
      paramKeys: Object.keys(params),
      codePreview: typeof params.code === 'string' ? params.code.substring(0, 100) : 'N/A',
    })

    for (const [key, value] of Object.entries(params)) {
      resolved[key] = this.resolveValue(value, currentNodeId, context, loopScopes, block)
    }

    logger.debug('DAGResolver resolved inputs:', {
      blockId: block.id,
      resolvedKeys: Object.keys(resolved),
      resolvedCodePreview: typeof resolved.code === 'string' ? resolved.code.substring(0, 100) : 'N/A',
    })

    return resolved
  }

  /**
   * Resolve a single value with scoping
   */
  private resolveValue(
    value: any,
    currentNodeId: string,
    context: ExecutionContext,
    loopScopes: Map<string, LoopScope>,
    block?: SerializedBlock
  ): any {
    if (typeof value !== 'string') {
      return value
    }

    const isFunctionBlock = block?.metadata?.id === 'function'

    // Check for variable references
    if (value.startsWith('<') && value.endsWith('>')) {
      const resolved = this.resolveReference(value, currentNodeId, context, loopScopes)
      // For function blocks, format for code context
      if (isFunctionBlock) {
        return this.formatValueForCodeContext(resolved)
      }
      return resolved
    }

    // Check for template strings with multiple references
    if (value.includes('<') && value.includes('>')) {
      return this.resolveTemplateString(value, currentNodeId, context, loopScopes, block)
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
    
    logger.debug('Resolving loop variable:', {
      variable,
      loopId,
      iteration: loopScope.iteration,
      item: loopScope.item,
      hasItems: !!loopScope.items,
    })
    
    switch (variable) {
      case 'iteration':
      case 'index':
        return loopScope.iteration
      case 'item':
      case 'currentItem':
        return loopScope.item
      case 'items':
        return loopScope.items
      case 'results':
        return loopScope.allIterationOutputs
      default:
        logger.warn('Unknown loop variable:', variable)
        return undefined
    }
  }

  /**
   * Resolve parallel-scoped variables like <parallel.currentItem>
   */
  private resolveParallelVariable(
    parts: string[],
    currentNodeId: string,
    context: ExecutionContext
  ): any {
    const variable = parts[1]
    
    // Extract branch index from current node ID
    const branchIndex = this.extractBranchIndex(currentNodeId)
    
    if (branchIndex === null) {
      logger.warn('Parallel variable referenced outside parallel:', parts.join('.'))
      return undefined
    }
    
    // Find which parallel this node belongs to
    const baseId = this.extractBaseId(currentNodeId)
    
    // Search through parallel configs to find which one contains this base block
    let parallelId: string | null = null
    for (const [pid, pconfig] of Object.entries(this.workflow.parallels || {})) {
      if ((pconfig as any).nodes?.includes(baseId)) {
        parallelId = pid
        break
      }
    }
    
    if (!parallelId) {
      logger.warn('Could not find parallel for node:', { currentNodeId, baseId })
      return undefined
    }
    
    // Get parallel config
    const parallelConfig = context.workflow?.parallels?.[parallelId]
    if (!parallelConfig) {
      logger.warn('Parallel config not found:', parallelId)
      return undefined
    }
    
    let distributionItems = (parallelConfig as any).distributionItems || (parallelConfig as any).distribution || []
    
    // Parse if string
    if (typeof distributionItems === 'string' && !distributionItems.startsWith('<')) {
      try {
        distributionItems = JSON.parse(distributionItems.replace(/'/g, '"'))
        logger.debug('Parsed parallel distribution:', { original: (parallelConfig as any).distribution, parsed: distributionItems })
      } catch (e) {
        logger.error('Failed to parse parallel distributionItems:', distributionItems, e)
        distributionItems = []
      }
    }
    
    logger.debug('Resolving parallel variable:', {
      variable,
      parallelId,
      branchIndex,
      totalItems: Array.isArray(distributionItems) ? distributionItems.length : 0,
      distributionItem: distributionItems[branchIndex],
    })
    
    switch (variable) {
      case 'currentItem':
      case 'item':
        return distributionItems[branchIndex]
      
      case 'index':
        return branchIndex
      
      case 'items':
        return distributionItems
      
      case 'results':
        // TODO: Collect all branch results when parallel completes
        return []
      
      default:
        logger.warn('Unknown parallel variable:', variable)
        return undefined
    }
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
    loopScopes: Map<string, LoopScope>,
    block?: SerializedBlock
  ): string {
    let result = template

    const matches = template.match(/<[^>]+>/g)
    if (!matches) return template

    const isFunctionBlock = block?.metadata?.id === 'function'

    for (const match of matches) {
      const resolved = this.resolveReference(match, currentNodeId, context, loopScopes)
      
      // For function blocks, format the value for code context
      const formatted = isFunctionBlock 
        ? this.formatValueForCodeContext(resolved)
        : String(resolved ?? '')
      
      result = result.replace(match, formatted)
    }

    return result
  }

  /**
   * Format value for safe use in code context (function blocks)
   * Ensures strings are properly quoted
   */
  private formatValueForCodeContext(value: any): string {
    if (typeof value === 'string') {
      return JSON.stringify(value) // Quote strings
    }
    if (typeof value === 'object' && value !== null) {
      return JSON.stringify(value) // Stringify objects/arrays
    }
    if (value === undefined) {
      return 'undefined'
    }
    if (value === null) {
      return 'null'
    }
    // Numbers, booleans can be inserted as-is
    return String(value)
  }
}

