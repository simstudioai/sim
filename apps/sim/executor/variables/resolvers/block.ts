import { createLogger } from '@/lib/logs/console/logger'
import { isReference, parseReferencePath, SPECIAL_REFERENCE_PREFIXES } from '@/executor/consts'
import type { SerializedWorkflow } from '@/serializer/types'
import { normalizeBlockName } from '@/stores/workflows/utils'
import type { ResolutionContext, Resolver } from './reference'

const logger = createLogger('BlockResolver')

export class BlockResolver implements Resolver {
  private blockByNormalizedName: Map<string, string>

  constructor(private workflow: SerializedWorkflow) {
    this.blockByNormalizedName = new Map()
    for (const block of workflow.blocks) {
      this.blockByNormalizedName.set(block.id, block.id)
      if (block.metadata?.name) {
        const normalized = normalizeBlockName(block.metadata.name)
        this.blockByNormalizedName.set(normalized, block.id)
      }
    }
  }

  canResolve(reference: string): boolean {
    if (!isReference(reference)) {
      return false
    }
    const parts = parseReferencePath(reference)
    if (parts.length === 0) {
      return false
    }
    const [type] = parts
    return !SPECIAL_REFERENCE_PREFIXES.includes(type as any)
  }

  resolve(reference: string, context: ResolutionContext): any {
    const parts = parseReferencePath(reference)
    if (parts.length === 0) {
      return undefined
    }
    const [blockName, ...pathParts] = parts
    logger.debug('Resolving block reference', {
      reference,
      blockName,
      pathParts,
    })

    const blockId = this.findBlockIdByName(blockName)
    if (!blockId) {
      logger.error('Block not found by name', { blockName, reference })
      throw new Error(`Block "${blockName}" not found`)
    }

    const output = this.getBlockOutput(blockId, context)
    logger.debug('Block output retrieved', {
      blockName,
      blockId,
      hasOutput: !!output,
      outputKeys: output ? Object.keys(output) : [],
    })

    if (!output) {
      throw new Error(`No state found for block "${blockName}"`)
    }
    if (pathParts.length === 0) {
      return output
    }

    const result = this.navigatePath(output, pathParts)
    
    if (result === undefined) {
      const availableKeys = output && typeof output === 'object' ? Object.keys(output) : []
      throw new Error(
        `No value found at path "${pathParts.join('.')}" in block "${blockName}". Available fields: ${availableKeys.join(', ')}`
      )
    }
    
    logger.debug('Navigated path result', {
      blockName,
      pathParts,
      result,
    })
    return result
  }

  private getBlockOutput(blockId: string, context: ResolutionContext): any {
    const stateOutput = context.executionState.getBlockOutput(blockId)
    if (stateOutput !== undefined) {
      return stateOutput
    }
    const contextState = context.executionContext.blockStates?.get(blockId)
    if (contextState?.output) {
      return contextState.output
    }

    return undefined
  }

  private findBlockIdByName(name: string): string | undefined {
    if (this.blockByNormalizedName.has(name)) {
      return this.blockByNormalizedName.get(name)
    }
    const normalized = normalizeBlockName(name)
    return this.blockByNormalizedName.get(normalized)
  }

  private navigatePath(obj: any, path: string[]): any {
    let current = obj
    for (const part of path) {
      if (current === null || current === undefined) {
        return undefined
      }
      if (/^\d+$/.test(part)) {
        const index = Number.parseInt(part, 10)
        current = Array.isArray(current) ? current[index] : undefined
      } else {
        current = current[part]
      }
    }
    return current
  }
}
