import { createLogger } from '@sim/logger'
import { extractInputFieldsFromBlocks } from '@/lib/workflows/input-format'
import {
  buildCanonicalIndex,
  type CanonicalModeOverrides,
  evaluateSubBlockCondition,
  isCanonicalPair,
  resolveCanonicalMode,
  type SubBlockCondition,
} from '@/lib/workflows/subblocks/visibility'
import type { SubBlockConfig as BlockSubBlockConfig, GenerationType } from '@/blocks/types'
import { safeAssign } from '@/tools/safe-assign'
import { isEmptyTagValue } from '@/tools/shared/tags'
import type { OAuthConfig, ParameterVisibility, ToolConfig } from '@/tools/types'
import { getTool } from '@/tools/utils'

const logger = createLogger('ToolsParams')
type ToolParamDefinition = ToolConfig['params'][string]

/**
 * Checks if a value is non-empty (not undefined, null, or empty string)
 */
export function isNonEmpty(value: unknown): boolean {
  return value !== undefined && value !== null && value !== ''
}

// ============================================================================
// Tag/Value Parsing Utilities
// ============================================================================

export interface Option {
  label: string
  value: string
}

export interface ComponentCondition {
  field: string
  value: string | number | boolean | Array<string | number | boolean>
  not?: boolean
}

export interface UIComponentConfig {
  type: string
  options?: Option[]
  placeholder?: string
  password?: boolean
  condition?: ComponentCondition
  title?: string
  value?: unknown
  serviceId?: string
  requiredScopes?: string[]
  mimeType?: string
  columns?: string[]
  min?: number
  max?: number
  step?: number
  integer?: boolean
  language?: string
  generationType?: string
  acceptedTypes?: string[]
  multiple?: boolean
  multiSelect?: boolean
  maxSize?: number
  dependsOn?: string[] | { all?: string[]; any?: string[] }
  /** Canonical parameter ID if this is part of a canonical group */
  canonicalParamId?: string
  /** The mode of the source subblock (basic/advanced/both) */
  mode?: 'basic' | 'advanced' | 'both' | 'trigger'
  /** The actual subblock ID this config was derived from */
  actualSubBlockId?: string
  /** Wand configuration for AI assistance */
  wandConfig?: {
    enabled: boolean
    prompt: string
    generationType?: GenerationType
    placeholder?: string
    maintainHistory?: boolean
  }
}

export interface SubBlockConfig {
  id: string
  type: string
  title?: string
  options?: Option[]
  placeholder?: string
  password?: boolean
  condition?: ComponentCondition
  value?: unknown
  serviceId?: string
  requiredScopes?: string[]
  mimeType?: string
  columns?: string[]
  min?: number
  max?: number
  step?: number
  integer?: boolean
  language?: string
  generationType?: string
  acceptedTypes?: string[]
  multiple?: boolean
  maxSize?: number
  dependsOn?: string[]
}

export interface BlockConfig {
  type: string
  subBlocks?: SubBlockConfig[]
}

export interface SchemaProperty {
  type: string
  description: string
  items?: Record<string, any>
  properties?: Record<string, SchemaProperty>
  required?: string[]
}

export interface ToolSchema {
  type: 'object'
  properties: Record<string, SchemaProperty>
  required: string[]
}

export interface ValidationResult {
  valid: boolean
  missingParams: string[]
}

export interface ToolParameterConfig {
  id: string
  type: string
  required?: boolean // Required for tool execution
  visibility?: ParameterVisibility // Controls who can/must provide this parameter
  userProvided?: boolean // User filled this parameter
  description?: string
  default?: unknown
  // UI component information from block config
  uiComponent?: UIComponentConfig
}

export interface ToolWithParameters {
  toolConfig: ToolConfig
  allParameters: ToolParameterConfig[]
  userInputParameters: ToolParameterConfig[] // Parameters shown to user
  requiredParameters: ToolParameterConfig[] // Must be filled by user or LLM
  optionalParameters: ToolParameterConfig[] // Nice to have, shown to user
}

let blockConfigCache: Record<string, BlockConfig> | null = null

function getBlockConfigurations(): Record<string, BlockConfig> {
  if (!blockConfigCache) {
    try {
      const { getAllBlocks } = require('@/blocks')
      const allBlocks = getAllBlocks()
      blockConfigCache = {}
      allBlocks.forEach((block: BlockConfig) => {
        blockConfigCache![block.type] = block
      })
    } catch (error) {
      console.warn('Could not load block configuration:', error)
      blockConfigCache = {}
    }
  }
  return blockConfigCache
}

function resolveSubBlockForParam(
  paramId: string,
  subBlocks: SubBlockConfig[],
  valuesWithOperation: Record<string, unknown>,
  paramType: string
): BlockSubBlockConfig | undefined {
  const blockSubBlocks = subBlocks as BlockSubBlockConfig[]

  // First pass: find subblock with matching condition
  let fallbackMatch: BlockSubBlockConfig | undefined

  for (const sb of blockSubBlocks) {
    const matches = sb.id === paramId || sb.canonicalParamId === paramId
    if (!matches) continue

    // Remember first match as fallback (for condition-based filtering in UI)
    if (!fallbackMatch) fallbackMatch = sb

    if (
      !sb.condition ||
      evaluateSubBlockCondition(sb.condition as SubBlockCondition, valuesWithOperation)
    ) {
      return sb
    }
  }

  // Return fallback so its condition can be used for UI filtering
  if (fallbackMatch) return fallbackMatch

  // Check if boolean param is part of a checkbox-list
  if (paramType === 'boolean') {
    return blockSubBlocks.find(
      (sb) =>
        sb.type === 'checkbox-list' &&
        Array.isArray(sb.options) &&
        (sb.options as Array<{ id?: string }>).some((opt) => opt.id === paramId)
    )
  }

  return undefined
}

/**
 * Gets all parameters for a tool, categorized by their usage
 * Also includes UI component information from block configurations
 */
export function getToolParametersConfig(
  toolId: string,
  blockType?: string,
  currentValues?: Record<string, unknown>
): ToolWithParameters | null {
  try {
    const toolConfig = getTool(toolId)
    if (!toolConfig) {
      logger.warn(`Tool not found: ${toolId}`)
      return null
    }

    // Validate that toolConfig has required properties
    if (!toolConfig.params || typeof toolConfig.params !== 'object') {
      logger.warn(`Tool ${toolId} has invalid params configuration`)
      return null
    }

    // Special handling for workflow_executor tool
    if (toolId === 'workflow_executor') {
      const parameters: ToolParameterConfig[] = [
        {
          id: 'workflowId',
          type: 'string',
          required: true,
          visibility: 'user-only',
          description: 'The ID of the workflow to execute',
          uiComponent: {
            type: 'workflow-selector',
            placeholder: 'Select workflow to execute',
          },
        },
        {
          id: 'inputMapping',
          type: 'object',
          required: false,
          visibility: 'user-or-llm',
          description: 'Map inputs to the selected workflow',
          uiComponent: {
            type: 'workflow-input-mapper',
            title: 'Workflow Inputs',
            condition: {
              field: 'workflowId',
              value: '',
              not: true, // Show when workflowId is not empty
            },
          },
        },
      ]

      return {
        toolConfig,
        allParameters: parameters,
        userInputParameters: parameters.filter(
          (param) => param.visibility === 'user-or-llm' || param.visibility === 'user-only'
        ),
        requiredParameters: parameters.filter((param) => param.required),
        optionalParameters: parameters.filter(
          (param) => param.visibility === 'user-only' && !param.required
        ),
      }
    }

    // Get block configuration for UI component information
    let blockConfig: BlockConfig | null = null
    if (blockType) {
      const blockConfigs = getBlockConfigurations()
      blockConfig = blockConfigs[blockType] || null
    }

    // Build values for condition evaluation
    // Operation should come from currentValues if provided, otherwise extract from toolId
    const values = currentValues || {}
    const valuesWithOperation = { ...values }
    if (valuesWithOperation.operation === undefined) {
      // Fallback: extract operation from tool ID (e.g., 'slack_message' -> 'message')
      const parts = toolId.split('_')
      valuesWithOperation.operation =
        parts.length >= 3 ? parts.slice(2).join('_') : parts[parts.length - 1]
    }

    // Convert tool params to our standard format with UI component info
    const allParameters: ToolParameterConfig[] = Object.entries(toolConfig.params).map(
      ([paramId, param]) => {
        const toolParam: ToolParameterConfig = {
          id: paramId,
          type: param.type,
          required: param.required ?? false,
          visibility: param.visibility ?? (param.required ? 'user-or-llm' : 'user-only'),
          description: param.description,
          default: param.default,
        }

        if (blockConfig) {
          const subBlock = resolveSubBlockForParam(
            paramId,
            blockConfig.subBlocks || [],
            valuesWithOperation,
            param.type
          )

          if (subBlock) {
            toolParam.uiComponent = {
              type: subBlock.type,
              options: subBlock.options as Option[] | undefined,
              placeholder: subBlock.placeholder,
              password: subBlock.password,
              condition: subBlock.condition as ComponentCondition | undefined,
              title: subBlock.title,
              value: subBlock.value,
              serviceId: subBlock.serviceId,
              requiredScopes: subBlock.requiredScopes,
              mimeType: subBlock.mimeType,
              columns: subBlock.columns,
              min: subBlock.min,
              max: subBlock.max,
              step: subBlock.step,
              integer: subBlock.integer,
              language: subBlock.language,
              generationType: subBlock.generationType,
              acceptedTypes: subBlock.acceptedTypes ? [subBlock.acceptedTypes] : undefined,
              multiple: subBlock.multiple,
              maxSize: subBlock.maxSize,
              dependsOn: subBlock.dependsOn,
              canonicalParamId: subBlock.canonicalParamId,
              mode: subBlock.mode,
              actualSubBlockId: subBlock.id,
              wandConfig: subBlock.wandConfig,
            }
          }
        }

        return toolParam
      }
    )

    // Parameters that should be shown to the user for input
    const userInputParameters = allParameters.filter(
      (param) => param.visibility === 'user-or-llm' || param.visibility === 'user-only'
    )

    // Parameters that are required (must be filled by user or LLM)
    const requiredParameters = allParameters.filter((param) => param.required)

    // Parameters that are optional but can be provided by user
    const optionalParameters = allParameters.filter(
      (param) => param.visibility === 'user-only' && !param.required
    )

    return {
      toolConfig,
      allParameters,
      userInputParameters,
      requiredParameters,
      optionalParameters,
    }
  } catch (error) {
    logger.error('Error getting tool parameters config:', error)
    return null
  }
}

/**
 * Creates a tool schema for LLM with user-provided parameters excluded
 */
function buildParameterSchema(
  toolId: string,
  paramId: string,
  param: ToolParamDefinition
): SchemaProperty {
  let schemaType = param.type
  if (schemaType === 'json' || schemaType === 'any') {
    schemaType = 'object'
  }

  const propertySchema: SchemaProperty = {
    type: schemaType,
    description: param.description || '',
  }

  if (param.type === 'array' && param.items) {
    propertySchema.items = {
      ...param.items,
      ...(param.items.properties && {
        properties: { ...param.items.properties },
      }),
    }
  } else if (param.items) {
    logger.warn(`items property ignored for non-array param "${paramId}" in tool "${toolId}"`)
  }

  return propertySchema
}

export function createUserToolSchema(toolConfig: ToolConfig): ToolSchema {
  const schema: ToolSchema = {
    type: 'object',
    properties: {},
    required: [],
  }

  for (const [paramId, param] of Object.entries(toolConfig.params)) {
    if (!param) continue
    const visibility = param.visibility ?? 'user-or-llm'
    if (visibility === 'hidden') {
      continue
    }

    const propertySchema = buildParameterSchema(toolConfig.id, paramId, param)
    schema.properties[paramId] = propertySchema

    if (param.required) {
      schema.required.push(paramId)
    }
  }

  return schema
}

export async function createLLMToolSchema(
  toolConfig: ToolConfig,
  userProvidedParams: Record<string, unknown>
): Promise<ToolSchema> {
  const schema: ToolSchema = {
    type: 'object',
    properties: {},
    required: [],
  }

  // Only include parameters that the LLM should/can provide
  for (const [paramId, param] of Object.entries(toolConfig.params)) {
    // Check if this param has schema enrichment config
    const enrichmentConfig = toolConfig.schemaEnrichment?.[paramId]

    // Special handling for workflow_executor's inputMapping parameter
    // Always include in LLM schema so LLM can provide dynamic input values
    // even if user has configured empty/partial inputMapping in the UI
    const isWorkflowInputMapping =
      toolConfig.id === 'workflow_executor' && paramId === 'inputMapping'

    // Parameters with enrichment config are treated specially:
    // - Include them if dependency value is available (even if normally hidden)
    // - Skip them if dependency value is not available
    if (enrichmentConfig) {
      const dependencyValue = userProvidedParams[enrichmentConfig.dependsOn] as string
      if (!dependencyValue) {
        continue
      }

      const propertySchema = buildParameterSchema(toolConfig.id, paramId, param)
      const enrichedSchema = await enrichmentConfig.enrichSchema(dependencyValue)

      if (enrichedSchema) {
        safeAssign(propertySchema, enrichedSchema as Record<string, unknown>)
        schema.properties[paramId] = propertySchema

        if (param.required) {
          schema.required.push(paramId)
        }
      }
      continue
    }

    if (!isWorkflowInputMapping) {
      // Skip parameters that user has already provided
      if (isNonEmpty(userProvidedParams[paramId])) {
        continue
      }

      // Skip parameters that are user-only (never shown to LLM)
      if (param.visibility === 'user-only') {
        continue
      }

      // Skip hidden parameters
      if (param.visibility === 'hidden') {
        continue
      }
    }

    // Add parameter to LLM schema
    const propertySchema = buildParameterSchema(toolConfig.id, paramId, param)

    // Apply dynamic schema enrichment for workflow_executor's inputMapping
    if (isWorkflowInputMapping) {
      const workflowId = userProvidedParams.workflowId as string
      if (workflowId) {
        await applyDynamicSchemaForWorkflow(propertySchema, workflowId)
      }
    }

    schema.properties[paramId] = propertySchema

    // Add to required if LLM must provide it and it's originally required
    if ((param.visibility === 'user-or-llm' || param.visibility === 'llm-only') && param.required) {
      schema.required.push(paramId)
    }
  }

  return schema
}

/**
 * Apply dynamic schema enrichment for workflow_executor's inputMapping parameter
 */
async function applyDynamicSchemaForWorkflow(
  propertySchema: any,
  workflowId: string
): Promise<void> {
  try {
    const workflowInputFields = await fetchWorkflowInputFields(workflowId)

    if (workflowInputFields && workflowInputFields.length > 0) {
      propertySchema.type = 'object'
      propertySchema.properties = {}
      propertySchema.required = []

      // Convert workflow input fields to JSON schema properties
      for (const field of workflowInputFields) {
        propertySchema.properties[field.name] = {
          type: field.type || 'string',
          description: field.description || `Input field: ${field.name}`,
        }
        propertySchema.required.push(field.name)
      }

      // Update description to be more specific
      propertySchema.description = `Input values for the workflow. Required fields: ${workflowInputFields.map((f) => f.name).join(', ')}`
    }
  } catch (error) {
    logger.error('Failed to fetch workflow input fields for LLM schema:', error)
  }
}

/**
 * Fetches workflow input fields from the API.
 */
async function fetchWorkflowInputFields(
  workflowId: string
): Promise<Array<{ name: string; type: string; description?: string }>> {
  try {
    const { buildAuthHeaders, buildAPIUrl } = await import('@/executor/utils/http')

    const headers = await buildAuthHeaders()
    const url = buildAPIUrl(`/api/workflows/${workflowId}`)

    const response = await fetch(url.toString(), { headers })
    if (!response.ok) {
      throw new Error('Failed to fetch workflow')
    }

    const { data } = await response.json()
    return extractInputFieldsFromBlocks(data?.state?.blocks)
  } catch (error) {
    logger.error('Error fetching workflow input fields:', error)
    return []
  }
}

/**
 * Creates a complete tool schema for execution with all parameters
 */
export function createExecutionToolSchema(toolConfig: ToolConfig): ToolSchema {
  const schema: ToolSchema = {
    type: 'object',
    properties: {},
    required: [],
  }

  Object.entries(toolConfig.params).forEach(([paramId, param]) => {
    const propertySchema: any = {
      type: param.type === 'json' ? 'object' : param.type,
      description: param.description || '',
    }

    // Include items property for arrays
    if (param.type === 'array' && param.items) {
      propertySchema.items = {
        ...param.items,
        ...(param.items.properties && {
          properties: { ...param.items.properties },
        }),
      }
    } else if (param.items) {
      logger.warn(
        `items property ignored for non-array param "${paramId}" in tool "${toolConfig.id}"`
      )
    }

    schema.properties[paramId] = propertySchema

    if (param.required) {
      schema.required.push(paramId)
    }
  })

  return schema
}

/**
 * Deep merges inputMapping objects, where LLM values fill in empty/missing user values.
 * User-provided non-empty values take precedence.
 */
export function deepMergeInputMapping(
  llmInputMapping: Record<string, unknown> | undefined,
  userInputMapping: Record<string, unknown> | string | undefined
): Record<string, unknown> {
  // Parse user inputMapping if it's a JSON string
  let parsedUserMapping: Record<string, unknown> = {}
  if (typeof userInputMapping === 'string') {
    try {
      const parsed = JSON.parse(userInputMapping)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        parsedUserMapping = parsed
      }
    } catch {
      // Invalid JSON, treat as empty
    }
  } else if (
    typeof userInputMapping === 'object' &&
    userInputMapping !== null &&
    !Array.isArray(userInputMapping)
  ) {
    parsedUserMapping = userInputMapping
  }

  // If no LLM mapping, return user mapping (or empty)
  if (!llmInputMapping || typeof llmInputMapping !== 'object') {
    return parsedUserMapping
  }

  // Deep merge: LLM values as base, user non-empty values override
  // If user provides empty object {}, LLM values fill all fields (intentional)
  const merged: Record<string, unknown> = { ...llmInputMapping }

  for (const [key, userValue] of Object.entries(parsedUserMapping)) {
    // Only override LLM value if user provided a non-empty value
    if (isNonEmpty(userValue)) {
      merged[key] = userValue
    }
  }

  return merged
}

/**
 * Merges user-provided parameters with LLM-generated parameters.
 * User-provided parameters take precedence, but empty strings are skipped
 * so that LLM-generated values are used when user clears a field.
 *
 * Special handling for inputMapping: deep merges so LLM can fill in
 * fields that user left empty in the UI.
 */
export function mergeToolParameters(
  userProvidedParams: Record<string, unknown>,
  llmGeneratedParams: Record<string, unknown>
): Record<string, unknown> {
  // Filter out empty and effectively-empty values from user-provided params
  // so that cleared fields don't override LLM values
  const filteredUserParams: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(userProvidedParams)) {
    if (isNonEmpty(value)) {
      // Skip tag-based params if they're effectively empty (only default/unfilled entries)
      if ((key === 'documentTags' || key === 'tagFilters') && isEmptyTagValue(value)) {
        continue
      }
      filteredUserParams[key] = value
    }
  }

  // Start with LLM params as base
  const result: Record<string, unknown> = { ...llmGeneratedParams }

  // Apply user params, with special handling for inputMapping
  for (const [key, userValue] of Object.entries(filteredUserParams)) {
    if (key === 'inputMapping') {
      // Deep merge inputMapping so LLM values fill in empty user fields
      const llmInputMapping = llmGeneratedParams.inputMapping as Record<string, unknown> | undefined
      const mergedInputMapping = deepMergeInputMapping(
        llmInputMapping,
        userValue as Record<string, unknown> | string | undefined
      )
      result.inputMapping = mergedInputMapping
    } else {
      // Normal override for other params
      result[key] = userValue
    }
  }

  // If LLM provided inputMapping but user didn't, ensure it's included
  if (llmGeneratedParams.inputMapping && !filteredUserParams.inputMapping) {
    result.inputMapping = llmGeneratedParams.inputMapping
  }

  return result
}

/**
 * Filters out user-provided parameters from tool schema for LLM
 */
export function filterSchemaForLLM(
  originalSchema: ToolSchema,
  userProvidedParams: Record<string, unknown>
): ToolSchema {
  if (!originalSchema || !originalSchema.properties) {
    return originalSchema
  }

  const filteredProperties = { ...originalSchema.properties }
  const filteredRequired = [...(originalSchema.required || [])]

  // Remove user-provided parameters from the schema
  Object.keys(userProvidedParams).forEach((paramKey) => {
    if (isNonEmpty(userProvidedParams[paramKey])) {
      delete filteredProperties[paramKey]
      const reqIndex = filteredRequired.indexOf(paramKey)
      if (reqIndex > -1) {
        filteredRequired.splice(reqIndex, 1)
      }
    }
  })

  return {
    ...originalSchema,
    properties: filteredProperties,
    required: filteredRequired,
  }
}

/**
 * Validates that all required parameters are provided
 */
export function validateToolParameters(
  toolConfig: ToolConfig,
  finalParams: Record<string, unknown>
): ValidationResult {
  const requiredParams = Object.entries(toolConfig.params)
    .filter(([_, param]) => param.required)
    .map(([paramId]) => paramId)

  const missingParams = requiredParams.filter(
    (paramId) =>
      finalParams[paramId] === undefined ||
      finalParams[paramId] === null ||
      finalParams[paramId] === ''
  )

  return {
    valid: missingParams.length === 0,
    missingParams,
  }
}

/**
 * Helper to check if a parameter should be treated as a password field
 */
export function isPasswordParameter(paramId: string): boolean {
  const passwordFields = [
    'password',
    'apiKey',
    'token',
    'secret',
    'key',
    'credential',
    'accessToken',
    'refreshToken',
    'botToken',
    'authToken',
  ]

  return passwordFields.some((field) => paramId.toLowerCase().includes(field.toLowerCase()))
}

/**
 * Formats parameter IDs into human-readable labels
 */
export function formatParameterLabel(paramId: string): string {
  // Special cases
  if (paramId === 'apiKey') return 'API Key'
  if (paramId === 'apiVersion') return 'API Version'
  if (paramId === 'accessToken') return 'Access Token'
  if (paramId === 'refreshToken') return 'Refresh Token'
  if (paramId === 'botToken') return 'Bot Token'

  // Handle underscore and hyphen separated words
  if (paramId.includes('_') || paramId.includes('-')) {
    return paramId
      .split(/[-_]/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  }

  // Handle single character parameters
  if (paramId.length === 1) return paramId.toUpperCase()

  // Handle camelCase
  if (/[A-Z]/.test(paramId)) {
    const result = paramId.replace(/([A-Z])/g, ' $1')
    return (
      result.charAt(0).toUpperCase() +
      result
        .slice(1)
        .replace(/ Api/g, ' API')
        .replace(/ Id/g, ' ID')
        .replace(/ Url/g, ' URL')
        .replace(/ Uri/g, ' URI')
        .replace(/ Ui/g, ' UI')
    )
  }

  // Simple case - just capitalize first letter
  return paramId.charAt(0).toUpperCase() + paramId.slice(1)
}

/**
 * SubBlock IDs that control tool routing, not user-facing parameters.
 * Excluded from tool-input rendering unless they have an explicit paramVisibility set.
 */
const STRUCTURAL_SUBBLOCK_IDS = new Set(['operation'])

/**
 * SubBlock types that represent auth/credential inputs handled separately
 * by the tool-input OAuth credential selector.
 */
const AUTH_SUBBLOCK_TYPES = new Set(['oauth-input'])

/**
 * SubBlock types that should never appear in tool-input context.
 */
const EXCLUDED_SUBBLOCK_TYPES = new Set([
  'tool-input',
  'skill-input',
  'condition-input',
  'eval-input',
  'webhook-config',
  'schedule-info',
  'trigger-save',
  'input-format',
  'response-format',
  'mcp-server-selector',
  'mcp-tool-selector',
  'mcp-dynamic-args',
  'input-mapping',
  'variables-input',
  'messages-input',
  'router-input',
  'text',
])

export interface SubBlocksForToolInput {
  toolConfig: ToolConfig
  subBlocks: BlockSubBlockConfig[]
  oauthConfig?: OAuthConfig
}

/**
 * Returns filtered SubBlockConfig[] for rendering in tool-input context.
 * Uses subblock definitions as the primary source of UI metadata,
 * getting all features (wandConfig, rich conditions, dependsOn, etc.) for free.
 *
 * For blocks without paramVisibility annotations, falls back to inferring
 * visibility from the tool's param definitions.
 */
export function getSubBlocksForToolInput(
  toolId: string,
  blockType: string,
  currentValues?: Record<string, unknown>,
  canonicalModeOverrides?: CanonicalModeOverrides
): SubBlocksForToolInput | null {
  try {
    const toolConfig = getTool(toolId)
    if (!toolConfig) {
      logger.warn(`Tool not found: ${toolId}`)
      return null
    }

    const blockConfigs = getBlockConfigurations()
    const blockConfig = blockConfigs[blockType]
    if (!blockConfig?.subBlocks?.length) {
      return null
    }

    const allSubBlocks = blockConfig.subBlocks as BlockSubBlockConfig[]
    const canonicalIndex = buildCanonicalIndex(allSubBlocks)

    // Build values for condition evaluation
    const values = currentValues || {}
    const valuesWithOperation = { ...values }
    if (valuesWithOperation.operation === undefined) {
      const parts = toolId.split('_')
      valuesWithOperation.operation =
        parts.length >= 3 ? parts.slice(2).join('_') : parts[parts.length - 1]
    }

    // Build a map of tool param IDs to their resolved visibility
    const toolParamVisibility: Record<string, ParameterVisibility> = {}
    for (const [paramId, param] of Object.entries(toolConfig.params || {})) {
      toolParamVisibility[paramId] =
        param.visibility ?? (param.required ? 'user-or-llm' : 'user-only')
    }

    // Track which canonical groups we've already included (to avoid duplicates)
    const includedCanonicalIds = new Set<string>()

    const filtered: BlockSubBlockConfig[] = []

    for (const sb of allSubBlocks) {
      // Skip excluded types
      if (EXCLUDED_SUBBLOCK_TYPES.has(sb.type)) continue

      // Skip trigger-mode-only subblocks
      if (sb.mode === 'trigger') continue

      // Determine the effective param ID (canonical or subblock id)
      const effectiveParamId = sb.canonicalParamId || sb.id

      // Resolve paramVisibility: explicit > inferred from tool params > skip
      let visibility = sb.paramVisibility
      if (!visibility) {
        // Infer from structural checks
        if (STRUCTURAL_SUBBLOCK_IDS.has(sb.id)) {
          visibility = 'hidden'
        } else if (AUTH_SUBBLOCK_TYPES.has(sb.type)) {
          visibility = 'hidden'
        } else if (
          sb.password &&
          (sb.id === 'botToken' || sb.id === 'accessToken' || sb.id === 'apiKey')
        ) {
          // Auth tokens without explicit paramVisibility are hidden
          // (they're handled by the OAuth credential selector or structurally)
          // But only if they don't have a matching tool param
          if (!(sb.id in toolParamVisibility)) {
            visibility = 'hidden'
          } else {
            visibility = toolParamVisibility[sb.id] || 'user-or-llm'
          }
        } else if (effectiveParamId in toolParamVisibility) {
          // Fallback: infer from tool param visibility
          visibility = toolParamVisibility[effectiveParamId]
        } else if (sb.id in toolParamVisibility) {
          visibility = toolParamVisibility[sb.id]
        } else if (sb.canonicalParamId) {
          visibility = 'user-or-llm'
        } else {
          continue
        }
      }

      // Filter by visibility: exclude hidden and llm-only
      if (visibility === 'hidden' || visibility === 'llm-only') continue

      // Evaluate condition against current values
      if (sb.condition) {
        const conditionMet = evaluateSubBlockCondition(
          sb.condition as SubBlockCondition,
          valuesWithOperation
        )
        if (!conditionMet) continue
      }

      // Handle canonical pairs: only include the active mode variant
      const canonicalId = canonicalIndex.canonicalIdBySubBlockId[sb.id]
      if (canonicalId) {
        const group = canonicalIndex.groupsById[canonicalId]
        if (group && isCanonicalPair(group)) {
          if (includedCanonicalIds.has(canonicalId)) continue
          includedCanonicalIds.add(canonicalId)

          // Determine active mode
          const mode = resolveCanonicalMode(group, valuesWithOperation, canonicalModeOverrides)
          if (mode === 'advanced') {
            // Find the advanced variant
            const advancedSb = allSubBlocks.find((s) => group.advancedIds.includes(s.id))
            if (advancedSb) {
              filtered.push({ ...advancedSb, paramVisibility: visibility })
            }
          } else {
            // Include basic variant (current sb if it's the basic one)
            if (group.basicId === sb.id) {
              filtered.push({ ...sb, paramVisibility: visibility })
            } else {
              const basicSb = allSubBlocks.find((s) => s.id === group.basicId)
              if (basicSb) {
                filtered.push({ ...basicSb, paramVisibility: visibility })
              }
            }
          }
          continue
        }
      }

      // Non-canonical, non-hidden, condition-passing subblock
      filtered.push({ ...sb, paramVisibility: visibility })
    }

    return {
      toolConfig,
      subBlocks: filtered,
      oauthConfig: toolConfig.oauth,
    }
  } catch (error) {
    logger.error('Error getting subblocks for tool input:', error)
    return null
  }
}
