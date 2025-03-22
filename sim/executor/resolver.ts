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

    // Initialize the normalized name map
    this.blockByNormalizedName = new Map(
      workflow.blocks.map((block) => [
        block.metadata?.name ? this.normalizeBlockName(block.metadata.name) : block.id,
        block,
      ])
    )

    // Add special handling for the starter block - allow referencing it as "start"
    const starterBlock = workflow.blocks.find((block) => block.metadata?.id === 'starter')
    if (starterBlock) {
      this.blockByNormalizedName.set('start', starterBlock)
      // Also add the normalized actual name if it exists
      if (starterBlock.metadata?.name) {
        this.blockByNormalizedName.set(
          this.normalizeBlockName(starterBlock.metadata.name),
          starterBlock
        )
      }
    }
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

        // Check if this is an API key field
        const isApiKey =
          key.toLowerCase().includes('apikey') ||
          key.toLowerCase().includes('secret') ||
          key.toLowerCase().includes('token')

        // Resolve environment variables
        resolvedValue = this.resolveEnvVariables(resolvedValue, isApiKey)

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
        result[key] = this.resolveNestedStructure(value, context, block)
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

      // Special case for "start" references
      // This allows users to reference the starter block using <start.response.type.input>
      // regardless of the actual name of the starter block
      if (blockRef.toLowerCase() === 'start') {
        // Find the starter block
        const starterBlock = this.workflow.blocks.find((block) => block.metadata?.id === 'starter')
        if (starterBlock) {
          const blockState = context.blockStates.get(starterBlock.id)
          if (blockState) {
            // Navigate through the path parts
            let replacementValue: any = blockState.output
            for (const part of pathParts) {
              if (!replacementValue || typeof replacementValue !== 'object') {
                throw new Error(`Invalid path "${part}" in "${path}" for starter block.`)
              }
              replacementValue = replacementValue[part]
              if (replacementValue === undefined) {
                throw new Error(`No value found at path "${path}" in starter block.`)
              }
            }

            // Format the value
            const formattedValue =
              typeof replacementValue === 'object'
                ? JSON.stringify(replacementValue)
                : String(replacementValue)

            resolvedValue = resolvedValue.replace(match, formattedValue)
            continue
          }
        }
      }

      // Standard block reference resolution
      let sourceBlock = this.blockById.get(blockRef)
      if (!sourceBlock) {
        const normalizedRef = this.normalizeBlockName(blockRef)
        sourceBlock = this.blockByNormalizedName.get(normalizedRef)
      }

      if (!sourceBlock) {
        // Provide a more helpful error message with available block names
        const availableBlocks = Array.from(this.blockByNormalizedName.keys()).join(', ')
        throw new Error(
          `Block reference "${blockRef}" was not found. Available blocks: ${availableBlocks}. ` +
            `For the starter block, try using "start" or the exact block name.`
        )
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
      } else if (currentBlock.metadata?.id === 'function' && typeof replacementValue === 'string') {
        // For function blocks, we need to properly quote string values to avoid syntax errors
        formattedValue = JSON.stringify(replacementValue)
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
   * Determines if a string contains a properly formatted environment variable reference.
   * Valid references are either:
   * 1. A standalone env var (entire string is just {{ENV_VAR}})
   * 2. An explicit env var with clear boundaries (usually within a URL or similar)
   *
   * @param value - The string to check
   * @returns Whether this contains a properly formatted env var reference
   */
  private containsProperEnvVarReference(value: string): boolean {
    if (!value || typeof value !== 'string') return false

    // Case 1: String is just a single environment variable
    if (value.trim().match(/^\{\{[^{}]+\}\}$/)) {
      return true
    }

    // Case 2: Check for environment variables in specific contexts
    // For example, in URLs, bearer tokens, etc.
    const properContextPatterns = [
      // Auth header patterns
      /Bearer\s+\{\{[^{}]+\}\}/i,
      /Authorization:\s+Bearer\s+\{\{[^{}]+\}\}/i,
      /Authorization:\s+\{\{[^{}]+\}\}/i,

      // API key in URL patterns
      /[?&]api[_-]?key=\{\{[^{}]+\}\}/i,
      /[?&]key=\{\{[^{}]+\}\}/i,
      /[?&]token=\{\{[^{}]+\}\}/i,

      // API key in header patterns
      /X-API-Key:\s+\{\{[^{}]+\}\}/i,
      /api[_-]?key:\s+\{\{[^{}]+\}\}/i,
    ]

    return properContextPatterns.some((pattern) => pattern.test(value))
  }

  /**
   * Resolves environment variables in any value ({{ENV_VAR}}).
   * Only processes environment variables in apiKey fields or when explicitly needed.
   *
   * @param value - Value that may contain environment variable references
   * @param isApiKey - Whether this is an API key field (requires special env var handling)
   * @returns Value with environment variables resolved
   * @throws Error if referenced environment variable is not found
   */
  resolveEnvVariables(value: any, isApiKey: boolean = false): any {
    if (typeof value === 'string') {
      // Only process environment variables if:
      // 1. This is an API key field
      // 2. String is a complete environment variable reference ({{ENV_VAR}})
      // 3. String contains environment variable references in proper contexts (auth headers, URLs)
      const isExplicitEnvVar = value.trim().startsWith('{{') && value.trim().endsWith('}}')
      const hasProperEnvVarReferences = this.containsProperEnvVarReference(value)

      if (isApiKey || isExplicitEnvVar || hasProperEnvVarReferences) {
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
      }
      return value
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.resolveEnvVariables(item, isApiKey))
    }

    if (value && typeof value === 'object') {
      return Object.entries(value).reduce(
        (acc, [k, v]) => ({
          ...acc,
          [k]: this.resolveEnvVariables(v, k.toLowerCase() === 'apikey'),
        }),
        {}
      )
    }

    return value
  }

  /**
   * Resolves references and environment variables in any nested structure (object or array).
   * This is a more general approach that handles any level of nesting.
   *
   * @param value - The value to resolve (object, array, or primitive)
   * @param context - Current execution context
   * @param currentBlock - Block that contains the references
   * @returns Resolved value with all references and environment variables processed
   */
  private resolveNestedStructure(
    value: any,
    context: ExecutionContext,
    currentBlock: SerializedBlock
  ): any {
    // Handle null or undefined
    if (value === null || value === undefined) {
      return value
    }

    // Handle strings
    if (typeof value === 'string') {
      // First resolve block references
      const resolvedReferences = this.resolveBlockReferences(value, context, currentBlock)

      // Check if this is an API key field
      const isApiKey = this.isApiKeyField(currentBlock, value)

      // Then resolve environment variables with the API key flag
      return this.resolveEnvVariables(resolvedReferences, isApiKey)
    }

    // Handle arrays
    if (Array.isArray(value)) {
      return value.map((item) => this.resolveNestedStructure(item, context, currentBlock))
    }

    // Handle objects
    if (typeof value === 'object') {
      const result: Record<string, any> = {}
      for (const [k, v] of Object.entries(value)) {
        const isApiKey = k.toLowerCase() === 'apikey'
        result[k] = this.resolveNestedStructure(v, context, currentBlock)
      }
      return result
    }

    // Return primitives as is
    return value
  }

  /**
   * Determines if a given field in a block is an API key field.
   *
   * @param block - Block containing the field
   * @param value - Value to check
   * @returns Whether this appears to be an API key field
   */
  private isApiKeyField(block: SerializedBlock, value: string): boolean {
    // Check if the block is an API or agent block (which typically have API keys)
    const blockType = block.metadata?.id
    if (blockType !== 'api' && blockType !== 'agent') {
      return false
    }

    // Look for the value in the block params
    for (const [key, paramValue] of Object.entries(block.config.params)) {
      if (paramValue === value) {
        // Check if key name suggests it's an API key
        const normalizedKey = key.toLowerCase().replace(/[_\-\s]/g, '')
        return (
          normalizedKey === 'apikey' ||
          normalizedKey.includes('apikey') ||
          normalizedKey.includes('secretkey') ||
          normalizedKey.includes('accesskey') ||
          normalizedKey.includes('token')
        )
      }
    }

    return false
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
