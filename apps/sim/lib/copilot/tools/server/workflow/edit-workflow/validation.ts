import { createLogger } from '@sim/logger'
import { validateSelectorIds } from '@/lib/copilot/validation/selector-validator'
import type { PermissionGroupConfig } from '@/lib/permission-groups/types'
import { getBlock } from '@/blocks/registry'
import type { SubBlockConfig } from '@/blocks/types'
import { EDGE, normalizeName } from '@/executor/constants'
import { TRIGGER_RUNTIME_SUBBLOCK_IDS } from '@/triggers/constants'
import type {
  EdgeHandleValidationResult,
  EditWorkflowOperation,
  ValidationError,
  ValidationResult,
  ValueValidationResult,
} from './types'
import { SELECTOR_TYPES } from './types'

const validationLogger = createLogger('EditWorkflowValidation')

/**
 * Finds an existing block with the same normalized name.
 */
export function findBlockWithDuplicateNormalizedName(
  blocks: Record<string, any>,
  name: string,
  excludeBlockId: string
): [string, any] | undefined {
  const normalizedName = normalizeName(name)
  return Object.entries(blocks).find(
    ([blockId, block]: [string, any]) =>
      blockId !== excludeBlockId && normalizeName(block.name || '') === normalizedName
  )
}

/**
 * Validates and filters inputs against a block's subBlock configuration
 * Returns valid inputs and any validation errors encountered
 */
export function validateInputsForBlock(
  blockType: string,
  inputs: Record<string, any>,
  blockId: string
): ValidationResult {
  const errors: ValidationError[] = []
  const blockConfig = getBlock(blockType)

  if (!blockConfig) {
    // Unknown block type - return inputs as-is (let it fail later if invalid)
    validationLogger.warn(`Unknown block type: ${blockType}, skipping validation`)
    return { validInputs: inputs, errors: [] }
  }

  const validatedInputs: Record<string, any> = {}
  const subBlockMap = new Map<string, SubBlockConfig>()

  // Build map of subBlock id -> config
  for (const subBlock of blockConfig.subBlocks) {
    subBlockMap.set(subBlock.id, subBlock)
  }

  for (const [key, value] of Object.entries(inputs)) {
    // Skip runtime subblock IDs
    if (TRIGGER_RUNTIME_SUBBLOCK_IDS.includes(key)) {
      continue
    }

    const subBlockConfig = subBlockMap.get(key)

    // If subBlock doesn't exist in config, skip it (unless it's a known dynamic field)
    if (!subBlockConfig) {
      // Some fields are valid but not in subBlocks (like loop/parallel config)
      // Allow these through for special block types
      if (blockType === 'loop' || blockType === 'parallel') {
        validatedInputs[key] = value
      } else {
        errors.push({
          blockId,
          blockType,
          field: key,
          value,
          error: `Unknown input field "${key}" for block type "${blockType}"`,
        })
      }
      continue
    }

    // Note: We do NOT check subBlockConfig.condition here.
    // Conditions are for UI display logic (show/hide fields in the editor).
    // For API/Copilot, any valid field in the block schema should be accepted.
    // The runtime will use the relevant fields based on the actual operation.

    // Validate value based on subBlock type
    const validationResult = validateValueForSubBlockType(
      subBlockConfig,
      value,
      key,
      blockType,
      blockId
    )
    if (validationResult.valid) {
      validatedInputs[key] = validationResult.value
    } else if (validationResult.error) {
      errors.push(validationResult.error)
    }
  }

  return { validInputs: validatedInputs, errors }
}

/**
 * Validates a value against its expected subBlock type
 * Returns validation result with the value or an error
 */
export function validateValueForSubBlockType(
  subBlockConfig: SubBlockConfig,
  value: any,
  fieldName: string,
  blockType: string,
  blockId: string
): ValueValidationResult {
  const { type } = subBlockConfig

  // Handle null/undefined - allow clearing fields
  if (value === null || value === undefined) {
    return { valid: true, value }
  }

  switch (type) {
    case 'dropdown': {
      // Validate against allowed options
      const options =
        typeof subBlockConfig.options === 'function'
          ? subBlockConfig.options()
          : subBlockConfig.options
      if (options && Array.isArray(options)) {
        const validIds = options.map((opt) => opt.id)
        if (!validIds.includes(value)) {
          return {
            valid: false,
            error: {
              blockId,
              blockType,
              field: fieldName,
              value,
              error: `Invalid dropdown value "${value}" for field "${fieldName}". Valid options: ${validIds.join(', ')}`,
            },
          }
        }
      }
      return { valid: true, value }
    }

    case 'slider': {
      // Validate numeric range
      const numValue = typeof value === 'number' ? value : Number(value)
      if (Number.isNaN(numValue)) {
        return {
          valid: false,
          error: {
            blockId,
            blockType,
            field: fieldName,
            value,
            error: `Invalid slider value "${value}" for field "${fieldName}" - must be a number`,
          },
        }
      }
      // Clamp to range (allow but warn)
      let clampedValue = numValue
      if (subBlockConfig.min !== undefined && numValue < subBlockConfig.min) {
        clampedValue = subBlockConfig.min
      }
      if (subBlockConfig.max !== undefined && numValue > subBlockConfig.max) {
        clampedValue = subBlockConfig.max
      }
      return {
        valid: true,
        value: subBlockConfig.integer ? Math.round(clampedValue) : clampedValue,
      }
    }

    case 'switch': {
      // Must be boolean
      if (typeof value !== 'boolean') {
        return {
          valid: false,
          error: {
            blockId,
            blockType,
            field: fieldName,
            value,
            error: `Invalid switch value "${value}" for field "${fieldName}" - must be true or false`,
          },
        }
      }
      return { valid: true, value }
    }

    case 'file-upload': {
      // File upload should be an object with specific properties or null
      if (value === null) return { valid: true, value: null }
      if (typeof value !== 'object') {
        return {
          valid: false,
          error: {
            blockId,
            blockType,
            field: fieldName,
            value,
            error: `Invalid file-upload value for field "${fieldName}" - expected object with name and path properties, or null`,
          },
        }
      }
      // Validate file object has required properties
      if (value && (!value.name || !value.path)) {
        return {
          valid: false,
          error: {
            blockId,
            blockType,
            field: fieldName,
            value,
            error: `Invalid file-upload object for field "${fieldName}" - must have "name" and "path" properties`,
          },
        }
      }
      return { valid: true, value }
    }

    case 'input-format':
    case 'table': {
      // Should be an array
      if (!Array.isArray(value)) {
        return {
          valid: false,
          error: {
            blockId,
            blockType,
            field: fieldName,
            value,
            error: `Invalid ${type} value for field "${fieldName}" - expected an array`,
          },
        }
      }
      return { valid: true, value }
    }

    case 'tool-input': {
      // Should be an array of tool objects
      if (!Array.isArray(value)) {
        return {
          valid: false,
          error: {
            blockId,
            blockType,
            field: fieldName,
            value,
            error: `Invalid tool-input value for field "${fieldName}" - expected an array of tool objects`,
          },
        }
      }
      return { valid: true, value }
    }

    case 'code': {
      // Code must be a string (content can be JS, Python, JSON, SQL, HTML, etc.)
      if (typeof value !== 'string') {
        return {
          valid: false,
          error: {
            blockId,
            blockType,
            field: fieldName,
            value,
            error: `Invalid code value for field "${fieldName}" - expected a string, got ${typeof value}`,
          },
        }
      }
      return { valid: true, value }
    }

    case 'response-format': {
      // Allow empty/null
      if (value === null || value === undefined || value === '') {
        return { valid: true, value }
      }
      // Allow objects (will be stringified later by normalizeResponseFormat)
      if (typeof value === 'object') {
        return { valid: true, value }
      }
      // If string, must be valid JSON
      if (typeof value === 'string') {
        try {
          JSON.parse(value)
          return { valid: true, value }
        } catch {
          return {
            valid: false,
            error: {
              blockId,
              blockType,
              field: fieldName,
              value,
              error: `Invalid response-format value for field "${fieldName}" - string must be valid JSON`,
            },
          }
        }
      }
      // Reject numbers, booleans, etc.
      return {
        valid: false,
        error: {
          blockId,
          blockType,
          field: fieldName,
          value,
          error: `Invalid response-format value for field "${fieldName}" - expected a JSON string or object`,
        },
      }
    }

    case 'short-input':
    case 'long-input':
    case 'combobox': {
      // Should be string (combobox allows custom values)
      if (typeof value !== 'string' && typeof value !== 'number') {
        // Convert to string but don't error
        return { valid: true, value: String(value) }
      }
      return { valid: true, value }
    }

    // Selector types - allow strings (IDs) or arrays of strings
    case 'oauth-input':
    case 'knowledge-base-selector':
    case 'document-selector':
    case 'file-selector':
    case 'project-selector':
    case 'channel-selector':
    case 'folder-selector':
    case 'mcp-server-selector':
    case 'mcp-tool-selector':
    case 'workflow-selector': {
      if (subBlockConfig.multiSelect && Array.isArray(value)) {
        return { valid: true, value }
      }
      if (typeof value === 'string') {
        return { valid: true, value }
      }
      return {
        valid: false,
        error: {
          blockId,
          blockType,
          field: fieldName,
          value,
          error: `Invalid selector value for field "${fieldName}" - expected a string${subBlockConfig.multiSelect ? ' or array of strings' : ''}`,
        },
      }
    }

    default:
      // For unknown types, pass through
      return { valid: true, value }
  }
}

/**
 * Validates source handle is valid for the block type
 */
export function validateSourceHandleForBlock(
  sourceHandle: string,
  sourceBlockType: string,
  sourceBlock: any
): EdgeHandleValidationResult {
  if (sourceHandle === 'error') {
    return { valid: true }
  }

  switch (sourceBlockType) {
    case 'loop':
      if (sourceHandle === 'loop-start-source' || sourceHandle === 'loop-end-source') {
        return { valid: true }
      }
      return {
        valid: false,
        error: `Invalid source handle "${sourceHandle}" for loop block. Valid handles: loop-start-source, loop-end-source, error`,
      }

    case 'parallel':
      if (sourceHandle === 'parallel-start-source' || sourceHandle === 'parallel-end-source') {
        return { valid: true }
      }
      return {
        valid: false,
        error: `Invalid source handle "${sourceHandle}" for parallel block. Valid handles: parallel-start-source, parallel-end-source, error`,
      }

    case 'condition': {
      const conditionsValue = sourceBlock?.subBlocks?.conditions?.value
      if (!conditionsValue) {
        return {
          valid: false,
          error: `Invalid condition handle "${sourceHandle}" - no conditions defined`,
        }
      }

      // validateConditionHandle accepts simple format (if, else-if-0, else),
      // legacy format (condition-{blockId}-if), and internal ID format (condition-{uuid})
      return validateConditionHandle(sourceHandle, sourceBlock.id, conditionsValue)
    }

    case 'router':
      if (sourceHandle === 'source' || sourceHandle.startsWith(EDGE.ROUTER_PREFIX)) {
        return { valid: true }
      }
      return {
        valid: false,
        error: `Invalid source handle "${sourceHandle}" for router block. Valid handles: source, ${EDGE.ROUTER_PREFIX}{targetId}, error`,
      }

    case 'router_v2': {
      const routesValue = sourceBlock?.subBlocks?.routes?.value
      if (!routesValue) {
        return {
          valid: false,
          error: `Invalid router handle "${sourceHandle}" - no routes defined`,
        }
      }

      // validateRouterHandle accepts simple format (route-0, route-1),
      // legacy format (router-{blockId}-route-1), and internal ID format (router-{uuid})
      return validateRouterHandle(sourceHandle, sourceBlock.id, routesValue)
    }

    default:
      if (sourceHandle === 'source') {
        return { valid: true }
      }
      return {
        valid: false,
        error: `Invalid source handle "${sourceHandle}" for ${sourceBlockType} block. Valid handles: source, error`,
      }
  }
}

/**
 * Validates condition handle references a valid condition in the block.
 * Accepts multiple formats:
 * - Simple format: "if", "else-if-0", "else-if-1", "else"
 * - Legacy semantic format: "condition-{blockId}-if", "condition-{blockId}-else-if"
 * - Internal ID format: "condition-{conditionId}"
 *
 * Returns the normalized handle (condition-{conditionId}) for storage.
 */
export function validateConditionHandle(
  sourceHandle: string,
  blockId: string,
  conditionsValue: string | any[]
): EdgeHandleValidationResult {
  let conditions: any[]
  if (typeof conditionsValue === 'string') {
    try {
      conditions = JSON.parse(conditionsValue)
    } catch {
      return {
        valid: false,
        error: `Cannot validate condition handle "${sourceHandle}" - conditions is not valid JSON`,
      }
    }
  } else if (Array.isArray(conditionsValue)) {
    conditions = conditionsValue
  } else {
    return {
      valid: false,
      error: `Cannot validate condition handle "${sourceHandle}" - conditions is not an array`,
    }
  }

  if (!Array.isArray(conditions) || conditions.length === 0) {
    return {
      valid: false,
      error: `Invalid condition handle "${sourceHandle}" - no conditions defined`,
    }
  }

  // Build a map of all valid handle formats -> normalized handle (condition-{conditionId})
  const handleToNormalized = new Map<string, string>()
  const legacySemanticPrefix = `condition-${blockId}-`
  let elseIfIndex = 0

  for (const condition of conditions) {
    if (!condition.id) continue

    const normalizedHandle = `condition-${condition.id}`
    const title = condition.title?.toLowerCase()

    // Always accept internal ID format
    handleToNormalized.set(normalizedHandle, normalizedHandle)

    if (title === 'if') {
      // Simple format: "if"
      handleToNormalized.set('if', normalizedHandle)
      // Legacy format: "condition-{blockId}-if"
      handleToNormalized.set(`${legacySemanticPrefix}if`, normalizedHandle)
    } else if (title === 'else if') {
      // Simple format: "else-if-0", "else-if-1", etc. (0-indexed)
      handleToNormalized.set(`else-if-${elseIfIndex}`, normalizedHandle)
      // Legacy format: "condition-{blockId}-else-if" for first, "condition-{blockId}-else-if-2" for second
      if (elseIfIndex === 0) {
        handleToNormalized.set(`${legacySemanticPrefix}else-if`, normalizedHandle)
      } else {
        handleToNormalized.set(
          `${legacySemanticPrefix}else-if-${elseIfIndex + 1}`,
          normalizedHandle
        )
      }
      elseIfIndex++
    } else if (title === 'else') {
      // Simple format: "else"
      handleToNormalized.set('else', normalizedHandle)
      // Legacy format: "condition-{blockId}-else"
      handleToNormalized.set(`${legacySemanticPrefix}else`, normalizedHandle)
    }
  }

  const normalizedHandle = handleToNormalized.get(sourceHandle)
  if (normalizedHandle) {
    return { valid: true, normalizedHandle }
  }

  // Build list of valid simple format options for error message
  const simpleOptions: string[] = []
  elseIfIndex = 0
  for (const condition of conditions) {
    const title = condition.title?.toLowerCase()
    if (title === 'if') {
      simpleOptions.push('if')
    } else if (title === 'else if') {
      simpleOptions.push(`else-if-${elseIfIndex}`)
      elseIfIndex++
    } else if (title === 'else') {
      simpleOptions.push('else')
    }
  }

  return {
    valid: false,
    error: `Invalid condition handle "${sourceHandle}". Valid handles: ${simpleOptions.join(', ')}`,
  }
}

/**
 * Validates router handle references a valid route in the block.
 * Accepts multiple formats:
 * - Simple format: "route-0", "route-1", "route-2" (0-indexed)
 * - Legacy semantic format: "router-{blockId}-route-1" (1-indexed)
 * - Internal ID format: "router-{routeId}"
 *
 * Returns the normalized handle (router-{routeId}) for storage.
 */
export function validateRouterHandle(
  sourceHandle: string,
  blockId: string,
  routesValue: string | any[]
): EdgeHandleValidationResult {
  let routes: any[]
  if (typeof routesValue === 'string') {
    try {
      routes = JSON.parse(routesValue)
    } catch {
      return {
        valid: false,
        error: `Cannot validate router handle "${sourceHandle}" - routes is not valid JSON`,
      }
    }
  } else if (Array.isArray(routesValue)) {
    routes = routesValue
  } else {
    return {
      valid: false,
      error: `Cannot validate router handle "${sourceHandle}" - routes is not an array`,
    }
  }

  if (!Array.isArray(routes) || routes.length === 0) {
    return {
      valid: false,
      error: `Invalid router handle "${sourceHandle}" - no routes defined`,
    }
  }

  // Build a map of all valid handle formats -> normalized handle (router-{routeId})
  const handleToNormalized = new Map<string, string>()
  const legacySemanticPrefix = `router-${blockId}-`

  for (let i = 0; i < routes.length; i++) {
    const route = routes[i]
    if (!route.id) continue

    const normalizedHandle = `router-${route.id}`

    // Always accept internal ID format: router-{uuid}
    handleToNormalized.set(normalizedHandle, normalizedHandle)

    // Simple format: route-0, route-1, etc. (0-indexed)
    handleToNormalized.set(`route-${i}`, normalizedHandle)

    // Legacy 1-indexed route number format: router-{blockId}-route-1
    handleToNormalized.set(`${legacySemanticPrefix}route-${i + 1}`, normalizedHandle)

    // Accept normalized title format: router-{blockId}-{normalized-title}
    if (route.title && typeof route.title === 'string') {
      const normalizedTitle = route.title
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
      if (normalizedTitle) {
        handleToNormalized.set(`${legacySemanticPrefix}${normalizedTitle}`, normalizedHandle)
      }
    }
  }

  const normalizedHandle = handleToNormalized.get(sourceHandle)
  if (normalizedHandle) {
    return { valid: true, normalizedHandle }
  }

  // Build list of valid simple format options for error message
  const simpleOptions = routes.map((_, i) => `route-${i}`)

  return {
    valid: false,
    error: `Invalid router handle "${sourceHandle}". Valid handles: ${simpleOptions.join(', ')}`,
  }
}

/**
 * Validates target handle is valid (must be 'target')
 */
export function validateTargetHandle(targetHandle: string): EdgeHandleValidationResult {
  if (targetHandle === 'target') {
    return { valid: true }
  }
  return {
    valid: false,
    error: `Invalid target handle "${targetHandle}". Expected "target"`,
  }
}

/**
 * Checks if a block type is allowed by the permission group config
 */
export function isBlockTypeAllowed(
  blockType: string,
  permissionConfig: PermissionGroupConfig | null
): boolean {
  if (!permissionConfig || permissionConfig.allowedIntegrations === null) {
    return true
  }
  return permissionConfig.allowedIntegrations.includes(blockType)
}

/**
 * Validates selector IDs in the workflow state exist in the database
 * Returns validation errors for any invalid selector IDs
 */
export async function validateWorkflowSelectorIds(
  workflowState: any,
  context: { userId: string; workspaceId?: string }
): Promise<ValidationError[]> {
  const logger = createLogger('EditWorkflowSelectorValidation')
  const errors: ValidationError[] = []

  // Collect all selector fields from all blocks
  const selectorsToValidate: Array<{
    blockId: string
    blockType: string
    fieldName: string
    selectorType: string
    value: string | string[]
  }> = []

  for (const [blockId, block] of Object.entries(workflowState.blocks || {})) {
    const blockData = block as any
    const blockType = blockData.type
    if (!blockType) continue

    const blockConfig = getBlock(blockType)
    if (!blockConfig) continue

    // Check each subBlock for selector types
    for (const subBlockConfig of blockConfig.subBlocks) {
      if (!SELECTOR_TYPES.has(subBlockConfig.type)) continue

      // Skip oauth-input - credentials are pre-validated before edit application
      // This allows existing collaborator credentials to remain untouched
      if (subBlockConfig.type === 'oauth-input') continue

      const subBlockValue = blockData.subBlocks?.[subBlockConfig.id]?.value
      if (!subBlockValue) continue

      // Handle comma-separated values for multi-select
      let values: string | string[] = subBlockValue
      if (typeof subBlockValue === 'string' && subBlockValue.includes(',')) {
        values = subBlockValue
          .split(',')
          .map((v: string) => v.trim())
          .filter(Boolean)
      }

      selectorsToValidate.push({
        blockId,
        blockType,
        fieldName: subBlockConfig.id,
        selectorType: subBlockConfig.type,
        value: values,
      })
    }
  }

  if (selectorsToValidate.length === 0) {
    return errors
  }

  logger.info('Validating selector IDs', {
    selectorCount: selectorsToValidate.length,
    userId: context.userId,
    workspaceId: context.workspaceId,
  })

  // Validate each selector field
  for (const selector of selectorsToValidate) {
    const result = await validateSelectorIds(selector.selectorType, selector.value, context)

    if (result.invalid.length > 0) {
      // Include warning info (like available credentials) in the error message for better LLM feedback
      const warningInfo = result.warning ? `. ${result.warning}` : ''
      errors.push({
        blockId: selector.blockId,
        blockType: selector.blockType,
        field: selector.fieldName,
        value: selector.value,
        error: `Invalid ${selector.selectorType} ID(s): ${result.invalid.join(', ')} - ID(s) do not exist or user doesn't have access${warningInfo}`,
      })
    } else if (result.warning) {
      // Log warnings that don't have errors (shouldn't happen for credentials but may for other selectors)
      logger.warn(result.warning, {
        blockId: selector.blockId,
        fieldName: selector.fieldName,
      })
    }
  }

  if (errors.length > 0) {
    logger.warn('Found invalid selector IDs', {
      errorCount: errors.length,
      errors: errors.map((e) => ({ blockId: e.blockId, field: e.field, error: e.error })),
    })
  }

  return errors
}

/**
 * Pre-validates credential and apiKey inputs in operations before they are applied.
 * - Validates oauth-input (credential) IDs belong to the user
 * - Filters out apiKey inputs for hosted models when isHosted is true
 * - Also validates credentials and apiKeys in nestedNodes (blocks inside loop/parallel)
 * Returns validation errors for any removed inputs.
 */
export async function preValidateCredentialInputs(
  operations: EditWorkflowOperation[],
  context: { userId: string },
  workflowState?: Record<string, unknown>
): Promise<{ filteredOperations: EditWorkflowOperation[]; errors: ValidationError[] }> {
  const { isHosted } = await import('@/lib/core/config/feature-flags')
  const { getHostedModels } = await import('@/providers/utils')

  const logger = createLogger('PreValidateCredentials')
  const errors: ValidationError[] = []

  // Collect credential and apiKey inputs that need validation/filtering
  const credentialInputs: Array<{
    operationIndex: number
    blockId: string
    blockType: string
    fieldName: string
    value: string
    nestedBlockId?: string
  }> = []

  const hostedApiKeyInputs: Array<{
    operationIndex: number
    blockId: string
    blockType: string
    model: string
    nestedBlockId?: string
  }> = []

  const hostedModelsLower = isHosted ? new Set(getHostedModels().map((m) => m.toLowerCase())) : null

  /**
   * Collect credential inputs from a block's inputs based on its block config
   */
  function collectCredentialInputs(
    blockConfig: ReturnType<typeof getBlock>,
    inputs: Record<string, unknown>,
    opIndex: number,
    blockId: string,
    blockType: string,
    nestedBlockId?: string
  ) {
    if (!blockConfig) return

    for (const subBlockConfig of blockConfig.subBlocks) {
      if (subBlockConfig.type !== 'oauth-input') continue

      const inputValue = inputs[subBlockConfig.id]
      if (!inputValue || typeof inputValue !== 'string' || inputValue.trim() === '') continue

      credentialInputs.push({
        operationIndex: opIndex,
        blockId,
        blockType,
        fieldName: subBlockConfig.id,
        value: inputValue,
        nestedBlockId,
      })
    }
  }

  /**
   * Check if apiKey should be filtered for a block with the given model
   */
  function collectHostedApiKeyInput(
    inputs: Record<string, unknown>,
    modelValue: string | undefined,
    opIndex: number,
    blockId: string,
    blockType: string,
    nestedBlockId?: string
  ) {
    if (!hostedModelsLower || !inputs.apiKey) return
    if (!modelValue || typeof modelValue !== 'string') return

    if (hostedModelsLower.has(modelValue.toLowerCase())) {
      hostedApiKeyInputs.push({
        operationIndex: opIndex,
        blockId,
        blockType,
        model: modelValue,
        nestedBlockId,
      })
    }
  }

  operations.forEach((op, opIndex) => {
    // Process main block inputs
    if (op.params?.inputs && op.params?.type) {
      const blockConfig = getBlock(op.params.type)
      if (blockConfig) {
        // Collect credentials from main block
        collectCredentialInputs(
          blockConfig,
          op.params.inputs as Record<string, unknown>,
          opIndex,
          op.block_id,
          op.params.type
        )

        // Check for apiKey inputs on hosted models
        let modelValue = (op.params.inputs as Record<string, unknown>).model as string | undefined

        // For edit operations, if model is not being changed, check existing block's model
        if (
          !modelValue &&
          op.operation_type === 'edit' &&
          (op.params.inputs as Record<string, unknown>).apiKey &&
          workflowState
        ) {
          const existingBlock = (workflowState.blocks as Record<string, unknown>)?.[op.block_id] as
            | Record<string, unknown>
            | undefined
          const existingSubBlocks = existingBlock?.subBlocks as Record<string, unknown> | undefined
          const existingModelSubBlock = existingSubBlocks?.model as
            | Record<string, unknown>
            | undefined
          modelValue = existingModelSubBlock?.value as string | undefined
        }

        collectHostedApiKeyInput(
          op.params.inputs as Record<string, unknown>,
          modelValue,
          opIndex,
          op.block_id,
          op.params.type
        )
      }
    }

    // Process nested nodes (blocks inside loop/parallel containers)
    const nestedNodes = op.params?.nestedNodes as
      | Record<string, Record<string, unknown>>
      | undefined
    if (nestedNodes) {
      Object.entries(nestedNodes).forEach(([childId, childBlock]) => {
        const childType = childBlock.type as string | undefined
        const childInputs = childBlock.inputs as Record<string, unknown> | undefined
        if (!childType || !childInputs) return

        const childBlockConfig = getBlock(childType)
        if (!childBlockConfig) return

        // Collect credentials from nested block
        collectCredentialInputs(
          childBlockConfig,
          childInputs,
          opIndex,
          op.block_id,
          childType,
          childId
        )

        // Check for apiKey inputs on hosted models in nested block
        const modelValue = childInputs.model as string | undefined
        collectHostedApiKeyInput(childInputs, modelValue, opIndex, op.block_id, childType, childId)
      })
    }
  })

  const hasCredentialsToValidate = credentialInputs.length > 0
  const hasHostedApiKeysToFilter = hostedApiKeyInputs.length > 0

  if (!hasCredentialsToValidate && !hasHostedApiKeysToFilter) {
    return { filteredOperations: operations, errors }
  }

  // Deep clone operations so we can modify them
  const filteredOperations = structuredClone(operations)

  // Filter out apiKey inputs for hosted models and add validation errors
  if (hasHostedApiKeysToFilter) {
    logger.info('Filtering apiKey inputs for hosted models', { count: hostedApiKeyInputs.length })

    for (const apiKeyInput of hostedApiKeyInputs) {
      const op = filteredOperations[apiKeyInput.operationIndex]

      // Handle nested block apiKey filtering
      if (apiKeyInput.nestedBlockId) {
        const nestedNodes = op.params?.nestedNodes as
          | Record<string, Record<string, unknown>>
          | undefined
        const nestedBlock = nestedNodes?.[apiKeyInput.nestedBlockId]
        const nestedInputs = nestedBlock?.inputs as Record<string, unknown> | undefined
        if (nestedInputs?.apiKey) {
          nestedInputs.apiKey = undefined
          logger.debug('Filtered apiKey for hosted model in nested block', {
            parentBlockId: apiKeyInput.blockId,
            nestedBlockId: apiKeyInput.nestedBlockId,
            model: apiKeyInput.model,
          })

          errors.push({
            blockId: apiKeyInput.nestedBlockId,
            blockType: apiKeyInput.blockType,
            field: 'apiKey',
            value: '[redacted]',
            error: `Cannot set API key for hosted model "${apiKeyInput.model}" - API keys are managed by the platform when using hosted models`,
          })
        }
      } else if (op.params?.inputs?.apiKey) {
        // Handle main block apiKey filtering
        op.params.inputs.apiKey = undefined
        logger.debug('Filtered apiKey for hosted model', {
          blockId: apiKeyInput.blockId,
          model: apiKeyInput.model,
        })

        errors.push({
          blockId: apiKeyInput.blockId,
          blockType: apiKeyInput.blockType,
          field: 'apiKey',
          value: '[redacted]',
          error: `Cannot set API key for hosted model "${apiKeyInput.model}" - API keys are managed by the platform when using hosted models`,
        })
      }
    }
  }

  // Validate credential inputs
  if (hasCredentialsToValidate) {
    logger.info('Pre-validating credential inputs', {
      credentialCount: credentialInputs.length,
      userId: context.userId,
    })

    const allCredentialIds = credentialInputs.map((c) => c.value)
    const validationResult = await validateSelectorIds('oauth-input', allCredentialIds, context)
    const invalidSet = new Set(validationResult.invalid)

    if (invalidSet.size > 0) {
      for (const credInput of credentialInputs) {
        if (!invalidSet.has(credInput.value)) continue

        const op = filteredOperations[credInput.operationIndex]

        // Handle nested block credential removal
        if (credInput.nestedBlockId) {
          const nestedNodes = op.params?.nestedNodes as
            | Record<string, Record<string, unknown>>
            | undefined
          const nestedBlock = nestedNodes?.[credInput.nestedBlockId]
          const nestedInputs = nestedBlock?.inputs as Record<string, unknown> | undefined
          if (nestedInputs?.[credInput.fieldName]) {
            delete nestedInputs[credInput.fieldName]
            logger.info('Removed invalid credential from nested block', {
              parentBlockId: credInput.blockId,
              nestedBlockId: credInput.nestedBlockId,
              field: credInput.fieldName,
              invalidValue: credInput.value,
            })
          }
        } else if (op.params?.inputs?.[credInput.fieldName]) {
          // Handle main block credential removal
          delete op.params.inputs[credInput.fieldName]
          logger.info('Removed invalid credential from operation', {
            blockId: credInput.blockId,
            field: credInput.fieldName,
            invalidValue: credInput.value,
          })
        }

        const warningInfo = validationResult.warning ? `. ${validationResult.warning}` : ''
        const errorBlockId = credInput.nestedBlockId ?? credInput.blockId
        errors.push({
          blockId: errorBlockId,
          blockType: credInput.blockType,
          field: credInput.fieldName,
          value: credInput.value,
          error: `Invalid credential ID "${credInput.value}" - credential does not exist or user doesn't have access${warningInfo}`,
        })
      }

      logger.warn('Filtered out invalid credentials', {
        invalidCount: invalidSet.size,
      })
    }
  }

  return { filteredOperations, errors }
}
