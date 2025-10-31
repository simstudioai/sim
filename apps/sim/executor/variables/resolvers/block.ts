/**
 * Block Resolver
 *
 * Resolves references to block outputs: <blockName.output.field>
 * - Finds blocks by ID or normalized name
 * - Navigates nested paths in block outputs
 * - Handles both ExecutionState and ExecutionContext lookups
 */

import { createLogger } from '@/lib/logs/console/logger'
import { REFERENCE } from '@/executor/consts'
import type { SerializedWorkflow } from '@/serializer/types'
import { normalizeBlockName } from '@/stores/workflows/utils'
import type { ResolutionContext, Resolver } from './reference'

const logger = createLogger('BlockResolver')

export class BlockResolver implements Resolver {
  private blockByNormalizedName: Map<string, string>

  constructor(private workflow: SerializedWorkflow) {
    // Build normalized name lookup map
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

    // This resolver handles block references (anything that's not a special type)
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

    // Find block ID by name
    const blockId = this.findBlockIdByName(blockName)
    if (!blockId) {
      logger.warn('Block not found by name', { blockName })
      return undefined
    }

    // Get block output from ExecutionState or ExecutionContext
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

    // If no path parts, return entire output
    if (pathParts.length === 0) {
      return output
    }

    // Navigate the path
    const result = this.navigatePath(output, pathParts)

    logger.debug('Navigated path result', {
      blockName,
      pathParts,
      result,
    })

    return result
  }

  /**
   * PRIVATE METHODS
   */

  private isReference(value: string): boolean {
    return value.startsWith(REFERENCE.START) && value.endsWith(REFERENCE.END)
  }

  private extractContent(reference: string): string {
    return reference.substring(REFERENCE.START.length, reference.length - REFERENCE.END.length)
  }

  private getBlockOutput(blockId: string, context: ResolutionContext): any {
    // First check ExecutionState
    const stateOutput = context.executionState.getBlockOutput(blockId)
    if (stateOutput !== undefined) {
      return stateOutput
    }

    // Then check ExecutionContext.blockStates
    const contextState = context.executionContext.blockStates?.get(blockId)
    if (contextState?.output) {
      return contextState.output
    }

    return undefined
  }

  private findBlockIdByName(name: string): string | undefined {
    // Try direct lookup (handles IDs and exact name matches)
    if (this.blockByNormalizedName.has(name)) {
      return this.blockByNormalizedName.get(name)
    }

    // Try normalized lookup
    const normalized = normalizeBlockName(name)
    return this.blockByNormalizedName.get(normalized)
  }

  private navigatePath(obj: any, path: string[]): any {
    let current = obj

    for (const part of path) {
      if (current === null || current === undefined) {
        return undefined
      }

      // Handle array indices
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
