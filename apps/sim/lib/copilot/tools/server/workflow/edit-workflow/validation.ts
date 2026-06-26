import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { validateSelectorIds } from '@/lib/copilot/validation/selector-validator'
import { isBlockTypeAccessControlExempt } from '@/lib/permission-groups/block-access'
import type { PermissionGroupConfig } from '@/lib/permission-groups/types'
import { getCustomToolById } from '@/lib/workflows/custom-tools/operations'
import { getSkillById } from '@/lib/workflows/skills/operations'
import {
  buildCanonicalIndex,
  buildSubBlockValues,
  isCanonicalPair,
  resolveCanonicalMode,
} from '@/lib/workflows/subblocks/visibility'
import { getBlock } from '@/blocks/registry'
import type { SubBlockConfig } from '@/blocks/types'
import { getModelOptions } from '@/blocks/utils'
import { EDGE, normalizeName } from '@/executor/constants'
import { isKnownModelId, suggestModelIdsForUnknownModel } from '@/providers/models'
import { getTool } from '@/tools/utils'
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
const agentToolLintLogger = createLogger('EditWorkflowAgentToolLint')

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

/** Tool-entry `type` values that are valid but are not registry block types. */
const KNOWN_NON_BLOCK_TOOL_TYPES = new Set(['custom-tool', 'mcp', 'workflow'])

/**
 * Validates a single entry in an agent block's `tools` (tool-input) array and
 * returns a human-readable error string for LLM feedback, or null when valid.
 *
 * Targets the shapes that silently fail to attach (the entry is stored but the
 * wrench icon never renders and/or the runtime drops the tool so the agent never
 * sees it): a custom tool missing `type: 'custom-tool'`, a custom tool with
 * neither `customToolId` nor an inline `schema.function`, an MCP tool missing
 * its `params.serverId`/`params.toolName`, a raw OpenAI function schema pasted
 * into the array, and unrecognized tool types.
 */
function validateAgentToolEntry(item: any, index: number): string | null {
  const where = `tools[${index}]`
  if (item === null || typeof item !== 'object' || Array.isArray(item)) {
    return `${where} must be a tool object`
  }

  const type = item.type

  // Raw OpenAI function schema pasted directly into the array (common mistake).
  // Keyed on type === 'function' (OpenAI's exact discriminator) so a real
  // integration tool that happens to carry a `function` property is not
  // misreported here - it falls through to the block-type check below.
  if (
    type === 'function' &&
    item.function &&
    typeof item.function === 'object' &&
    typeof item.function.name === 'string'
  ) {
    return `${where} looks like a raw function schema. A custom tool must be {"type":"custom-tool","customToolId":"<id>"} (preferred) or {"type":"custom-tool","schema":{"type":"function","function":{...}},"code":"..."}`
  }

  if (typeof type !== 'string' || type.trim() === '') {
    return `${where} is missing a string "type". Custom tools require "type":"custom-tool" (without it the tool will not attach or show its icon); use "mcp" for MCP tools or an integration block type (e.g. "exa") otherwise`
  }

  if (type === 'custom-tool') {
    const hasReference = typeof item.customToolId === 'string' && item.customToolId.trim() !== ''
    const fn = item.schema?.function
    const hasInlineSchema =
      !!fn &&
      typeof fn.name === 'string' &&
      fn.name.trim() !== '' &&
      !!fn.parameters &&
      typeof fn.parameters === 'object'
    if (!hasReference && !hasInlineSchema) {
      return `${where} (custom-tool) must include "customToolId" (the "id" from agent/custom-tools/{name}.json - not the filename, not schema.function.name) or an inline "schema.function" with "name" and "parameters"`
    }
    return null
  }

  if (type === 'mcp') {
    const serverId = item.params?.serverId
    const toolName = item.params?.toolName
    const ok =
      typeof serverId === 'string' &&
      serverId.trim() !== '' &&
      typeof toolName === 'string' &&
      toolName.trim() !== ''
    if (!ok) {
      return `${where} (mcp) must include params.serverId and params.toolName`
    }
    return null
  }

  // Integration/block-based tool: the type must be a real registry block that
  // actually exposes callable tools. A known block with an empty tools.access
  // (control-flow blocks like condition/loop/parallel/router, or the agent block
  // itself) can't attach as an agent tool, so the addition would not apply
  // correctly even though the type "exists".
  if (!KNOWN_NON_BLOCK_TOOL_TYPES.has(type)) {
    const block = getBlock(type)
    if (!block) {
      return `${where} has unrecognized tool type "${type}". Use "custom-tool" for custom tools, "mcp" for MCP tools, or a valid integration block type`
    }
    if (!Array.isArray(block.tools?.access) || block.tools.access.length === 0) {
      return `${where} block type "${type}" cannot be attached as an agent tool (it exposes no callable tools)`
    }
  }

  return null
}

/**
 * Validates a single entry in an agent block's `skills` (skill-input) array.
 * Skills are a SEPARATE array from tools; each entry references a workspace or
 * builtin skill by `skillId`. Returns an error string or null when valid.
 */
function validateAgentSkillEntry(item: any, index: number): string | null {
  const where = `skills[${index}]`
  if (item === null || typeof item !== 'object' || Array.isArray(item)) {
    return `${where} must be a skill object like {"skillId":"<id>","name":"<name>"}`
  }
  if (typeof item.skillId !== 'string' || item.skillId.trim() === '') {
    if (typeof item.id === 'string') {
      return `${where} uses "id" but skills require "skillId" (the "id" from agent/skills/{name}.json)`
    }
    if (typeof item.type === 'string' || item.schema || item.customToolId) {
      return `${where} looks like a tool entry. Skills go in the SEPARATE "skills" array and need only {"skillId":"<id>"} - no "type"/"schema"/"customToolId"`
    }
    return `${where} must include "skillId" (the "id" from agent/skills/{name}.json)`
  }
  return null
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

    case 'condition-input':
    case 'router-input': {
      const parsedValue =
        typeof value === 'string'
          ? (() => {
              try {
                return JSON.parse(value)
              } catch {
                return null
              }
            })()
          : value

      if (!Array.isArray(parsedValue)) {
        return {
          valid: false,
          error: {
            blockId,
            blockType,
            field: fieldName,
            value,
            error: `Invalid ${type} value for field "${fieldName}" - expected a JSON array`,
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
      const toolErrors = value
        .map((item, index) => validateAgentToolEntry(item, index))
        .filter((err): err is string => err !== null)
      if (toolErrors.length > 0) {
        return {
          valid: false,
          error: {
            blockId,
            blockType,
            field: fieldName,
            value,
            error: `Invalid tool ${toolErrors.length === 1 ? 'entry' : 'entries'} in "${fieldName}": ${toolErrors.join('; ')}`,
          },
        }
      }
      return { valid: true, value }
    }

    case 'skill-input': {
      // Should be an array of skill reference objects ({ skillId, name? })
      if (!Array.isArray(value)) {
        return {
          valid: false,
          error: {
            blockId,
            blockType,
            field: fieldName,
            value,
            error: `Invalid skill-input value for field "${fieldName}" - expected an array of skill objects`,
          },
        }
      }
      const skillErrors = value
        .map((item, index) => validateAgentSkillEntry(item, index))
        .filter((err): err is string => err !== null)
      if (skillErrors.length > 0) {
        return {
          valid: false,
          error: {
            blockId,
            blockType,
            field: fieldName,
            value,
            error: `Invalid skill ${skillErrors.length === 1 ? 'entry' : 'entries'} in "${fieldName}": ${skillErrors.join('; ')}`,
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
      const usesProviderCatalog =
        fieldName === 'model' && subBlockConfig.options === getModelOptions

      if (usesProviderCatalog) {
        const stringValue = typeof value === 'string' ? value : String(value)
        const trimmed = stringValue.trim()
        if (trimmed !== '' && !isKnownModelId(trimmed)) {
          const suggestions = suggestModelIdsForUnknownModel(trimmed)
          const suggestionText =
            suggestions.length > 0 ? ` Valid options include: ${suggestions.join(', ')}.` : ''
          return {
            valid: false,
            error: {
              blockId,
              blockType,
              field: fieldName,
              value,
              error: `Unknown model id "${trimmed}" for block "${blockType}". Read components/blocks/${blockType}.json (the model.options array) for valid ids; prefer entries with recommended: true and avoid deprecated: true. For user-configured models (Ollama, Ollama Cloud, vLLM, LiteLLM, OpenRouter, Fireworks, Together AI, Baseten), prefix the id with the provider slash, e.g. "ollama/llama3.1:8b" or "ollama-cloud/gpt-oss:120b".${suggestionText}`,
            },
          }
        }
        return { valid: true, value: trimmed }
      }

      if (typeof value !== 'string' && typeof value !== 'number') {
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
  if (isBlockTypeAccessControlExempt(blockType)) {
    return true
  }
  if (!permissionConfig || permissionConfig.allowedIntegrations === null) {
    return true
  }
  return permissionConfig.allowedIntegrations.includes(blockType.toLowerCase())
}

/**
 * A credential/resource reference whose value does not resolve to an accessible
 * workspace entity (the "set in basic mode but the dropdown shows nothing" case).
 * Structurally compatible with the copilot WorkflowLintUnresolvedReference.
 */
export interface UnresolvedSelectorReference {
  blockId: string
  blockName?: string
  blockType?: string
  field: string
  value: string | string[]
  kind: 'credential' | 'resource' | 'custom-tool' | 'mcp-tool' | 'skill'
  reason: string
}

/**
 * External selector IDs (Slack channels, Drive files, Jira projects, folders,
 * MCP tools) are validated only at run time, so a clean Tier-2 result is not
 * proof those references resolve. Surface this in the lint output.
 */
export const UNRESOLVABLE_AT_LINT_NOTE =
  'Credential/resource resolution covers oauth credentials, knowledge bases, documents, workflows, and MCP servers. External selector IDs (Slack channels, Drive files, Jira projects, folders, MCP tools) are validated only at run time.'

interface SelectorFieldToValidate {
  blockId: string
  blockType: string
  blockName?: string
  fieldName: string
  selectorType: string
  value: string | string[]
}

/**
 * Walk a workflow state and collect selector/credential fields to validate.
 * For canonical pairs only the ACTIVE member is collected (an intentionally-empty
 * inactive member is never flagged). oauth-input credentials are included only
 * when `options.includeCredentials` is set.
 */
function collectSelectorFields(
  workflowState: any,
  options: { includeCredentials?: boolean } = {}
): SelectorFieldToValidate[] {
  const fields: SelectorFieldToValidate[] = []

  for (const [blockId, block] of Object.entries(workflowState.blocks || {})) {
    const blockData = block as any
    const blockType = blockData.type
    if (!blockType) continue

    const blockConfig = getBlock(blockType)
    if (!blockConfig) continue

    const canonicalIndex = buildCanonicalIndex(blockConfig.subBlocks)
    const allValues = buildSubBlockValues(blockData.subBlocks || {})
    const canonicalModeOverrides = blockData.data?.canonicalModes

    for (const subBlockConfig of blockConfig.subBlocks) {
      if (!SELECTOR_TYPES.has(subBlockConfig.type)) continue

      // oauth-input credentials are only validated when explicitly requested
      // (the edit path pre-validates them separately; the lint opts in).
      if (subBlockConfig.type === 'oauth-input' && !options.includeCredentials) continue

      // For canonical pairs, only validate the active member's value so an
      // intentionally-empty inactive member is never flagged.
      const canonicalId = canonicalIndex.canonicalIdBySubBlockId[subBlockConfig.id]
      const group = canonicalId ? canonicalIndex.groupsById[canonicalId] : undefined
      if (group && isCanonicalPair(group)) {
        const mode = resolveCanonicalMode(group, allValues, canonicalModeOverrides)
        const isActiveMember =
          mode === 'advanced'
            ? group.advancedIds.includes(subBlockConfig.id)
            : group.basicId === subBlockConfig.id
        if (!isActiveMember) continue
      }

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

      fields.push({
        blockId,
        blockType,
        blockName: blockData.name,
        fieldName: subBlockConfig.id,
        selectorType: subBlockConfig.type,
        value: values,
      })
    }
  }

  return fields
}

/**
 * Validates selector IDs in the workflow state exist in the database.
 * Returns validation errors for any invalid selector IDs.
 *
 * `options.includeCredentials` controls whether oauth-input credential fields
 * are validated (the edit path defaults to skipping them since they are
 * pre-validated; the lint opts in to close that gap).
 */
export async function validateWorkflowSelectorIds(
  workflowState: any,
  context: { userId: string; workspaceId?: string },
  options: { includeCredentials?: boolean } = {}
): Promise<ValidationError[]> {
  const logger = createLogger('EditWorkflowSelectorValidation')
  const errors: ValidationError[] = []

  const selectorsToValidate = collectSelectorFields(workflowState, options)

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
 * Lint-facing Tier-2 resolution: validate every ACTIVE credential/resource
 * member (including oauth-input) against the workspace and return the references
 * that do not resolve to an accessible entity. This is the "set in basic mode
 * but the dropdown shows nothing" check, using the same resolver the dropdown
 * options come from. Best-effort: per-field resolution failures are skipped.
 */
export async function collectUnresolvedReferences(
  workflowState: any,
  context: { userId: string; workspaceId?: string }
): Promise<UnresolvedSelectorReference[]> {
  const logger = createLogger('EditWorkflowResolutionLint')
  const references: UnresolvedSelectorReference[] = []

  const selectorsToValidate = collectSelectorFields(workflowState, { includeCredentials: true })
  if (selectorsToValidate.length === 0) {
    return references
  }

  for (const selector of selectorsToValidate) {
    let result: Awaited<ReturnType<typeof validateSelectorIds>>
    try {
      result = await validateSelectorIds(selector.selectorType, selector.value, context)
    } catch (error) {
      logger.warn('Selector resolution failed; skipping field', {
        blockId: selector.blockId,
        fieldName: selector.fieldName,
        error: toError(error).message,
      })
      continue
    }

    if (result.invalid.length > 0) {
      const kind = selector.selectorType === 'oauth-input' ? 'credential' : 'resource'
      const warningInfo = result.warning ? `. ${result.warning}` : ''
      references.push({
        blockId: selector.blockId,
        blockType: selector.blockType,
        blockName: selector.blockName,
        field: selector.fieldName,
        value: selector.value,
        kind,
        reason: `${selector.selectorType} ID(s) ${result.invalid.join(', ')} do not resolve to an accessible ${kind}${warningInfo}`,
      })
    }
  }

  return references
}

/**
 * Lint-facing existence check for agent-block tool/skill references. Walks every
 * agent block and verifies that reference-format custom tools (`customToolId`),
 * MCP tools (`params.serverId`), and skills (`skillId`) resolve to real
 * workspace/builtin entities. A well-shaped entry whose id does not resolve
 * passes shape validation but is silently dropped at runtime (the agent never
 * sees the tool/skill), so surface it through the lint channel. Best-effort:
 * per-entry resolution failures are skipped rather than failing the edit.
 */
export async function collectUnresolvedAgentToolReferences(
  workflowState: any,
  context: { userId: string; workspaceId?: string }
): Promise<UnresolvedSelectorReference[]> {
  const logger = agentToolLintLogger
  const references: UnresolvedSelectorReference[] = []
  const { userId, workspaceId } = context

  for (const [blockId, block] of Object.entries(workflowState.blocks || {})) {
    const blockData = block as any
    if (blockData?.type !== 'agent') continue
    const blockName = blockData.name as string | undefined

    const tools = blockData.subBlocks?.tools?.value
    if (Array.isArray(tools)) {
      for (const tool of tools) {
        if (!tool || typeof tool !== 'object') continue

        // Reference-format custom tools must resolve to a DB row. Inline tools
        // (those carrying their own schema) are self-contained, so skip them.
        // Gated on workspaceId (like the MCP/skill paths below): without a
        // workspace, getCustomToolById only sees legacy tools and would
        // false-positive on every workspace-scoped tool.
        if (tool.type === 'custom-tool' && !tool.schema && workspaceId) {
          const toolId = tool.customToolId
          if (typeof toolId !== 'string' || toolId.trim() === '') continue
          try {
            const found = await getCustomToolById({ toolId, userId, workspaceId })
            if (!found) {
              references.push({
                blockId,
                blockName,
                blockType: 'agent',
                field: 'tools',
                value: toolId,
                kind: 'custom-tool',
                reason: `custom tool id "${toolId}" does not resolve to a custom tool in this workspace - create it with manage_custom_tool and use the returned id, otherwise the agent will not see the tool`,
              })
            }
          } catch (error) {
            logger.warn('Custom tool resolution failed; skipping', {
              blockId,
              toolId,
              error: toError(error).message,
            })
          }
        } else if (tool.type === 'mcp' && workspaceId) {
          const serverId = tool.params?.serverId
          if (typeof serverId !== 'string' || serverId.trim() === '') continue
          try {
            const result = await validateSelectorIds('mcp-server-selector', serverId, context)
            if (result.invalid.length > 0) {
              references.push({
                blockId,
                blockName,
                blockType: 'agent',
                field: 'tools',
                value: serverId,
                kind: 'mcp-tool',
                reason: `MCP server "${serverId}" does not resolve to an enabled MCP server in this workspace`,
              })
            }
          } catch (error) {
            logger.warn('MCP server resolution failed; skipping', {
              blockId,
              serverId,
              error: toError(error).message,
            })
          }
        }
      }
    }

    const skills = blockData.subBlocks?.skills?.value
    if (Array.isArray(skills) && workspaceId) {
      for (const skillEntry of skills) {
        if (!skillEntry || typeof skillEntry !== 'object') continue
        const skillId = skillEntry.skillId
        if (typeof skillId !== 'string' || skillId.trim() === '') continue
        try {
          const found = await getSkillById({ skillId, workspaceId })
          if (!found) {
            references.push({
              blockId,
              blockName,
              blockType: 'agent',
              field: 'skills',
              value: skillId,
              kind: 'skill',
              reason: `skill id "${skillId}" does not resolve to a builtin or workspace skill - use manage_skill (operation "list") to get valid ids`,
            })
          }
        } catch (error) {
          logger.warn('Skill resolution failed; skipping', {
            blockId,
            skillId,
            error: toError(error).message,
          })
        }
      }
    }
  }

  return references
}

/**
 * Pre-validates credential and apiKey inputs in operations before they are applied.
 * - Validates oauth-input (credential) IDs are accessible to the user in the workflow workspace
 * - Filters out apiKey inputs when isHosted is true and the key is platform-managed: either a
 *   hosted LLM model (model in getHostedModels) or a block whose active tool declares
 *   `hosting` (e.g. Fal-backed video/image generators) - the canonical signal also used by
 *   injectHostedKeyIfNeeded at execution
 * - Also validates credentials and apiKeys in nestedNodes (blocks inside loop/parallel)
 * Returns validation errors for any removed inputs.
 */
export async function preValidateCredentialInputs(
  operations: EditWorkflowOperation[],
  context: { userId: string; workspaceId?: string },
  workflowState?: Record<string, unknown>
): Promise<{ filteredOperations: EditWorkflowOperation[]; errors: ValidationError[] }> {
  const { isHosted } = await import('@/lib/core/config/env-flags')
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
    fieldName: string
    reason: 'hosted_model' | 'hosted_tool'
    model?: string
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
        fieldName: 'apiKey',
        reason: 'hosted_model',
        model: modelValue,
        nestedBlockId,
      })
    }
  }

  /**
   * Collect inputs targeting a hosted tool's key param. `tool.hosting` is the canonical
   * "Sim provides this key" signal — the same one injectHostedKeyIfNeeded uses at execution. It
   * names the managed field (`apiKeyParam`) and gates per-provider (`enabled`). We resolve the
   * tool the block's current inputs select (via the block's `tools.config.tool` selector), so
   * multi-provider blocks (video routing falai -> video_falai) and per-provider gates
   * (image_generate, falai-only) match execution exactly. The UI hides these fields, but the
   * copilot can still author them, so strip them here.
   */
  function collectHostedToolApiKeyInput(
    blockConfig: ReturnType<typeof getBlock>,
    inputs: Record<string, unknown>,
    toolParams: Record<string, unknown>,
    opIndex: number,
    blockId: string,
    blockType: string,
    nestedBlockId?: string
  ) {
    if (!isHosted || !blockConfig?.tools) return

    // Resolve which tool(s) the current inputs select. With a selector there is exactly one active
    // tool; without one, every accessible tool is a candidate.
    let candidateToolIds: string[]
    const toolSelector = blockConfig.tools.config?.tool
    if (toolSelector) {
      try {
        candidateToolIds = [toolSelector(toolParams)]
      } catch {
        return
      }
    } else {
      candidateToolIds = blockConfig.tools.access ?? []
    }

    const managedFieldIds = new Set<string>()
    for (const toolId of candidateToolIds) {
      const tool = getTool(toolId)
      if (!tool?.hosting) continue
      // The enabled predicate is tool-defined; guard it so a throw can't break edit_workflow. On
      // a throw the hosting state is unknown, so fail toward treating the key as managed (strip)
      // rather than preserving a key that may actually be platform-managed.
      if (tool.hosting.enabled) {
        let isManaged: boolean
        try {
          isManaged = tool.hosting.enabled(toolParams)
        } catch {
          isManaged = true
        }
        if (!isManaged) continue
      }
      managedFieldIds.add(tool.hosting.apiKeyParam)
    }

    for (const fieldId of managedFieldIds) {
      const value = inputs[fieldId]
      if (typeof value !== 'string' || value.trim() === '') continue

      const alreadyCollected = hostedApiKeyInputs.some(
        (e) =>
          e.operationIndex === opIndex &&
          e.blockId === blockId &&
          e.nestedBlockId === nestedBlockId &&
          e.fieldName === fieldId
      )
      if (alreadyCollected) continue

      hostedApiKeyInputs.push({
        operationIndex: opIndex,
        blockId,
        blockType,
        fieldName: fieldId,
        reason: 'hosted_tool',
        nestedBlockId,
      })
    }
  }

  const asRecord = (value: unknown): Record<string, unknown> | undefined =>
    value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
  const snapshotBlock = (blockId: string) => asRecord(asRecord(workflowState?.blocks)?.[blockId])

  // Track each block's effective state across ops in this batch (seeded from the snapshot, then
  // updated per op), so a later type-less edit sees type/provider changed by an earlier op in the
  // same request rather than the stale snapshot — otherwise a key could survive on a block an
  // earlier op just made hosted.
  const batchBlockType = new Map<string, string | undefined>()
  const batchBlockValues = new Map<string, Record<string, unknown>>()

  operations.forEach((op, opIndex) => {
    const inputs = asRecord(op.params?.inputs)

    // Effective block type: this op's type, else the type left by an earlier batch op, else the
    // snapshot. Edit ops omit `type`, so without this an apiKey-only edit would skip stripping.
    const priorType = batchBlockType.has(op.block_id)
      ? batchBlockType.get(op.block_id)
      : (snapshotBlock(op.block_id)?.type as string | undefined)
    const opBlockType = (op.params?.type as string | undefined) ?? priorType
    batchBlockType.set(op.block_id, opBlockType)

    // Process main block inputs
    if (inputs && opBlockType) {
      const blockConfig = getBlock(opBlockType)
      if (blockConfig) {
        collectCredentialInputs(blockConfig, inputs, opIndex, op.block_id, opBlockType)

        // Both hosted collectors no-op off hosted Sim, so only reconstruct the effective inputs
        // (prior batch/snapshot values overlaid with this op's delta) when it can matter.
        if (isHosted) {
          const priorValues =
            batchBlockValues.get(op.block_id) ??
            buildSubBlockValues(
              (snapshotBlock(op.block_id)?.subBlocks as Record<string, { value?: unknown }>) ?? {}
            )
          const toolParams = { ...priorValues, ...inputs }
          batchBlockValues.set(op.block_id, toolParams)
          const modelValue = toolParams.model as string | undefined
          collectHostedApiKeyInput(inputs, modelValue, opIndex, op.block_id, opBlockType)
          collectHostedToolApiKeyInput(
            blockConfig,
            inputs,
            toolParams,
            opIndex,
            op.block_id,
            opBlockType
          )
        }
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
        collectHostedToolApiKeyInput(
          childBlockConfig,
          childInputs,
          childInputs,
          opIndex,
          op.block_id,
          childType,
          childId
        )
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
    logger.info('Filtering platform-managed apiKey inputs', { count: hostedApiKeyInputs.length })

    const stripMessage = (input: (typeof hostedApiKeyInputs)[number]): string =>
      input.reason === 'hosted_tool'
        ? `Cannot set "${input.fieldName}" for "${input.blockType}" - it is managed by Sim on the hosted platform. Leave "${input.fieldName}" unset.`
        : `Cannot set API key for hosted model "${input.model}" - API keys are managed by the platform when using hosted models`

    for (const apiKeyInput of hostedApiKeyInputs) {
      const op = filteredOperations[apiKeyInput.operationIndex]
      const field = apiKeyInput.fieldName

      // Handle nested block apiKey filtering
      if (apiKeyInput.nestedBlockId) {
        const nestedNodes = op.params?.nestedNodes as
          | Record<string, Record<string, unknown>>
          | undefined
        const nestedBlock = nestedNodes?.[apiKeyInput.nestedBlockId]
        const nestedInputs = nestedBlock?.inputs as Record<string, unknown> | undefined
        if (nestedInputs?.[field]) {
          nestedInputs[field] = undefined
          logger.debug('Filtered platform-managed apiKey in nested block', {
            parentBlockId: apiKeyInput.blockId,
            nestedBlockId: apiKeyInput.nestedBlockId,
            field,
            reason: apiKeyInput.reason,
            model: apiKeyInput.model,
          })

          errors.push({
            blockId: apiKeyInput.nestedBlockId,
            blockType: apiKeyInput.blockType,
            field,
            value: '[redacted]',
            error: stripMessage(apiKeyInput),
          })
        }
      } else if (op.params?.inputs?.[field]) {
        // Handle main block apiKey filtering
        op.params.inputs[field] = undefined
        logger.debug('Filtered platform-managed apiKey', {
          blockId: apiKeyInput.blockId,
          field,
          reason: apiKeyInput.reason,
          model: apiKeyInput.model,
        })

        errors.push({
          blockId: apiKeyInput.blockId,
          blockType: apiKeyInput.blockType,
          field,
          value: '[redacted]',
          error: stripMessage(apiKeyInput),
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
