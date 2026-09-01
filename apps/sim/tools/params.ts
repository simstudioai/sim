import { createLogger } from '@sim/logger'
import {
  buildCanonicalIndex,
  type CanonicalModeOverrides,
  evaluateSubBlockCondition,
  isCanonicalPair,
  isSubBlockFeatureEnabled,
  isSubBlockHidden,
  isTriggerModeSubBlock,
  resolveCanonicalMode,
  type SubBlockCondition,
} from '@/lib/workflows/subblocks/visibility'
import { isCustomBlockType, RESERVED_PARAMS } from '@/blocks/custom/build-config'
import type {
  BlockConfig as AppBlockConfig,
  SubBlockConfig as BlockSubBlockConfig,
  SubBlockType,
} from '@/blocks/types'
import { isNonEmpty } from '@/tools/merge-params'
import { getToolMetadata, type ToolMetadata } from '@/tools/metadata'
import { buildSubBlockForToolParam } from '@/tools/param-shape'
import { safeAssign } from '@/tools/safe-assign'
import type {
  ExecutableToolConfig,
  OAuthConfig,
  ParameterVisibility,
  ToolConfig,
  ToolParameterItemSchema,
  WorkflowToolExecutionContext,
} from '@/tools/types'

const logger = createLogger('ToolsParams')
type ToolParamDefinition = ToolConfig['params'][string]

type ToolInputBlockConfig = Pick<AppBlockConfig, 'type' | 'subBlocks' | 'tools'>

interface SchemaProperty {
  type: string
  description?: string
  items?: ToolParameterItemSchema
  properties?: Record<string, SchemaProperty>
  required?: string[]
}

export interface ToolSchema {
  type: 'object'
  properties: Record<string, SchemaProperty>
  required: string[]
}

export interface UserToolSchemaOptions {
  surface?: 'default' | 'copilot'
  /**
   * Set when the deployment provides hosted API keys for tools with a
   * `hosting` config. For unconditionally hosted tools the key param then
   * stays in the schema only as an optional bring-your-own-key override
   * instead of a required argument — the executor injects the hosted key
   * server-side after validation, and the key value itself is never exposed
   * to the model or the mothership. Tools with a conditional
   * `hosting.enabled` predicate keep the key required, since injection only
   * happens for configurations that satisfy the predicate (mirrors the VFS
   * `conditional_hosted_or_byok` auth mode).
   */
  hostedKeySupport?: boolean
}

export interface LLMToolSchemaResult {
  schema: ToolSchema
  enrichedDescription?: string
  /**
   * Params the model is never allowed to supply, because the tool declares them
   * `user-only` or `hidden`. Omitting them from {@link schema} is not enough on
   * its own — nothing stops a model from emitting an undeclared key, and the
   * merge downstream seeds from the model's args — so the names travel with the
   * schema for `prepareToolExecution` to strip.
   */
  modelBlockedParams?: string[]
}

export type WorkflowInputFieldsReader = (
  workflowId: string,
  context: WorkflowToolExecutionContext
) => Promise<Array<{ name: string; type: string; description?: string }>>

export class ToolSchemaEnrichmentError extends Error {
  constructor(toolId: string, cause: unknown) {
    super(`Failed to enrich schema for tool "${toolId}"`, { cause })
    this.name = 'ToolSchemaEnrichmentError'
  }
}

export interface ValidationResult {
  valid: boolean
  missingParams: string[]
}

let blockConfigCache: Record<string, ToolInputBlockConfig> | null = null

function getBlockConfigurations(): Record<string, ToolInputBlockConfig> {
  if (!blockConfigCache) {
    try {
      const { getAllBlocks } = require('@/blocks')
      const allBlocks = getAllBlocks()
      blockConfigCache = {}
      allBlocks.forEach((block: AppBlockConfig) => {
        blockConfigCache![block.type] = block
      })
    } catch (error) {
      logger.warn('Could not load block configuration:', error)
      blockConfigCache = {}
    }
  }
  return blockConfigCache
}

/**
 * Gets the correct tool ID for a block operation.
 *
 * Pass `blockOverride` (a fresh, overlay-aware config) for custom (deploy-as-block)
 * blocks — the module `getBlockConfigurations()` cache can miss async-hydrated
 * custom blocks, which would return `undefined` here and make "add tool" silently
 * no-op.
 */
export function getToolIdForOperation(
  blockType: string,
  operation?: string,
  blockOverride?: Pick<ToolInputBlockConfig, 'tools'>
): string | undefined {
  const block = blockOverride ?? getBlockConfigurations()[blockType]
  if (!block?.tools?.access) return undefined

  if (block.tools.access.length === 1) {
    return block.tools.access[0]
  }

  if (operation && block.tools.config?.tool) {
    try {
      return block.tools.config.tool({ operation })
    } catch (error) {
      logger.error('Error selecting tool for operation:', error)
    }
  }

  if (operation && block.tools.access.includes(operation)) {
    return operation
  }

  return block.tools.access[0]
}

/**
 * Creates a tool schema for LLM with user-provided parameters excluded
 */
function buildParameterSchema(
  toolId: string,
  paramId: string,
  param: ToolParamDefinition,
  options: UserToolSchemaOptions = {}
): SchemaProperty {
  const surface = options.surface ?? 'default'

  if (param.type === 'file' || param.type === 'file[]') {
    return surface === 'copilot'
      ? buildCopilotFileParameterSchema(param)
      : buildFileReferenceParameterSchema(param)
  }

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

/**
 * File schema for model-facing surfaces other than Copilot: a reference string,
 * not a file object.
 *
 * A model has no way to produce the `key`, `url`, and `size` a real file object
 * carries — those come from a previous tool result or the block's own
 * configuration — so asking for the object would only invite invented values. An
 * id it can copy verbatim from what it just saw; the runtime hydrates it into
 * the full object before the tool runs.
 *
 * Without this branch a file param declared `user-or-llm` emitted `{"type":
 * "file"}`, which is not a JSON Schema type at all.
 */
function buildFileReferenceParameterSchema(param: ToolParamDefinition): SchemaProperty {
  const baseDescription =
    param.description ||
    (param.type === 'file' ? 'A file for tool execution.' : 'Files for tool execution.')
  const resolutionDescription =
    'Pass the file id from an earlier tool result, or a canonical workspace file id such as "wf_123". The runtime resolves it into the full file object before the tool runs.'
  const description = `${baseDescription} ${resolutionDescription}`

  if (param.type === 'file') {
    return { type: 'string', description }
  }

  return {
    type: 'array',
    description,
    items: { type: 'string', description: 'A file id.' },
  }
}

function buildCopilotFileParameterSchema(param: ToolParamDefinition): SchemaProperty {
  const baseDescription =
    param.description ||
    (param.type === 'file'
      ? 'A file object for tool execution.'
      : 'An array of file objects for tool execution.')
  const resolutionDescription =
    'For copilot and mothership tool calls, prefer passing canonical workspace file IDs such as "wf_123". The runtime will resolve them into full file objects before tool execution.'

  const fileObjectSchema: SchemaProperty = {
    type: 'object',
    description: `${baseDescription} ${resolutionDescription}`,
    properties: {
      id: { type: 'string', description: 'Canonical workspace file ID.' },
      name: { type: 'string', description: 'File name.' },
      url: { type: 'string', description: 'File URL or serve path.' },
      size: { type: 'number', description: 'File size in bytes.' },
      type: { type: 'string', description: 'MIME type.' },
      key: { type: 'string', description: 'Internal storage key.' },
      context: { type: 'string', description: 'Optional file context.' },
      base64: { type: 'string', description: 'Optional base64-encoded file contents.' },
    },
    required: ['id', 'name', 'url', 'size', 'type', 'key'],
  }

  if (param.type === 'file') {
    return fileObjectSchema
  }

  return {
    type: 'array',
    description: `${baseDescription} ${resolutionDescription}`,
    items: {
      type: 'object',
      description: 'A file object.',
      properties: fileObjectSchema.properties,
    },
  }
}

export function createUserToolSchema(
  toolConfig: ExecutableToolConfig,
  options: UserToolSchemaOptions = {}
): ToolSchema {
  const surface = options.surface ?? 'default'
  const hostedApiKeyParam =
    options.hostedKeySupport && toolConfig.hosting && !toolConfig.hosting.enabled
      ? toolConfig.hosting.apiKeyParam
      : undefined
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

    const propertySchema = buildParameterSchema(toolConfig.id, paramId, param, options)
    if (paramId === hostedApiKeyParam) {
      propertySchema.description = [
        propertySchema.description,
        'Optional: Sim provides a hosted key for this tool. Omit this parameter unless intentionally overriding with your own key.',
      ]
        .filter(Boolean)
        .join(' ')
    }
    // Copilot agents never see secret values, only names — so tell them the
    // reference form works here, or they paste placeholders that fail upstream.
    if (visibility === 'user-only' && surface === 'copilot') {
      propertySchema.description = [
        propertySchema.description,
        'Accepts an environment-variable reference like {{VAR_NAME}} (see environment/variables.json), resolved server-side.',
      ]
        .filter(Boolean)
        .join(' ')
    }
    schema.properties[paramId] = propertySchema

    if (param.required && paramId !== hostedApiKeyParam) {
      schema.required.push(paramId)
    }
  }

  if (toolConfig.oauth?.required && surface === 'copilot') {
    schema.properties.credentialId = {
      type: 'string',
      description:
        'Credential ID to use for this OAuth tool call. Required for Copilot/Superagent execution. Get valid IDs from environment/credentials.json.',
    }
    schema.required.push('credentialId')
  }

  return schema
}

export async function createLLMToolSchema(
  toolConfig: ExecutableToolConfig,
  userProvidedParams: Record<string, unknown>,
  enrichmentContext: WorkflowToolExecutionContext = {},
  readWorkflowInputFields?: WorkflowInputFieldsReader
): Promise<LLMToolSchemaResult> {
  const schema: ToolSchema = {
    type: 'object',
    properties: {},
    required: [],
  }

  // Derived from the declarations rather than from which branch below skipped a
  // param: the loop's `continue`s also skip params the user simply filled in,
  // and those are not off-limits to the model.
  const modelBlockedParams = Object.entries(toolConfig.params)
    .filter(([, param]) => param.visibility === 'user-only' || param.visibility === 'hidden')
    .map(([paramId]) => paramId)

  for (const [paramId, param] of Object.entries(toolConfig.params)) {
    const enrichmentConfig = toolConfig.schemaEnrichment?.[paramId]

    const isWorkflowInputMapping =
      toolConfig.id === 'workflow_executor' && paramId === 'inputMapping'

    if (enrichmentConfig) {
      const dependencyValue = userProvidedParams[enrichmentConfig.dependsOn] as string
      if (!dependencyValue) {
        continue
      }

      const propertySchema = buildParameterSchema(toolConfig.id, paramId, param)
      const enrichedSchema = await enrichmentConfig.enrichSchema(dependencyValue, enrichmentContext)

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
      if (isNonEmpty(userProvidedParams[paramId])) {
        continue
      }

      if (param.visibility === 'user-only') {
        continue
      }

      if (param.visibility === 'hidden') {
        continue
      }
    }

    const propertySchema = buildParameterSchema(toolConfig.id, paramId, param)

    if (isWorkflowInputMapping) {
      const workflowId = userProvidedParams.workflowId as string
      if (workflowId) {
        await applyDynamicSchemaForWorkflow(
          propertySchema,
          workflowId,
          enrichmentContext,
          readWorkflowInputFields
        )
      }
    }

    schema.properties[paramId] = propertySchema

    if ((param.visibility === 'user-or-llm' || param.visibility === 'llm-only') && param.required) {
      schema.required.push(paramId)
    }
  }

  if (toolConfig.toolEnrichment) {
    const dependencyValue = userProvidedParams[toolConfig.toolEnrichment.dependsOn] as string
    if (dependencyValue) {
      let enriched
      try {
        enriched = await toolConfig.toolEnrichment.enrichTool(
          dependencyValue,
          schema,
          toolConfig.description,
          enrichmentContext
        )
      } catch (error) {
        throw new ToolSchemaEnrichmentError(toolConfig.id, error)
      }
      if (enriched) {
        return {
          schema: enriched.parameters as ToolSchema,
          enrichedDescription: enriched.description,
          modelBlockedParams,
        }
      }
    }
  }

  return { schema, modelBlockedParams }
}

/**
 * Apply dynamic schema enrichment for workflow_executor's inputMapping parameter
 */
async function applyDynamicSchemaForWorkflow(
  propertySchema: SchemaProperty,
  workflowId: string,
  context: WorkflowToolExecutionContext,
  readWorkflowInputFields?: WorkflowInputFieldsReader
): Promise<void> {
  try {
    const workflowInputFields = await fetchWorkflowInputFields(
      workflowId,
      context,
      readWorkflowInputFields
    )

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

/** Reads workflow inputs through the authorized application operation. */
async function fetchWorkflowInputFields(
  workflowId: string,
  context: WorkflowToolExecutionContext,
  readWorkflowInputFields?: WorkflowInputFieldsReader
): Promise<Array<{ name: string; type: string; description?: string }>> {
  try {
    if (!context.executorDelegationOrigin || !readWorkflowInputFields) {
      throw new Error('Workflow input enrichment requires trusted execution authority')
    }
    return await readWorkflowInputFields(workflowId, context)
  } catch (error) {
    logger.error('Error fetching workflow input fields:', error)
    return []
  }
}

interface FilterableToolSchema {
  properties?: Record<string, unknown>
  required?: string[]
}

/** Filters user-provided parameters from any object-shaped tool schema sent to an LLM. */
export function filterSchemaForLLM<T extends FilterableToolSchema>(
  originalSchema: T,
  userProvidedParams: Record<string, unknown>
): T {
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

  return Object.assign({}, originalSchema, {
    properties: filteredProperties,
    required: filteredRequired,
  })
}

/**
 * Validates that all required parameters are provided
 */
export function validateToolParameters(
  toolConfig: ExecutableToolConfig,
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
 * A tool param's effective visibility.
 *
 * An undeclared visibility means the param is the user's to fill when it is optional,
 * and either party's when the tool requires it. Only 59 of 28,612 registry params rely
 * on this default, but the rule is duplicated wherever visibility is read, so it lives
 * here once.
 */
export function resolveToolParamVisibility(
  param: Pick<ToolParamDefinition, 'required' | 'visibility'>
): ParameterVisibility {
  return param.visibility ?? (param.required ? 'user-or-llm' : 'user-only')
}

/** Whether a tool param is offered to the user in a tool row. */
export function isUserFacingToolParam(
  param: Pick<ToolParamDefinition, 'required' | 'visibility'>
): boolean {
  const visibility = resolveToolParamVisibility(param)
  return visibility === 'user-or-llm' || visibility === 'user-only'
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
  'input-format',
  'response-format',
  'mcp-server-selector',
  'mcp-tool-selector',
  'mcp-dynamic-args',
  'variables-input',
  'messages-input',
  'router-input',
  'text',
])

/**
 * Canvas controls that have a tool-input counterpart collecting the same param.
 *
 * A tool row is a different surface with different affordances — it has no canvas
 * references to offer and far less room — so a couple of controls have a simpler
 * sibling. Declaring the swap keeps the sub-block the single source of truth for the
 * param: without it, the type would have to be excluded here and the field
 * reintroduced by a hard-coded per-tool branch, which is what this replaced.
 */
const TOOL_INPUT_SUBBLOCK_TYPE_SUBSTITUTIONS: Record<string, SubBlockType> = {
  'input-mapping': 'workflow-input-mapper',
}

export interface SubBlocksForToolInput {
  toolConfig: ToolMetadata
  subBlocks: BlockSubBlockConfig[]
  oauthConfig?: OAuthConfig
}

/**
 * Every sub-block id a tool param could resolve to, so a param backed by one is never
 * also synthesized as a bare field.
 *
 * Built from the block's FULL sub-block list, before any visibility or condition
 * filtering. A param whose sub-block exists but whose `condition` currently fails must
 * stay hidden rather than reappear as an unconditional text box, so a param is claimed
 * by its sub-block's existence, never by that sub-block surviving the filter.
 */
function buildClaimedParamIds(
  allSubBlocks: BlockSubBlockConfig[],
  canonicalIndex: ReturnType<typeof buildCanonicalIndex>
): Set<string> {
  const claimed = new Set<string>()

  for (const sb of allSubBlocks) {
    claimed.add(sb.id)
    if (sb.canonicalParamId) claimed.add(sb.canonicalParamId)

    const canonicalId = canonicalIndex.canonicalIdBySubBlockId[sb.id]
    if (canonicalId) {
      claimed.add(canonicalId)
      const group = canonicalIndex.groupsById[canonicalId]
      if (group) {
        if (group.basicId) claimed.add(group.basicId)
        for (const advancedId of group.advancedIds) claimed.add(advancedId)
      }
    }

    // A checkbox-list holds one boolean per option id, so those ids are the
    // param names it collects.
    if (
      (sb.type === 'checkbox-list' || sb.type === 'grouped-checkbox-list') &&
      Array.isArray(sb.options)
    ) {
      for (const option of sb.options) {
        if (option && typeof option === 'object' && 'id' in option && option.id) {
          claimed.add(String(option.id))
        }
      }
    }
  }

  return claimed
}

/**
 * The complete, ordered set of fields a tool exposes for configuration in a tool row.
 *
 * The block's own sub-blocks come first and are the primary source of UI metadata —
 * conditions, `dependsOn`, `selectorKey`, wand config, canonical basic/advanced pairs
 * all come along for free. Params the block does not surface get a `SubBlockConfig`
 * synthesized from their declared type, so they render through the same canonical
 * renderer instead of a parallel one that ignored their type and produced a text box.
 *
 * Synthesis is not optional: ~87 `user-only` params have no sub-block, and those are
 * excluded from the model's schema, so a rendered field is their only channel.
 */
export function getSubBlocksForToolInput(
  toolId: string,
  blockType: string,
  currentValues?: Record<string, unknown>,
  canonicalModeOverrides?: CanonicalModeOverrides,
  blockConfigOverride?: Pick<ToolInputBlockConfig, 'subBlocks'>
): SubBlocksForToolInput | null {
  try {
    const toolConfig = getToolMetadata(toolId)
    if (!toolConfig) {
      logger.warn(`Tool not found: ${toolId}`)
      return null
    }

    const blockConfigs = getBlockConfigurations()
    const blockConfig = blockConfigOverride ?? blockConfigs[blockType]

    // Custom (deploy-as-block) blocks: render their own editable field sub-blocks
    // as `user-or-llm` (the hidden workflowId/inputMapping wiring is filtered by
    // RESERVED_PARAMS — `isSubBlockHidden` does NOT honor `hidden: true`, so the
    // explicit reserved filter is what keeps them out).
    if (blockType && isCustomBlockType(blockType)) {
      const fieldSubBlocks = ((blockConfig?.subBlocks ?? []) as BlockSubBlockConfig[])
        .filter((sb) => !sb.hidden && !RESERVED_PARAMS.has(sb.id))
        .map((sb) => ({ ...sb, paramVisibility: 'user-or-llm' as ParameterVisibility }))
      return {
        toolConfig,
        subBlocks: fieldSubBlocks,
        oauthConfig: toolConfig.oauth,
      }
    }

    const allSubBlocks = (blockConfig?.subBlocks ?? []) as BlockSubBlockConfig[]
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
      toolParamVisibility[paramId] = resolveToolParamVisibility(param)
    }

    // Track which canonical groups we've already included (to avoid duplicates)
    const includedCanonicalIds = new Set<string>()

    const filtered: BlockSubBlockConfig[] = []

    /** Applies the tool-input counterpart of a canvas-only control, if it has one. */
    const forToolInput = (subBlock: BlockSubBlockConfig): BlockSubBlockConfig => {
      const substitute = TOOL_INPUT_SUBBLOCK_TYPE_SUBSTITUTIONS[subBlock.type]
      return substitute ? { ...subBlock, type: substitute } : subBlock
    }

    for (const original of allSubBlocks) {
      const sb = forToolInput(original)

      // Skip excluded types
      if (EXCLUDED_SUBBLOCK_TYPES.has(sb.type)) continue

      // Skip trigger-mode-only subblocks
      if (isTriggerModeSubBlock(sb)) continue

      // Hide tool API key fields when running on hosted Sim or when env var is set
      if (isSubBlockHidden(sb)) continue

      // A field the deployment has switched off is not offerable here either —
      // the canvas already hides it, and offering it in tool-input lets an author
      // pick a value the executor will refuse (e.g. Python with no sandbox provider).
      if (!isSubBlockFeatureEnabled(sb)) continue

      // Determine the effective param ID (canonical or subblock id)
      const effectiveParamId = sb.canonicalParamId || sb.id

      // Resolve paramVisibility: explicit > inferred from tool params > skip
      let visibility = sb.paramVisibility
      if (!visibility) {
        // Infer from structural checks
        if (STRUCTURAL_SUBBLOCK_IDS.has(sb.id)) {
          visibility = 'hidden'
        } else if (AUTH_SUBBLOCK_TYPES.has(sb.type) && sb.canonicalParamId !== 'oauthCredential') {
          visibility = 'hidden'
        } else if (sb.canonicalParamId === 'oauthCredential') {
          visibility = 'user-only'
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

      if (sb.condition && !sb.reactiveCondition) {
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
              filtered.push({ ...forToolInput(advancedSb), paramVisibility: visibility })
            }
          } else {
            // Include basic variant (current sb if it's the basic one)
            if (group.basicId === sb.id) {
              filtered.push({ ...sb, paramVisibility: visibility })
            } else {
              const basicSb = allSubBlocks.find((s) => s.id === group.basicId)
              if (basicSb) {
                filtered.push({ ...forToolInput(basicSb), paramVisibility: visibility })
              }
            }
          }
          continue
        }
      }

      // Non-canonical, non-hidden, condition-passing subblock
      filtered.push({ ...sb, paramVisibility: visibility })
    }

    const claimedParamIds = buildClaimedParamIds(allSubBlocks, canonicalIndex)

    for (const [paramId, param] of Object.entries(toolConfig.params || {})) {
      if (claimedParamIds.has(paramId)) continue

      const visibility = toolParamVisibility[paramId]
      if (visibility === 'hidden' || visibility === 'llm-only') continue

      filtered.push(
        buildSubBlockForToolParam(
          paramId,
          param,
          formatParameterLabel(paramId),
          isPasswordParameter(paramId)
        )
      )
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
