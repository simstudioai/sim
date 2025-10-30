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

const logger = createLogger('VariableResolver')

const REFERENCE_START = '<'
const REFERENCE_END = '>'
const ENV_VAR_START = '{{'
const ENV_VAR_END = '}}'
const PATH_DELIMITER = '.'

export class VariableResolver {
  constructor(
    private workflow: SerializedWorkflow,
    private workflowVariables: Record<string, any>,
    private state: ExecutionState
  ) {}

  resolveInputs(
    params: Record<string, any>,
    currentNodeId: string,
    context: ExecutionContext
  ): Record<string, any> {
    if (!params) {
      return {}
    }

    const resolved: Record<string, any> = {}

    for (const [key, value] of Object.entries(params)) {
      resolved[key] = this.resolveValue(value, currentNodeId, context)
    }

    return resolved
  }

  resolveSingleReference(reference: string, currentNodeId: string, context: ExecutionContext): any {
    return this.resolveValue(reference, currentNodeId, context)
  }

  private resolveValue(value: any, currentNodeId: string, context: ExecutionContext): any {
    if (value === null || value === undefined) {
      return value
    }

    if (Array.isArray(value)) {
      return value.map(item => this.resolveValue(item, currentNodeId, context))
    }

    if (typeof value === 'object' && value.constructor === Object) {
      const resolved: Record<string, any> = {}
      for (const [k, v] of Object.entries(value)) {
        resolved[k] = this.resolveValue(v, currentNodeId, context)
      }
      return resolved
    }

    if (typeof value !== 'string') {
      return value
    }

    if (this.isReference(value)) {
      return this.resolveReference(value, currentNodeId, context)
    }

    if (this.isEnvVariable(value)) {
      return this.resolveEnvVariable(value, context)
    }

    if (this.hasTemplate(value)) {
      return this.resolveTemplate(value, currentNodeId, context)
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

  private resolveReference(reference: string, currentNodeId: string, context: ExecutionContext): any {
    const content = reference.substring(
      REFERENCE_START.length,
      reference.length - REFERENCE_END.length
    )
    const parts = content.split(PATH_DELIMITER)

    if (parts.length === 0) {
      return undefined
    }

    const [type, ...pathParts] = parts

    switch (type) {
      case 'loop':
        return this.resolveLoopVariable(pathParts, currentNodeId)
      case 'parallel':
        return this.resolveParallelVariable(pathParts, currentNodeId)
      case 'variable':
        return this.resolveWorkflowVariable(pathParts, context)
      default:
        return this.resolveBlockOutput(type, pathParts)
    }
  }

  private resolveLoopVariable(pathParts: string[], currentNodeId: string): any {
    const [property] = pathParts

    const loopId = this.findLoopForBlock(currentNodeId)
    if (!loopId) {
      return undefined
    }

    const scope = this.state.getLoopScope(loopId)
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

  private resolveBlockOutput(blockName: string, pathParts: string[]): any {
    const blockId = this.findBlockIdByName(blockName)
    if (!blockId) {
      return undefined
    }

    const output = this.state.getBlockOutput(blockId)
    if (!output) {
      return undefined
    }

    if (pathParts.length === 0) {
      return output
    }

    return this.navigatePath(output, pathParts)
  }

  private resolveEnvVariable(value: string, context: ExecutionContext): string {
    const varName = value.substring(
      ENV_VAR_START.length,
      value.length - ENV_VAR_END.length
    )

    return context.environmentVariables?.[varName] ?? value
  }

  private resolveTemplate(template: string, currentNodeId: string, context: ExecutionContext): string {
    let result = template

    const referenceRegex = /<([^>]+)>/g
    result = result.replace(referenceRegex, (match) => {
      const resolved = this.resolveReference(match, currentNodeId, context)
      if (resolved === undefined) {
        return match
      }
      
      if (typeof resolved === 'string') {
        return JSON.stringify(resolved)
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
    for (const block of this.workflow.blocks) {
      if (block.metadata?.name === name || block.id === name) {
        return block.id
      }
    }
    return undefined
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

