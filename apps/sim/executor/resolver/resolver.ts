import { createLogger } from '@/lib/logs/console/logger'
import { VariableManager } from '@/lib/variables/variable-manager'
import { extractReferencePrefixes, SYSTEM_REFERENCE_PREFIXES } from '@/lib/workflows/references'
import { TRIGGER_REFERENCE_ALIAS_MAP } from '@/lib/workflows/triggers'
import { getBlock } from '@/blocks/index'
import type { LoopManager } from '@/executor/loops/loops'
import type { ExecutionContext } from '@/executor/types'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'
import { normalizeBlockName } from '@/stores/workflows/utils'

const logger = createLogger('InputResolver')

function resolvePropertyAccess(obj: any, property: string): any {
  return obj[property]
}

export class InputResolver {
  private blockById: Map<string, SerializedBlock>
  private blockByNormalizedName: Map<string, SerializedBlock>
  private loopsByBlockId: Map<string, string> // Maps block ID to containing loop ID
  private parallelsByBlockId: Map<string, string> // Maps block ID to containing parallel ID

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

    // Create efficient parallel lookup map
    this.parallelsByBlockId = new Map()
    for (const [parallelId, parallel] of Object.entries(workflow.parallels || {})) {
      for (const blockId of parallel.nodes) {
        this.parallelsByBlockId.set(blockId, parallelId)
      }
    }
  }

  /**
   * Evaluates if a sub-block should be active based on its condition
   * @param condition - The condition to evaluate (can be static object or function)
   * @param currentValues - Current values of all inputs
   * @returns True if the sub-block should be active
   */
  private evaluateSubBlockCondition(
    condition:
      | {
          field: string
          value: any
          not?: boolean
          and?: { field: string; value: any; not?: boolean }
        }
      | (() => {
          field: string
          value: any
          not?: boolean
          and?: { field: string; value: any; not?: boolean }
        })
      | undefined,
    currentValues: Record<string, any>
  ): boolean {
    if (!condition) return true

    // If condition is a function, call it to get the actual condition object
    const actualCondition = typeof condition === 'function' ? condition() : condition

    // Get the field value
    const fieldValue = currentValues[actualCondition.field]

    // Check if the condition value is an array
    const isValueMatch = Array.isArray(actualCondition.value)
      ? fieldValue != null &&
        (actualCondition.not
          ? !actualCondition.value.includes(fieldValue)
          : actualCondition.value.includes(fieldValue))
      : actualCondition.not
        ? fieldValue !== actualCondition.value
        : fieldValue === actualCondition.value

    // Check both conditions if 'and' is present
    const isAndValueMatch =
      !actualCondition.and ||
      (() => {
        const andFieldValue = currentValues[actualCondition.and!.field]
        return Array.isArray(actualCondition.and!.value)
          ? andFieldValue != null &&
              (actualCondition.and!.not
                ? !actualCondition.and!.value.includes(andFieldValue)
                : actualCondition.and!.value.includes(andFieldValue))
          : actualCondition.and!.not
            ? andFieldValue !== actualCondition.and!.value
            : andFieldValue === actualCondition.and!.value
      })()

    return isValueMatch && isAndValueMatch
  }

  /**
   * Filters inputs based on sub-block conditions
   * @param block - Block to filter inputs for
   * @param inputs - All input parameters
   * @returns Filtered input parameters that should be processed
   */
  private filterInputsByConditions(
    block: SerializedBlock,
    inputs: Record<string, any>
  ): Record<string, any> {
    const blockType = block.metadata?.id
    if (!blockType) return inputs

    const blockConfig = getBlock(blockType)
    if (!blockConfig || !blockConfig.subBlocks) return inputs

    // Filter inputs based on conditions
    const filteredInputs: Record<string, any> = {}
    for (const [key, value] of Object.entries(inputs)) {
      // Check if this input should be included based on subBlock conditions
      let shouldInclude = false

      // Find all subBlocks with this ID
      const matchingSubBlocks = blockConfig.subBlocks.filter((sb) => sb.id === key)

      if (matchingSubBlocks.length === 0) {
        // No subBlock config found for this input - include it
        shouldInclude = true
      } else {
        // Check if any of the matching subBlocks should be active
        for (const subBlock of matchingSubBlocks) {
          if (!subBlock.condition || this.evaluateSubBlockCondition(subBlock.condition, inputs)) {
            shouldInclude = true
            break
          }
        }
      }

      if (shouldInclude) {
        filteredInputs[key] = value
      }
    }

    return filteredInputs
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
    const allInputs = { ...block.config.params }
    // Filter inputs based on sub-block conditions to only process active fields
    const inputs = this.filterInputsByConditions(block, allInputs)
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
        result[key] = this.processObjectValue(value, context, block)
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

    const blockMatches = extractReferencePrefixes(value)
    if (blockMatches.length === 0) return value

    const accessiblePrefixes = this.getAccessiblePrefixes(currentBlock)

    let resolvedValue = value

    for (const match of blockMatches) {
      const { raw, prefix } = match
      if (!accessiblePrefixes.has(prefix)) {
        continue
      }

      if (raw.startsWith('<variable.')) {
        continue
      }

      const path = raw.slice(1, -1)
      const [blockRefToken, ...pathParts] = path.split('.')
      const blockRef = blockRefToken.trim()

      // Skip XML-like tags (but allow block names with spaces)
      if (blockRef.includes(':')) {
        continue
      }

      // Check if we're in a template literal context
      const isInTemplateLiteral =
        currentBlock.metadata?.id === 'function' &&
        value.includes('${') &&
        value.includes('}') &&
        value.includes('`')

      // System references (start, loop, parallel, variable) and regular block references are both processed
      // Accessibility validation happens later in validateBlockReference

      // Special case for trigger block references (start, api, chat, manual)
      const blockRefLower = blockRef.toLowerCase()
      const triggerType =
        TRIGGER_REFERENCE_ALIAS_MAP[blockRefLower as keyof typeof TRIGGER_REFERENCE_ALIAS_MAP]
      if (triggerType) {
        const triggerBlock = this.workflow.blocks.find(
          (block) => block.metadata?.id === triggerType
        )
        if (triggerBlock) {
          const blockState = context.blockStates.get(triggerBlock.id)
          if (blockState) {
            // For trigger blocks, start directly with the flattened output
            // This enables direct access to <start.input>, <api.fieldName>, <chat.input> etc
            let replacementValue: any = blockState.output

            for (const part of pathParts) {
              if (!replacementValue || typeof replacementValue !== 'object') {
                logger.warn(
                  `[resolveBlockReferences] Invalid path "${part}" - replacementValue is not an object:`,
                  replacementValue
                )
                throw new Error(`Invalid path "${part}" in "${path}" for trigger block.`)
              }

              // Handle array indexing syntax like "files[0]" or "items[1]"
              const arrayMatch = part.match(/^([^[]+)\[(\d+)\]$/)
              if (arrayMatch) {
                const [, arrayName, indexStr] = arrayMatch
                const index = Number.parseInt(indexStr, 10)

                // First access the array property
                const arrayValue = replacementValue[arrayName]
                if (!Array.isArray(arrayValue)) {
                  throw new Error(
                    `Property "${arrayName}" is not an array in path "${path}" for trigger block.`
                  )
                }

                // Then access the array element
                if (index < 0 || index >= arrayValue.length) {
                  throw new Error(
                    `Array index ${index} is out of bounds for "${arrayName}" (length: ${arrayValue.length}) in path "${path}" for trigger block.`
                  )
                }

                replacementValue = arrayValue[index]
              } else if (/^(?:[^[]+(?:\[\d+\])+|(?:\[\d+\])+)$/.test(part)) {
                // Enhanced: support multiple indices like "values[0][0]"
                replacementValue = this.resolvePartWithIndices(
                  replacementValue,
                  part,
                  path,
                  'starter block'
                )
              } else {
                // Regular property access with FileReference mapping
                replacementValue = resolvePropertyAccess(replacementValue, part)
              }

              if (replacementValue === undefined) {
                logger.warn(
                  `[resolveBlockReferences] No value found at path "${part}" in trigger block.`
                )
                throw new Error(`No value found at path "${path}" in trigger block.`)
              }
            }

            // Format the value based on block type and path
            let formattedValue: string

            // Special handling for all blocks referencing trigger input
            // For starter and chat triggers, check for 'input' field. For API trigger, any field access counts
            const isTriggerInputRef =
              (blockRefLower === 'start' && pathParts.join('.').includes('input')) ||
              (blockRefLower === 'chat' && pathParts.join('.').includes('input')) ||
              (blockRefLower === 'api' && pathParts.length > 0)
            if (isTriggerInputRef) {
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
                // For response blocks, preserve object structure as-is for proper JSON response
                else if (blockType === 'response') {
                  formattedValue = replacementValue
                }
                // For all other blocks, stringify objects
                else {
                  // Preserve full JSON structure for objects
                  formattedValue = JSON.stringify(replacementValue)
                }
              } else {
                // For primitive values, format based on target block type
                if (blockType === 'function') {
                  formattedValue = this.formatValueForCodeContext(
                    replacementValue,
                    currentBlock,
                    isInTemplateLiteral
                  )
                } else if (blockType === 'condition') {
                  formattedValue = this.stringifyForCondition(replacementValue)
                } else {
                  formattedValue = String(replacementValue)
                }
              }
            } else {
              // Standard handling for non-input references
              const blockType = currentBlock.metadata?.id

              if (blockType === 'response') {
                // For response blocks, properly quote string values for JSON context
                if (typeof replacementValue === 'string') {
                  // Properly escape and quote the string for JSON
                  formattedValue = JSON.stringify(replacementValue)
                } else {
                  formattedValue = replacementValue
                }
              } else {
                formattedValue =
                  typeof replacementValue === 'object'
                    ? JSON.stringify(replacementValue)
                    : String(replacementValue)
              }
            }

            resolvedValue = resolvedValue.replace(raw, formattedValue)
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
            resolvedValue = resolvedValue.replace(raw, formattedValue)
            continue
          }
        }
      }

      // Special case for "parallel" references - allows accessing parallel properties
      if (blockRef.toLowerCase() === 'parallel') {
        // Find which parallel this block belongs to using efficient lookup
        const containingParallelId = this.parallelsByBlockId.get(currentBlock.id)

        if (containingParallelId) {
          const formattedValue = this.resolveParallelReference(
            containingParallelId,
            pathParts,
            context,
            currentBlock,
            isInTemplateLiteral
          )

          if (formattedValue !== null) {
            resolvedValue = resolvedValue.replace(raw, formattedValue)
            continue
          }
        }
      }

      // Standard block reference resolution with connection validation
      const validation = this.validateBlockReference(blockRef, currentBlock.id)

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
        resolvedValue = resolvedValue.replace(raw, '')
        continue
      }

      // For parallel execution, check if we need to use the virtual block ID
      let blockState = context.blockStates.get(sourceBlock.id)

      // If we're in parallel execution and the source block is also in the same parallel,
      // try to get the virtual block state for the same iteration
      if (
        context.currentVirtualBlockId &&
        context.parallelBlockMapping?.has(context.currentVirtualBlockId)
      ) {
        const currentParallelInfo = context.parallelBlockMapping.get(context.currentVirtualBlockId)
        if (currentParallelInfo) {
          // Check if the source block is in the same parallel
          const parallel = context.workflow?.parallels?.[currentParallelInfo.parallelId]
          if (parallel?.nodes.includes(sourceBlock.id)) {
            // Try to get the virtual block state for the same iteration
            const virtualSourceBlockId = `${sourceBlock.id}_parallel_${currentParallelInfo.parallelId}_iteration_${currentParallelInfo.iterationIndex}`
            blockState = context.blockStates.get(virtualSourceBlockId)
          }
        }
      }

      if (!blockState) {
        // If the block is in a loop, return empty string
        const isInLoop = this.loopsByBlockId.has(sourceBlock.id)

        if (isInLoop) {
          resolvedValue = resolvedValue.replace(raw, '')
          continue
        }

        // If the block hasn't been executed and isn't in the active path,
        // it means it's in an inactive branch - return empty string
        if (!context.activeExecutionPath.has(sourceBlock.id)) {
          resolvedValue = resolvedValue.replace(raw, '')
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

        // Handle array indexing syntax like "files[0]" or "items[1]"
        const arrayMatch = part.match(/^([^[]+)\[(\d+)\]$/)
        if (arrayMatch) {
          const [, arrayName, indexStr] = arrayMatch
          const index = Number.parseInt(indexStr, 10)

          // First access the array property
          const arrayValue = replacementValue[arrayName]
          if (!Array.isArray(arrayValue)) {
            throw new Error(
              `Property "${arrayName}" is not an array in path "${path}" for block "${sourceBlock.metadata?.name || sourceBlock.id}".`
            )
          }

          // Then access the array element
          if (index < 0 || index >= arrayValue.length) {
            throw new Error(
              `Array index ${index} is out of bounds for "${arrayName}" (length: ${arrayValue.length}) in path "${path}" for block "${sourceBlock.metadata?.name || sourceBlock.id}".`
            )
          }

          replacementValue = arrayValue[index]
        } else if (/^(?:[^[]+(?:\[\d+\])+|(?:\[\d+\])+)$/.test(part)) {
          // Enhanced: support multiple indices like "values[0][0]"
          replacementValue = this.resolvePartWithIndices(
            replacementValue,
            part,
            path,
            sourceBlock.metadata?.name || sourceBlock.id
          )
        } else {
          // Regular property access with FileReference mapping
          replacementValue = resolvePropertyAccess(replacementValue, part)
        }

        if (replacementValue === undefined) {
          throw new Error(
            `No value found at path "${path}" in block "${sourceBlock.metadata?.name || sourceBlock.id}".`
          )
        }
      }

      const blockType = currentBlock.metadata?.id

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

        // For response blocks, properly quote string values for JSON context
        if (currentBlock.metadata?.id === 'response') {
          if (typeof replacementValue === 'string') {
            // Properly escape and quote the string for JSON
            formattedValue = JSON.stringify(replacementValue)
          } else {
            formattedValue = replacementValue
          }
        } else {
          // For code blocks, use our formatter
          formattedValue = this.formatValueForCodeContext(
            replacementValue,
            currentBlock,
            isInTemplateLiteral
          )
        }
      } else {
        // The function execution API will handle variable resolution within code strings
        formattedValue =
          typeof replacementValue === 'object'
            ? JSON.stringify(replacementValue)
            : String(replacementValue)
      }

      resolvedValue = resolvedValue.replace(raw, formattedValue)
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
        (acc, [k, v]) => ({
          ...acc,
          [k]: this.resolveEnvVariables(v),
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

      // Then resolve environment variables
      return this.resolveEnvVariables(resolvedReferences)
    }

    // Handle arrays
    if (Array.isArray(value)) {
      return value.map((item) => this.resolveNestedStructure(item, context, currentBlock))
    }

    // Handle objects
    if (typeof value === 'object') {
      const result: Record<string, any> = {}
      for (const [k, v] of Object.entries(value)) {
        result[k] = this.resolveNestedStructure(v, context, currentBlock)
      }
      return result
    }

    // Return primitives as is
    return value
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
      const sanitized = value
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
      return `"${sanitized}"`
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
   * Applies a path part that may include multiple array indices, e.g. "values[0][0]".
   */
  private resolvePartWithIndices(
    base: any,
    part: string,
    fullPath: string,
    sourceName: string
  ): any {
    let value = base

    // Extract leading property name if present
    const propMatch = part.match(/^([^[]+)/)
    let rest = part
    if (propMatch) {
      const prop = propMatch[1]
      value = resolvePropertyAccess(value, prop)
      rest = part.slice(prop.length)
      if (value === undefined) {
        throw new Error(`No value found at path "${fullPath}" in block "${sourceName}".`)
      }
    }

    // Iteratively apply each [index]
    const indexRe = /^\[(\d+)\]/
    while (rest.length > 0) {
      const m = rest.match(indexRe)
      if (!m) {
        throw new Error(`Invalid path "${part}" in "${fullPath}" for block "${sourceName}".`)
      }
      const idx = Number.parseInt(m[1], 10)
      if (!Array.isArray(value)) {
        throw new Error(`Invalid path "${part}" in "${fullPath}" for block "${sourceName}".`)
      }
      if (idx < 0 || idx >= value.length) {
        throw new Error(
          `Array index ${idx} is out of bounds in path "${fullPath}" for block "${sourceName}".`
        )
      }
      value = value[idx]
      rest = rest.slice(m[0].length)
    }

    return value
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
    const currentBlockParallel = this.parallelsByBlockId.get(currentBlockId)
    if (currentBlockParallel) {
      const parallel = this.workflow.parallels?.[currentBlockParallel]
      if (parallel) {
        for (const nodeId of parallel.nodes) {
          accessibleBlocks.add(nodeId)
        }
      }
    }

    return accessibleBlocks
  }

  /**
   * Gets user-friendly block names for error messages.
   * Only returns the actual block names that users see in the UI.
   */
  private getAccessibleBlockNamesForError(currentBlockId: string): string[] {
    const accessibleBlockIds = this.getAccessibleBlocks(currentBlockId)
    const names: string[] = []

    for (const blockId of accessibleBlockIds) {
      const block = this.blockById.get(blockId)
      if (block?.metadata?.name) {
        names.push(block.metadata.name)
      }
    }

    return [...new Set(names)] // Remove duplicates
  }

  /**
   * Validates if a block reference is accessible from the current block.
   * Checks existence and connection-based access rules.
   *
   * @param blockRef - Name or ID of the referenced block
   * @param currentBlockId - ID of the block making the reference
   * @returns Validation result with success status and resolved block ID or error message
   */
  private validateBlockReference(
    blockRef: string,
    currentBlockId: string
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

      if (!sourceBlock) {
        for (const candidate of this.workflow.blocks) {
          const candidateName = candidate.metadata?.name
          if (!candidateName) continue
          const normalizedName = this.normalizeBlockName(candidateName)
          if (normalizedName === normalizedRef) {
            sourceBlock = candidate
            break
          }
        }
      }
    }

    if (!sourceBlock) {
      const accessibleNames = this.getAccessibleBlockNamesForError(currentBlockId)
      return {
        isValid: false,
        errorMessage: `Block "${blockRef}" was not found. Available connected blocks: ${accessibleNames.join(', ')}`,
      }
    }

    // Check if block is accessible (connected)
    const accessibleBlocks = this.getAccessibleBlocks(currentBlockId)
    if (!accessibleBlocks.has(sourceBlock.id)) {
      const accessibleNames = this.getAccessibleBlockNamesForError(currentBlockId)
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
              logger.error('Error parsing JSON for loop:', jsonError)
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
          logger.error('Error evaluating forEach items:', e)
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
          for (const [_, mapping] of context.parallelBlockMapping || new Map()) {
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
        logger.error('Error evaluating parallel distribution items:', e)
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

    // Then resolve environment variables
    const resolvedEnv = this.resolveEnvVariables(resolvedReferences)

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
   * @param context - Current execution context
   * @param block - Block containing the value
   * @returns Processed object/array
   */
  private processObjectValue(value: any, context: ExecutionContext, block: SerializedBlock): any {
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

  /**
   * Get the containing loop ID for a block
   * @param blockId - The ID of the block
   * @returns The containing loop ID or undefined if not in a loop
   */
  getContainingLoopId(blockId: string): string | undefined {
    return this.loopsByBlockId.get(blockId)
  }

  /**
   * Get the containing parallel ID for a block
   * @param blockId - The ID of the block
   * @returns The containing parallel ID or undefined if not in a parallel
   */
  getContainingParallelId(blockId: string): string | undefined {
    return this.parallelsByBlockId.get(blockId)
  }

  private getAccessiblePrefixes(block: SerializedBlock): Set<string> {
    const prefixes = new Set<string>()

    const accessibleBlocks = this.getAccessibleBlocks(block.id)
    accessibleBlocks.forEach((blockId) => {
      prefixes.add(normalizeBlockName(blockId))
      const sourceBlock = this.blockById.get(blockId)
      if (sourceBlock?.metadata?.name) {
        prefixes.add(normalizeBlockName(sourceBlock.metadata.name))
      }
    })

    SYSTEM_REFERENCE_PREFIXES.forEach((prefix) => prefixes.add(prefix))

    return prefixes
  }
}
