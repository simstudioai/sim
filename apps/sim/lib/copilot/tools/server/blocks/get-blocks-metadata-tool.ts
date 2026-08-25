import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { omit } from '@sim/utils/object'
import { z } from 'zod'
import {
  type CatalogBlockDetail,
  type CatalogInputDefinition,
  projectBlockDetail,
  splitFieldsByOperation,
} from '@/lib/catalog/projection/block-detail'
import type { CatalogSubBlock } from '@/lib/catalog/projection/subblock'
import type { CatalogToolSummary } from '@/lib/catalog/projection/tool'
import { getCopilotToolDescription } from '@/lib/copilot/tools/descriptions'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { getAllowedIntegrationsFromEnv, isHosted } from '@/lib/core/config/env-flags'
import { isIntegrationDeploymentAvailableForVisibility } from '@/lib/integrations/availability.server'
import { getServiceAccountProviderForProviderId } from '@/lib/oauth/utils'
import { isBlockTypeAccessControlExempt } from '@/lib/permission-groups/block-access'
import { intersectIntegrationAllowlists } from '@/lib/permission-groups/integration-allowlist'
import {
  collectDeniedOperationIds,
  createToolAccessGate,
  type IsToolAllowed,
  OPERATION_SUBBLOCK_ID,
  type OperationGateBlock,
} from '@/lib/permission-groups/operation-access'
import { getBlock } from '@/blocks/registry'
import { AuthMode, type BlockConfig, type SubBlockConfig } from '@/blocks/types'
import { isHiddenUnder, overlayVisibility } from '@/blocks/visibility/context'
import { getUserPermissionConfig } from '@/ee/access-control/utils/permission-check'

/**
 * The block shape this tool reports, projected by the shared catalog projection
 * (`@/lib/catalog/projection`) and then reshaped for the agent below.
 *
 * The projection reads tool params and outputs from `@/tools/metadata` and
 * `@/tools/metadata-outputs` rather than the executable registry, which is what
 * keeps this module's graph off the ~4,700 modules `@/tools/registry` costs.
 */
type CopilotSubblockMetadata = CatalogSubBlock

interface CopilotToolMetadata {
  id: string
  name: string
  description?: string
  inputs?: Record<string, unknown>
  outputs?: Record<string, unknown>
}

interface CopilotTriggerMetadata {
  id: string
  outputs?: Record<string, unknown>
  configFields?: Record<string, unknown>
}

interface CopilotBlockMetadata {
  id: string
  name: string
  description: string
  bestPractices?: string
  inputSchema: CopilotSubblockMetadata[]
  inputDefinitions?: Record<string, any>
  triggerAllowed?: boolean
  authType?: 'OAuth' | 'API Key' | 'Bot Token'
  tools: CopilotToolMetadata[]
  triggers: CopilotTriggerMetadata[]
  operationInputSchema: Record<string, CopilotSubblockMetadata[]>
  operations?: Record<
    string,
    {
      toolId?: string
      toolName?: string
      description?: string
      inputs?: Record<string, any>
      outputs?: Record<string, any>
      inputSchema?: CopilotSubblockMetadata[]
    }
  >
  outputs?: Record<string, any>
  yamlDocumentation?: string
}

const GetBlocksMetadataInputSchema = z.object({ blockIds: z.array(z.string()).min(1) })
const GetBlocksMetadataResultSchema = z.object({ metadata: z.record(z.string(), z.any()) })

/**
 * Prompt-shaped tool description: the raw text plus the hosted-key note the
 * agent needs. The public catalog publishes the raw description and a structured
 * `hostedApiKey` instead, which is why this stays a Copilot concern rather than
 * moving into the shared projection.
 */
function describeToolForAgent(tool: CatalogToolSummary): string {
  return getCopilotToolDescription(tool, {
    isHosted,
    hostedApiKey: tool.hostedApiKey,
    fallbackName: tool.id,
  })
}

/** Reshapes the shared block projection into the agent-facing metadata above. */
function toCopilotBlockMetadata(detail: CatalogBlockDetail): CopilotBlockMetadata {
  return removeNullish({
    id: detail.id,
    name: detail.name,
    description: detail.longDescription || detail.description || '',
    bestPractices: detail.bestPractices,
    inputSchema: detail.inputSchema,
    inputDefinitions: detail.inputDefinitions,
    triggerAllowed: detail.triggerAllowed,
    authType: resolveAuthType(detail.authMode as AuthMode | undefined),
    tools: detail.tools.map((tool) => ({
      id: tool.id,
      name: tool.name,
      description: tool.description,
      inputs: tool.params,
      outputs: tool.outputs,
    })),
    triggers: detail.triggers,
    operationInputSchema: detail.operationInputSchema,
    operations: detail.operations,
    outputs: detail.outputs,
  }) as CopilotBlockMetadata
}

/**
 * Strips everything a denied tool id reaches in one block's metadata: the tool
 * entry, every operation that runs it, that operation's input schema, and the
 * selector option that would choose it.
 *
 * Returns the projection untouched when the group denies nothing this block
 * owns, so an unrestricted viewer pays one pass over `operations` and nothing
 * else. `null` means the block has no usable operation left and should be
 * withheld entirely, matching the VFS projection.
 */
function withDeniedToolsRemoved(
  metadata: CopilotBlockMetadata,
  block: OperationGateBlock,
  isToolAllowed: IsToolAllowed
): CopilotBlockMetadata | null {
  const operations = metadata.operations ?? {}
  /* Resolved through the shared operation gate rather than `operation.toolId`:
     the catalog projection fills that field only from `tools.config.tool`, so a
     block whose operation ids ARE its tool ids leaves it undefined and every one
     of its operations would read as permitted. */
  const deniedOperations = collectDeniedOperationIds(block, Object.keys(operations), isToolAllowed)
  const tools = metadata.tools.filter((tool) => isToolAllowed(tool.id))
  if (deniedOperations.size === 0 && tools.length === metadata.tools.length) return metadata

  const allToolsDenied = metadata.tools.length > 0 && tools.length === 0
  const allOperationsDenied =
    Object.keys(operations).length > 0 && deniedOperations.size === Object.keys(operations).length
  if (allToolsDenied || allOperationsDenied) return null

  return {
    ...metadata,
    tools,
    /* `removeNullish` drops an empty projection, so neither schema is
       guaranteed present. */
    ...(metadata.inputSchema
      ? {
          inputSchema: metadata.inputSchema.map((field) =>
            field.id === OPERATION_SUBBLOCK_ID && Array.isArray(field.options)
              ? {
                  ...field,
                  options: field.options.filter((option) => !deniedOperations.has(option.id)),
                }
              : field
          ),
        }
      : {}),
    operations: omit(operations, [...deniedOperations]),
    ...(metadata.operationInputSchema
      ? { operationInputSchema: omit(metadata.operationInputSchema, [...deniedOperations]) }
      : {}),
  }
}

export const getBlocksMetadataServerTool: BaseServerTool<
  z.infer<typeof GetBlocksMetadataInputSchema>,
  z.infer<typeof GetBlocksMetadataResultSchema>
> = {
  name: 'get_blocks_metadata',
  inputSchema: GetBlocksMetadataInputSchema,
  outputSchema: GetBlocksMetadataResultSchema,
  async execute(
    { blockIds }: z.infer<typeof GetBlocksMetadataInputSchema>,
    context?: { userId: string; workspaceId?: string }
  ): Promise<z.infer<typeof GetBlocksMetadataResultSchema>> {
    const logger = createLogger('GetBlocksMetadataServerTool')
    logger.debug('Executing get_blocks_metadata', { count: blockIds?.length })

    const permissionConfig =
      context?.userId && context?.workspaceId
        ? await getUserPermissionConfig(context.userId, context.workspaceId)
        : null
    const allowedIntegrations = intersectIntegrationAllowlists(
      permissionConfig?.allowedIntegrations ?? null,
      getAllowedIntegrationsFromEnv()
    )
    const isToolAllowed = createToolAccessGate(permissionConfig?.deniedTools)
    const visibility = overlayVisibility()

    const result: Record<string, CopilotBlockMetadata> = {}
    for (const blockId of blockIds || []) {
      const specialBlock = SPECIAL_BLOCKS_METADATA[blockId]
      if (!isIntegrationDeploymentAvailableForVisibility(blockId, visibility)) {
        logger.debug('Block unavailable for this deployment', { blockId })
        continue
      }
      if (
        allowedIntegrations != null &&
        !specialBlock &&
        !isBlockTypeAccessControlExempt(blockId) &&
        !allowedIntegrations.includes(blockId.toLowerCase())
      ) {
        logger.debug('Block not allowed by permission group', { blockId })
        continue
      }

      let metadata: CopilotBlockMetadata

      if (specialBlock) {
        const inputDefinitions: Record<string, CatalogInputDefinition> = specialBlock.inputs || {}
        const { commonFields, operationFields } = splitFieldsByOperation(
          (specialBlock.subBlocks || []) as SubBlockConfig[],
          inputDefinitions
        )
        metadata = {
          id: specialBlock.id,
          name: specialBlock.name,
          description: specialBlock.description || '',
          inputSchema: commonFields,
          inputDefinitions,
          tools: [],
          triggers: [],
          operationInputSchema: operationFields,
          outputs: specialBlock.outputs,
        }
      } else {
        const blockConfig: BlockConfig | undefined = getBlock(blockId)
        if (!blockConfig) {
          logger.debug('Block not found in registry', { blockId })
          continue
        }

        if (blockConfig.hideFromToolbar) {
          logger.debug('Skipping block hidden from toolbar', { blockId })
          continue
        }

        // getBlock is pure, so the viewer's visibility must be checked
        // explicitly: unrevealed preview blocks and kill-switched types stay
        // out of the agent's metadata (the router wraps this tool in
        // withBlockVisibility).
        if (isHiddenUnder(visibility, blockConfig)) {
          logger.debug('Skipping block gated by visibility', { blockId })
          continue
        }

        /**
         * One block's projection must not fail the whole call. A sub-block
         * `condition` declared as a function is invoked during projection, and a
         * throwing one propagates — the `catalog-sweep` test proves no
         * registered block has one, but a runtime-built custom (deploy-as-block)
         * config is not swept, so this keeps the blast radius to the block that
         * carries the defect rather than every block the agent asked for.
         */
        try {
          metadata = toCopilotBlockMetadata(
            projectBlockDetail(blockConfig, {
              deployment: { hostedKeys: isHosted },
              describeTool: describeToolForAgent,
            })
          )
        } catch (error) {
          logger.error('Failed to project block metadata', {
            blockId,
            error: toError(error).message,
          })
          continue
        }

        const permitted = withDeniedToolsRemoved(metadata, blockConfig, isToolAllowed)
        if (!permitted) {
          logger.debug('Block has no operation this permission group allows', { blockId })
          continue
        }
        metadata = permitted
      }

      try {
        const workingDir = process.cwd()
        const isInAppsSim = workingDir.endsWith('/apps/sim') || workingDir.endsWith('\\apps\\sim')
        const basePath = isInAppsSim ? join(workingDir, '..', '..') : workingDir
        const docPath = join(
          basePath,
          'apps',
          'docs',
          'content',
          'docs',
          'yaml',
          'blocks',
          `${DOCS_FILE_MAPPING[blockId] || blockId}.mdx`
        )
        if (existsSync(docPath)) {
          metadata.yamlDocumentation = readFileSync(docPath, 'utf-8')
        }
      } catch (error) {
        logger.warn('Failed to read YAML documentation file', {
          error: toError(error).message,
        })
      }

      result[blockId] = metadata
    }

    const transformedResult: Record<string, any> = {}
    for (const [blockId, metadata] of Object.entries(result)) {
      transformedResult[blockId] = transformBlockMetadata(metadata)
    }

    return GetBlocksMetadataResultSchema.parse({ metadata: transformedResult })
  },
}

function transformBlockMetadata(metadata: CopilotBlockMetadata): any {
  const transformed: any = {
    blockType: metadata.id,
    name: metadata.name,
    description: metadata.description,
  }

  if (metadata.bestPractices) {
    transformed.bestPractices = metadata.bestPractices
  }

  if (metadata.authType) {
    transformed.authType = metadata.authType

    if (metadata.authType === 'OAuth') {
      transformed.requiredCredentials = {
        type: 'oauth',
        service: metadata.id, // e.g., 'gmail', 'slack', etc.
        description: `OAuth authentication required for ${metadata.name}`,
      }

      // Check if this service also supports service account credentials
      const oauthSubBlock = metadata.inputSchema?.find(
        (sb: CopilotSubblockMetadata) => sb.type === 'oauth-input' && sb.serviceId
      )
      if (oauthSubBlock?.serviceId) {
        const serviceAccountProviderId = getServiceAccountProviderForProviderId(
          oauthSubBlock.serviceId
        )
        if (serviceAccountProviderId) {
          transformed.requiredCredentials.serviceAccountType = serviceAccountProviderId
          transformed.requiredCredentials.description = `OAuth or service account authentication supported for ${metadata.name}`
        }
      }
    } else if (metadata.authType === 'API Key') {
      transformed.requiredCredentials = {
        type: 'api_key',
        description: `API key required for ${metadata.name}`,
      }
    } else if (metadata.authType === 'Bot Token') {
      transformed.requiredCredentials = {
        type: 'bot_token',
        description: `Bot token required for ${metadata.name}`,
      }
    }
  }

  const inputs = extractInputs(metadata)
  if (inputs.required.length > 0 || inputs.optional.length > 0) {
    transformed.inputs = inputs
  }

  const hasOperations = metadata.operations && Object.keys(metadata.operations).length > 0
  if (hasOperations && metadata.operations) {
    const blockLevelInputs = new Set(Object.keys(metadata.inputDefinitions || {}))
    transformed.operations = Object.entries(metadata.operations).reduce(
      (acc, [opId, opData]) => {
        acc[opId] = {
          name: opData.toolName || opId,
          description: opData.description,
          inputs: extractOperationInputs(opData, blockLevelInputs),
          outputs: formatOutputsFromDefinition(opData.outputs || {}),
        }
        return acc
      },
      {} as Record<string, any>
    )
  }

  if (!hasOperations) {
    const outputs = extractOutputs(metadata)
    if (outputs.length > 0) {
      transformed.outputs = outputs
    }
  }

  if (metadata.triggers && metadata.triggers.length > 0) {
    transformed.triggers = metadata.triggers.map((t) => ({
      id: t.id,
      outputs: formatOutputsFromDefinition(t.outputs || {}),
      configFields: t.configFields || {},
    }))
  }

  if (metadata.yamlDocumentation) {
    transformed.yamlDocumentation = metadata.yamlDocumentation
  }

  return transformed
}

function extractInputs(metadata: CopilotBlockMetadata): {
  required: any[]
  optional: any[]
} {
  const required: any[] = []
  const optional: any[] = []
  const inputDefs = metadata.inputDefinitions || {}

  for (const schema of metadata.inputSchema || []) {
    // Skip trigger subBlocks - they're handled separately in triggers.configFields
    if (schema.mode === 'trigger' || schema.mode === 'trigger-advanced') {
      continue
    }

    if (schema.id === 'triggerConfig' || schema.type === 'trigger-config') {
      continue
    }

    const inputDef = inputDefs[schema.id] || inputDefs[schema.canonicalParamId || '']

    let description = schema.description || inputDef?.description || schema.title
    if (schema.id === 'operation') {
      description = 'Operation to perform'
    }

    const input: any = {
      name: schema.id,
      type: mapSchemaTypeToSimpleType(schema.type, schema),
      description,
    }

    if (schema.options && schema.options.length > 0) {
      input.options = schema.options.map((opt) => opt.id || opt.label)
    }

    if (inputDef?.enum && Array.isArray(inputDef.enum)) {
      input.options = inputDef.enum
    }

    if (schema.defaultValue !== undefined) {
      input.default = schema.defaultValue
    } else if (inputDef?.default !== undefined) {
      input.default = inputDef.default
    }

    if (schema.type === 'slider' || schema.type === 'number-input') {
      if (schema.min !== undefined) input.min = schema.min
      if (schema.max !== undefined) input.max = schema.max
    } else if (inputDef?.minimum !== undefined || inputDef?.maximum !== undefined) {
      if (inputDef.minimum !== undefined) input.min = inputDef.minimum
      if (inputDef.maximum !== undefined) input.max = inputDef.maximum
    }

    const example = generateInputExample(schema, inputDef)
    if (example !== undefined) {
      input.example = example
    }

    const isOperationField =
      schema.id === 'operation' &&
      metadata.operations &&
      Object.keys(metadata.operations).length > 0
    const isRequired = schema.required || inputDef?.required || isOperationField

    if (isRequired) {
      required.push(input)
    } else {
      optional.push(input)
    }
  }

  return { required, optional }
}

function extractOperationInputs(
  opData: any,
  blockLevelInputs: Set<string>
): {
  required: any[]
  optional: any[]
} {
  const required: any[] = []
  const optional: any[] = []
  const inputs = opData.inputs || {}

  for (const [key, inputDef] of Object.entries(inputs)) {
    if (blockLevelInputs.has(key)) {
      continue
    }

    const input: any = {
      name: key,
      type: (inputDef as any)?.type || 'string',
      description: (inputDef as any)?.description,
    }

    if ((inputDef as any)?.enum) {
      input.options = (inputDef as any).enum
    }

    if ((inputDef as any)?.default !== undefined) {
      input.default = (inputDef as any).default
    }

    if ((inputDef as any)?.example !== undefined) {
      input.example = (inputDef as any).example
    }

    if ((inputDef as any)?.required) {
      required.push(input)
    } else {
      optional.push(input)
    }
  }

  return { required, optional }
}

function extractOutputs(metadata: CopilotBlockMetadata): any[] {
  const outputs: any[] = []

  if (metadata.outputs && Object.keys(metadata.outputs).length > 0) {
    return formatOutputsFromDefinition(metadata.outputs)
  }

  if (metadata.operations && Object.keys(metadata.operations).length > 0) {
    const firstOp = Object.values(metadata.operations)[0]
    return formatOutputsFromDefinition(firstOp.outputs || {})
  }

  return outputs
}

function formatOutputsFromDefinition(outputDefs: Record<string, any>): any[] {
  const outputs: any[] = []

  for (const [key, def] of Object.entries(outputDefs)) {
    const output: any = {
      name: key,
      type: typeof def === 'string' ? def : def?.type || 'any',
    }

    if (typeof def === 'object') {
      if (def.description) output.description = def.description
      if (def.example) output.example = def.example
    }

    outputs.push(output)
  }

  return outputs
}

function mapSchemaTypeToSimpleType(schemaType: string, schema: CopilotSubblockMetadata): string {
  const typeMap: Record<string, string> = {
    'short-input': 'string',
    'long-input': 'string',
    'code-input': 'string',
    'number-input': 'number',
    slider: 'number',
    dropdown: 'string',
    combobox: 'string',
    toggle: 'boolean',
    'json-input': 'json',
    'file-upload': 'file',
    'multi-select': 'array',
    'credential-input': 'credential',
    'oauth-credential': 'credential',
    'oauth-input': 'credential',
  }

  const mappedType = typeMap[schemaType] || schemaType

  if (schema.multiSelect) return 'array'

  return mappedType
}

function generateInputExample(schema: CopilotSubblockMetadata, inputDef?: any): any {
  if (inputDef?.example !== undefined) return inputDef.example

  switch (schema.type) {
    case 'short-input':
    case 'long-input':
      if (schema.id === 'systemPrompt') return 'You are a helpful assistant...'
      if (schema.id === 'userPrompt') return 'What is the weather today?'
      if (schema.placeholder) return schema.placeholder
      return undefined
    case 'number-input':
    case 'slider':
      return schema.defaultValue ?? schema.min ?? 0
    case 'toggle':
      return schema.defaultValue ?? false
    case 'json-input':
      return schema.defaultValue ?? {}
    case 'dropdown':
    case 'combobox':
      if (schema.options && schema.options.length > 0) {
        return schema.options[0].id
      }
      return undefined
    default:
      return undefined
  }
}
function resolveAuthType(
  authMode: AuthMode | undefined
): 'OAuth' | 'API Key' | 'Bot Token' | undefined {
  if (!authMode) return undefined
  if (authMode === AuthMode.OAuth) return 'OAuth'
  if (authMode === AuthMode.ApiKey) return 'API Key'
  if (authMode === AuthMode.BotToken) return 'Bot Token'
  return undefined
}
function removeNullish(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj

  const cleaned: any = Array.isArray(obj) ? [] : {}

  for (const [key, value] of Object.entries(obj)) {
    if (value !== null && value !== undefined) {
      cleaned[key] = value
    }
  }

  return cleaned
}
const DOCS_FILE_MAPPING: Record<string, string> = {}

const SPECIAL_BLOCKS_METADATA: Record<string, any> = {
  loop: {
    id: 'loop',
    name: 'Loop',
    description: 'Control flow block for iterating over collections or repeating actions',
    longDescription:
      'Control flow block for iterating over collections or repeating actions serially',
    bestPractices: `
    - Set reasonable limits for iterations.
    - Use forEach for collection processing, for loops for fixed iterations.
    - Cannot have loops/parallels inside a loop block.
    - For yaml it needs to connect blocks inside to the start field of the block.
    - IMPORTANT for while/doWhile: The condition is evaluated BEFORE each iteration starts, so blocks INSIDE the loop cannot be referenced in the condition (their outputs don't exist yet when the condition runs).
    - For while/doWhile conditions, use: <loop.index> for iteration count, workflow variables (set by blocks OUTSIDE the loop), or references to blocks OUTSIDE the loop.
    - To break a while/doWhile loop based on internal block results, use a variables block OUTSIDE the loop and update it from inside, then reference that variable in the condition.
    `,
    inputs: {
      loopType: {
        type: 'string',
        required: true,
        enum: ['for', 'forEach', 'while', 'doWhile'],
        description:
          "Loop Type - 'for' runs N times, 'forEach' iterates over collection, 'while' runs while condition is true, 'doWhile' runs at least once then checks condition",
      },
      iterations: {
        type: 'number',
        required: false,
        minimum: 1,
        maximum: 1000,
        description: "Number of iterations (for 'for' loopType)",
        example: 5,
      },
      collection: {
        type: 'string',
        required: false,
        description: "Collection to iterate over (for 'forEach' loopType)",
        example: '<previousblock.items>',
      },
      condition: {
        type: 'string',
        required: false,
        description:
          "Condition to evaluate (for 'while' and 'doWhile' loopType). IMPORTANT: Cannot reference blocks INSIDE the loop - use <loop.index>, workflow variables, or blocks OUTSIDE the loop instead.",
        example: '<loop.index> < 10',
      },
      maxConcurrency: {
        type: 'number',
        required: false,
        default: 1,
        minimum: 1,
        maximum: 10,
        description: 'Max parallel executions (1 = sequential)',
        example: 1,
      },
    },
    outputs: {
      results: { type: 'array', description: 'Array of results from each iteration' },
      currentIndex: { type: 'number', description: 'Current iteration index (0-based)' },
      currentItem: { type: 'any', description: 'Current item being iterated (for forEach loops)' },
      totalIterations: { type: 'number', description: 'Total number of iterations' },
    },
    subBlocks: [
      {
        id: 'loopType',
        title: 'Loop Type',
        type: 'dropdown',
        required: true,
        options: [
          { label: 'For Loop (count)', id: 'for' },
          { label: 'For Each (collection)', id: 'forEach' },
          { label: 'While (condition)', id: 'while' },
          { label: 'Do While (condition)', id: 'doWhile' },
        ],
      },
      {
        id: 'iterations',
        title: 'Iterations',
        type: 'slider',
        min: 1,
        max: 1000,
        integer: true,
        condition: { field: 'loopType', value: 'for' },
      },
      {
        id: 'collection',
        title: 'Collection',
        type: 'short-input',
        placeholder: 'Array or object to iterate over...',
        condition: { field: 'loopType', value: 'forEach' },
      },
      {
        id: 'condition',
        title: 'Condition',
        type: 'code',
        language: 'javascript',
        placeholder: '<loop.index> < 10 or <variable.variablename>',
        description:
          'Cannot reference blocks inside the loop. Use <loop.index>, workflow variables, or blocks outside the loop.',
        condition: { field: 'loopType', value: ['while', 'doWhile'] },
      },
      {
        id: 'maxConcurrency',
        title: 'Max Concurrency',
        type: 'slider',
        min: 1,
        max: 10,
        integer: true,
        default: 1,
      },
    ],
  },
  parallel: {
    id: 'parallel',
    name: 'Parallel',
    description: 'Control flow block for executing multiple branches simultaneously',
    longDescription: 'Control flow block for executing multiple branches simultaneously',
    bestPractices: `
    - Keep structures inside simple. Cannot have multiple blocks within a parallel block.
    - Cannot have loops/parallels inside a parallel block.
    - Agent block combobox can be <parallel.currentItem> if the user wants to query multiple models in parallel. The collection has to be an array of correct model strings available for the agent block.
    - For yaml it needs to connect blocks inside to the start field of the block.
    `,
    inputs: {
      parallelType: {
        type: 'string',
        required: true,
        enum: ['count', 'collection'],
        description: "Parallel Type - 'count' runs N branches, 'collection' runs one per item",
      },
      count: {
        type: 'number',
        required: false,
        minimum: 1,
        maximum: 100,
        description: "Number of parallel branches (for 'count' type)",
        example: 3,
      },
      collection: {
        type: 'string',
        required: false,
        description: "Collection to process in parallel (for 'collection' type)",
        example: '<previousblock.items>',
      },
      maxConcurrency: {
        type: 'number',
        required: false,
        default: 10,
        minimum: 1,
        maximum: 50,
        description: 'Max concurrent executions at once',
        example: 10,
      },
    },
    outputs: {
      results: { type: 'array', description: 'Array of results from all parallel branches' },
      index: { type: 'number', description: 'Current branch index (0-based)' },
      currentItem: {
        type: 'any',
        description: 'Current item for this branch (for collection type)',
      },
      items: { type: 'array', description: 'All distribution items' },
    },
    subBlocks: [
      {
        id: 'parallelType',
        title: 'Parallel Type',
        type: 'dropdown',
        required: true,
        options: [
          { label: 'Count (number)', id: 'count' },
          { label: 'Collection (array)', id: 'collection' },
        ],
      },
      {
        id: 'count',
        title: 'Count',
        type: 'slider',
        min: 1,
        max: 100,
        integer: true,
        condition: { field: 'parallelType', value: 'count' },
      },
      {
        id: 'collection',
        title: 'Collection',
        type: 'short-input',
        placeholder: 'Array to process in parallel...',
        condition: { field: 'parallelType', value: 'collection' },
      },
      {
        id: 'maxConcurrency',
        title: 'Max Concurrency',
        type: 'slider',
        min: 1,
        max: 50,
        integer: true,
        default: 10,
      },
    ],
  },
}
