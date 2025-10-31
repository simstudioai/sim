import { createLogger } from '@/lib/logs/console/logger'
import { REFERENCE } from '@/executor/consts'
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
    if (!this.isReference(reference)) {
      return false
    }
    const content = this.extractContent(reference)
    const parts = content.split(REFERENCE.PATH_DELIMITER)
    if (parts.length === 0) {
      return false
    }
    const [type] = parts
    const specialTypes = ['loop', 'parallel', 'variable']
    return !specialTypes.includes(type)
  }
  resolve(reference: string, context: ResolutionContext): any {
    const content = this.extractContent(reference)
    const parts = content.split(REFERENCE.PATH_DELIMITER)
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
      logger.warn('Block not found by name', { blockName })
      return undefined
    }
    const output = this.getBlockOutput(blockId, context)
    logger.debug('Block output retrieved', {
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
    logger.debug('Navigated path result', {
      blockName,
      pathParts,
      result,
    })
    return result
  }
  private isReference(value: string): boolean {
    return value.startsWith(REFERENCE.START) && value.endsWith(REFERENCE.END)
  }
  private extractContent(reference: string): string {
    return reference.substring(REFERENCE.START.length, reference.length - REFERENCE.END.length)
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
