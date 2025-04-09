import { createLogger } from '@/lib/logs/console-logger'
import { SerializedBlock, SerializedWorkflow } from '@/serializer/types'
import { LoopManager } from './loops'
import { ExecutionContext } from './types'

const logger = createLogger('InputResolver')

/**
 * Resolves input values for blocks by handling references and variable substitution.
 */
export class InputResolver {
  private blockById: Map<string, SerializedBlock>
  private blockByNormalizedName: Map<string, SerializedBlock>

  constructor(
    private workflow: SerializedWorkflow,
    private environmentVariables: Record<string, string>,
    private workflowVariables: Record<string, any> = {},
    private loopManager?: LoopManager
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

      // *** Add check for Condition Block's 'conditions' key early ***
      const isConditionBlock = block.metadata?.id === 'condition'
      const isConditionsKey = key === 'conditions'

      if (isConditionBlock && isConditionsKey && typeof value === 'string') {
        // Pass the raw string directly without resolving refs or parsing JSON
        result[key] = value
        continue // Skip further processing for this key
      }
      // *** End of early check ***

      // Handle string values that may contain references
      if (typeof value === 'string') {
        // First check for variable references
        let resolvedValue = this.resolveVariableReferences(value, block)

        // Then resolve block references
        resolvedValue = this.resolveBlockReferences(resolvedValue, context, block)

        // Check if this is an API key field
        const isApiKey =
          key.toLowerCase().includes('apikey') ||
          key.toLowerCase().includes('secret') ||
          key.toLowerCase().includes('token')

        // Resolve environment variables
        resolvedValue = this.resolveEnvVariables(resolvedValue, isApiKey)

        // Special handling for different block types
        const isFunctionBlock = block.metadata?.id === 'function'
        const isApiBlock = block.metadata?.id === 'api'

        // For function blocks, we need special handling for code input
        if (isFunctionBlock && key === 'code') {
          result[key] = resolvedValue
        }
        // For API blocks, handle body input specially
        else if (isApiBlock && key === 'body') {
          try {
            if (resolvedValue.trim().startsWith('{') || resolvedValue.trim().startsWith('[')) {
              result[key] = JSON.parse(resolvedValue)
            } else {
              result[key] = resolvedValue
            }
          } catch {
            result[key] = resolvedValue
          }
        }
        // For other inputs, try to convert JSON strings to objects
        else {
          try {
            // Check if it looks like JSON and is not empty
            if (
              resolvedValue && // Ensure resolvedValue is not null/undefined before trim
              resolvedValue.trim().length > 0 &&
              (resolvedValue.trim().startsWith('{') || resolvedValue.trim().startsWith('['))
            ) {
              result[key] = JSON.parse(resolvedValue)
            } else {
              // If not JSON-like or empty, keep as string (or potentially null/undefined if resolvedValue became that)
              result[key] = resolvedValue
            }
          } catch {
            // If it's not valid JSON, keep it as a string
            result[key] = resolvedValue
          }
        }
      }
      // Handle objects and arrays recursively
      else if (typeof value === 'object') {
        // *** Note: If conditions is ever stored as an object, this needs adjustment ***
        // Assuming conditions is always passed as string from UI initially.
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
   * Resolves workflow variable references in a string (<variable.name>).
   *
   * @param value - String containing variable references
   * @param currentBlock - The current block, used to determine context
   * @returns String with resolved variable references
   */
  resolveVariableReferences(value: string, currentBlock?: SerializedBlock): string {
    const variableMatches = value.match(/<variable\.([^>]+)>/g)
    if (!variableMatches) return value

    let resolvedValue = value

    for (const match of variableMatches) {
      const variableName = match.slice('<variable.'.length, -1)

      // Find the variable by normalized name (without spaces)
      const foundVariable = Object.entries(this.workflowVariables).find(([_, variable]) => {
        const normalizedName = (variable.name || '').replace(/\s+/g, '')
        return normalizedName === variableName
      })

      if (foundVariable) {
        const [_, variable] = foundVariable

        // Process variable value based on its type
        let processedValue = variable.value

        // Handle string values that could be stored with quotes
        if (variable.type === 'string' && typeof processedValue === 'string') {
          // If the string value starts and ends with quotes, remove them
          const trimmed = processedValue.trim()
          if (
            (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
            (trimmed.startsWith("'") && trimmed.endsWith("'"))
          ) {
            // Remove the quotes and unescape any escaped quotes
            processedValue = trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'")
          }
        }
        // Handle boolean values that might be stored as strings
        else if (variable.type === 'boolean' && typeof processedValue === 'string') {
          processedValue = processedValue.trim().toLowerCase() === 'true'
        }
        // Handle number values that might be stored as strings
        else if (variable.type === 'number' && typeof processedValue === 'string') {
          const parsed = Number(processedValue)
          if (!isNaN(parsed)) {
            processedValue = parsed
          }
        }
        // Handle object/array values that might be stored as JSON strings
        else if (
          (variable.type === 'object' || variable.type === 'array') &&
          typeof processedValue === 'string'
        ) {
          try {
            processedValue = JSON.parse(processedValue)
          } catch (e) {
            // Keep as string if parsing fails
          }
        }

        // Determine if this needs to be a code-compatible string literal
        const needsCodeStringLiteral = this.needsCodeStringLiteral(currentBlock, value)

        // Format the processed value for insertion into the string based on context
        let formattedValue: string

        if (variable.type === 'string' && needsCodeStringLiteral) {
          // For code contexts like function and condition blocks, properly quote strings
          formattedValue = JSON.stringify(processedValue)
        } else if (typeof processedValue === 'object' && processedValue !== null) {
          // For objects, always stringify
          formattedValue = JSON.stringify(processedValue)
        } else {
          // For other types in normal contexts, use simple string conversion
          formattedValue = String(processedValue)
        }

        resolvedValue = resolvedValue.replace(match, formattedValue)
      }
    }

    return resolvedValue
  }

  /**
   * Determines if a value needs to be formatted as a code-compatible string literal
   * based on the block type and context. Handles JavaScript and other code contexts.
   *
   * @param block - The block where the value is being used
   * @param expression - The expression containing the value
   * @returns Whether the value should be formatted as a string literal
   */
  private needsCodeStringLiteral(block?: SerializedBlock, expression?: string): boolean {
    if (!block) return false

    // These block types execute code and need properly formatted string literals
    const codeExecutionBlocks = ['function', 'condition']

    // Check if this is a block that executes code
    if (block.metadata?.id && codeExecutionBlocks.includes(block.metadata.id)) {
      return true
    }

    // Check if the expression is likely part of code
    if (expression) {
      const codeIndicators = [
        // Function/method calls
        /\(\s*$/, // Function call
        /\.\w+\s*\(/, // Method call

        // JavaScript/Python operators
        /[=<>!+\-*/%](?:==?)?/, // Common operators
        /\+=|-=|\*=|\/=|%=|\*\*=?/, // Assignment operators

        // JavaScript keywords
        /\b(if|else|for|while|return|var|let|const|function)\b/,

        // Python keywords
        /\b(if|else|elif|for|while|def|return|import|from|as|class|with|try|except)\b/,

        // Common code patterns
        /^['"]use strict['"];?$/, // JS strict mode
        /\$\{.+?\}/, // JS template literals
        /f['"].*?['"]/, // Python f-strings
        /\bprint\s*\(/, // Python print
        /\bconsole\.\w+\(/, // JS console methods
      ]

      return codeIndicators.some((pattern) => pattern.test(expression))
    }

    return false
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
      // Skip variables - they've already been processed
      if (match.startsWith('<variable.')) {
        continue
      }

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
                logger.warn(
                  `[resolveBlockReferences] Invalid path "${part}" - replacementValue is not an object:`,
                  replacementValue
                )
                throw new Error(`Invalid path "${part}" in "${path}" for starter block.`)
              }

              replacementValue = replacementValue[part]

              if (replacementValue === undefined) {
                logger.warn(
                  `[resolveBlockReferences] No value found at path "${part}" in starter block.`
                )
                throw new Error(`No value found at path "${path}" in starter block.`)
              }
            }

            // Format the value based on block type and path
            let formattedValue: string

            // Special handling for all blocks referencing starter input
            if (blockRef.toLowerCase() === 'start' && pathParts.join('.').includes('input')) {
              const blockType = currentBlock.metadata?.id

              // Format based on which block is consuming this value
              if (typeof replacementValue === 'object' && replacementValue !== null) {
                // For function blocks, preserve the object structure for code usage
                if (blockType === 'function') {
                  formattedValue = JSON.stringify(replacementValue)
                }
                // For API blocks, handle body special case
                else if (blockType === 'api') {
                  formattedValue = JSON.stringify(replacementValue)
                }
                // For condition blocks, ensure proper formatting
                else if (blockType === 'condition') {
                  formattedValue = this.stringifyForCondition(replacementValue)
                }
                // For all other blocks, stringify objects
                else {
                  formattedValue = JSON.stringify(replacementValue)
                }
              } else {
                // For primitive values
                formattedValue = String(replacementValue)
              }
            } else {
              // Standard handling for non-input references
              formattedValue =
                typeof replacementValue === 'object'
                  ? JSON.stringify(replacementValue)
                  : String(replacementValue)
            }

            resolvedValue = resolvedValue.replace(match, formattedValue)
            continue
          }
        }
      }

      // Special case for "loop" references - allows accessing loop properties
      if (blockRef.toLowerCase() === 'loop') {
        // Find which loop this block belongs to
        let containingLoopId: string | undefined

        for (const [loopId, loop] of Object.entries(context.workflow?.loops || {})) {
          if (loop.nodes.includes(currentBlock.id)) {
            containingLoopId = loopId
            break
          }
        }

        if (containingLoopId) {
          const loop = context.workflow?.loops[containingLoopId]
          const loopType = loop?.loopType || 'for'

          // Handle each loop property
          if (pathParts[0] === 'currentItem') {
            // Get the items to iterate over
            const items = this.getLoopItems(loop, context)

            // Get the correct index using the LoopManager
            const index = this.loopManager
              ? this.loopManager.getLoopIndex(containingLoopId, currentBlock.id, context)
              : context.loopIterations.get(containingLoopId) || 0

            // Get the current item directly from the items array at the current index
            if (Array.isArray(items) && index >= 0 && index < items.length) {
              const currentItem = items[index]

              // Format the value based on type
              if (currentItem !== undefined) {
                if (typeof currentItem !== 'object' || currentItem === null) {
                  // For primitives, convert to string
                  resolvedValue = resolvedValue.replace(match, String(currentItem))
                } else if (
                  Array.isArray(currentItem) &&
                  currentItem.length === 2 &&
                  typeof currentItem[0] === 'string'
                ) {
                  // Handle [key, value] pair from Object.entries()
                  if (pathParts.length > 1) {
                    if (pathParts[1] === 'key') {
                      resolvedValue = resolvedValue.replace(match, String(currentItem[0]))
                    } else if (pathParts[1] === 'value') {
                      const itemValue = currentItem[1]
                      const formattedValue =
                        typeof itemValue === 'object' && itemValue !== null
                          ? JSON.stringify(itemValue)
                          : String(itemValue)
                      resolvedValue = resolvedValue.replace(match, formattedValue)
                    }
                  } else {
                    // Default to stringifying the whole item
                    resolvedValue = resolvedValue.replace(match, JSON.stringify(currentItem))
                  }
                } else {
                  // Navigate path if provided for objects
                  if (pathParts.length > 1) {
                    let itemValue = currentItem
                    for (let i = 1; i < pathParts.length; i++) {
                      if (!itemValue || typeof itemValue !== 'object') {
                        throw new Error(
                          `Invalid path "${pathParts[i]}" in loop item reference "${path}"`
                        )
                      }
                      itemValue = itemValue[pathParts[i]]
                      if (itemValue === undefined) {
                        throw new Error(`No value found at path "${path}" in loop item`)
                      }
                    }

                    const formattedValue =
                      typeof itemValue === 'object' && itemValue !== null
                        ? JSON.stringify(itemValue)
                        : String(itemValue)

                    resolvedValue = resolvedValue.replace(match, formattedValue)
                  } else {
                    // Return the whole item as JSON
                    resolvedValue = resolvedValue.replace(match, JSON.stringify(currentItem))
                  }
                }
              }

              continue
            }
          } else if (pathParts[0] === 'items' && loopType === 'forEach') {
            // Get all items in the forEach loop
            const items = this.getLoopItems(loop, context)

            if (items) {
              // Format the items based on type
              const formattedValue =
                typeof items === 'object' && items !== null ? JSON.stringify(items) : String(items)

              resolvedValue = resolvedValue.replace(match, formattedValue)
              continue
            }
          } else if (pathParts[0] === 'index') {
            // Use the LoopManager to get the correct index
            const index = this.loopManager
              ? this.loopManager.getLoopIndex(containingLoopId, currentBlock.id, context)
              : context.loopIterations.get(containingLoopId) || 0

            resolvedValue = resolvedValue.replace(match, String(index))
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
      } else if (
        typeof replacementValue === 'string' &&
        this.needsCodeStringLiteral(currentBlock, value)
      ) {
        // For code blocks, quote string values properly for the given language
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
      // First resolve variable references
      const resolvedVars = this.resolveVariableReferences(value, currentBlock)

      // Then resolve block references
      const resolvedReferences = this.resolveBlockReferences(resolvedVars, context, currentBlock)

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

  /**
   * Gets the items for a forEach loop.
   * The items can be stored directly in loop.forEachItems or may need to be evaluated.
   *
   * @param loop - The loop configuration
   * @param context - Current execution context
   * @returns The items to iterate over (array or object)
   */
  private getLoopItems(loop: any, context: ExecutionContext): any[] | Record<string, any> | null {
    if (!loop) return null

    // If items are already available as an array or object, return them directly
    if (loop.forEachItems) {
      if (
        Array.isArray(loop.forEachItems) ||
        (typeof loop.forEachItems === 'object' && loop.forEachItems !== null)
      ) {
        return loop.forEachItems
      }

      // If it's a string, try to evaluate it (could be an expression or JSON)
      if (typeof loop.forEachItems === 'string') {
        try {
          // Check if it's valid JSON
          const trimmedExpression = loop.forEachItems.trim()
          if (trimmedExpression.startsWith('[') || trimmedExpression.startsWith('{')) {
            try {
              // Try to parse as JSON first
              return JSON.parse(trimmedExpression)
            } catch (jsonError) {
              console.error(`Error parsing JSON for loop:`, jsonError)
              // If JSON parsing fails, continue with expression evaluation
            }
          }

          // If not valid JSON or JSON parsing failed, try to evaluate as an expression
          if (trimmedExpression && !trimmedExpression.startsWith('//')) {
            const result = new Function('context', `return ${loop.forEachItems}`)(context)
            if (Array.isArray(result) || (typeof result === 'object' && result !== null)) {
              return result
            }
          }
        } catch (e) {
          console.error(`Error evaluating forEach items:`, e)
        }
      }
    }

    // As a fallback, look for the most recent array or object in any block's output
    // This is less reliable but might help in some cases
    for (const [blockId, blockState] of context.blockStates.entries()) {
      const output = blockState.output?.response
      if (output) {
        for (const [key, value] of Object.entries(output)) {
          if (Array.isArray(value) && value.length > 0) {
            return value
          } else if (typeof value === 'object' && value !== null && Object.keys(value).length > 0) {
            return value
          }
        }
      }
    }

    // Default to empty array if no valid items found
    return []
  }
}
