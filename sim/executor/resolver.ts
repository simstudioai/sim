import { createLogger } from '@/lib/logs/console-logger'
import { VariableManager } from '@/lib/variables/variable-manager'
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
        const trimmedValue = value.trim()
        const directVariableMatch = trimmedValue.match(/^<variable\.([^>]+)>$/)

        // Check for direct variable reference first
        if (directVariableMatch) {
          const variableName = directVariableMatch[1]
          const variable = this.findVariableByName(variableName)

          if (variable) {
            // Return the typed value directly
            result[key] = this.getTypedVariableValue(variable)
            continue // Skip further processing for this direct reference
          } else {
            logger.warn(
              `Direct variable reference <variable.${variableName}> not found. Treating as literal.`
            )
            result[key] = value // Return original string
            continue
          }
        }

        // If not direct reference, proceed with interpolation + other resolutions
        // First resolve variable references (interpolation)
        const resolvedVars = this.resolveVariableReferences(value, block)

        // Then resolve block references
        // Need to ensure input is string here if resolveVariableReferences returned non-string somehow (shouldn't)
        const resolvedReferences =
          typeof resolvedVars === 'string'
            ? this.resolveBlockReferences(resolvedVars, context, block)
            : resolvedVars // Pass non-string through

        // Check if this is an API key field - needs original context, less reliable here
        // We might need a better way to pass isApiKey context down recursively
        const isApiKey = this.isApiKeyField(block, value) // Check original value context

        // Then resolve environment variables
        // Need to ensure input is string here
        const resolvedEnv =
          typeof resolvedReferences === 'string'
            ? this.resolveEnvVariables(resolvedReferences, isApiKey)
            : resolvedReferences // Pass non-string through

        // Special handling for different block types
        const isFunctionBlock = block.metadata?.id === 'function'
        const isApiBlock = block.metadata?.id === 'api'

        // For function blocks, we need special handling for code input
        if (isFunctionBlock && key === 'code') {
          result[key] = resolvedEnv
        }
        // For API blocks, handle body input specially
        else if (isApiBlock && key === 'body') {
          // If the final resolved value is a string that looks like JSON, parse it.
          // Otherwise, use the value as is (it might already be an object/array from direct ref).
          if (typeof resolvedEnv === 'string') {
            try {
              if (resolvedEnv.trim().startsWith('{') || resolvedEnv.trim().startsWith('[')) {
                result[key] = JSON.parse(resolvedEnv)
              } else {
                result[key] = resolvedEnv // Keep as string if not JSON-like
              }
            } catch {
              result[key] = resolvedEnv // Keep as string if JSON parsing fails
            }
          } else {
            result[key] = resolvedEnv // Already a non-string type
          }
        }
        // For other inputs, try to convert JSON strings to objects/arrays
        else {
          // If the final resolved value is a string that looks like JSON, parse it.
          if (typeof resolvedEnv === 'string') {
            try {
              if (
                resolvedEnv.trim().length > 0 &&
                (resolvedEnv.trim().startsWith('{') || resolvedEnv.trim().startsWith('['))
              ) {
                result[key] = JSON.parse(resolvedEnv)
              } else {
                // If not JSON-like or empty, keep as string
                result[key] = resolvedEnv
              }
            } catch {
              // If it's not valid JSON, keep it as a string
              result[key] = resolvedEnv
            }
          } else {
            // If resolvedValue is already not a string (due to direct reference), keep its type
            result[key] = resolvedEnv
          }
        }
      }
      // Handle objects and arrays recursively
      else if (typeof value === 'object') {
        // Special handling for table-like arrays (e.g., from API params/headers)
        if (
          Array.isArray(value) &&
          value.every((item) => typeof item === 'object' && item !== null && 'cells' in item)
        ) {
          // Resolve each cell's value within the array
          // Cell values are resolved here and will be extracted by tools/utils.ts transformTable function
          result[key] = value.map((row) => ({
            ...row,
            cells: Object.entries(row.cells).reduce(
              (acc, [cellKey, cellValue]) => {
                if (typeof cellValue === 'string') {
                  const trimmedValue = cellValue.trim()
                  // Check for direct variable reference pattern: <variable.name>
                  const directVariableMatch = trimmedValue.match(/^<variable\.([^>]+)>$/)

                  if (directVariableMatch) {
                    // Direct variable reference - handle with clean variable lookup
                    const variableName = directVariableMatch[1]
                    const variable = this.findVariableByName(variableName)

                    if (variable) {
                      // Use the variable's typed value directly
                      acc[cellKey] = this.getTypedVariableValue(variable)
                    } else {
                      logger.warn(
                        `Variable reference <variable.${variableName}> not found in table cell`
                      )
                      acc[cellKey] = cellValue // Fall back to original string
                    }
                  } else {
                    // Process interpolated variables, block references, and environment variables
                    // The resolveNestedStructure handles all types of resolution in a consistent way
                    acc[cellKey] = this.resolveNestedStructure(cellValue, context, block)
                  }
                } else {
                  // Handle non-string values (objects, arrays, etc.)
                  acc[cellKey] = this.resolveNestedStructure(cellValue, context, block)
                }
                return acc
              },
              {} as Record<string, any>
            ),
          }))
        } else {
          // Use general recursive resolution for other objects/arrays
          result[key] = this.resolveNestedStructure(value, context, block)
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
   * Retrieves the correctly typed value of a variable based on its stored type.
   * Uses VariableManager for consistent handling of all variable types.
   *
   * @param variable - The variable object from workflowVariables
   * @returns The actual typed value of the variable
   */
  private getTypedVariableValue(variable: any): any {
    if (!variable || variable.value === undefined || variable.value === null) {
      return variable?.value // Return null or undefined as is
    }

    try {
      // Use the centralized VariableManager to resolve variable values
      return VariableManager.resolveForExecution(variable.value, variable.type)
    } catch (error) {
      logger.error(`Error processing variable ${variable.name} (type: ${variable.type}):`, error)
      return variable.value // Fallback to original value on error
    }
  }

  /**
   * Formats a typed variable value for interpolation into a string.
   * Ensures values are formatted correctly based on their type and context.
   * Uses VariableManager for consistent handling of all variable types.
   *
   * @param value - The typed value obtained from getTypedVariableValue
   * @param type - The original variable type ('string', 'number', 'plain', etc.)
   * @param currentBlock - The block context, used for needsCodeStringLiteral check
   * @returns A string representation suitable for insertion
   */
  private formatValueForInterpolation(
    value: any,
    type: string,
    currentBlock?: SerializedBlock
  ): string {
    try {
      // Determine if this needs special handling for code contexts
      const needsCodeStringLiteral = this.needsCodeStringLiteral(currentBlock, String(value))

      // Use the appropriate formatting method based on context
      if (needsCodeStringLiteral) {
        return VariableManager.formatForCodeContext(value, type as any)
      } else {
        return VariableManager.formatForTemplateInterpolation(value, type as any)
      }
    } catch (error) {
      logger.error(`Error formatting value for interpolation (type: ${type}):`, error)
      // Fallback to simple string conversion
      return String(value)
    }
  }

  /**
   * Resolves workflow variable references in a string (<variable.name>).
   *
   * @param value - String containing variable references
   * @param currentBlock - The current block, used to determine context
   * @returns String with resolved variable references
   */
  resolveVariableReferences(value: string, currentBlock?: SerializedBlock): string {
    // Added check: If value is not a string, return it directly.
    // This can happen if a prior resolution step (like block reference) returned a non-string.
    if (typeof value !== 'string') {
      return value as any // Cast needed as function technically returns string, but might pass through others
    }

    const variableMatches = value.match(/<variable\.([^>]+)>/g)
    if (!variableMatches) return value

    let resolvedValue = value

    for (const match of variableMatches) {
      const variableName = match.slice('<variable.'.length, -1)

      // Find the variable using our helper method
      const variable = this.findVariableByName(variableName)

      if (variable) {
        // Get the actual typed value
        const typedValue = this.getTypedVariableValue(variable)

        // Format the typed value for string interpolation
        const formattedValue: string = this.formatValueForInterpolation(
          typedValue,
          variable.type,
          currentBlock
        )
        resolvedValue = resolvedValue.replace(match, formattedValue)
      } else {
        // Variable not found - leave the placeholder <variable.name> in the string? Or replace with empty string?
        // For now, let's leave it, which matches previous behavior implicitly.
        logger.warn(
          `Interpolated variable reference <variable.${variableName}> not found. Leaving as literal.`
        )
      }
    }

    return resolvedValue
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

    // Check if we're in a template literal for function blocks
    const isInTemplateLiteral =
      currentBlock.metadata?.id === 'function' &&
      (/\${[^}]*</.test(value) || /<[^>]*}}\$/.test(value))

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
                  // Format primitive values properly for code contexts
                  resolvedValue = resolvedValue.replace(
                    match,
                    this.formatValueForCodeContext(currentItem, currentBlock, isInTemplateLiteral)
                  )
                } else if (
                  Array.isArray(currentItem) &&
                  currentItem.length === 2 &&
                  typeof currentItem[0] === 'string'
                ) {
                  // Handle [key, value] pair from Object.entries()
                  if (pathParts.length > 1) {
                    if (pathParts[1] === 'key') {
                      resolvedValue = resolvedValue.replace(
                        match,
                        this.formatValueForCodeContext(
                          currentItem[0],
                          currentBlock,
                          isInTemplateLiteral
                        )
                      )
                    } else if (pathParts[1] === 'value') {
                      resolvedValue = resolvedValue.replace(
                        match,
                        this.formatValueForCodeContext(
                          currentItem[1],
                          currentBlock,
                          isInTemplateLiteral
                        )
                      )
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

                    // Use the formatter helper method
                    resolvedValue = resolvedValue.replace(
                      match,
                      this.formatValueForCodeContext(itemValue, currentBlock, isInTemplateLiteral)
                    )
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
              // Format the items using our helper
              resolvedValue = resolvedValue.replace(
                match,
                this.formatValueForCodeContext(items, currentBlock, isInTemplateLiteral)
              )
              continue
            }
          } else if (pathParts[0] === 'index') {
            // Use the LoopManager to get the correct index
            const index = this.loopManager
              ? this.loopManager.getLoopIndex(containingLoopId, currentBlock.id, context)
              : context.loopIterations.get(containingLoopId) || 0

            // For function blocks, we don't need to quote numbers, but use the formatter for consistency
            resolvedValue = resolvedValue.replace(
              match,
              this.formatValueForCodeContext(index, currentBlock, isInTemplateLiteral)
            )
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
        // Check if we're in a template literal
        const isInTemplateLiteral =
          currentBlock.metadata?.id === 'function' &&
          (/\${[^}]*</.test(value) || /<[^>]*}\$/.test(value))

        // For code blocks, use our formatter
        formattedValue = this.formatValueForCodeContext(
          replacementValue,
          currentBlock,
          isInTemplateLiteral
        )
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
   * Helper method to find a variable by its name.
   * Handles normalization of names (removing spaces) for consistent matching.
   *
   * @param variableName - The name of the variable to find
   * @returns The found variable object or undefined if not found
   */
  private findVariableByName(variableName: string): any | undefined {
    const foundVariable = Object.entries(this.workflowVariables).find(
      ([_, variable]) => (variable.name || '').replace(/\s+/g, '') === variableName
    )

    return foundVariable ? foundVariable[1] : undefined
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
              // Handle both JSON format (double quotes) and JS format (single quotes)
              const normalizedExpression = trimmedExpression
                .replace(/'/g, '"') // Replace all single quotes with double quotes
                .replace(/(\w+):/g, '"$1":') // Convert property names to double-quoted strings
                .replace(/,\s*]/g, ']') // Remove trailing commas before closing brackets
                .replace(/,\s*}/g, '}') // Remove trailing commas before closing braces

              return JSON.parse(normalizedExpression)
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

  /**
   * Formats a value for safe use in a code context (like function blocks).
   * Ensures strings are properly quoted in JavaScript.
   *
   * @param value - The value to format
   * @param block - The block that will use this value
   * @param isInTemplateLiteral - Whether this value is inside a template literal
   * @returns Properly formatted value for code insertion
   */
  private formatValueForCodeContext(
    value: any,
    block: SerializedBlock,
    isInTemplateLiteral: boolean = false
  ): string {
    // For function blocks, properly format values to avoid syntax errors
    if (block.metadata?.id === 'function') {
      // Special case for values in template literals (like `Hello ${<loop.currentItem>}`)
      if (isInTemplateLiteral) {
        if (typeof value === 'string') {
          return value // Don't quote strings in template literals
        } else if (typeof value === 'object' && value !== null) {
          return JSON.stringify(value) // But do stringify objects
        } else {
          return String(value)
        }
      }

      // Regular (non-template) contexts
      if (typeof value === 'string') {
        // Quote strings for JavaScript
        return JSON.stringify(value)
      } else if (typeof value === 'object' && value !== null) {
        // Stringify objects and arrays
        return JSON.stringify(value)
      } else if (value === undefined) {
        return 'undefined'
      } else if (value === null) {
        return 'null'
      } else {
        // Numbers, booleans can be inserted as is
        return String(value)
      }
    }

    // For non-code blocks, use normal string conversion
    return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)
  }

  /**
   * Determines if a value needs to be formatted as a code-compatible string literal
   * based on the block type and context. Handles JavaScript and other code contexts.
   *
   * @param block - The block where the value is being used
   * @param expression - The expression containing the value (used for context checks)
   * @returns Whether the value should be formatted as a string literal
   */
  private needsCodeStringLiteral(block?: SerializedBlock, expression?: string): boolean {
    if (!block) return false

    // These block types execute code and need properly formatted string literals
    const codeExecutionBlocks = ['function', 'condition']

    // Check if this is a block that executes code
    if (block.metadata?.id && codeExecutionBlocks.includes(block.metadata.id)) {
      // Specifically for condition blocks, stringifyForCondition handles quoting
      // so we don't need extra quoting here unless it's within an expression.
      if (block.metadata.id === 'condition' && !expression) {
        return false
      }
      return true
    }

    // Check if the expression itself looks like code, which might indicate
    // that even in non-code blocks, a variable needs string literal formatting.
    if (expression) {
      const codeIndicators = [
        // Function/method calls
        /\(\s*$/, // Function call
        /\.\w+\s*\(/, // Method call

        // JavaScript/Python operators
        /[=<>!+\-*\/%](?:==?)?/, // Common operators
        /\+=|-=|\*=|\/=|%=|\*\*=?/, // Assignment operators

        // JavaScript keywords
        /\b(if|else|for|while|return|var|let|const|function)\b/,

        // Python keywords
        /\b(if|else|elif|for|while|def|return|import|from|as|class|with|try|except)\b/,

        // Common code patterns
        /^['\"]use strict['\"]?$/, // JS strict mode
        /\$\{.+?\}/, // JS template literals
        /f['\"].*?['\"]/, // Python f-strings
        /\bprint\s*\(/, // Python print
        /\bconsole\.\w+\(/, // JS console methods
      ]

      // Check if the expression (which might contain the variable placeholder) matches code patterns
      return codeIndicators.some((pattern) => pattern.test(expression))
    }

    return false
  }
}
