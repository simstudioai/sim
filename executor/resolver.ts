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
   * Resolves all inputs for a block based on current context.
   * Handles block references, environment variables, and JSON parsing.
   *
   * @param block - Block to resolve inputs for
   * @param context - Current execution context
   * @returns Resolved input parameters
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
   * Resolves block references in a string (<blockId.property> or <blockName.property>).
   * Handles inactive paths, missing blocks, and formats values appropriately.
   *
   * @param value - String containing block references
   * @param context - Current execution context
   * @param currentBlock - Block that contains the references
   * @returns String with resolved references
   * @throws Error if referenced block is not found or disabled
   */
  resolveBlockReferences(
    value: string,
    context: ExecutionContext,
    currentBlock: SerializedBlock
  ): string {
    const blockMatches = value.match(/<([^>]+)>/g)
    if (!blockMatches) return value

    let resolvedValue = value

    for (const match of blockMatches) {
      const path = match.slice(1, -1)
      const [blockRef, ...pathParts] = path.split('.')

      let sourceBlock = this.blockById.get(blockRef)

      if (!sourceBlock) {
        const normalizedRef = this.normalizeBlockName(blockRef)
        sourceBlock = this.blockByNormalizedName.get(normalizedRef)
      }

      if (!sourceBlock) {
        throw new Error(`Block reference "${blockRef}" was not found.`)
      }

      if (sourceBlock.enabled === false) {
        throw new Error(
          `Block "${sourceBlock.metadata?.name || sourceBlock.id}" is disabled, and block "${currentBlock.metadata?.name || currentBlock.id}" depends on it.`
        )
      }

      const isInActivePath = context.activeExecutionPath.has(sourceBlock.id)

      if (!isInActivePath) {
        resolvedValue = resolvedValue.replace(match, '')
        continue
      }

      const blockState = context.blockStates.get(sourceBlock.id)

      if (!blockState) {
        // If the block is in a loop, return empty string
        const isInLoop = Object.values(this.workflow.loops || {}).some((loop) =>
          loop.nodes.includes(sourceBlock.id)
        )

        if (isInLoop) {
          resolvedValue = resolvedValue.replace(match, '')
          continue
        }

        // If the block hasn't been executed and isn't in the active path,
        // it means it's in an inactive branch - return empty string
        if (!context.activeExecutionPath.has(sourceBlock.id)) {
          resolvedValue = resolvedValue.replace(match, '')
          continue
        }

        throw new Error(
          `No state found for block "${sourceBlock.metadata?.name || sourceBlock.id}" (ID: ${sourceBlock.id}).`
        )
      }

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

      let formattedValue: string

      if (currentBlock.metadata?.id === 'condition') {
        formattedValue = this.stringifyForCondition(replacementValue)
      } else {
        formattedValue =
          typeof replacementValue === 'object'
            ? JSON.stringify(replacementValue)
            : String(replacementValue)
      }

      resolvedValue = resolvedValue.replace(match, formattedValue)
    }

    return resolvedValue
  }

  /**
   * Resolves environment variables in any value ({{ENV_VAR}}).
   *
   * @param value - Value that may contain environment variable references
   * @returns Value with environment variables resolved
   * @throws Error if referenced environment variable is not found
   */
  resolveEnvVariables(value: any): any {
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

    if (Array.isArray(value)) {
      return value.map((item) => this.resolveEnvVariables(item))
    }

    if (value && typeof value === 'object') {
      return Object.entries(value).reduce(
        (acc, [k, v]) => ({ ...acc, [k]: this.resolveEnvVariables(v) }),
        {}
      )
    }

    return value
  }

  /**
   * Resolves block references in an object or array.
   * Recursively processes nested objects and arrays.
   *
   * @param obj - Object containing block references
   * @param context - Current execution context
   * @param currentBlock - Block that contains the references
   * @returns Object with resolved references
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
   * Formats a value for use in condition blocks.
   * Handles strings, null, undefined, and objects appropriately.
   *
   * @param value - Value to format
   * @returns Formatted string representation
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
   * Normalizes block name for consistent lookups.
   * Converts to lowercase and removes whitespace.
   *
   * @param name - Block name to normalize
   * @returns Normalized block name
   */
  private normalizeBlockName(name: string): string {
    return name.toLowerCase().replace(/\s+/g, '')
  }
}
