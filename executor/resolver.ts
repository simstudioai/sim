import { SerializedBlock, SerializedWorkflow } from '@/serializer/types'
import { ExecutionContext } from './types'

/**
 * Resolves input values for blocks by handling references and variable substitution.
 */
export class InputResolver {
  private blockById: Map<string, SerializedBlock>
  private blockByNormalizedName: Map<string, SerializedBlock>

  constructor(
    private workflow: SerializedWorkflow,
    private environmentVariables: Record<string, string>
  ) {
    // Create maps for efficient lookups
    this.blockById = new Map(workflow.blocks.map((block) => [block.id, block]))
    this.blockByNormalizedName = new Map(
      workflow.blocks.map((block) => [
        block.metadata?.name ? this.normalizeBlockName(block.metadata.name) : block.id,
        block,
      ])
    )
  }

  /**
   * Resolve all inputs for a block based on current context
   */
  resolveInputs(block: SerializedBlock, context: ExecutionContext): Record<string, any> {
    const inputs = { ...block.config.params }
    const result: Record<string, any> = {}

    // Process each input parameter
    for (const [key, value] of Object.entries(inputs)) {
      // Skip null or undefined values
      if (value === null || value === undefined) {
        result[key] = value
        continue
      }

      // Handle string values that may contain references
      if (typeof value === 'string') {
        // Resolve block references
        let resolvedValue = this.resolveBlockReferences(value, context, block)

        // Resolve environment variables
        resolvedValue = this.resolveEnvVariables(resolvedValue)

        // Convert JSON strings to objects if possible
        try {
          if (resolvedValue.startsWith('{') || resolvedValue.startsWith('[')) {
            result[key] = JSON.parse(resolvedValue)
          } else {
            result[key] = resolvedValue
          }
        } catch {
          // If it's not valid JSON, keep it as a string
          result[key] = resolvedValue
        }
      }
      // Handle objects and arrays recursively
      else if (typeof value === 'object') {
        if (Array.isArray(value)) {
          result[key] = value.map((item) =>
            typeof item === 'string'
              ? this.resolveEnvVariables(this.resolveBlockReferences(item, context, block))
              : item
          )
        } else {
          result[key] = this.resolveObjectReferences(value, context, block)
        }
      }
      // Pass through other value types
      else {
        result[key] = value
      }
    }

    return result
  }

  /**
   * Resolve block references in a string (<blockId.property> or <blockName.property>)
   */
  resolveBlockReferences(
    value: string,
    context: ExecutionContext,
    currentBlock: SerializedBlock
  ): string {
    // Match all block references: <blockReference.path.to.property>
    const blockMatches = value.match(/<([^>]+)>/g)
    if (!blockMatches) return value

    let resolvedValue = value

    for (const match of blockMatches) {
      const path = match.slice(1, -1)
      const [blockRef, ...pathParts] = path.split('.')

      // Try to find the referenced block
      let sourceBlock = this.blockById.get(blockRef)

      // If not found by ID, try by normalized name
      if (!sourceBlock) {
        const normalizedRef = this.normalizeBlockName(blockRef)
        sourceBlock = this.blockByNormalizedName.get(normalizedRef)
      }

      // If still not found, throw error
      if (!sourceBlock) {
        throw new Error(`Block reference "${blockRef}" was not found.`)
      }

      // Check if block is enabled
      if (sourceBlock.enabled === false) {
        throw new Error(
          `Block "${sourceBlock.metadata?.name || sourceBlock.id}" is disabled, and block "${currentBlock.metadata?.name || currentBlock.id}" depends on it.`
        )
      }

      // NEW LOGIC: Check if the block is in an inactive path
      const isInActivePath = context.activeExecutionPath.has(sourceBlock.id)

      // If block is not in active path, return empty value based on path type
      if (!isInActivePath) {
        // Return appropriate empty value based on the path
        if (pathParts.length > 0) {
          const lastPart = pathParts[pathParts.length - 1]
          // Try to infer the type from the path
          if (lastPart.includes('content')) {
            resolvedValue = resolvedValue.replace(match, '""')
            continue
          } else if (lastPart.includes('data') || lastPart.includes('response')) {
            resolvedValue = resolvedValue.replace(match, '{}')
            continue
          } else if (lastPart.includes('list') || lastPart.includes('array')) {
            resolvedValue = resolvedValue.replace(match, '[]')
            continue
          } else {
            resolvedValue = resolvedValue.replace(match, '""')
            continue
          }
        } else {
          // Default to empty object for full block references
          resolvedValue = resolvedValue.replace(match, '{}')
          continue
        }
      }

      // Get the state of the referenced block
      const blockState = context.blockStates.get(sourceBlock.id)

      // Handle loops - if we're in a loop and the block state isn't available yet
      if (!blockState) {
        // Check if the block is part of a loop
        const isInLoop = Object.values(this.workflow.loops || {}).some((loop) =>
          loop.nodes.includes(sourceBlock.id)
        )

        if (isInLoop) {
          // For loop blocks that haven't been executed yet, return an empty value
          // This avoids breaking the execution when blocks reference future loop iterations
          if (pathParts.length > 0) {
            resolvedValue = resolvedValue.replace(match, '""')
          } else {
            resolvedValue = resolvedValue.replace(match, '{}')
          }
          continue
        }

        // If not in a loop, it's an error
        throw new Error(
          `No state found for block "${sourceBlock.metadata?.name || sourceBlock.id}" (ID: ${sourceBlock.id}).`
        )
      }

      // Drill into the property path to get the value
      let replacementValue: any = blockState.output

      for (const part of pathParts) {
        if (!replacementValue || typeof replacementValue !== 'object') {
          throw new Error(
            `Invalid path "${part}" in "${path}" for block "${currentBlock.metadata?.name || currentBlock.id}".`
          )
        }
        replacementValue = replacementValue[part]

        if (replacementValue === undefined) {
          throw new Error(
            `No value found at path "${path}" in block "${sourceBlock.metadata?.name || sourceBlock.id}".`
          )
        }
      }

      // Format replacement value based on block type
      let formattedValue: string

      if (currentBlock.metadata?.id === 'condition') {
        // For conditions, stringified values may need special handling
        formattedValue = this.stringifyForCondition(replacementValue)
      } else {
        // For other blocks, just convert to string representation
        formattedValue =
          typeof replacementValue === 'object'
            ? JSON.stringify(replacementValue)
            : String(replacementValue)
      }

      // Replace the match with the resolved value
      resolvedValue = resolvedValue.replace(match, formattedValue)
    }

    return resolvedValue
  }

  /**
   * Resolve environment variables in any value ({{ENV_VAR}})
   */
  resolveEnvVariables(value: any): any {
    // Handle strings
    if (typeof value === 'string') {
      const envMatches = value.match(/\{\{([^}]+)\}\}/g)
      if (envMatches) {
        let resolvedValue = value
        for (const match of envMatches) {
          const envKey = match.slice(2, -2)
          const envValue = this.environmentVariables[envKey]

          if (envValue === undefined) {
            throw new Error(`Environment variable "${envKey}" was not found.`)
          }

          resolvedValue = resolvedValue.replace(match, envValue)
        }
        return resolvedValue
      }
      return value
    }

    // Handle arrays
    if (Array.isArray(value)) {
      return value.map((item) => this.resolveEnvVariables(item))
    }

    // Handle objects
    if (value && typeof value === 'object') {
      return Object.entries(value).reduce(
        (acc, [k, v]) => ({ ...acc, [k]: this.resolveEnvVariables(v) }),
        {}
      )
    }

    // Return other types as-is
    return value
  }

  /**
   * Resolve block references in an object or array
   */
  private resolveObjectReferences(
    obj: Record<string, any>,
    context: ExecutionContext,
    currentBlock: SerializedBlock
  ): Record<string, any> {
    const result: Record<string, any> = {}

    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        result[key] = this.resolveBlockReferences(value, context, currentBlock)
        result[key] = this.resolveEnvVariables(result[key])
      } else if (Array.isArray(value)) {
        result[key] = value.map((item) =>
          typeof item === 'string'
            ? this.resolveEnvVariables(this.resolveBlockReferences(item, context, currentBlock))
            : typeof item === 'object'
              ? this.resolveObjectReferences(item, context, currentBlock)
              : item
        )
      } else if (value && typeof value === 'object') {
        result[key] = this.resolveObjectReferences(value, context, currentBlock)
      } else {
        result[key] = value
      }
    }

    return result
  }

  /**
   * Properly format a value for use in condition blocks
   */
  private stringifyForCondition(value: any): string {
    if (typeof value === 'string') {
      return `"${value.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
    } else if (value === null) {
      return 'null'
    } else if (typeof value === 'undefined') {
      return 'undefined'
    } else if (typeof value === 'object') {
      return JSON.stringify(value)
    }
    return String(value)
  }

  /**
   * Normalize block name for consistent lookups
   */
  private normalizeBlockName(name: string): string {
    return name.toLowerCase().replace(/\s+/g, '')
  }
}
