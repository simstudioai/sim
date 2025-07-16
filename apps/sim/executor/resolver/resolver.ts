import { BlockPathCalculator } from '@/lib/block-path-calculator'
import { createLogger } from '@/lib/logs/console-logger'
import { VariableManager } from '@/lib/variables/variable-manager'
import type { LoopManager } from '@/executor/loops/loops'
import type { ExecutionContext } from '@/executor/types'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'

const logger = createLogger('InputResolver')

/**
 * Resolves input values for blocks by handling references and variable substitution.
 */
export class InputResolver {
  private blockById: Map<string, SerializedBlock>
  private blockByNormalizedName: Map<string, SerializedBlock>
  private loopsByBlockId: Map<string, string> // Maps block ID to containing loop ID

  constructor(
    private workflow: SerializedWorkflow,
    private environmentVariables: Record<string, string>,
    private workflowVariables: Record<string, any> = {},
    private loopManager?: LoopManager,
    public accessibleBlocksMap?: Map<string, Set<string>>
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

    // Create efficient loop lookup map
    this.loopsByBlockId = new Map()
    for (const [loopId, loop] of Object.entries(workflow.loops || {})) {
      for (const blockId of loop.nodes) {
        this.loopsByBlockId.set(blockId, loopId)
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

        // Check for direct variable reference pattern: <variable.name>
        const directVariableMatch = trimmedValue.match(/^<variable\.([^>]+)>$/)
        if (directVariableMatch) {
          const variableName = directVariableMatch[1]
          const variable = this.findVariableByName(variableName)

          if (variable) {
            // Return the typed value directly
            result[key] = this.getTypedVariableValue(variable)
            continue
          }
          logger.warn(
            `Direct variable reference <variable.${variableName}> not found. Treating as literal.`
          )
          result[key] = value
          continue
        }

        // Check for direct loop reference pattern: <loop.property>
        const directLoopMatch = trimmedValue.match(/^<loop\.([^>]+)>$/)
        if (directLoopMatch) {
          // Find which loop this block belongs to using efficient lookup
          const containingLoopId = this.loopsByBlockId.get(block.id)

          if (containingLoopId) {
            const pathParts = directLoopMatch[1].split('.')
            const loopValue = this.resolveLoopReference(
              containingLoopId,
              pathParts,
              context,
              block,
              false
            )

            if (loopValue !== null) {
              // Parse the value if it's a JSON string
              try {
                result[key] = JSON.parse(loopValue)
              } catch {
                // If it's not valid JSON, use as is
                result[key] = loopValue
              }
              continue
            }
          }

          logger.warn(`Direct loop reference <loop.${directLoopMatch[1]}> could not be resolved.`)
          result[key] = value
          continue
        }

        // Check for direct parallel reference pattern: <parallel.property>
        const directParallelMatch = trimmedValue.match(/^<parallel\.([^>]+)>$/)
        if (directParallelMatch) {
          // Find which parallel this block belongs to
          let containingParallelId: string | undefined
          for (const [parallelId, parallel] of Object.entries(context.workflow?.parallels || {})) {
            if (parallel.nodes.includes(block.id)) {
              containingParallelId = parallelId
              break
            }
          }

          if (containingParallelId) {
            const pathParts = directParallelMatch[1].split('.')
            const parallelValue = this.resolveParallelReference(
              containingParallelId,
              pathParts,
              context,
              block,
              false
            )

            if (parallelValue !== null) {
              // Parse the value if it's a JSON string
              try {
                result[key] = JSON.parse(parallelValue)
              } catch {
                // If it's not valid JSON, use as is
                result[key] = parallelValue
              }
              continue
            }
          }

          logger.warn(
            `Direct parallel reference <parallel.${directParallelMatch[1]}> could not be resolved.`
          )
          result[key] = value
          continue
        }

        // Process string with potential interpolations and references
        result[key] = this.processStringValue(value, key, context, block)
      }
      // Handle objects and arrays recursively
      else if (typeof value === 'object') {
        result[key] = this.processObjectValue(value, key, context, block)
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
      // Handle 'string' type the same as 'plain' for backward compatibility
      const type = variable.type === 'string' ? 'plain' : variable.type

      // Use the centralized VariableManager to resolve variable values
      return VariableManager.resolveForExecution(variable.value, type)
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
      // Handle 'string' type the same as 'plain' for backward compatibility
      const normalizedType = type === 'string' ? 'plain' : type

      // For plain text, use exactly what's entered without modifications
      if (normalizedType === 'plain' && typeof value === 'string') {
        return value
      }

      // Determine if this needs special handling for code contexts
      const needsCodeStringLiteral = this.needsCodeStringLiteral(currentBlock, String(value))
      const isFunctionBlock = currentBlock?.metadata?.id === 'function'

      // Always use code formatting for function blocks
      if (isFunctionBlock || needsCodeStringLiteral) {
        return VariableManager.formatForCodeContext(value, normalizedType as any)
      }
      return VariableManager.formatForTemplateInterpolation(value, normalizedType as any)
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
    // Skip resolution for API block body content that looks like XML
    if (
      currentBlock.metadata?.id === 'api' &&
      typeof value === 'string' &&
      // Check if this looks like XML content
      (value.includes('<?xml') || value.includes('xmlns:') || value.includes('</')) &&
      value.includes('<') &&
      value.includes('>')
    ) {
      return value
    }

    const blockMatches = value.match(/<([^>]+)>/g)
    if (!blockMatches) return value

    // If we're in an API block body, check each match to see if it looks like XML rather than a reference
    if (
      currentBlock.metadata?.id === 'api' &&
      blockMatches.some((match) => {
        const innerContent = match.slice(1, -1)
        // Patterns that suggest this is XML, not a block reference:
        return (
          innerContent.includes(':') || // namespaces like soap:Envelope
          innerContent.includes('=') || // attributes like xmlns="http://..."
          innerContent.includes(' ') || // any space indicates attributes
          innerContent.includes('/') || // self-closing tags
          !innerContent.includes('.')
        ) // block refs always have dots
      })
    ) {
      return value // Likely XML content, return unchanged
    }

    let resolvedValue = value

    // Check if we're in a template literal for function blocks
    const isInTemplateLiteral =
      currentBlock.metadata?.id === 'function' &&
      value.includes('${') &&
      value.includes('}') &&
      value.includes('`')

    for (const match of blockMatches) {
      // Skip variables - they've already been processed
      if (match.startsWith('<variable.')) {
        continue
      }

      const path = match.slice(1, -1)
      const [blockRef, ...pathParts] = path.split('.')

      // Skip XML-like tags (but allow block names with spaces)
      if (blockRef.includes(':')) {
        continue
      }

      // System references (start, loop, parallel, variable) are handled as special cases
      const isSystemReference = ['start', 'loop', 'parallel', 'variable'].includes(
        blockRef.toLowerCase()
      )

      // System references and regular block references are both processed
      // Accessibility validation happens later in validateBlockReference

      // Special case for "start" references
      if (blockRef.toLowerCase() === 'start') {
        // Find the starter block
        const starterBlock = this.workflow.blocks.find((block) => block.metadata?.id === 'starter')
        if (starterBlock) {
          const blockState = context.blockStates.get(starterBlock.id)
          if (blockState) {
            // For starter block, start directly with the flattened output
            // This enables direct access to <start.input> and <start.conversationId>
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
                  // Preserve full JSON structure for objects
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
        // Find which loop this block belongs to using efficient lookup
        const containingLoopId = this.loopsByBlockId.get(currentBlock.id)

        if (containingLoopId) {
          const formattedValue = this.resolveLoopReference(
            containingLoopId,
            pathParts,
            context,
            currentBlock,
            isInTemplateLiteral
          )

          if (formattedValue !== null) {
            resolvedValue = resolvedValue.replace(match, formattedValue)
            continue
          }
        }
      }

      // Special case for "parallel" references - allows accessing parallel properties
      if (blockRef.toLowerCase() === 'parallel') {
        // Find which parallel this block belongs to
        let containingParallelId: string | undefined

        for (const [parallelId, parallel] of Object.entries(context.workflow?.parallels || {})) {
          if (parallel.nodes.includes(currentBlock.id)) {
            containingParallelId = parallelId
            break
          }
        }

        if (containingParallelId) {
          const formattedValue = this.resolveParallelReference(
            containingParallelId,
            pathParts,
            context,
            currentBlock,
            isInTemplateLiteral
          )

          if (formattedValue !== null) {
            resolvedValue = resolvedValue.replace(match, formattedValue)
            continue
          }
        }
      }

      // Standard block reference resolution with connection validation
      const validation = this.validateBlockReference(blockRef, currentBlock.id, context)

      if (!validation.isValid) {
        throw new Error(validation.errorMessage!)
      }

      const sourceBlock = this.blockById.get(validation.resolvedBlockId!)!

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
        const isInLoop = this.loopsByBlockId.has(sourceBlock.id)

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
          value.includes('${') &&
          value.includes('}') &&
          value.includes('`')

        // For code blocks, use our formatter
        formattedValue = this.formatValueForCodeContext(
          replacementValue,
          currentBlock,
          isInTemplateLiteral
        )
      } else {
        // The function execution API will handle variable resolution within code strings
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
  resolveEnvVariables(value: any, isApiKey = false): any {
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
        const _isApiKey = k.toLowerCase() === 'apikey'
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
    }
    if (value === null) {
      return 'null'
    }
    if (typeof value === 'undefined') {
      return 'undefined'
    }
    if (typeof value === 'object') {
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
   * Gets all blocks that the current block can reference.
   * Uses pre-calculated accessible blocks if available, otherwise falls back to legacy calculation.
   *
   * @param currentBlockId - ID of the block requesting references
   * @returns Set of accessible block IDs
   */
  private getAccessibleBlocks(currentBlockId: string): Set<string> {
    // Use pre-calculated accessible blocks if available
    if (this.accessibleBlocksMap?.has(currentBlockId)) {
      return this.accessibleBlocksMap.get(currentBlockId)!
    }

    // Fallback to legacy calculation for backward compatibility
    return this.calculateAccessibleBlocksLegacy(currentBlockId)
  }

  /**
   * Legacy method for calculating accessible blocks (for backward compatibility).
   * This method is kept for cases where pre-calculated data is not available.
   *
   * @param currentBlockId - ID of the block requesting references
   * @returns Set of accessible block IDs
   */
  private calculateAccessibleBlocksLegacy(currentBlockId: string): Set<string> {
    const accessibleBlocks = new Set<string>()

    // Add blocks that have outgoing connections TO this block
    for (const connection of this.workflow.connections) {
      if (connection.target === currentBlockId) {
        accessibleBlocks.add(connection.source)
      }
    }

    // Always allow referencing the starter block (special case)
    const starterBlock = this.workflow.blocks.find((block) => block.metadata?.id === 'starter')
    if (starterBlock) {
      accessibleBlocks.add(starterBlock.id)
    }

    // Special case: blocks in the same loop can reference each other
    const currentBlockLoop = this.loopsByBlockId.get(currentBlockId)
    if (currentBlockLoop) {
      const loop = this.workflow.loops?.[currentBlockLoop]
      if (loop) {
        for (const nodeId of loop.nodes) {
          accessibleBlocks.add(nodeId)
        }
      }
    }

    // Special case: blocks in the same parallel can reference each other
    for (const [parallelId, parallel] of Object.entries(this.workflow.parallels || {})) {
      if (parallel.nodes.includes(currentBlockId)) {
        for (const nodeId of parallel.nodes) {
          accessibleBlocks.add(nodeId)
        }
      }
    }

    return accessibleBlocks
  }

  /**
   * Gets block names that the current block can reference for helpful error messages.
   * Uses shared utility when pre-calculated data is available.
   *
   * @param currentBlockId - ID of the block requesting references
   * @returns Array of accessible block names and aliases
   */
  private getAccessibleBlockNames(currentBlockId: string): string[] {
    // Use shared utility if pre-calculated data is available
    if (this.accessibleBlocksMap) {
      return BlockPathCalculator.getAccessibleBlockNames(
        currentBlockId,
        this.workflow,
        this.accessibleBlocksMap
      )
    }

    // Fallback to legacy calculation
    const accessibleBlockIds = this.getAccessibleBlocks(currentBlockId)
    const names: string[] = []

    for (const blockId of accessibleBlockIds) {
      const block = this.blockById.get(blockId)
      if (block) {
        // Add both the actual name and the normalized name
        if (block.metadata?.name) {
          names.push(block.metadata.name)
          names.push(this.normalizeBlockName(block.metadata.name))
        }
        names.push(blockId)
      }
    }

    // Add special aliases
    names.push('start') // Always allow start alias

    return [...new Set(names)] // Remove duplicates
  }

  /**
   * Checks if a block reference could potentially be valid without throwing errors.
   * Used to filter out non-block patterns like <test> from block reference resolution.
   *
   * @param blockRef - The block reference to check
   * @param currentBlockId - ID of the current block
   * @returns Whether this could be a valid block reference
   */
  private isAccessibleBlockReference(blockRef: string, currentBlockId: string): boolean {
    // Special cases that are always allowed
    const specialRefs = ['start', 'loop', 'parallel']
    if (specialRefs.includes(blockRef.toLowerCase())) {
      return true
    }

    // Get all accessible block names for this block
    const accessibleNames = this.getAccessibleBlockNames(currentBlockId)

    // Check if the reference matches any accessible block name
    return accessibleNames.includes(blockRef) || accessibleNames.includes(blockRef.toLowerCase())
  }

  /**
   * Validates if a block reference is accessible from the current block.
   * Checks existence and connection-based access rules.
   *
   * @param blockRef - Name or ID of the referenced block
   * @param currentBlockId - ID of the block making the reference
   * @param context - Current execution context
   * @returns Validation result with success status and resolved block ID or error message
   */
  private validateBlockReference(
    blockRef: string,
    currentBlockId: string,
    context: ExecutionContext
  ): { isValid: boolean; resolvedBlockId?: string; errorMessage?: string } {
    // Special case: 'start' is always allowed
    if (blockRef.toLowerCase() === 'start') {
      const starterBlock = this.workflow.blocks.find((block) => block.metadata?.id === 'starter')
      return starterBlock
        ? { isValid: true, resolvedBlockId: starterBlock.id }
        : { isValid: false, errorMessage: 'Starter block not found in workflow' }
    }

    // Check if block exists
    let sourceBlock = this.blockById.get(blockRef)
    if (!sourceBlock) {
      const normalizedRef = this.normalizeBlockName(blockRef)
      sourceBlock = this.blockByNormalizedName.get(normalizedRef)
    }

    if (!sourceBlock) {
      const accessibleNames = this.getAccessibleBlockNames(currentBlockId)
      return {
        isValid: false,
        errorMessage: `Block "${blockRef}" was not found. Available connected blocks: ${accessibleNames.join(', ')}`,
      }
    }

    // Check if block is accessible (connected)
    const accessibleBlocks = this.getAccessibleBlocks(currentBlockId)
    if (!accessibleBlocks.has(sourceBlock.id)) {
      const accessibleNames = this.getAccessibleBlockNames(currentBlockId)
      return {
        isValid: false,
        errorMessage: `Block "${blockRef}" is not connected to this block. Available connected blocks: ${accessibleNames.join(', ')}`,
      }
    }

    return { isValid: true, resolvedBlockId: sourceBlock.id }
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
              console.error('Error parsing JSON for loop:', jsonError)
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
          console.error('Error evaluating forEach items:', e)
        }
      }
    }

    // As a fallback, look for the most recent array or object in any block's output
    // This is less reliable but might help in some cases
    for (const [_blockId, blockState] of context.blockStates.entries()) {
      const output = blockState.output
      if (output) {
        for (const [_key, value] of Object.entries(output)) {
          if (Array.isArray(value) && value.length > 0) {
            return value
          }
          if (typeof value === 'object' && value !== null && Object.keys(value).length > 0) {
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
    isInTemplateLiteral = false
  ): string {
    // For function blocks, properly format values to avoid syntax errors
    if (block.metadata?.id === 'function') {
      // Special case for values in template literals (like `Hello ${<loop.currentItem>}`)
      if (isInTemplateLiteral) {
        if (typeof value === 'string') {
          return value // Don't quote strings in template literals
        }
        if (typeof value === 'object' && value !== null) {
          return JSON.stringify(value) // But do stringify objects
        }
        return String(value)
      }

      // Regular (non-template) contexts - ALL strings need to be quoted for JavaScript
      if (typeof value === 'string') {
        // Always quote strings for JavaScript code
        return JSON.stringify(value)
      }
      if (typeof value === 'object' && value !== null) {
        // Stringify objects and arrays
        return JSON.stringify(value)
      }
      if (value === undefined) {
        return 'undefined'
      }
      if (value === null) {
        return 'null'
      }
      // Numbers, booleans can be inserted as is
      return String(value)
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
      // Always return true for function blocks - they need properly formatted string literals
      if (block.metadata.id === 'function') {
        return true
      }

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
        /[=<>!+\-*/%](?:==?)?/, // Common operators
        /\+=|-=|\*=|\/=|%=|\*\*=?/, // Assignment operators

        // JavaScript keywords
        /\b(if|else|for|while|return|var|let|const|function)\b/,

        // Python keywords
        /\b(if|else|elif|for|while|def|return|import|from|as|class|with|try|except)\b/,

        // Common code patterns
        /^['"]use strict['"]?$/, // JS strict mode
        /\$\{.+?\}/, // JS template literals
        /f['"].*?['"]/, // Python f-strings
        /\bprint\s*\(/, // Python print
        /\bconsole\.\w+\(/, // JS console methods
      ]

      // Check if the expression (which might contain the variable placeholder) matches code patterns
      return codeIndicators.some((pattern) => pattern.test(expression))
    }

    return false
  }

  /**
   * Resolves a loop reference (<loop.property>).
   * Handles currentItem, items, and index references.
   *
   * @param loopId - ID of the loop
   * @param pathParts - Parts of the reference path after 'loop'
   * @param context - Current execution context
   * @param currentBlock - Block containing the reference
   * @param isInTemplateLiteral - Whether this is inside a template literal
   * @returns Formatted value or null if reference is invalid
   */
  private resolveLoopReference(
    loopId: string,
    pathParts: string[],
    context: ExecutionContext,
    currentBlock: SerializedBlock,
    isInTemplateLiteral: boolean
  ): string | null {
    const loop = context.workflow?.loops[loopId]
    if (!loop) return null

    const property = pathParts[0]

    switch (property) {
      case 'currentItem': {
        // Get the current item from context (set by loop handler)
        const currentItem = context.loopItems.get(loopId)
        if (currentItem === undefined) {
          // If no current item stored, we're probably not in an active iteration
          return ''
        }

        // Handle nested path access (e.g., <loop.currentItem.key>)
        if (pathParts.length > 1) {
          // Special handling for [key, value] pairs from Object.entries()
          if (
            Array.isArray(currentItem) &&
            currentItem.length === 2 &&
            typeof currentItem[0] === 'string'
          ) {
            const subProperty = pathParts[1]
            if (subProperty === 'key') {
              return this.formatValueForCodeContext(
                currentItem[0],
                currentBlock,
                isInTemplateLiteral
              )
            }
            if (subProperty === 'value') {
              return this.formatValueForCodeContext(
                currentItem[1],
                currentBlock,
                isInTemplateLiteral
              )
            }
          }

          // Navigate nested path for objects
          let value = currentItem
          for (let i = 1; i < pathParts.length; i++) {
            if (!value || typeof value !== 'object') {
              throw new Error(`Invalid path "${pathParts[i]}" in loop item reference`)
            }
            value = (value as any)[pathParts[i] as any]
            if (value === undefined) {
              throw new Error(`No value found at path "loop.${pathParts.join('.')}" in loop item`)
            }
          }
          return this.formatValueForCodeContext(value, currentBlock, isInTemplateLiteral)
        }

        // Return the whole current item
        return this.formatValueForCodeContext(currentItem, currentBlock, isInTemplateLiteral)
      }

      case 'items': {
        // Only valid for forEach loops
        if (loop.loopType !== 'forEach') {
          return null
        }

        // Get all items - prefer stored items from context
        const items = context.loopItems.get(`${loopId}_items`) || this.getLoopItems(loop, context)
        if (!items) {
          return '[]'
        }

        return this.formatValueForCodeContext(items, currentBlock, isInTemplateLiteral)
      }

      case 'index': {
        // Get the current iteration index
        const index = context.loopIterations.get(loopId) || 0
        // Adjust for the fact that the loop handler increments after setting up the iteration
        const adjustedIndex = Math.max(0, index - 1)
        return this.formatValueForCodeContext(adjustedIndex, currentBlock, isInTemplateLiteral)
      }

      default:
        return null
    }
  }

  /**
   * Resolves a parallel reference (<parallel.property>).
   * Handles currentItem, items, and index references for parallel executions.
   *
   * @param parallelId - ID of the parallel block
   * @param pathParts - Parts of the reference path after 'parallel'
   * @param context - Current execution context
   * @param currentBlock - Block containing the reference
   * @param isInTemplateLiteral - Whether this is inside a template literal
   * @returns Formatted value or null if reference is invalid
   */
  private resolveParallelReference(
    parallelId: string,
    pathParts: string[],
    context: ExecutionContext,
    currentBlock: SerializedBlock,
    isInTemplateLiteral: boolean
  ): string | null {
    const parallel = context.workflow?.parallels?.[parallelId]
    if (!parallel) return null

    const property = pathParts[0]

    // For parallel blocks, we need to determine which parallel iteration this block is part of
    // This is more complex than loops since multiple instances run concurrently

    switch (property) {
      case 'currentItem': {
        // Try to find the current item for this parallel execution
        let currentItem = context.loopItems.get(parallelId)

        // If we have a current virtual block ID, use it to get the exact iteration
        if (context.currentVirtualBlockId && context.parallelBlockMapping) {
          const mapping = context.parallelBlockMapping.get(context.currentVirtualBlockId)
          if (mapping && mapping.parallelId === parallelId) {
            const iterationKey = `${parallelId}_iteration_${mapping.iterationIndex}`
            const iterationItem = context.loopItems.get(iterationKey)
            if (iterationItem !== undefined) {
              currentItem = iterationItem
            }
          }
        } else if (parallel.nodes.includes(currentBlock.id)) {
          // Fallback: if we're inside a parallel execution but don't have currentVirtualBlockId
          // This shouldn't happen in normal execution but provides backward compatibility
          for (const [virtualId, mapping] of context.parallelBlockMapping || new Map()) {
            if (mapping.originalBlockId === currentBlock.id && mapping.parallelId === parallelId) {
              const iterationKey = `${parallelId}_iteration_${mapping.iterationIndex}`
              const iterationItem = context.loopItems.get(iterationKey)
              if (iterationItem !== undefined) {
                currentItem = iterationItem
                break
              }
            }
          }
        }

        // If not found directly, try to find it with parallel iteration suffix (backward compatibility)
        if (currentItem === undefined) {
          // Check for parallel-specific keys like "parallelId_parallel_0", "parallelId_parallel_1", etc.
          for (let i = 0; i < 100; i++) {
            // Reasonable upper limit
            const parallelKey = `${parallelId}_parallel_${i}`
            if (context.loopItems.has(parallelKey)) {
              currentItem = context.loopItems.get(parallelKey)
              break
            }
          }
        }

        if (currentItem === undefined) {
          return ''
        }

        // Handle nested path access (e.g., <parallel.currentItem.key>)
        if (pathParts.length > 1) {
          // Special handling for [key, value] pairs from Object.entries()
          if (
            Array.isArray(currentItem) &&
            currentItem.length === 2 &&
            typeof currentItem[0] === 'string'
          ) {
            const subProperty = pathParts[1]
            if (subProperty === 'key') {
              return this.formatValueForCodeContext(
                currentItem[0],
                currentBlock,
                isInTemplateLiteral
              )
            }
            if (subProperty === 'value') {
              return this.formatValueForCodeContext(
                currentItem[1],
                currentBlock,
                isInTemplateLiteral
              )
            }
          }

          // Navigate nested path for objects
          let value = currentItem
          for (let i = 1; i < pathParts.length; i++) {
            if (!value || typeof value !== 'object') {
              throw new Error(`Invalid path "${pathParts[i]}" in parallel item reference`)
            }
            value = (value as any)[pathParts[i] as any]
            if (value === undefined) {
              throw new Error(
                `No value found at path "parallel.${pathParts.join('.')}" in parallel item`
              )
            }
          }
          return this.formatValueForCodeContext(value, currentBlock, isInTemplateLiteral)
        }

        // Return the whole current item
        return this.formatValueForCodeContext(currentItem, currentBlock, isInTemplateLiteral)
      }

      case 'items': {
        // Get all items for the parallel distribution
        const items =
          context.loopItems.get(`${parallelId}_items`) ||
          (parallel.distribution && this.getParallelItems(parallel, context))
        if (!items) {
          return '[]'
        }

        return this.formatValueForCodeContext(items, currentBlock, isInTemplateLiteral)
      }

      case 'index': {
        // Get the current parallel index
        let index = context.loopIterations.get(parallelId)

        // If we have a current virtual block ID, use it to get the exact iteration
        if (context.currentVirtualBlockId && context.parallelBlockMapping) {
          const mapping = context.parallelBlockMapping.get(context.currentVirtualBlockId)
          if (mapping && mapping.parallelId === parallelId) {
            index = mapping.iterationIndex
          }
        } else {
          // Fallback: try to find it with parallel iteration suffix
          if (index === undefined) {
            for (let i = 0; i < 100; i++) {
              const parallelKey = `${parallelId}_parallel_${i}`
              if (context.loopIterations.has(parallelKey)) {
                index = context.loopIterations.get(parallelKey)
                break
              }
            }
          }
        }

        const adjustedIndex = index !== undefined ? index : 0
        return this.formatValueForCodeContext(adjustedIndex, currentBlock, isInTemplateLiteral)
      }

      default:
        return null
    }
  }

  /**
   * Gets the items for a parallel distribution.
   * Similar to getLoopItems but for parallel blocks.
   *
   * @param parallel - The parallel configuration
   * @param context - Current execution context
   * @returns The items to distribute (array or object)
   */
  private getParallelItems(
    parallel: any,
    context: ExecutionContext
  ): any[] | Record<string, any> | null {
    if (!parallel || !parallel.distribution) return null

    // If items are already available as an array or object, return them directly
    if (
      Array.isArray(parallel.distribution) ||
      (typeof parallel.distribution === 'object' && parallel.distribution !== null)
    ) {
      return parallel.distribution
    }

    // If it's a string, try to evaluate it (could be an expression or JSON)
    if (typeof parallel.distribution === 'string') {
      try {
        // Check if it's valid JSON
        const trimmedExpression = parallel.distribution.trim()
        if (trimmedExpression.startsWith('[') || trimmedExpression.startsWith('{')) {
          try {
            return JSON.parse(trimmedExpression)
          } catch {
            // Continue with expression evaluation
          }
        }

        // Try to evaluate as an expression
        if (trimmedExpression && !trimmedExpression.startsWith('//')) {
          const result = new Function('context', `return ${parallel.distribution}`)(context)
          if (Array.isArray(result) || (typeof result === 'object' && result !== null)) {
            return result
          }
        }
      } catch (e) {
        console.error('Error evaluating parallel distribution items:', e)
      }
    }

    return []
  }

  /**
   * Processes a string value that may contain interpolations and references.
   * Handles the full resolution pipeline: variables -> blocks -> environment.
   *
   * @param value - String value to process
   * @param key - The parameter key (for special handling)
   * @param context - Current execution context
   * @param block - Block containing the value
   * @returns Processed value (may be parsed JSON or string)
   */
  private processStringValue(
    value: string,
    key: string,
    context: ExecutionContext,
    block: SerializedBlock
  ): any {
    // First resolve variable references (interpolation)
    const resolvedVars = this.resolveVariableReferences(value, block)

    // Then resolve block references
    const resolvedReferences = this.resolveBlockReferences(resolvedVars, context, block)

    // Check if this is an API key field
    const isApiKey = this.isApiKeyField(block, value)

    // Then resolve environment variables
    const resolvedEnv = this.resolveEnvVariables(resolvedReferences, isApiKey)

    // Special handling for different block types
    const blockType = block.metadata?.id

    // For function blocks, code input doesn't need JSON parsing
    if (blockType === 'function' && key === 'code') {
      return resolvedEnv
    }

    // For API blocks, handle body input specially
    if (blockType === 'api' && key === 'body') {
      return this.tryParseJSON(resolvedEnv)
    }

    // For other inputs, try to convert JSON strings to objects/arrays
    return this.tryParseJSON(resolvedEnv)
  }

  /**
   * Processes object/array values recursively.
   * Handles special cases like table-like arrays with cells.
   *
   * @param value - Object or array to process
   * @param key - The parameter key
   * @param context - Current execution context
   * @param block - Block containing the value
   * @returns Processed object/array
   */
  private processObjectValue(
    value: any,
    key: string,
    context: ExecutionContext,
    block: SerializedBlock
  ): any {
    // Special handling for table-like arrays (e.g., from API params/headers)
    if (
      Array.isArray(value) &&
      value.every((item) => typeof item === 'object' && item !== null && 'cells' in item)
    ) {
      // Resolve each cell's value within the array
      return value.map((row) => ({
        ...row,
        cells: Object.entries(row.cells).reduce(
          (acc, [cellKey, cellValue]) => {
            if (typeof cellValue === 'string') {
              const trimmedValue = cellValue.trim()
              // Check for direct variable reference
              const directVariableMatch = trimmedValue.match(/^<variable\.([^>]+)>$/)

              if (directVariableMatch) {
                const variableName = directVariableMatch[1]
                const variable = this.findVariableByName(variableName)

                if (variable) {
                  acc[cellKey] = this.getTypedVariableValue(variable)
                } else {
                  logger.warn(
                    `Variable reference <variable.${variableName}> not found in table cell`
                  )
                  acc[cellKey] = cellValue
                }
              } else {
                // Process interpolated variables, block references, and environment variables
                acc[cellKey] = this.resolveNestedStructure(cellValue, context, block)
              }
            } else {
              // Handle non-string values
              acc[cellKey] = this.resolveNestedStructure(cellValue, context, block)
            }
            return acc
          },
          {} as Record<string, any>
        ),
      }))
    }

    // Use general recursive resolution for other objects/arrays
    return this.resolveNestedStructure(value, context, block)
  }

  /**
   * Tries to parse a string as JSON if it looks like JSON.
   * Returns the original string if parsing fails or it doesn't look like JSON.
   *
   * @param value - Value to potentially parse
   * @returns Parsed JSON or original value
   */
  private tryParseJSON(value: any): any {
    if (typeof value !== 'string') {
      return value
    }

    const trimmed = value.trim()
    if (trimmed.length > 0 && (trimmed.startsWith('{') || trimmed.startsWith('['))) {
      try {
        return JSON.parse(trimmed)
      } catch {
        // Not valid JSON, return as string
      }
    }

    return value
  }
}
