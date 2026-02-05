import crypto from 'crypto'
import { db } from '@sim/db'
import { workflow as workflowTable } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { validateSelectorIds } from '@/lib/copilot/validation/selector-validator'
import type { PermissionGroupConfig } from '@/lib/permission-groups/types'
import { getBlockOutputs } from '@/lib/workflows/blocks/block-outputs'
import { extractAndPersistCustomTools } from '@/lib/workflows/persistence/custom-tools-persistence'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'
import { isValidKey } from '@/lib/workflows/sanitization/key-validation'
import { validateWorkflowState } from '@/lib/workflows/sanitization/validation'
import { buildCanonicalIndex, isCanonicalPair } from '@/lib/workflows/subblocks/visibility'
import { TriggerUtils } from '@/lib/workflows/triggers/triggers'
import { getAllBlocks, getBlock } from '@/blocks/registry'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'
import { getUserPermissionConfig } from '@/ee/access-control/utils/permission-check'
import { EDGE, normalizeName, RESERVED_BLOCK_NAMES } from '@/executor/constants'
import { generateLoopBlocks, generateParallelBlocks } from '@/stores/workflows/workflow/utils'
import { TRIGGER_RUNTIME_SUBBLOCK_IDS } from '@/triggers/constants'

/** Selector subblock types that can be validated */
const SELECTOR_TYPES = new Set([
  'oauth-input',
  'knowledge-base-selector',
  'document-selector',
  'file-selector',
  'project-selector',
  'channel-selector',
  'folder-selector',
  'mcp-server-selector',
  'mcp-tool-selector',
  'workflow-selector',
])

const validationLogger = createLogger('EditWorkflowValidation')

/**
 * Validation error for a specific field
 */
interface ValidationError {
  blockId: string
  blockType: string
  field: string
  value: any
  error: string
}

/**
 * Types of items that can be skipped during operation application
 */
type SkippedItemType =
  | 'block_not_found'
  | 'invalid_block_type'
  | 'block_not_allowed'
  | 'block_locked'
  | 'tool_not_allowed'
  | 'invalid_edge_target'
  | 'invalid_edge_source'
  | 'invalid_source_handle'
  | 'invalid_target_handle'
  | 'invalid_subblock_field'
  | 'missing_required_params'
  | 'invalid_subflow_parent'
  | 'nested_subflow_not_allowed'
  | 'duplicate_block_name'
  | 'reserved_block_name'
  | 'duplicate_trigger'
  | 'duplicate_single_instance_block'

/**
 * Represents an item that was skipped during operation application
 */
interface SkippedItem {
  type: SkippedItemType
  operationType: string
  blockId: string
  reason: string
  details?: Record<string, any>
}

/**
 * Logs and records a skipped item
 */
function logSkippedItem(skippedItems: SkippedItem[], item: SkippedItem): void {
  validationLogger.warn(`Skipped ${item.operationType} operation: ${item.reason}`, {
    type: item.type,
    operationType: item.operationType,
    blockId: item.blockId,
    ...(item.details && { details: item.details }),
  })
  skippedItems.push(item)
}

/**
 * Finds an existing block with the same normalized name.
 */
function findBlockWithDuplicateNormalizedName(
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
 * Result of input validation
 */
interface ValidationResult {
  validInputs: Record<string, any>
  errors: ValidationError[]
}

/**
 * Validates and filters inputs against a block's subBlock configuration
 * Returns valid inputs and any validation errors encountered
 */
function validateInputsForBlock(
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
 * Result of validating a single value
 */
interface ValueValidationResult {
  valid: boolean
  value?: any
  error?: ValidationError
}

/**
 * Validates a value against its expected subBlock type
 * Returns validation result with the value or an error
 */
function validateValueForSubBlockType(
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

interface EditWorkflowOperation {
  operation_type: 'add' | 'edit' | 'delete' | 'insert_into_subflow' | 'extract_from_subflow'
  block_id: string
  params?: Record<string, any>
}

interface EditWorkflowParams {
  operations: EditWorkflowOperation[]
  workflowId: string
  currentUserWorkflow?: string
}

/**
 * Topologically sort insert operations to ensure parents are created before children
 * Returns sorted array where parent inserts always come before child inserts
 */
function topologicalSortInserts(
  inserts: EditWorkflowOperation[],
  adds: EditWorkflowOperation[]
): EditWorkflowOperation[] {
  if (inserts.length === 0) return []

  // Build a map of blockId -> operation for quick lookup
  const insertMap = new Map<string, EditWorkflowOperation>()
  inserts.forEach((op) => insertMap.set(op.block_id, op))

  // Build a set of blocks being added (potential parents)
  const addedBlocks = new Set(adds.map((op) => op.block_id))

  // Build dependency graph: block -> blocks that depend on it
  const dependents = new Map<string, Set<string>>()
  const dependencies = new Map<string, Set<string>>()

  inserts.forEach((op) => {
    const blockId = op.block_id
    const parentId = op.params?.subflowId

    dependencies.set(blockId, new Set())

    if (parentId) {
      // Track dependency if parent is being inserted OR being added
      // This ensures children wait for parents regardless of operation type
      const parentBeingCreated = insertMap.has(parentId) || addedBlocks.has(parentId)

      if (parentBeingCreated) {
        // Only add dependency if parent is also being inserted (not added)
        // Because adds run before inserts, added parents are already created
        if (insertMap.has(parentId)) {
          dependencies.get(blockId)!.add(parentId)
          if (!dependents.has(parentId)) {
            dependents.set(parentId, new Set())
          }
          dependents.get(parentId)!.add(blockId)
        }
      }
    }
  })

  // Topological sort using Kahn's algorithm
  const sorted: EditWorkflowOperation[] = []
  const queue: string[] = []

  // Start with nodes that have no dependencies (or depend only on added blocks)
  inserts.forEach((op) => {
    const deps = dependencies.get(op.block_id)!
    if (deps.size === 0) {
      queue.push(op.block_id)
    }
  })

  while (queue.length > 0) {
    const blockId = queue.shift()!
    const op = insertMap.get(blockId)
    if (op) {
      sorted.push(op)
    }

    // Remove this node from dependencies of others
    const children = dependents.get(blockId)
    if (children) {
      children.forEach((childId) => {
        const childDeps = dependencies.get(childId)!
        childDeps.delete(blockId)
        if (childDeps.size === 0) {
          queue.push(childId)
        }
      })
    }
  }

  // If sorted length doesn't match input, there's a cycle (shouldn't happen with valid operations)
  // Just append remaining operations
  if (sorted.length < inserts.length) {
    inserts.forEach((op) => {
      if (!sorted.includes(op)) {
        sorted.push(op)
      }
    })
  }

  return sorted
}

/**
 * Helper to create a block state from operation params
 */
function createBlockFromParams(
  blockId: string,
  params: any,
  parentId?: string,
  errorsCollector?: ValidationError[],
  permissionConfig?: PermissionGroupConfig | null,
  skippedItems?: SkippedItem[]
): any {
  const blockConfig = getAllBlocks().find((b) => b.type === params.type)

  // Validate inputs against block configuration
  let validatedInputs: Record<string, any> | undefined
  if (params.inputs) {
    const result = validateInputsForBlock(params.type, params.inputs, blockId)
    validatedInputs = result.validInputs
    if (errorsCollector && result.errors.length > 0) {
      errorsCollector.push(...result.errors)
    }
  }

  // Determine outputs based on trigger mode
  const triggerMode = params.triggerMode || false
  let outputs: Record<string, any>

  if (params.outputs) {
    outputs = params.outputs
  } else if (blockConfig) {
    const subBlocks: Record<string, any> = {}
    if (validatedInputs) {
      Object.entries(validatedInputs).forEach(([key, value]) => {
        // Skip runtime subblock IDs when computing outputs
        if (TRIGGER_RUNTIME_SUBBLOCK_IDS.includes(key)) {
          return
        }
        subBlocks[key] = { id: key, type: 'short-input', value: value }
      })
    }
    outputs = getBlockOutputs(params.type, subBlocks, triggerMode)
  } else {
    outputs = {}
  }

  const blockState: any = {
    id: blockId,
    type: params.type,
    name: params.name,
    position: { x: 0, y: 0 },
    enabled: params.enabled !== undefined ? params.enabled : true,
    horizontalHandles: true,
    advancedMode: params.advancedMode || false,
    height: 0,
    triggerMode: triggerMode,
    subBlocks: {},
    outputs: outputs,
    data: parentId ? { parentId, extent: 'parent' as const } : {},
    locked: false,
  }

  // Add validated inputs as subBlocks
  if (validatedInputs) {
    Object.entries(validatedInputs).forEach(([key, value]) => {
      if (TRIGGER_RUNTIME_SUBBLOCK_IDS.includes(key)) {
        return
      }

      let sanitizedValue = value

      // Normalize array subblocks with id fields (inputFormat, table rows, etc.)
      if (shouldNormalizeArrayIds(key)) {
        sanitizedValue = normalizeArrayWithIds(value)
      }

      // Special handling for tools - normalize and filter disallowed
      if (key === 'tools' && Array.isArray(value)) {
        sanitizedValue = filterDisallowedTools(
          normalizeTools(value),
          permissionConfig ?? null,
          blockId,
          skippedItems ?? []
        )
      }

      // Special handling for responseFormat - normalize to ensure consistent format
      if (key === 'responseFormat' && value) {
        sanitizedValue = normalizeResponseFormat(value)
      }

      blockState.subBlocks[key] = {
        id: key,
        type: 'short-input',
        value: sanitizedValue,
      }
    })
  }

  // Set up subBlocks from block configuration
  if (blockConfig) {
    blockConfig.subBlocks.forEach((subBlock) => {
      if (!blockState.subBlocks[subBlock.id]) {
        blockState.subBlocks[subBlock.id] = {
          id: subBlock.id,
          type: subBlock.type,
          value: null,
        }
      }
    })

    if (validatedInputs) {
      updateCanonicalModesForInputs(blockState, Object.keys(validatedInputs), blockConfig)
    }
  }

  return blockState
}

function updateCanonicalModesForInputs(
  block: { data?: { canonicalModes?: Record<string, 'basic' | 'advanced'> } },
  inputKeys: string[],
  blockConfig: BlockConfig
): void {
  if (!blockConfig.subBlocks?.length) return

  const canonicalIndex = buildCanonicalIndex(blockConfig.subBlocks)
  const canonicalModeUpdates: Record<string, 'basic' | 'advanced'> = {}

  for (const inputKey of inputKeys) {
    const canonicalId = canonicalIndex.canonicalIdBySubBlockId[inputKey]
    if (!canonicalId) continue

    const group = canonicalIndex.groupsById[canonicalId]
    if (!group || !isCanonicalPair(group)) continue

    const isAdvanced = group.advancedIds.includes(inputKey)
    const existingMode = canonicalModeUpdates[canonicalId]

    if (!existingMode || isAdvanced) {
      canonicalModeUpdates[canonicalId] = isAdvanced ? 'advanced' : 'basic'
    }
  }

  if (Object.keys(canonicalModeUpdates).length > 0) {
    if (!block.data) block.data = {}
    if (!block.data.canonicalModes) block.data.canonicalModes = {}
    Object.assign(block.data.canonicalModes, canonicalModeUpdates)
  }
}

/**
 * Normalize tools array by adding back fields that were sanitized for training
 */
function normalizeTools(tools: any[]): any[] {
  return tools.map((tool) => {
    if (tool.type === 'custom-tool') {
      // New reference format: minimal fields only
      if (tool.customToolId && !tool.schema && !tool.code) {
        return {
          type: tool.type,
          customToolId: tool.customToolId,
          usageControl: tool.usageControl || 'auto',
          isExpanded: tool.isExpanded ?? true,
        }
      }

      // Legacy inline format: include all fields
      const normalized: any = {
        ...tool,
        params: tool.params || {},
        isExpanded: tool.isExpanded ?? true,
      }

      // Ensure schema has proper structure (for inline format)
      if (normalized.schema?.function) {
        normalized.schema = {
          type: 'function',
          function: {
            name: normalized.schema.function.name || tool.title, // Preserve name or derive from title
            description: normalized.schema.function.description,
            parameters: normalized.schema.function.parameters,
          },
        }
      }

      return normalized
    }

    // For other tool types, just ensure isExpanded exists
    return {
      ...tool,
      isExpanded: tool.isExpanded ?? true,
    }
  })
}

/** UUID v4 regex pattern for validation */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Subblock types that store arrays of objects with `id` fields.
 * The LLM may generate arbitrary IDs which need to be converted to proper UUIDs.
 */
const ARRAY_WITH_ID_SUBBLOCK_TYPES = new Set([
  'inputFormat', // input-format: Fields with id, name, type, value, collapsed
  'headers', // table: Rows with id, cells (used for HTTP headers)
  'params', // table: Rows with id, cells (used for query params)
  'variables', // table or variables-input: Rows/assignments with id
  'tagFilters', // knowledge-tag-filters: Filters with id, tagName, etc.
  'documentTags', // document-tag-entry: Tags with id, tagName, etc.
  'metrics', // eval-input: Metrics with id, name, description, range
])

/**
 * Normalizes array subblock values by ensuring each item has a valid UUID.
 * The LLM may generate arbitrary IDs like "input-desc-001" or "row-1" which need
 * to be converted to proper UUIDs for consistency with UI-created items.
 */
function normalizeArrayWithIds(value: unknown): any[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.map((item: any) => {
    if (!item || typeof item !== 'object') {
      return item
    }

    // Check if id is missing or not a valid UUID
    const hasValidUUID = typeof item.id === 'string' && UUID_REGEX.test(item.id)
    if (!hasValidUUID) {
      return { ...item, id: crypto.randomUUID() }
    }

    return item
  })
}

/**
 * Checks if a subblock key should have its array items normalized with UUIDs.
 */
function shouldNormalizeArrayIds(key: string): boolean {
  return ARRAY_WITH_ID_SUBBLOCK_TYPES.has(key)
}

/**
 * Normalize responseFormat to ensure consistent storage
 * Handles both string (JSON) and object formats
 * Returns pretty-printed JSON for better UI readability
 */
function normalizeResponseFormat(value: any): string {
  try {
    let obj = value

    // If it's already a string, parse it first
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (!trimmed) {
        return ''
      }
      obj = JSON.parse(trimmed)
    }

    // If it's an object, stringify it with consistent formatting
    if (obj && typeof obj === 'object') {
      // Sort keys recursively for consistent comparison
      const sortKeys = (item: any): any => {
        if (Array.isArray(item)) {
          return item.map(sortKeys)
        }
        if (item !== null && typeof item === 'object') {
          return Object.keys(item)
            .sort()
            .reduce((result: any, key: string) => {
              result[key] = sortKeys(item[key])
              return result
            }, {})
        }
        return item
      }

      // Return pretty-printed with 2-space indentation for UI readability
      // The sanitizer will normalize it to minified format for comparison
      return JSON.stringify(sortKeys(obj), null, 2)
    }

    return String(value)
  } catch (error) {
    // If parsing fails, return the original value as string
    return String(value)
  }
}

interface EdgeHandleValidationResult {
  valid: boolean
  error?: string
  /** The normalized handle to use (e.g., simple 'if' normalized to 'condition-{uuid}') */
  normalizedHandle?: string
}

/**
 * Validates source handle is valid for the block type
 */
function validateSourceHandleForBlock(
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
function validateConditionHandle(
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
function validateRouterHandle(
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
function validateTargetHandle(targetHandle: string): EdgeHandleValidationResult {
  if (targetHandle === 'target') {
    return { valid: true }
  }
  return {
    valid: false,
    error: `Invalid target handle "${targetHandle}". Expected "target"`,
  }
}

/**
 * Creates a validated edge between two blocks.
 * Returns true if edge was created, false if skipped due to validation errors.
 */
function createValidatedEdge(
  modifiedState: any,
  sourceBlockId: string,
  targetBlockId: string,
  sourceHandle: string,
  targetHandle: string,
  operationType: string,
  logger: ReturnType<typeof createLogger>,
  skippedItems?: SkippedItem[]
): boolean {
  if (!modifiedState.blocks[targetBlockId]) {
    logger.warn(`Target block "${targetBlockId}" not found. Edge skipped.`, {
      sourceBlockId,
      targetBlockId,
      sourceHandle,
    })
    skippedItems?.push({
      type: 'invalid_edge_target',
      operationType,
      blockId: sourceBlockId,
      reason: `Edge from "${sourceBlockId}" to "${targetBlockId}" skipped - target block does not exist`,
      details: { sourceHandle, targetHandle, targetId: targetBlockId },
    })
    return false
  }

  const sourceBlock = modifiedState.blocks[sourceBlockId]
  if (!sourceBlock) {
    logger.warn(`Source block "${sourceBlockId}" not found. Edge skipped.`, {
      sourceBlockId,
      targetBlockId,
    })
    skippedItems?.push({
      type: 'invalid_edge_source',
      operationType,
      blockId: sourceBlockId,
      reason: `Edge from "${sourceBlockId}" to "${targetBlockId}" skipped - source block does not exist`,
      details: { sourceHandle, targetHandle, targetId: targetBlockId },
    })
    return false
  }

  const sourceBlockType = sourceBlock.type
  if (!sourceBlockType) {
    logger.warn(`Source block "${sourceBlockId}" has no type. Edge skipped.`, {
      sourceBlockId,
      targetBlockId,
    })
    skippedItems?.push({
      type: 'invalid_edge_source',
      operationType,
      blockId: sourceBlockId,
      reason: `Edge from "${sourceBlockId}" to "${targetBlockId}" skipped - source block has no type`,
      details: { sourceHandle, targetHandle, targetId: targetBlockId },
    })
    return false
  }

  const sourceValidation = validateSourceHandleForBlock(sourceHandle, sourceBlockType, sourceBlock)
  if (!sourceValidation.valid) {
    logger.warn(`Invalid source handle. Edge skipped.`, {
      sourceBlockId,
      targetBlockId,
      sourceHandle,
      error: sourceValidation.error,
    })
    skippedItems?.push({
      type: 'invalid_source_handle',
      operationType,
      blockId: sourceBlockId,
      reason: sourceValidation.error || `Invalid source handle "${sourceHandle}"`,
      details: { sourceHandle, targetHandle, targetId: targetBlockId },
    })
    return false
  }

  const targetValidation = validateTargetHandle(targetHandle)
  if (!targetValidation.valid) {
    logger.warn(`Invalid target handle. Edge skipped.`, {
      sourceBlockId,
      targetBlockId,
      targetHandle,
      error: targetValidation.error,
    })
    skippedItems?.push({
      type: 'invalid_target_handle',
      operationType,
      blockId: sourceBlockId,
      reason: targetValidation.error || `Invalid target handle "${targetHandle}"`,
      details: { sourceHandle, targetHandle, targetId: targetBlockId },
    })
    return false
  }

  // Use normalized handle if available (e.g., 'if' -> 'condition-{uuid}')
  const finalSourceHandle = sourceValidation.normalizedHandle || sourceHandle

  modifiedState.edges.push({
    id: crypto.randomUUID(),
    source: sourceBlockId,
    sourceHandle: finalSourceHandle,
    target: targetBlockId,
    targetHandle,
    type: 'default',
  })
  return true
}

/**
 * Adds connections as edges for a block.
 * Supports multiple target formats:
 * - String: "target-block-id"
 * - Object: { block: "target-block-id", handle?: "custom-target-handle" }
 * - Array of strings or objects
 */
function addConnectionsAsEdges(
  modifiedState: any,
  blockId: string,
  connections: Record<string, any>,
  logger: ReturnType<typeof createLogger>,
  skippedItems?: SkippedItem[]
): void {
  Object.entries(connections).forEach(([sourceHandle, targets]) => {
    if (targets === null) return

    const addEdgeForTarget = (targetBlock: string, targetHandle?: string) => {
      createValidatedEdge(
        modifiedState,
        blockId,
        targetBlock,
        sourceHandle,
        targetHandle || 'target',
        'add_edge',
        logger,
        skippedItems
      )
    }

    if (typeof targets === 'string') {
      addEdgeForTarget(targets)
    } else if (Array.isArray(targets)) {
      targets.forEach((target: any) => {
        if (typeof target === 'string') {
          addEdgeForTarget(target)
        } else if (target?.block) {
          addEdgeForTarget(target.block, target.handle)
        }
      })
    } else if (typeof targets === 'object' && targets?.block) {
      addEdgeForTarget(targets.block, targets.handle)
    }
  })
}

function applyTriggerConfigToBlockSubblocks(block: any, triggerConfig: Record<string, any>) {
  if (!block?.subBlocks || !triggerConfig || typeof triggerConfig !== 'object') {
    return
  }

  Object.entries(triggerConfig).forEach(([configKey, configValue]) => {
    const existingSubblock = block.subBlocks[configKey]
    if (existingSubblock) {
      const existingValue = existingSubblock.value
      const valuesEqual =
        typeof existingValue === 'object' || typeof configValue === 'object'
          ? JSON.stringify(existingValue) === JSON.stringify(configValue)
          : existingValue === configValue

      if (valuesEqual) {
        return
      }

      block.subBlocks[configKey] = {
        ...existingSubblock,
        value: configValue,
      }
    } else {
      block.subBlocks[configKey] = {
        id: configKey,
        type: 'short-input',
        value: configValue,
      }
    }
  })
}

/**
 * Result of applying operations to workflow state
 */
interface ApplyOperationsResult {
  state: any
  validationErrors: ValidationError[]
  skippedItems: SkippedItem[]
}

/**
 * Checks if a block type is allowed by the permission group config
 */
function isBlockTypeAllowed(
  blockType: string,
  permissionConfig: PermissionGroupConfig | null
): boolean {
  if (!permissionConfig || permissionConfig.allowedIntegrations === null) {
    return true
  }
  return permissionConfig.allowedIntegrations.includes(blockType)
}

/**
 * Filters out tools that are not allowed by the permission group config
 * Returns both the allowed tools and any skipped tool items for logging
 */
function filterDisallowedTools(
  tools: any[],
  permissionConfig: PermissionGroupConfig | null,
  blockId: string,
  skippedItems: SkippedItem[]
): any[] {
  if (!permissionConfig) {
    return tools
  }

  const allowedTools: any[] = []

  for (const tool of tools) {
    if (tool.type === 'custom-tool' && permissionConfig.disableCustomTools) {
      logSkippedItem(skippedItems, {
        type: 'tool_not_allowed',
        operationType: 'add',
        blockId,
        reason: `Custom tool "${tool.title || tool.customToolId || 'unknown'}" is not allowed by permission group - tool not added`,
        details: { toolType: 'custom-tool', toolId: tool.customToolId },
      })
      continue
    }
    if (tool.type === 'mcp' && permissionConfig.disableMcpTools) {
      logSkippedItem(skippedItems, {
        type: 'tool_not_allowed',
        operationType: 'add',
        blockId,
        reason: `MCP tool "${tool.title || 'unknown'}" is not allowed by permission group - tool not added`,
        details: { toolType: 'mcp', serverId: tool.params?.serverId },
      })
      continue
    }
    allowedTools.push(tool)
  }

  return allowedTools
}

/**
 * Apply operations directly to the workflow JSON state
 */
function applyOperationsToWorkflowState(
  workflowState: any,
  operations: EditWorkflowOperation[],
  permissionConfig: PermissionGroupConfig | null = null
): ApplyOperationsResult {
  // Deep clone the workflow state to avoid mutations
  const modifiedState = JSON.parse(JSON.stringify(workflowState))

  // Collect validation errors across all operations
  const validationErrors: ValidationError[] = []

  // Collect skipped items across all operations
  const skippedItems: SkippedItem[] = []

  // Log initial state
  const logger = createLogger('EditWorkflowServerTool')
  logger.info('Applying operations to workflow:', {
    totalOperations: operations.length,
    operationTypes: operations.reduce((acc: any, op) => {
      acc[op.operation_type] = (acc[op.operation_type] || 0) + 1
      return acc
    }, {}),
    initialBlockCount: Object.keys(modifiedState.blocks || {}).length,
  })

  /**
   * Reorder operations to ensure correct execution sequence:
   * 1. delete - Remove blocks first to free up IDs and clean state
   * 2. extract_from_subflow - Extract blocks from subflows before modifications
   * 3. add - Create new blocks (sorted by connection dependencies)
   * 4. insert_into_subflow - Insert blocks into subflows (sorted by parent dependency)
   * 5. edit - Edit existing blocks last, so connections to newly added blocks work
   *
   * This ordering is CRITICAL: operations may reference blocks being added/inserted
   * in the same batch. Without proper ordering, target blocks wouldn't exist yet.
   *
   * For add operations, we use a two-pass approach:
   * - Pass 1: Create all blocks (without connections)
   * - Pass 2: Add all connections (now all blocks exist)
   * This ensures that if block A connects to block B, and both are being added,
   * B will exist when we try to create the edge from A to B.
   */
  const deletes = operations.filter((op) => op.operation_type === 'delete')
  const extracts = operations.filter((op) => op.operation_type === 'extract_from_subflow')
  const adds = operations.filter((op) => op.operation_type === 'add')
  const inserts = operations.filter((op) => op.operation_type === 'insert_into_subflow')
  const edits = operations.filter((op) => op.operation_type === 'edit')

  // Sort insert operations to ensure parents are inserted before children
  // This handles cases where a loop/parallel is being added along with its children
  const sortedInserts = topologicalSortInserts(inserts, adds)

  // We'll process add operations in two passes (handled in the switch statement below)
  // This is tracked via a separate flag to know which pass we're in
  const orderedOperations: EditWorkflowOperation[] = [
    ...deletes,
    ...extracts,
    ...adds,
    ...sortedInserts,
    ...edits,
  ]

  logger.info('Operations after reordering:', {
    totalOperations: orderedOperations.length,
    deleteCount: deletes.length,
    extractCount: extracts.length,
    addCount: adds.length,
    insertCount: sortedInserts.length,
    editCount: edits.length,
    operationOrder: orderedOperations.map(
      (op) =>
        `${op.operation_type}:${op.block_id}${op.params?.subflowId ? `(parent:${op.params.subflowId})` : ''}`
    ),
  })

  // Two-pass processing for add operations:
  // Pass 1: Create all blocks (without connections)
  // Pass 2: Add all connections (all blocks now exist)
  const addOperationsWithConnections: Array<{
    blockId: string
    connections: Record<string, any>
  }> = []

  for (const operation of orderedOperations) {
    const { operation_type, block_id, params } = operation

    // CRITICAL: Validate block_id is a valid string and not "undefined"
    // This prevents undefined keys from being set in the workflow state
    if (!isValidKey(block_id)) {
      logSkippedItem(skippedItems, {
        type: 'missing_required_params',
        operationType: operation_type,
        blockId: String(block_id || 'invalid'),
        reason: `Invalid block_id "${block_id}" (type: ${typeof block_id}) - operation skipped. Block IDs must be valid non-empty strings.`,
      })
      logger.error('Invalid block_id detected in operation', {
        operation_type,
        block_id,
        block_id_type: typeof block_id,
      })
      continue
    }

    logger.debug(`Executing operation: ${operation_type} for block ${block_id}`, {
      params: params ? Object.keys(params) : [],
      currentBlockCount: Object.keys(modifiedState.blocks).length,
    })

    switch (operation_type) {
      case 'delete': {
        if (!modifiedState.blocks[block_id]) {
          logSkippedItem(skippedItems, {
            type: 'block_not_found',
            operationType: 'delete',
            blockId: block_id,
            reason: `Block "${block_id}" does not exist and cannot be deleted`,
          })
          break
        }

        // Check if block is locked or inside a locked container
        const deleteBlock = modifiedState.blocks[block_id]
        const deleteParentId = deleteBlock.data?.parentId as string | undefined
        const deleteParentLocked = deleteParentId
          ? modifiedState.blocks[deleteParentId]?.locked
          : false
        if (deleteBlock.locked || deleteParentLocked) {
          logSkippedItem(skippedItems, {
            type: 'block_locked',
            operationType: 'delete',
            blockId: block_id,
            reason: deleteParentLocked
              ? `Block "${block_id}" is inside locked container "${deleteParentId}" and cannot be deleted`
              : `Block "${block_id}" is locked and cannot be deleted`,
          })
          break
        }

        // Find all child blocks to remove
        const blocksToRemove = new Set<string>([block_id])
        const findChildren = (parentId: string) => {
          Object.entries(modifiedState.blocks).forEach(([childId, child]: [string, any]) => {
            if (child.data?.parentId === parentId) {
              blocksToRemove.add(childId)
              findChildren(childId)
            }
          })
        }
        findChildren(block_id)

        // Remove blocks
        blocksToRemove.forEach((id) => delete modifiedState.blocks[id])

        // Remove edges connected to deleted blocks
        modifiedState.edges = modifiedState.edges.filter(
          (edge: any) => !blocksToRemove.has(edge.source) && !blocksToRemove.has(edge.target)
        )
        break
      }

      case 'edit': {
        if (!modifiedState.blocks[block_id]) {
          logSkippedItem(skippedItems, {
            type: 'block_not_found',
            operationType: 'edit',
            blockId: block_id,
            reason: `Block "${block_id}" does not exist and cannot be edited`,
          })
          break
        }

        const block = modifiedState.blocks[block_id]

        // Check if block is locked or inside a locked container
        const editParentId = block.data?.parentId as string | undefined
        const editParentLocked = editParentId ? modifiedState.blocks[editParentId]?.locked : false
        if (block.locked || editParentLocked) {
          logSkippedItem(skippedItems, {
            type: 'block_locked',
            operationType: 'edit',
            blockId: block_id,
            reason: editParentLocked
              ? `Block "${block_id}" is inside locked container "${editParentId}" and cannot be edited`
              : `Block "${block_id}" is locked and cannot be edited`,
          })
          break
        }

        // Ensure block has essential properties
        if (!block.type) {
          logger.warn(`Block ${block_id} missing type property, skipping edit`, {
            blockKeys: Object.keys(block),
            blockData: JSON.stringify(block),
          })
          logSkippedItem(skippedItems, {
            type: 'block_not_found',
            operationType: 'edit',
            blockId: block_id,
            reason: `Block "${block_id}" exists but has no type property`,
          })
          break
        }

        // Update inputs (convert to subBlocks format)
        if (params?.inputs) {
          if (!block.subBlocks) block.subBlocks = {}

          // Validate inputs against block configuration
          const validationResult = validateInputsForBlock(block.type, params.inputs, block_id)
          validationErrors.push(...validationResult.errors)

          Object.entries(validationResult.validInputs).forEach(([inputKey, value]) => {
            // Normalize common field name variations (LLM may use plural/singular inconsistently)
            let key = inputKey
            if (
              key === 'credentials' &&
              !block.subBlocks.credentials &&
              block.subBlocks.credential
            ) {
              key = 'credential'
            }

            if (TRIGGER_RUNTIME_SUBBLOCK_IDS.includes(key)) {
              return
            }
            let sanitizedValue = value

            // Normalize array subblocks with id fields (inputFormat, table rows, etc.)
            if (shouldNormalizeArrayIds(key)) {
              sanitizedValue = normalizeArrayWithIds(value)
            }

            // Special handling for tools - normalize and filter disallowed
            if (key === 'tools' && Array.isArray(value)) {
              sanitizedValue = filterDisallowedTools(
                normalizeTools(value),
                permissionConfig,
                block_id,
                skippedItems
              )
            }

            // Special handling for responseFormat - normalize to ensure consistent format
            if (key === 'responseFormat' && value) {
              sanitizedValue = normalizeResponseFormat(value)
            }

            if (!block.subBlocks[key]) {
              block.subBlocks[key] = {
                id: key,
                type: 'short-input',
                value: sanitizedValue,
              }
            } else {
              const existingValue = block.subBlocks[key].value
              const valuesEqual =
                typeof existingValue === 'object' || typeof sanitizedValue === 'object'
                  ? JSON.stringify(existingValue) === JSON.stringify(sanitizedValue)
                  : existingValue === sanitizedValue

              if (!valuesEqual) {
                block.subBlocks[key].value = sanitizedValue
              }
            }
          })

          if (
            Object.hasOwn(params.inputs, 'triggerConfig') &&
            block.subBlocks.triggerConfig &&
            typeof block.subBlocks.triggerConfig.value === 'object'
          ) {
            applyTriggerConfigToBlockSubblocks(block, block.subBlocks.triggerConfig.value)
          }

          // Update loop/parallel configuration in block.data (strict validation)
          if (block.type === 'loop') {
            block.data = block.data || {}
            // loopType is always valid
            if (params.inputs.loopType !== undefined) {
              const validLoopTypes = ['for', 'forEach', 'while', 'doWhile']
              if (validLoopTypes.includes(params.inputs.loopType)) {
                block.data.loopType = params.inputs.loopType
              }
            }
            const effectiveLoopType = params.inputs.loopType ?? block.data.loopType ?? 'for'
            // iterations only valid for 'for' loopType
            if (params.inputs.iterations !== undefined && effectiveLoopType === 'for') {
              block.data.count = params.inputs.iterations
            }
            // collection only valid for 'forEach' loopType
            if (params.inputs.collection !== undefined && effectiveLoopType === 'forEach') {
              block.data.collection = params.inputs.collection
            }
            // condition only valid for 'while' or 'doWhile' loopType
            if (
              params.inputs.condition !== undefined &&
              (effectiveLoopType === 'while' || effectiveLoopType === 'doWhile')
            ) {
              if (effectiveLoopType === 'doWhile') {
                block.data.doWhileCondition = params.inputs.condition
              } else {
                block.data.whileCondition = params.inputs.condition
              }
            }
          } else if (block.type === 'parallel') {
            block.data = block.data || {}
            // parallelType is always valid
            if (params.inputs.parallelType !== undefined) {
              const validParallelTypes = ['count', 'collection']
              if (validParallelTypes.includes(params.inputs.parallelType)) {
                block.data.parallelType = params.inputs.parallelType
              }
            }
            const effectiveParallelType =
              params.inputs.parallelType ?? block.data.parallelType ?? 'count'
            // count only valid for 'count' parallelType
            if (params.inputs.count !== undefined && effectiveParallelType === 'count') {
              block.data.count = params.inputs.count
            }
            // collection only valid for 'collection' parallelType
            if (params.inputs.collection !== undefined && effectiveParallelType === 'collection') {
              block.data.collection = params.inputs.collection
            }
          }

          const editBlockConfig = getBlock(block.type)
          if (editBlockConfig) {
            updateCanonicalModesForInputs(
              block,
              Object.keys(validationResult.validInputs),
              editBlockConfig
            )
          }
        }

        // Update basic properties
        if (params?.type !== undefined) {
          // Special container types (loop, parallel) are not in the block registry but are valid
          const isContainerType = params.type === 'loop' || params.type === 'parallel'

          // Validate type before setting (skip validation for container types)
          const blockConfig = getBlock(params.type)
          if (!blockConfig && !isContainerType) {
            logSkippedItem(skippedItems, {
              type: 'invalid_block_type',
              operationType: 'edit',
              blockId: block_id,
              reason: `Invalid block type "${params.type}" - type change skipped`,
              details: { requestedType: params.type },
            })
          } else if (!isContainerType && !isBlockTypeAllowed(params.type, permissionConfig)) {
            logSkippedItem(skippedItems, {
              type: 'block_not_allowed',
              operationType: 'edit',
              blockId: block_id,
              reason: `Block type "${params.type}" is not allowed by permission group - type change skipped`,
              details: { requestedType: params.type },
            })
          } else {
            block.type = params.type
          }
        }
        if (params?.name !== undefined) {
          const normalizedName = normalizeName(params.name)
          if (!normalizedName) {
            logSkippedItem(skippedItems, {
              type: 'missing_required_params',
              operationType: 'edit',
              blockId: block_id,
              reason: `Cannot rename to empty name`,
              details: { requestedName: params.name },
            })
          } else if ((RESERVED_BLOCK_NAMES as readonly string[]).includes(normalizedName)) {
            logSkippedItem(skippedItems, {
              type: 'reserved_block_name',
              operationType: 'edit',
              blockId: block_id,
              reason: `Cannot rename to "${params.name}" - this is a reserved name`,
              details: { requestedName: params.name },
            })
          } else {
            const conflictingBlock = findBlockWithDuplicateNormalizedName(
              modifiedState.blocks,
              params.name,
              block_id
            )

            if (conflictingBlock) {
              logSkippedItem(skippedItems, {
                type: 'duplicate_block_name',
                operationType: 'edit',
                blockId: block_id,
                reason: `Cannot rename to "${params.name}" - conflicts with "${conflictingBlock[1].name}"`,
                details: {
                  requestedName: params.name,
                  conflictingBlockId: conflictingBlock[0],
                  conflictingBlockName: conflictingBlock[1].name,
                },
              })
            } else {
              block.name = params.name
            }
          }
        }

        // Handle trigger mode toggle
        if (typeof params?.triggerMode === 'boolean') {
          block.triggerMode = params.triggerMode

          if (params.triggerMode === true) {
            // Remove all incoming edges when enabling trigger mode
            modifiedState.edges = modifiedState.edges.filter(
              (edge: any) => edge.target !== block_id
            )
          }
        }

        // Handle advanced mode toggle
        if (typeof params?.advancedMode === 'boolean') {
          block.advancedMode = params.advancedMode
        }

        // Handle nested nodes update (for loops/parallels)
        if (params?.nestedNodes) {
          // Remove all existing child blocks
          const existingChildren = Object.keys(modifiedState.blocks).filter(
            (id) => modifiedState.blocks[id].data?.parentId === block_id
          )
          existingChildren.forEach((childId) => delete modifiedState.blocks[childId])

          // Remove edges to/from removed children
          modifiedState.edges = modifiedState.edges.filter(
            (edge: any) =>
              !existingChildren.includes(edge.source) && !existingChildren.includes(edge.target)
          )

          // Add new nested blocks
          Object.entries(params.nestedNodes).forEach(([childId, childBlock]: [string, any]) => {
            // Validate childId is a valid string
            if (!isValidKey(childId)) {
              logSkippedItem(skippedItems, {
                type: 'missing_required_params',
                operationType: 'add_nested_node',
                blockId: String(childId || 'invalid'),
                reason: `Invalid childId "${childId}" in nestedNodes - child block skipped`,
              })
              logger.error('Invalid childId detected in nestedNodes', {
                parentBlockId: block_id,
                childId,
                childId_type: typeof childId,
              })
              return
            }

            if (childBlock.type === 'loop' || childBlock.type === 'parallel') {
              logSkippedItem(skippedItems, {
                type: 'nested_subflow_not_allowed',
                operationType: 'edit_nested_node',
                blockId: childId,
                reason: `Cannot nest ${childBlock.type} inside ${block.type} - nested subflows are not supported`,
                details: { parentType: block.type, childType: childBlock.type },
              })
              return
            }

            const childBlockState = createBlockFromParams(
              childId,
              childBlock,
              block_id,
              validationErrors,
              permissionConfig,
              skippedItems
            )
            modifiedState.blocks[childId] = childBlockState

            // Add connections for child block
            if (childBlock.connections) {
              addConnectionsAsEdges(
                modifiedState,
                childId,
                childBlock.connections,
                logger,
                skippedItems
              )
            }
          })

          // Update loop/parallel configuration based on type (strict validation)
          if (block.type === 'loop') {
            block.data = block.data || {}
            // loopType is always valid
            if (params.inputs?.loopType) {
              const validLoopTypes = ['for', 'forEach', 'while', 'doWhile']
              if (validLoopTypes.includes(params.inputs.loopType)) {
                block.data.loopType = params.inputs.loopType
              }
            }
            const effectiveLoopType = params.inputs?.loopType ?? block.data.loopType ?? 'for'
            // iterations only valid for 'for' loopType
            if (params.inputs?.iterations && effectiveLoopType === 'for') {
              block.data.count = params.inputs.iterations
            }
            // collection only valid for 'forEach' loopType
            if (params.inputs?.collection && effectiveLoopType === 'forEach') {
              block.data.collection = params.inputs.collection
            }
            // condition only valid for 'while' or 'doWhile' loopType
            if (
              params.inputs?.condition &&
              (effectiveLoopType === 'while' || effectiveLoopType === 'doWhile')
            ) {
              if (effectiveLoopType === 'doWhile') {
                block.data.doWhileCondition = params.inputs.condition
              } else {
                block.data.whileCondition = params.inputs.condition
              }
            }
          } else if (block.type === 'parallel') {
            block.data = block.data || {}
            // parallelType is always valid
            if (params.inputs?.parallelType) {
              const validParallelTypes = ['count', 'collection']
              if (validParallelTypes.includes(params.inputs.parallelType)) {
                block.data.parallelType = params.inputs.parallelType
              }
            }
            const effectiveParallelType =
              params.inputs?.parallelType ?? block.data.parallelType ?? 'count'
            // count only valid for 'count' parallelType
            if (params.inputs?.count && effectiveParallelType === 'count') {
              block.data.count = params.inputs.count
            }
            // collection only valid for 'collection' parallelType
            if (params.inputs?.collection && effectiveParallelType === 'collection') {
              block.data.collection = params.inputs.collection
            }
          }
        }

        // Handle connections update (convert to edges)
        if (params?.connections) {
          modifiedState.edges = modifiedState.edges.filter((edge: any) => edge.source !== block_id)

          Object.entries(params.connections).forEach(([connectionType, targets]) => {
            if (targets === null) return

            const mapConnectionTypeToHandle = (type: string): string => {
              if (type === 'success') return 'source'
              if (type === 'error') return 'error'
              return type
            }

            const sourceHandle = mapConnectionTypeToHandle(connectionType)

            const addEdgeForTarget = (targetBlock: string, targetHandle?: string) => {
              createValidatedEdge(
                modifiedState,
                block_id,
                targetBlock,
                sourceHandle,
                targetHandle || 'target',
                'edit',
                logger,
                skippedItems
              )
            }

            if (typeof targets === 'string') {
              addEdgeForTarget(targets)
            } else if (Array.isArray(targets)) {
              targets.forEach((target: any) => {
                if (typeof target === 'string') {
                  addEdgeForTarget(target)
                } else if (target?.block) {
                  addEdgeForTarget(target.block, target.handle)
                }
              })
            } else if (typeof targets === 'object' && (targets as any)?.block) {
              addEdgeForTarget((targets as any).block, (targets as any).handle)
            }
          })
        }

        // Handle edge removal
        if (params?.removeEdges && Array.isArray(params.removeEdges)) {
          params.removeEdges.forEach(({ targetBlockId, sourceHandle = 'source' }) => {
            modifiedState.edges = modifiedState.edges.filter(
              (edge: any) =>
                !(
                  edge.source === block_id &&
                  edge.target === targetBlockId &&
                  edge.sourceHandle === sourceHandle
                )
            )
          })
        }
        break
      }

      case 'add': {
        const addNormalizedName = params?.name ? normalizeName(params.name) : ''
        if (!params?.type || !params?.name || !addNormalizedName) {
          logSkippedItem(skippedItems, {
            type: 'missing_required_params',
            operationType: 'add',
            blockId: block_id,
            reason: `Missing required params (type or name) for adding block "${block_id}"`,
            details: { hasType: !!params?.type, hasName: !!params?.name },
          })
          break
        }

        if ((RESERVED_BLOCK_NAMES as readonly string[]).includes(addNormalizedName)) {
          logSkippedItem(skippedItems, {
            type: 'reserved_block_name',
            operationType: 'add',
            blockId: block_id,
            reason: `Block name "${params.name}" is a reserved name and cannot be used`,
            details: { requestedName: params.name },
          })
          break
        }

        const conflictingBlock = findBlockWithDuplicateNormalizedName(
          modifiedState.blocks,
          params.name,
          block_id
        )

        if (conflictingBlock) {
          logSkippedItem(skippedItems, {
            type: 'duplicate_block_name',
            operationType: 'add',
            blockId: block_id,
            reason: `Block name "${params.name}" conflicts with existing block "${conflictingBlock[1].name}"`,
            details: {
              requestedName: params.name,
              conflictingBlockId: conflictingBlock[0],
              conflictingBlockName: conflictingBlock[1].name,
            },
          })
          break
        }

        // Special container types (loop, parallel) are not in the block registry but are valid
        const isContainerType = params.type === 'loop' || params.type === 'parallel'

        // Validate block type before adding (skip validation for container types)
        const addBlockConfig = getBlock(params.type)
        if (!addBlockConfig && !isContainerType) {
          logSkippedItem(skippedItems, {
            type: 'invalid_block_type',
            operationType: 'add',
            blockId: block_id,
            reason: `Invalid block type "${params.type}" - block not added`,
            details: { requestedType: params.type },
          })
          break
        }

        // Check if block type is allowed by permission group
        if (!isContainerType && !isBlockTypeAllowed(params.type, permissionConfig)) {
          logSkippedItem(skippedItems, {
            type: 'block_not_allowed',
            operationType: 'add',
            blockId: block_id,
            reason: `Block type "${params.type}" is not allowed by permission group - block not added`,
            details: { requestedType: params.type },
          })
          break
        }

        const triggerIssue = TriggerUtils.getTriggerAdditionIssue(modifiedState.blocks, params.type)
        if (triggerIssue) {
          logSkippedItem(skippedItems, {
            type: 'duplicate_trigger',
            operationType: 'add',
            blockId: block_id,
            reason: `Cannot add ${triggerIssue.triggerName} - a workflow can only have one`,
            details: { requestedType: params.type, issue: triggerIssue.issue },
          })
          break
        }

        // Check single-instance block constraints (e.g., Response block)
        const singleInstanceIssue = TriggerUtils.getSingleInstanceBlockIssue(
          modifiedState.blocks,
          params.type
        )
        if (singleInstanceIssue) {
          logSkippedItem(skippedItems, {
            type: 'duplicate_single_instance_block',
            operationType: 'add',
            blockId: block_id,
            reason: `Cannot add ${singleInstanceIssue.blockName} - a workflow can only have one`,
            details: { requestedType: params.type },
          })
          break
        }

        // Create new block with proper structure
        const newBlock = createBlockFromParams(
          block_id,
          params,
          undefined,
          validationErrors,
          permissionConfig,
          skippedItems
        )

        // Set loop/parallel data on parent block BEFORE adding to blocks (strict validation)
        if (params.nestedNodes) {
          if (params.type === 'loop') {
            const validLoopTypes = ['for', 'forEach', 'while', 'doWhile']
            const loopType =
              params.inputs?.loopType && validLoopTypes.includes(params.inputs.loopType)
                ? params.inputs.loopType
                : 'for'
            newBlock.data = {
              ...newBlock.data,
              loopType,
              // Only include type-appropriate fields
              ...(loopType === 'forEach' &&
                params.inputs?.collection && { collection: params.inputs.collection }),
              ...(loopType === 'for' &&
                params.inputs?.iterations && { count: params.inputs.iterations }),
              ...(loopType === 'while' &&
                params.inputs?.condition && { whileCondition: params.inputs.condition }),
              ...(loopType === 'doWhile' &&
                params.inputs?.condition && { doWhileCondition: params.inputs.condition }),
            }
          } else if (params.type === 'parallel') {
            const validParallelTypes = ['count', 'collection']
            const parallelType =
              params.inputs?.parallelType && validParallelTypes.includes(params.inputs.parallelType)
                ? params.inputs.parallelType
                : 'count'
            newBlock.data = {
              ...newBlock.data,
              parallelType,
              // Only include type-appropriate fields
              ...(parallelType === 'collection' &&
                params.inputs?.collection && { collection: params.inputs.collection }),
              ...(parallelType === 'count' &&
                params.inputs?.count && { count: params.inputs.count }),
            }
          }
        }

        // Add parent block FIRST before adding children
        // This ensures children can reference valid parentId
        modifiedState.blocks[block_id] = newBlock

        // Handle nested nodes (for loops/parallels created from scratch)
        if (params.nestedNodes) {
          // Defensive check: verify parent is not locked before adding children
          // (Parent was just created with locked: false, but check for consistency)
          const parentBlock = modifiedState.blocks[block_id]
          if (parentBlock?.locked) {
            logSkippedItem(skippedItems, {
              type: 'block_locked',
              operationType: 'add_nested_nodes',
              blockId: block_id,
              reason: `Container "${block_id}" is locked - cannot add nested nodes`,
            })
            break
          }

          Object.entries(params.nestedNodes).forEach(([childId, childBlock]: [string, any]) => {
            // Validate childId is a valid string
            if (!isValidKey(childId)) {
              logSkippedItem(skippedItems, {
                type: 'missing_required_params',
                operationType: 'add_nested_node',
                blockId: String(childId || 'invalid'),
                reason: `Invalid childId "${childId}" in nestedNodes - child block skipped`,
              })
              logger.error('Invalid childId detected in nestedNodes', {
                parentBlockId: block_id,
                childId,
                childId_type: typeof childId,
              })
              return
            }

            if (childBlock.type === 'loop' || childBlock.type === 'parallel') {
              logSkippedItem(skippedItems, {
                type: 'nested_subflow_not_allowed',
                operationType: 'add_nested_node',
                blockId: childId,
                reason: `Cannot nest ${childBlock.type} inside ${params.type} - nested subflows are not supported`,
                details: { parentType: params.type, childType: childBlock.type },
              })
              return
            }

            const childBlockState = createBlockFromParams(
              childId,
              childBlock,
              block_id,
              validationErrors,
              permissionConfig,
              skippedItems
            )
            modifiedState.blocks[childId] = childBlockState

            // Defer connection processing to ensure all blocks exist first
            if (childBlock.connections) {
              addOperationsWithConnections.push({
                blockId: childId,
                connections: childBlock.connections,
              })
            }
          })
        }

        // Defer connection processing to ensure all blocks exist first (pass 2)
        if (params.connections) {
          addOperationsWithConnections.push({
            blockId: block_id,
            connections: params.connections,
          })
        }
        break
      }

      case 'insert_into_subflow': {
        const subflowId = params?.subflowId
        if (!subflowId || !params?.type || !params?.name) {
          logSkippedItem(skippedItems, {
            type: 'missing_required_params',
            operationType: 'insert_into_subflow',
            blockId: block_id,
            reason: `Missing required params (subflowId, type, or name) for inserting block "${block_id}"`,
            details: {
              hasSubflowId: !!subflowId,
              hasType: !!params?.type,
              hasName: !!params?.name,
            },
          })
          break
        }

        const subflowBlock = modifiedState.blocks[subflowId]
        if (!subflowBlock) {
          logSkippedItem(skippedItems, {
            type: 'invalid_subflow_parent',
            operationType: 'insert_into_subflow',
            blockId: block_id,
            reason: `Subflow block "${subflowId}" not found - block "${block_id}" not inserted`,
            details: { subflowId },
          })
          break
        }

        // Check if subflow is locked
        if (subflowBlock.locked) {
          logSkippedItem(skippedItems, {
            type: 'block_locked',
            operationType: 'insert_into_subflow',
            blockId: block_id,
            reason: `Subflow "${subflowId}" is locked - cannot insert block "${block_id}"`,
            details: { subflowId },
          })
          break
        }

        if (subflowBlock.type !== 'loop' && subflowBlock.type !== 'parallel') {
          logger.error('Subflow block has invalid type', {
            subflowId,
            type: subflowBlock.type,
            block_id,
          })
          break
        }

        if (params.type === 'loop' || params.type === 'parallel') {
          logSkippedItem(skippedItems, {
            type: 'nested_subflow_not_allowed',
            operationType: 'insert_into_subflow',
            blockId: block_id,
            reason: `Cannot nest ${params.type} inside ${subflowBlock.type} - nested subflows are not supported`,
            details: { parentType: subflowBlock.type, childType: params.type },
          })
          break
        }

        // Get block configuration
        const blockConfig = getAllBlocks().find((block) => block.type === params.type)

        // Check if block already exists (moving into subflow) or is new
        const existingBlock = modifiedState.blocks[block_id]

        if (existingBlock) {
          if (existingBlock.type === 'loop' || existingBlock.type === 'parallel') {
            logSkippedItem(skippedItems, {
              type: 'nested_subflow_not_allowed',
              operationType: 'insert_into_subflow',
              blockId: block_id,
              reason: `Cannot move ${existingBlock.type} into ${subflowBlock.type} - nested subflows are not supported`,
              details: { parentType: subflowBlock.type, childType: existingBlock.type },
            })
            break
          }

          // Check if existing block is locked
          if (existingBlock.locked) {
            logSkippedItem(skippedItems, {
              type: 'block_locked',
              operationType: 'insert_into_subflow',
              blockId: block_id,
              reason: `Block "${block_id}" is locked and cannot be moved into a subflow`,
            })
            break
          }

          // Moving existing block into subflow - just update parent
          existingBlock.data = {
            ...existingBlock.data,
            parentId: subflowId,
            extent: 'parent' as const,
          }

          // Update inputs if provided (with validation)
          if (params.inputs) {
            // Validate inputs against block configuration
            const validationResult = validateInputsForBlock(
              existingBlock.type,
              params.inputs,
              block_id
            )
            validationErrors.push(...validationResult.errors)

            Object.entries(validationResult.validInputs).forEach(([key, value]) => {
              // Skip runtime subblock IDs (webhookId, triggerPath)
              if (TRIGGER_RUNTIME_SUBBLOCK_IDS.includes(key)) {
                return
              }

              let sanitizedValue = value

              // Normalize array subblocks with id fields (inputFormat, table rows, etc.)
              if (shouldNormalizeArrayIds(key)) {
                sanitizedValue = normalizeArrayWithIds(value)
              }

              // Special handling for tools - normalize and filter disallowed
              if (key === 'tools' && Array.isArray(value)) {
                sanitizedValue = filterDisallowedTools(
                  normalizeTools(value),
                  permissionConfig,
                  block_id,
                  skippedItems
                )
              }

              // Special handling for responseFormat - normalize to ensure consistent format
              if (key === 'responseFormat' && value) {
                sanitizedValue = normalizeResponseFormat(value)
              }

              if (!existingBlock.subBlocks[key]) {
                existingBlock.subBlocks[key] = {
                  id: key,
                  type: 'short-input',
                  value: sanitizedValue,
                }
              } else {
                existingBlock.subBlocks[key].value = sanitizedValue
              }
            })

            const existingBlockConfig = getBlock(existingBlock.type)
            if (existingBlockConfig) {
              updateCanonicalModesForInputs(
                existingBlock,
                Object.keys(validationResult.validInputs),
                existingBlockConfig
              )
            }
          }
        } else {
          // Special container types (loop, parallel) are not in the block registry but are valid
          const isContainerType = params.type === 'loop' || params.type === 'parallel'

          // Validate block type before creating (skip validation for container types)
          const insertBlockConfig = getBlock(params.type)
          if (!insertBlockConfig && !isContainerType) {
            logSkippedItem(skippedItems, {
              type: 'invalid_block_type',
              operationType: 'insert_into_subflow',
              blockId: block_id,
              reason: `Invalid block type "${params.type}" - block not inserted into subflow`,
              details: { requestedType: params.type, subflowId },
            })
            break
          }

          // Check if block type is allowed by permission group
          if (!isContainerType && !isBlockTypeAllowed(params.type, permissionConfig)) {
            logSkippedItem(skippedItems, {
              type: 'block_not_allowed',
              operationType: 'insert_into_subflow',
              blockId: block_id,
              reason: `Block type "${params.type}" is not allowed by permission group - block not inserted`,
              details: { requestedType: params.type, subflowId },
            })
            break
          }

          // Create new block as child of subflow
          const newBlock = createBlockFromParams(
            block_id,
            params,
            subflowId,
            validationErrors,
            permissionConfig,
            skippedItems
          )
          modifiedState.blocks[block_id] = newBlock
        }

        // Defer connection processing to ensure all blocks exist first
        // This is particularly important when multiple blocks are being inserted
        // and they have connections to each other
        if (params.connections) {
          // Remove existing edges from this block first
          modifiedState.edges = modifiedState.edges.filter((edge: any) => edge.source !== block_id)

          // Add to deferred connections list
          addOperationsWithConnections.push({
            blockId: block_id,
            connections: params.connections,
          })
        }
        break
      }

      case 'extract_from_subflow': {
        const subflowId = params?.subflowId
        if (!subflowId) {
          logSkippedItem(skippedItems, {
            type: 'missing_required_params',
            operationType: 'extract_from_subflow',
            blockId: block_id,
            reason: `Missing subflowId for extracting block "${block_id}"`,
          })
          break
        }

        const block = modifiedState.blocks[block_id]
        if (!block) {
          logSkippedItem(skippedItems, {
            type: 'block_not_found',
            operationType: 'extract_from_subflow',
            blockId: block_id,
            reason: `Block "${block_id}" not found for extraction`,
          })
          break
        }

        // Check if block is locked
        if (block.locked) {
          logSkippedItem(skippedItems, {
            type: 'block_locked',
            operationType: 'extract_from_subflow',
            blockId: block_id,
            reason: `Block "${block_id}" is locked and cannot be extracted from subflow`,
          })
          break
        }

        // Check if parent subflow is locked
        const parentSubflow = modifiedState.blocks[subflowId]
        if (parentSubflow?.locked) {
          logSkippedItem(skippedItems, {
            type: 'block_locked',
            operationType: 'extract_from_subflow',
            blockId: block_id,
            reason: `Subflow "${subflowId}" is locked - cannot extract block "${block_id}"`,
            details: { subflowId },
          })
          break
        }

        // Verify it's actually a child of this subflow
        if (block.data?.parentId !== subflowId) {
          logger.warn('Block is not a child of specified subflow', {
            block_id,
            actualParent: block.data?.parentId,
            specifiedParent: subflowId,
          })
        }

        // Remove parent relationship
        if (block.data) {
          block.data.parentId = undefined
          block.data.extent = undefined
        }

        // Note: We keep the block and its edges, just remove parent relationship
        // The block becomes a root-level block
        break
      }
    }
  }

  // Pass 2: Add all deferred connections from add/insert operations
  // Now all blocks exist (from add, insert, and edit operations), so connections can be safely created
  // This ensures that if block A connects to block B, and both are being added/inserted,
  // B will exist when we create the edge from A to B
  if (addOperationsWithConnections.length > 0) {
    logger.info('Processing deferred connections from add/insert operations', {
      deferredConnectionCount: addOperationsWithConnections.length,
      totalBlocks: Object.keys(modifiedState.blocks).length,
    })

    for (const { blockId, connections } of addOperationsWithConnections) {
      // Verify the source block still exists (it might have been deleted by a later operation)
      if (!modifiedState.blocks[blockId]) {
        logger.warn('Source block no longer exists for deferred connection', {
          blockId,
          availableBlocks: Object.keys(modifiedState.blocks),
        })
        continue
      }

      addConnectionsAsEdges(modifiedState, blockId, connections, logger, skippedItems)
    }

    logger.info('Finished processing deferred connections', {
      totalEdges: modifiedState.edges.length,
    })
  }

  // Regenerate loops and parallels after modifications
  modifiedState.loops = generateLoopBlocks(modifiedState.blocks)
  modifiedState.parallels = generateParallelBlocks(modifiedState.blocks)

  // Validate all blocks have types before returning
  const blocksWithoutType = Object.entries(modifiedState.blocks)
    .filter(([_, block]: [string, any]) => !block.type || block.type === undefined)
    .map(([id, block]: [string, any]) => ({ id, block }))

  if (blocksWithoutType.length > 0) {
    logger.error('Blocks without type after operations:', {
      blocksWithoutType: blocksWithoutType.map(({ id, block }) => ({
        id,
        type: block.type,
        name: block.name,
        keys: Object.keys(block),
      })),
    })

    // Attempt to fix by removing type-less blocks
    blocksWithoutType.forEach(({ id }) => {
      delete modifiedState.blocks[id]
    })

    // Remove edges connected to removed blocks
    const removedIds = new Set(blocksWithoutType.map(({ id }) => id))
    modifiedState.edges = modifiedState.edges.filter(
      (edge: any) => !removedIds.has(edge.source) && !removedIds.has(edge.target)
    )
  }

  return { state: modifiedState, validationErrors, skippedItems }
}

/**
 * Validates selector IDs in the workflow state exist in the database
 * Returns validation errors for any invalid selector IDs
 */
async function validateWorkflowSelectorIds(
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
async function preValidateCredentialInputs(
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

async function getCurrentWorkflowStateFromDb(
  workflowId: string
): Promise<{ workflowState: any; subBlockValues: Record<string, Record<string, any>> }> {
  const logger = createLogger('EditWorkflowServerTool')
  const [workflowRecord] = await db
    .select()
    .from(workflowTable)
    .where(eq(workflowTable.id, workflowId))
    .limit(1)
  if (!workflowRecord) throw new Error(`Workflow ${workflowId} not found in database`)
  const normalized = await loadWorkflowFromNormalizedTables(workflowId)
  if (!normalized) throw new Error('Workflow has no normalized data')

  // Validate and fix blocks without types
  const blocks = { ...normalized.blocks }
  const invalidBlocks: string[] = []

  Object.entries(blocks).forEach(([id, block]: [string, any]) => {
    if (!block.type) {
      logger.warn(`Block ${id} loaded without type from database`, {
        blockKeys: Object.keys(block),
        blockName: block.name,
      })
      invalidBlocks.push(id)
    }
  })

  // Remove invalid blocks
  invalidBlocks.forEach((id) => delete blocks[id])

  // Remove edges connected to invalid blocks
  const edges = normalized.edges.filter(
    (edge: any) => !invalidBlocks.includes(edge.source) && !invalidBlocks.includes(edge.target)
  )

  const workflowState: any = {
    blocks,
    edges,
    loops: normalized.loops || {},
    parallels: normalized.parallels || {},
  }
  const subBlockValues: Record<string, Record<string, any>> = {}
  Object.entries(normalized.blocks).forEach(([blockId, block]) => {
    subBlockValues[blockId] = {}
    Object.entries((block as any).subBlocks || {}).forEach(([subId, sub]) => {
      if ((sub as any).value !== undefined) subBlockValues[blockId][subId] = (sub as any).value
    })
  })
  return { workflowState, subBlockValues }
}

export const editWorkflowServerTool: BaseServerTool<EditWorkflowParams, any> = {
  name: 'edit_workflow',
  async execute(params: EditWorkflowParams, context?: { userId: string }): Promise<any> {
    const logger = createLogger('EditWorkflowServerTool')
    const { operations, workflowId, currentUserWorkflow } = params
    if (!Array.isArray(operations) || operations.length === 0) {
      throw new Error('operations are required and must be an array')
    }
    if (!workflowId) throw new Error('workflowId is required')

    logger.info('Executing edit_workflow', {
      operationCount: operations.length,
      workflowId,
      hasCurrentUserWorkflow: !!currentUserWorkflow,
    })

    // Get current workflow state
    let workflowState: any
    if (currentUserWorkflow) {
      try {
        workflowState = JSON.parse(currentUserWorkflow)
      } catch (error) {
        logger.error('Failed to parse currentUserWorkflow', error)
        throw new Error('Invalid currentUserWorkflow format')
      }
    } else {
      const fromDb = await getCurrentWorkflowStateFromDb(workflowId)
      workflowState = fromDb.workflowState
    }

    // Get permission config for the user
    const permissionConfig = context?.userId ? await getUserPermissionConfig(context.userId) : null

    // Pre-validate credential and apiKey inputs before applying operations
    // This filters out invalid credentials and apiKeys for hosted models
    let operationsToApply = operations
    const credentialErrors: ValidationError[] = []
    if (context?.userId) {
      const { filteredOperations, errors: credErrors } = await preValidateCredentialInputs(
        operations,
        { userId: context.userId },
        workflowState
      )
      operationsToApply = filteredOperations
      credentialErrors.push(...credErrors)
    }

    // Apply operations directly to the workflow state
    const {
      state: modifiedWorkflowState,
      validationErrors,
      skippedItems,
    } = applyOperationsToWorkflowState(workflowState, operationsToApply, permissionConfig)

    // Add credential validation errors
    validationErrors.push(...credentialErrors)

    // Get workspaceId for selector validation
    let workspaceId: string | undefined
    try {
      const [workflowRecord] = await db
        .select({ workspaceId: workflowTable.workspaceId })
        .from(workflowTable)
        .where(eq(workflowTable.id, workflowId))
        .limit(1)
      workspaceId = workflowRecord?.workspaceId ?? undefined
    } catch (error) {
      logger.warn('Failed to get workspaceId for selector validation', { error, workflowId })
    }

    // Validate selector IDs exist in the database
    if (context?.userId) {
      try {
        const selectorErrors = await validateWorkflowSelectorIds(modifiedWorkflowState, {
          userId: context.userId,
          workspaceId,
        })
        validationErrors.push(...selectorErrors)
      } catch (error) {
        logger.warn('Selector ID validation failed', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    // Validate the workflow state
    const validation = validateWorkflowState(modifiedWorkflowState, { sanitize: true })

    if (!validation.valid) {
      logger.error('Edited workflow state is invalid', {
        errors: validation.errors,
        warnings: validation.warnings,
      })
      throw new Error(`Invalid edited workflow: ${validation.errors.join('; ')}`)
    }

    if (validation.warnings.length > 0) {
      logger.warn('Edited workflow validation warnings', {
        warnings: validation.warnings,
      })
    }

    // Extract and persist custom tools to database (reuse workspaceId from selector validation)
    if (context?.userId && workspaceId) {
      try {
        const finalWorkflowState = validation.sanitizedState || modifiedWorkflowState
        const { saved, errors } = await extractAndPersistCustomTools(
          finalWorkflowState,
          workspaceId,
          context.userId
        )

        if (saved > 0) {
          logger.info(`Persisted ${saved} custom tool(s) to database`, { workflowId })
        }

        if (errors.length > 0) {
          logger.warn('Some custom tools failed to persist', { errors, workflowId })
        }
      } catch (error) {
        logger.error('Failed to persist custom tools', { error, workflowId })
      }
    } else if (context?.userId && !workspaceId) {
      logger.warn('Workflow has no workspaceId, skipping custom tools persistence', {
        workflowId,
      })
    } else {
      logger.warn('No userId in context - skipping custom tools persistence', { workflowId })
    }

    logger.info('edit_workflow successfully applied operations', {
      operationCount: operations.length,
      blocksCount: Object.keys(modifiedWorkflowState.blocks).length,
      edgesCount: modifiedWorkflowState.edges.length,
      inputValidationErrors: validationErrors.length,
      skippedItemsCount: skippedItems.length,
      schemaValidationErrors: validation.errors.length,
      validationWarnings: validation.warnings.length,
    })

    // Format validation errors for LLM feedback
    const inputErrors =
      validationErrors.length > 0
        ? validationErrors.map((e) => `Block "${e.blockId}" (${e.blockType}): ${e.error}`)
        : undefined

    // Format skipped items for LLM feedback
    const skippedMessages =
      skippedItems.length > 0 ? skippedItems.map((item) => item.reason) : undefined

    // Return the modified workflow state for the client to convert to YAML if needed
    return {
      success: true,
      workflowState: validation.sanitizedState || modifiedWorkflowState,
      // Include input validation errors so the LLM can see what was rejected
      ...(inputErrors && {
        inputValidationErrors: inputErrors,
        inputValidationMessage: `${inputErrors.length} input(s) were rejected due to validation errors. The workflow was still updated with valid inputs only. Errors: ${inputErrors.join('; ')}`,
      }),
      // Include skipped items so the LLM can see what operations were skipped
      ...(skippedMessages && {
        skippedItems: skippedMessages,
        skippedItemsMessage: `${skippedItems.length} operation(s) were skipped due to invalid references. Details: ${skippedMessages.join('; ')}`,
      }),
    }
  },
}
