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

    if (block.metadata?.id === 'function') {
      logger.debug('DAGResolver resolveInputs called for function:', {
        blockId: block.id,
        blockName: block.metadata?.name,
        originalCode: typeof params.code === 'string' ? params.code : 'N/A',
        paramKeys: Object.keys(params),
      })
    }

    for (const [key, value] of Object.entries(params)) {
      resolved[key] = this.resolveValue(value, currentNodeId, context, loopScopes, block)
    }

    if (block.metadata?.id === 'function') {
      logger.debug('DAGResolver resolved function inputs:', {
        blockId: block.id,
        blockName: block.metadata?.name,
        resolvedCode: typeof resolved.code === 'string' ? resolved.code : 'N/A',
      })
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
    loopScopes: Map<string, LoopScope>,
    block?: SerializedBlock
  ): any {
    // Handle arrays - recursively resolve each element
    if (Array.isArray(value)) {
      return value.map(item => 
        this.resolveValue(item, currentNodeId, context, loopScopes, block)
      )
    }

    // Handle objects - recursively resolve each property
    if (typeof value === 'object' && value !== null) {
      const resolved: Record<string, any> = {}
      for (const [key, val] of Object.entries(value)) {
        resolved[key] = this.resolveValue(val, currentNodeId, context, loopScopes, block)
      }
      return resolved
    }

    if (typeof value !== 'string') {
      return value
    }

    const isFunctionBlock = block?.metadata?.id === 'function'

    // Check for variable references
    if (value.startsWith('<') && value.endsWith('>')) {
      const resolved = this.resolveReference(value, currentNodeId, context, loopScopes)
      // For function blocks, if this is the entire value (standalone reference),
      // format it for code context (e.g., `<variable.i>` → `0` not `"0"`)
      // Formatting for template strings is handled in resolveTemplateString
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

    // Special: workflow variable
    if (parts[0] === 'variable') {
      return this.resolveWorkflowVariable(parts, context)
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
   * Resolve workflow variables like <variable.i>
   * Variables can be updated by Variables blocks during execution,
   * so we check context.workflowVariables first (runtime), then fall back to initial values
   * Returns the value in its native type (number, string, boolean, etc.)
   */
  private resolveWorkflowVariable(parts: string[], context: ExecutionContext): any {
    const variableName = parts[1]
    
    if (!variableName) {
      logger.warn('No variable name provided in reference')
      return undefined
    }

    let variable: any = null

    // First check context's workflow variables (these get updated by Variables blocks)
    if (context.workflowVariables) {
      for (const [varId, varObj] of Object.entries(context.workflowVariables)) {
        const v = varObj as any
        if (v.name === variableName || v.id === variableName) {
          variable = v
          break
        }
      }
    }

    // Fallback to initial variables
    if (!variable) {
      for (const [varId, varObj] of Object.entries(this.workflowVariables)) {
        const v = varObj as any
        if (v.name === variableName || v.id === variableName) {
          variable = v
          break
        }
      }
    }

    if (!variable) {
      logger.warn('Workflow variable not found:', variableName)
      return undefined
    }

    // Return the value - Variables block handler should have already converted it to native type
    logger.debug('Resolved workflow variable:', {
      variableName,
      value: variable.value,
      valueType: typeof variable.value,
      variableType: variable.type,
    })
    
    return variable.value
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
   * Returns a string representation that, when inserted into code, evaluates correctly
   */
  private formatValueForCodeContext(value: any): string {
    if (typeof value === 'string') {
      return JSON.stringify(value) // Quote strings: "hello" → "\"hello\""
    }
    if (typeof value === 'object' && value !== null) {
      return JSON.stringify(value) // Stringify objects/arrays: {a:1} → "{\"a\":1}"
    }
    if (value === undefined) {
      return 'undefined'
    }
    if (value === null) {
      return 'null'
    }
    // Numbers and booleans: return unquoted string so they insert as literals
    // 0 → "0" inserts as 0 (number), not "0" (string)
    // true → "true" inserts as true (boolean), not "true" (string)
    return String(value)
  }
}

