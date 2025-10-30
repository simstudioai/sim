/**
 * VariableResolver
 * 
 * Resolves all variable references in block inputs.
 * Handles: <block.output>, <variable.name>, <loop.iteration>, <parallel.index>, {{env.VAR}}
 */

import { createLogger } from '@/lib/logs/console/logger'
import type { ExecutionContext } from '@/executor/types'
import type { SerializedWorkflow } from '@/serializer/types'
import type { ExecutionState, LoopScope } from './execution-state'
import { normalizeBlockName } from '@/stores/workflows/utils'
import type { SerializedBlock } from '@/serializer/types'

const logger = createLogger('VariableResolver')

const REFERENCE_START = '<'
const REFERENCE_END = '>'
const ENV_VAR_START = '{{'
const ENV_VAR_END = '}}'
const PATH_DELIMITER = '.'

export class VariableResolver {
  private blockByNormalizedName: Map<string, string> // Maps normalized name to block ID

  constructor(
    private workflow: SerializedWorkflow,
    private workflowVariables: Record<string, any>,
    private state: ExecutionState
  ) {
    // Initialize the normalized name map for efficient block lookups
    this.blockByNormalizedName = new Map()
    
    for (const block of workflow.blocks) {
      // Map by block ID
      this.blockByNormalizedName.set(block.id, block.id)
      
      // Map by normalized block name
      if (block.metadata?.name) {
        const normalized = normalizeBlockName(block.metadata.name)
        this.blockByNormalizedName.set(normalized, block.id)
      }
    }
    
    // Add special handling for the starter block - allow referencing it as "start"
    const starterBlock = workflow.blocks.find((b) => 
      b.metadata?.id === 'starter' || 
      b.metadata?.id === 'start_trigger' ||
      b.metadata?.category === 'triggers'
    )
    if (starterBlock) {
      this.blockByNormalizedName.set('start', starterBlock.id)
    }
  }

  resolveInputs(params: Record<string, any>, currentNodeId: string, context: ExecutionContext, block?: SerializedBlock): Record<string, any> {
    if (!params) {
      return {}
    }

    const resolved: Record<string, any> = {}

    for (const [key, value] of Object.entries(params)) {
      resolved[key] = this.resolveValue(value, currentNodeId, context, undefined, block)
    }

    return resolved
  }

  private getBlockOutputFromContext(blockId: string, context: ExecutionContext): any {
    // First check ExecutionState (for blocks that have completed during this execution)
    const stateOutput = this.state.getBlockOutput(blockId)
    if (stateOutput !== undefined) {
      return stateOutput
    }

    // Then check context.blockStates (for pre-initialized blocks like starter)
    const contextState = context.blockStates?.get(blockId)
    if (contextState?.output) {
      return contextState.output
    }

    return undefined
  }

  resolveSingleReference(reference: string, currentNodeId: string, context: ExecutionContext, loopScope?: LoopScope): any {
    return this.resolveValue(reference, currentNodeId, context, loopScope)
  }

  private resolveValue(value: any, currentNodeId: string, context: ExecutionContext, loopScope?: LoopScope, block?: SerializedBlock): any {
    if (value === null || value === undefined) {
      return value
    }

    if (Array.isArray(value)) {
      return value.map(v => this.resolveValue(v, currentNodeId, context, loopScope, block))
    }

    if (typeof value === 'object') {
      return Object.entries(value).reduce(
        (acc, [key, val]) => ({
          ...acc,
          [key]: this.resolveValue(val, currentNodeId, context, loopScope, block),
        }),
        {}
      )
    }

    if (typeof value === 'string') {
      return this.resolveTemplate(value, currentNodeId, context, loopScope, block)
    }

    return value
  }

  private isReference(value: string): boolean {
    return value.startsWith(REFERENCE_START) && value.endsWith(REFERENCE_END)
  }

  private isEnvVariable(value: string): boolean {
    return value.startsWith(ENV_VAR_START) && value.endsWith(ENV_VAR_END)
  }

  private hasTemplate(value: string): boolean {
    return value.includes(REFERENCE_START) || value.includes(ENV_VAR_START)
  }

  private resolveReference(reference: string, currentNodeId: string, context: ExecutionContext, loopScope?: LoopScope): any {
    const content = reference.substring(
      REFERENCE_START.length,
      reference.length - REFERENCE_END.length
    )
    const parts = content.split(PATH_DELIMITER)

    logger.info(`[VariableResolver] Resolving reference`, {
      reference,
      content,
      parts,
    })

    if (parts.length === 0) {
      return undefined
    }

    const [type, ...pathParts] = parts

    logger.info(`[VariableResolver] Reference type and path`, {
      type,
      pathParts,
    })

    let result: any
    switch (type) {
      case 'loop':
        result = this.resolveLoopVariable(pathParts, currentNodeId, loopScope)
        break
      case 'parallel':
        result = this.resolveParallelVariable(pathParts, currentNodeId)
        break
      case 'variable':
        result = this.resolveWorkflowVariable(pathParts, context)
        break
      default:
        result = this.resolveBlockOutput(type, pathParts, context)
        break
    }

    logger.info(`[VariableResolver] Reference resolved to`, {
      reference,
      type,
      result,
    })

    return result
  }

  private resolveLoopVariable(pathParts: string[], currentNodeId: string, loopScope?: LoopScope): any {
    const [property] = pathParts

    let scope = loopScope
    if (!scope) {
      const loopId = this.findLoopForBlock(currentNodeId)
      if (!loopId) {
        return undefined
      }
      scope = this.state.getLoopScope(loopId)
    }

    if (!scope) {
      return undefined
    }

    switch (property) {
      case 'iteration':
        return scope.iteration
      case 'index':
        return scope.iteration
      case 'item':
      case 'currentItem':
        return scope.item
      default:
        return undefined
    }
  }

  private resolveParallelVariable(pathParts: string[], currentNodeId: string): any {
    const [property] = pathParts

    const parallelId = this.findParallelForBlock(currentNodeId)
    if (!parallelId) {
      return undefined
    }

    if (property === 'index') {
      const branchIndex = this.extractBranchIndex(currentNodeId)
      return branchIndex
    }

    return undefined
  }

  private resolveWorkflowVariable(pathParts: string[], context: ExecutionContext): any {
    const [variableName] = pathParts

    if (context.workflowVariables) {
      for (const varObj of Object.values(context.workflowVariables)) {
        const v = varObj as any
        if (v.name === variableName || v.id === variableName) {
          return v.value
        }
      }
    }

    for (const varObj of Object.values(this.workflowVariables)) {
      const v = varObj as any
      if (v.name === variableName || v.id === variableName) {
        return v.value
      }
    }

    return undefined
  }

  private resolveBlockOutput(blockName: string, pathParts: string[], context?: ExecutionContext): any {
    const blockId = this.findBlockIdByName(blockName)
    
    logger.info(`[VariableResolver] Resolving block output`, {
      blockName,
      blockId,
      pathParts,
    })
    
    if (!blockId) {
      logger.warn(`[VariableResolver] Block not found by name`, { blockName })
      return undefined
    }

    // Get output from either ExecutionState or context.blockStates
    let output: any
    if (context) {
      output = this.getBlockOutputFromContext(blockId, context)
    } else {
      output = this.state.getBlockOutput(blockId)
    }

    logger.info(`[VariableResolver] Block output retrieved`, {
      blockName,
      blockId,
      hasOutput: !!output,
      outputKeys: output ? Object.keys(output) : [],
    })

    if (!output) {
      return undefined
    }

    if (pathParts.length === 0) {
      return output
    }

    const result = this.navigatePath(output, pathParts)
    
    logger.info(`[VariableResolver] Navigated path result`, {
      blockName,
      pathParts,
      result,
    })

    return result
  }

  private resolveEnvVariable(value: string, context: ExecutionContext): string {
    const varName = value.substring(
      ENV_VAR_START.length,
      value.length - ENV_VAR_END.length
    )

    return context.environmentVariables?.[varName] ?? value
  }

  private resolveTemplate(template: string, currentNodeId: string, context: ExecutionContext, loopScope?: LoopScope, block?: SerializedBlock): string {
    let result = template

    const referenceRegex = /<([^>]+)>/g
    result = result.replace(referenceRegex, (match) => {
      const resolved = this.resolveReference(match, currentNodeId, context, loopScope)
      if (resolved === undefined) {
        return match
      }
      
      // For function blocks, string values should be quoted for code context
      // This prevents variables like <loop.item> from becoming bare identifiers
      const isFunctionBlock = block?.metadata?.id === 'function'
      
      if (typeof resolved === 'string') {
        // If this is a function block, quote string values so they're string literals in code
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

    const envRegex = /\{\{([^}]+)\}\}/g
    result = result.replace(envRegex, (match) => {
      return this.resolveEnvVariable(match, context)
    })

    return result
  }

  private navigatePath(obj: any, path: string[]): any {
    let current = obj

    for (const part of path) {
      if (current === null || current === undefined) {
        return undefined
      }

      if (/^\d+$/.test(part)) {
        const index = parseInt(part, 10)
        current = Array.isArray(current) ? current[index] : undefined
      } else {
        current = current[part]
      }
    }

    return current
  }

  private findBlockIdByName(name: string): string | undefined {
    // Try direct lookup first (handles IDs and exact name matches)
    if (this.blockByNormalizedName.has(name)) {
      return this.blockByNormalizedName.get(name)
    }
    
    // Try normalized lookup
    const normalized = normalizeBlockName(name)
    return this.blockByNormalizedName.get(normalized)
  }

  private findLoopForBlock(blockId: string): string | undefined {
    const baseId = this.extractBaseId(blockId)
    
    for (const loopId of Object.keys(this.workflow.loops || {})) {
      const loopConfig = this.workflow.loops[loopId]
      if (loopConfig.nodes.includes(baseId)) {
        return loopId
      }
    }

    return undefined
  }

  private findParallelForBlock(blockId: string): string | undefined {
    const baseId = this.extractBaseId(blockId)
    
    if (!this.workflow.parallels) {
      return undefined
    }
    
    for (const parallelId of Object.keys(this.workflow.parallels)) {
      const parallelConfig = this.workflow.parallels[parallelId]
      if (parallelConfig?.nodes.includes(baseId)) {
        return parallelId
      }
    }

    return undefined
  }

  private extractBaseId(nodeId: string): string {
    return nodeId.replace(/₍\d+₎$/, '')
  }

  private extractBranchIndex(nodeId: string): number | null {
    const match = nodeId.match(/₍(\d+)₎$/)
    return match ? parseInt(match[1], 10) : null
  }
}


