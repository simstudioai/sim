import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { resolveBlockRetryConfig } from '@sim/workflow-types/workflow'
import type { Edge } from '@xyflow/react'
import type { CanonicalModeOverrides } from '@/lib/workflows/subblocks/visibility'
import {
  buildCanonicalIndex,
  buildSubBlockValues,
  evaluateSubBlockCondition,
  getCanonicalValues,
  isCanonicalPair,
  isNonEmptyValue,
  isSubBlockHidden,
  isToolInputOnlySubBlock,
  resolveCanonicalMode,
} from '@/lib/workflows/subblocks/visibility'
import { getBlock } from '@/blocks'
import { isCustomBlockType, RESERVED_PARAMS } from '@/blocks/custom/build-config'
import type { SubBlockConfig } from '@/blocks/types'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'
import type { BlockState, Loop, Parallel } from '@/stores/workflows/workflow/types'
import { generateLoopBlocks, generateParallelBlocks } from '@/stores/workflows/workflow/utils'
import { getToolParams } from '@/tools/metadata'
import { expandSubBlockValueToParams } from '@/tools/param-shape'

const logger = createLogger('Serializer')

/**
 * Structured validation error for pre-execution workflow validation
 */
export class WorkflowValidationError extends Error {
  constructor(
    message: string,
    public blockId?: string,
    public blockType?: string,
    public blockName?: string
  ) {
    super(message)
    this.name = 'WorkflowValidationError'
  }
}

/**
 * Helper function to check if a subblock should be serialized.
 */
function shouldSerializeSubBlock(
  subBlockConfig: SubBlockConfig,
  values: Record<string, unknown>,
  displayAdvancedOptions: boolean,
  isTriggerContext: boolean,
  isTriggerCategory: boolean,
  canonicalIndex: ReturnType<typeof buildCanonicalIndex>,
  canonicalModeOverrides?: CanonicalModeOverrides
): boolean {
  // Only meaningful when the block is invoked as an agent tool, where the
  // value lives on the tool entry rather than the block. Serializing it here
  // would let a non-UI writer (copilot, YAML import) set an invisible secret
  // scope that the executor's env inlining does not honor.
  if (isToolInputOnlySubBlock(subBlockConfig)) return false
  if (isSubBlockHidden(subBlockConfig)) return false

  // `trigger-advanced` is a trigger-mode field too - the advanced twin of a
  // `trigger` selector - so it must be excluded from tool-mode serialization for
  // the same reason. Without this it stays a live, validated tool param: a
  // trigger's `required` manual field then blocks running an unrelated operation
  // that does not even render it, and the error names a hidden field.
  if (subBlockConfig.mode === 'trigger' || subBlockConfig.mode === 'trigger-advanced') {
    if (!isTriggerContext && !isTriggerCategory) return false
  } else if (isTriggerContext && !isTriggerCategory) {
    return false
  }

  const isCanonicalMember = Boolean(canonicalIndex.canonicalIdBySubBlockId[subBlockConfig.id])
  if (isCanonicalMember) {
    const canonicalId = canonicalIndex.canonicalIdBySubBlockId[subBlockConfig.id]
    const group = canonicalId ? canonicalIndex.groupsById[canonicalId] : undefined
    if (group && isCanonicalPair(group)) {
      const mode =
        canonicalModeOverrides?.[group.canonicalId] != null || !displayAdvancedOptions
          ? resolveCanonicalMode(group, values, canonicalModeOverrides)
          : 'advanced'
      const matchesMode =
        mode === 'advanced'
          ? group.advancedIds.includes(subBlockConfig.id)
          : group.basicId === subBlockConfig.id
      return matchesMode && evaluateSubBlockCondition(subBlockConfig.condition, values)
    }
    return evaluateSubBlockCondition(subBlockConfig.condition, values)
  }

  if (subBlockConfig.mode === 'advanced' && !displayAdvancedOptions) {
    return isNonEmptyValue(values[subBlockConfig.id])
  }
  if (subBlockConfig.mode === 'basic' && displayAdvancedOptions) {
    return false
  }

  return evaluateSubBlockCondition(subBlockConfig.condition, values)
}

/**
 * Helper function to migrate agent block params from old format to messages array
 * Transforms systemPrompt/userPrompt into messages array format
 * Only migrates if old format exists and new format doesn't (idempotent)
 */
function migrateAgentParamsToMessages(
  params: Record<string, any>,
  subBlocks: Record<string, any>,
  blockId: string
): void {
  // Only migrate if old format exists and new format doesn't
  if ((params.systemPrompt || params.userPrompt) && !params.messages) {
    logger.info('Migrating agent block from legacy format to messages array', {
      blockId,
      hasSystemPrompt: !!params.systemPrompt,
      hasUserPrompt: !!params.userPrompt,
    })

    const messages: any[] = []

    // Add system message first (industry standard)
    if (params.systemPrompt) {
      messages.push({
        role: 'system',
        content: params.systemPrompt,
      })
    }

    // Add user message
    if (params.userPrompt) {
      let userContent = params.userPrompt

      // Handle object format (e.g., { input: "..." })
      if (typeof userContent === 'object' && userContent !== null) {
        if ('input' in userContent) {
          userContent = userContent.input
        } else {
          // If it's an object but doesn't have 'input', stringify it
          userContent = JSON.stringify(userContent)
        }
      }

      messages.push({
        role: 'user',
        content: String(userContent),
      })
    }

    // Set the migrated messages in subBlocks
    subBlocks.messages = {
      id: 'messages',
      type: 'messages-input',
      value: messages,
    }
  }
}

export class Serializer {
  serializeWorkflow(
    blocks: Record<string, BlockState>,
    edges: Edge[],
    loops?: Record<string, Loop>,
    parallels?: Record<string, Parallel>,
    validateRequired = false
  ): SerializedWorkflow {
    const canonicalLoops = generateLoopBlocks(blocks)
    const canonicalParallels = generateParallelBlocks(blocks)
    const safeLoops = Object.keys(canonicalLoops).length > 0 ? canonicalLoops : loops || {}
    const safeParallels =
      Object.keys(canonicalParallels).length > 0 ? canonicalParallels : parallels || {}
    if (validateRequired) {
      this.validateSubflowsBeforeExecution(blocks, safeLoops, safeParallels)
    }

    // A custom block whose definition was deleted (or is out of scope) no longer
    // resolves via `getBlock`. Treat it as a removed block — drop it and any edges
    // touching it — so the rest of the workflow still serializes and runs, instead
    // of throwing `Invalid block type` and corrupting the whole workflow.
    const droppedBlockIds = new Set<string>()
    const serializedBlocks: SerializedBlock[] = []
    for (const block of Object.values(blocks)) {
      if (isCustomBlockType(block.type) && !getBlock(block.type)) {
        droppedBlockIds.add(block.id)
        logger.warn(`Dropping unresolvable custom block from serialization`, {
          blockId: block.id,
          type: block.type,
        })
        continue
      }
      serializedBlocks.push(this.serializeBlock(block, { validateRequired, allBlocks: blocks }))
    }

    return {
      version: '1.0',
      blocks: serializedBlocks,
      /** Legacy handleless branches infer route IDs from edge order, including missing targets. */
      connections: edges
        .filter((edge) => !droppedBlockIds.has(edge.source) && !droppedBlockIds.has(edge.target))
        .map((edge) => ({
          source: edge.source,
          target: edge.target,
          sourceHandle: edge.sourceHandle || undefined,
          targetHandle: edge.targetHandle || undefined,
        })),
      loops: safeLoops,
      parallels: safeParallels,
    }
  }

  /**
   * Validate loop and parallel subflows for required inputs when running in "each/collection" modes
   */
  private validateSubflowsBeforeExecution(
    blocks: Record<string, BlockState>,
    loops: Record<string, Loop>,
    parallels: Record<string, Parallel>
  ): void {
    // Note: Empty collections in forEach loops and parallel collection mode are handled gracefully
    // at runtime - the loop/parallel will simply be skipped. No build-time validation needed.
  }

  private serializeBlock(
    block: BlockState,
    options: {
      validateRequired: boolean
      allBlocks: Record<string, BlockState>
    }
  ): SerializedBlock {
    // Special handling for subflow blocks (loops, parallels, etc.)
    if (block.type === 'loop' || block.type === 'parallel') {
      return {
        id: block.id,
        position: block.position,
        config: {
          tool: '', // Loop blocks don't have tools
          params: (block.data || {}) as Record<string, unknown>, // Preserve the block data (parallelType, count, etc.)
        },
        inputs: {},
        outputs: block.outputs,
        metadata: {
          id: block.type,
          name: block.name,
          description: block.type === 'loop' ? 'Loop container' : 'Parallel container',
          category: 'subflow',
          color: block.type === 'loop' ? '#3b82f6' : '#8b5cf6',
        },
        enabled: block.enabled,
      }
    }

    const blockConfig = getBlock(block.type)
    if (!blockConfig) {
      throw new Error(`Invalid block type: ${block.type}`)
    }

    // Extract parameters from UI state
    const params = extractBlockParams(block)

    const isTriggerCategory = blockConfig.category === 'triggers'
    if (block.triggerMode === true || isTriggerCategory) {
      params.triggerMode = true
    }
    if (block.advancedMode === true) {
      params.advancedMode = true
    }

    // Validate required fields that only users can provide (before execution starts)
    if (options.validateRequired) {
      const { missingRequiredFields } = collectBlockFieldIssues(block, blockConfig, params)
      if (missingRequiredFields.length > 0) {
        const blockName = block.name || blockConfig.name || 'Block'
        throw new Error(
          `${blockName} is missing required fields: ${missingRequiredFields.join(', ')}`
        )
      }
    }

    let toolId = ''

    if (block.type === 'agent' && params.tools) {
      // Process the tools in the agent block
      try {
        const tools = Array.isArray(params.tools) ? params.tools : JSON.parse(params.tools)

        // If there are custom tools, we just keep them as is
        // They'll be handled by the executor during runtime

        // For non-custom tools, we determine the tool ID
        const nonCustomTools = tools.filter((tool: any) => tool.type !== 'custom-tool')
        if (nonCustomTools.length > 0) {
          toolId = selectToolId(blockConfig, params)
        }
      } catch (error) {
        logger.error('Error processing tools in agent block:', { error })
        // Default to the first tool if we can't process tools
        toolId = blockConfig.tools.access[0]
      }
    } else {
      // For non-agent blocks, get tool ID from block config as usual
      toolId = selectToolId(blockConfig, params)
    }

    // Get inputs from block config
    const inputs: Record<string, any> = {}
    if (blockConfig.inputs) {
      Object.entries(blockConfig.inputs).forEach(([key, config]) => {
        inputs[key] = config.type
      })
    }

    const retry = resolveBlockRetryConfig(block.retry)

    const serialized: SerializedBlock = {
      id: block.id,
      position: block.position,
      config: {
        tool: toolId,
        params,
      },
      inputs,
      outputs: {
        ...block.outputs,
      },
      metadata: {
        id: block.type,
        name: block.name,
        description: blockConfig.description,
        category: blockConfig.category,
        color: blockConfig.bgColor,
      },
      enabled: block.enabled,
      ...(retry ? { retry } : {}),
    }

    const privateInputIds = new Set<string>()
    for (const subBlock of blockConfig.subBlocks) {
      if (!subBlock.hideFromCopilot) continue
      privateInputIds.add(subBlock.id)
      if (subBlock.canonicalParamId) privateInputIds.add(subBlock.canonicalParamId)
    }
    if (privateInputIds.size > 0) {
      serialized.privateInputIds = [...privateInputIds]
    }

    if (block.data?.canonicalModes) {
      serialized.canonicalModes = block.data.canonicalModes as Record<string, 'basic' | 'advanced'>
    }

    return serialized
  }

  deserializeWorkflow(workflow: SerializedWorkflow): {
    blocks: Record<string, BlockState>
    edges: Edge[]
  } {
    const blocks: Record<string, BlockState> = {}
    const edges: Edge[] = []

    // A deleted custom block no longer resolves via `getBlock`. Treat it as a
    // removed block — skip it and drop any edges touching it — so deserialization
    // of the rest of the workflow succeeds instead of throwing `Invalid block type`.
    const droppedBlockIds = new Set<string>()

    // Deserialize blocks
    workflow.blocks.forEach((serializedBlock) => {
      const type = serializedBlock.metadata?.id
      if (isCustomBlockType(type) && !getBlock(type)) {
        droppedBlockIds.add(serializedBlock.id)
        logger.warn(`Dropping unresolvable custom block from deserialization`, {
          blockId: serializedBlock.id,
          type,
        })
        return
      }
      const block = this.deserializeBlock(serializedBlock)
      blocks[block.id] = block
    })

    // Deserialize connections
    workflow.connections.forEach((connection) => {
      if (droppedBlockIds.has(connection.source) || droppedBlockIds.has(connection.target)) {
        return
      }
      edges.push({
        id: generateId(),
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle,
        targetHandle: connection.targetHandle,
      })
    })

    return { blocks, edges }
  }

  private deserializeBlock(serializedBlock: SerializedBlock): BlockState {
    const blockType = serializedBlock.metadata?.id
    if (!blockType) {
      throw new Error(`Invalid block type: ${serializedBlock.metadata?.id}`)
    }

    // Special handling for subflow blocks (loops, parallels, etc.)
    if (blockType === 'loop' || blockType === 'parallel') {
      return {
        id: serializedBlock.id,
        type: blockType,
        name: serializedBlock.metadata?.name || (blockType === 'loop' ? 'Loop' : 'Parallel'),
        position: serializedBlock.position,
        subBlocks: {}, // Loops and parallels don't have traditional subBlocks
        outputs: serializedBlock.outputs,
        enabled: serializedBlock.enabled ?? true,
        data: serializedBlock.config.params, // Preserve the data (parallelType, count, etc.)
      }
    }

    const blockConfig = getBlock(blockType)
    if (!blockConfig) {
      throw new Error(`Invalid block type: ${blockType}`)
    }

    const subBlocks: Record<string, any> = {}
    blockConfig.subBlocks.forEach((subBlock) => {
      subBlocks[subBlock.id] = {
        id: subBlock.id,
        type: subBlock.type,
        // A checkbox-list serializes to one param per OPTION, so its own id holds
        // nothing — rebuild the record from those params to keep the round trip lossless.
        value:
          collectSubBlockValueFromParams(subBlock, serializedBlock.config.params) ??
          serializedBlock.config.params[subBlock.id] ??
          null,
      }
    })

    // Migration logic for agent blocks: Transform old systemPrompt/userPrompt to messages array
    if (blockType === 'agent') {
      migrateAgentParamsToMessages(serializedBlock.config.params, subBlocks, serializedBlock.id)
    }

    return {
      id: serializedBlock.id,
      type: blockType,
      name: serializedBlock.metadata?.name || blockConfig.name,
      position: serializedBlock.position,
      subBlocks,
      outputs: serializedBlock.outputs,
      enabled: true,
      triggerMode:
        serializedBlock.config?.params?.triggerMode === true ||
        serializedBlock.metadata?.category === 'triggers',
      advancedMode: serializedBlock.config?.params?.advancedMode === true,
      ...(serializedBlock.retry ? { retry: serializedBlock.retry } : {}),
    }
  }
}

/**
 * The stored value of a sub-block whose params are spread across several keys, i.e. the
 * inverse of {@link expandSubBlockValueToParams}. `undefined` for every other sub-block,
 * which reads its value straight off its own id.
 */
function collectSubBlockValueFromParams(
  subBlock: SubBlockConfig,
  params: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!expandSubBlockValueToParams(subBlock, {})) return undefined

  const options = Array.isArray(subBlock.options) ? subBlock.options : []
  const value: Record<string, unknown> = {}
  for (const option of options) {
    if (!option || typeof option !== 'object' || !('id' in option) || !option.id) continue
    const optionId = String(option.id)
    if (Object.hasOwn(params, optionId)) value[optionId] = params[optionId]
  }
  return Object.keys(value).length > 0 ? value : undefined
}

/** A canonical pair where the active member is empty but an inactive member holds a value that will be silently dropped. */
export interface InactiveModeValue {
  canonicalId: string
  /** The member the active mode reads from (where the value should live). */
  activeMemberId?: string
  /** The member that currently holds the stranded value. */
  inactiveMemberId: string
  kind: 'credential' | 'resource' | 'other'
}

export interface BlockFieldIssues {
  missingRequiredFields: string[]
  inactiveModeValues: InactiveModeValue[]
}

/**
 * Select the tool id for a block given its resolved params.
 */
export function selectToolId(blockConfig: any, params: Record<string, any>): string {
  try {
    return blockConfig.tools.config?.tool
      ? blockConfig.tools.config.tool(params)
      : blockConfig.tools.access[0]
  } catch (error) {
    logger.warn('Tool selection failed during serialization, using default:', {
      error: toError(error).message,
    })
    return blockConfig.tools.access[0]
  }
}

/**
 * Resolve a block's UI sub-block state into the flat `params` map the runtime
 * sees. Loop/parallel containers have no params; unknown block types throw.
 *
 * Exported as the single source of truth so the copilot workflow lint resolves
 * params exactly the way execution (serializeBlock) does.
 */
export function extractBlockParams(block: BlockState): Record<string, any> {
  if (block.type === 'loop' || block.type === 'parallel') {
    return {}
  }

  const blockConfig = getBlock(block.type)
  if (!blockConfig) {
    throw new Error(`Invalid block type: ${block.type}`)
  }

  const params: Record<string, any> = {}
  const legacyAdvancedMode = block.advancedMode ?? false
  const canonicalModeOverrides = block.data?.canonicalModes
  const isStarterBlock = block.type === 'starter'
  const isAgentBlock = block.type === 'agent'
  const isCustomBlock = isCustomBlockType(block.type)
  // A custom block whose config declares its input fields (client overlay, or the
  // server overlay once it carries curated `inputFields`) can tell a live input
  // from a deleted one. Only when the config is schema-agnostic (legacy rows with
  // no curated inputs) do we carry every stored field value forward blindly. A
  // declared input is any sub-block that isn't the block's own reserved wiring.
  const customBlockHasDeclaredInputs =
    isCustomBlock && blockConfig.subBlocks.some((config) => !RESERVED_PARAMS.has(config.id))
  const isTriggerContext = block.triggerMode ?? false
  const isTriggerCategory = blockConfig.category === 'triggers'
  // The serializer filters BEFORE it resolves, which is why execution has always been correct
  // here even unscoped — see `getCanonicalSubBlocksForSurface`.
  // canonical-index-unscoped: `shouldSerializeSubBlock` drops the inactive surface's members, and
  // the collapse below reads `params` (the filtered map), never `allValues`.
  const canonicalIndex = buildCanonicalIndex(blockConfig.subBlocks)
  const allValues = buildSubBlockValues(block.subBlocks)

  Object.entries(block.subBlocks).forEach(([id, subBlock]) => {
    const matchingConfigs = blockConfig.subBlocks.filter((config) => config.id === id)

    const hasStarterInputFormatValues =
      isStarterBlock &&
      id === 'inputFormat' &&
      Array.isArray(subBlock.value) &&
      subBlock.value.length > 0

    const isLegacyAgentField =
      isAgentBlock && ['systemPrompt', 'userPrompt', 'memories'].includes(id)

    const shouldInclude =
      matchingConfigs.length === 0 ||
      matchingConfigs.some((config) =>
        shouldSerializeSubBlock(
          config,
          allValues,
          legacyAdvancedMode,
          isTriggerContext,
          isTriggerCategory,
          canonicalIndex,
          canonicalModeOverrides
        )
      )

    // Include a stored input value that has no matching sub-block config only for
    // schema-agnostic custom blocks. When the config declares its inputs, a value
    // with no config is a DELETED input — dropping it stops the block passing a
    // field the child no longer has (and stops resolving its now-stale reference).
    const isCustomBlockInputField =
      isCustomBlock && matchingConfigs.length === 0 && !customBlockHasDeclaredInputs

    // A custom block's `workflowId`/`inputMapping` are computed (value-fn) sub-blocks,
    // not user data. The canvas persists their last-computed value, which goes stale
    // as input fields change — so never carry the stored value forward; let the value
    // fn in the pass below recompute them from the current field params.
    const isCustomBlockWiring = isCustomBlock && (id === 'workflowId' || id === 'inputMapping')

    if (
      !isCustomBlockWiring &&
      ((matchingConfigs.length > 0 && shouldInclude) ||
        hasStarterInputFormatValues ||
        isLegacyAgentField ||
        isCustomBlockInputField)
    ) {
      // A checkbox-list groups several boolean params behind one field, so it projects
      // onto its option ids rather than its own id — which no tool declares.
      const expanded = matchingConfigs.reduce<Record<string, boolean> | null>(
        (found, config) => found ?? expandSubBlockValueToParams(config, subBlock.value),
        null
      )
      if (expanded) {
        Object.assign(params, expanded)
      } else {
        params[id] = subBlock.value
      }
    }
  })

  blockConfig.subBlocks.forEach((subBlockConfig) => {
    const id = subBlockConfig.id
    if (
      params[id] == null &&
      subBlockConfig.value &&
      shouldSerializeSubBlock(
        subBlockConfig,
        allValues,
        legacyAdvancedMode,
        isTriggerContext,
        isTriggerCategory,
        canonicalIndex,
        canonicalModeOverrides
      )
    ) {
      params[id] = subBlockConfig.value(params)
    }
  })

  Object.values(canonicalIndex.groupsById).forEach((group) => {
    const { basicValue, advancedValue } = getCanonicalValues(group, params)
    const hasExplicitOverride = canonicalModeOverrides?.[group.canonicalId] != null
    // Legacy `advancedMode: true` (a block flag the editor no longer writes) means "the advanced
    // member of a PAIR wins". A group with no advanced member has nothing for it to select, so it
    // must resolve normally - forcing 'advanced' there leaves `chosen` undefined while the sourceIds
    // sweep below still deletes the basic member, dropping the value the block actually holds.
    // Mirrors the `isCanonicalPair` guard `shouldSerializeSubBlock` already applies upstream.
    const legacyAdvancedWins = legacyAdvancedMode && !hasExplicitOverride && isCanonicalPair(group)
    const pairMode = legacyAdvancedWins
      ? 'advanced'
      : resolveCanonicalMode(group, allValues, canonicalModeOverrides)
    const chosen = pairMode === 'advanced' ? advancedValue : basicValue

    const sourceIds = [group.basicId, ...group.advancedIds].filter(Boolean) as string[]
    sourceIds.forEach((id) => delete params[id])

    if (chosen !== undefined) {
      params[group.canonicalId] = chosen
    }
  })

  return params
}

/**
 * Classify a canonical group as a credential/resource selector based on the
 * sub-block type of its members (oauth-input -> credential, *-selector ->
 * resource).
 */
function classifyCanonicalKind(
  blockConfig: any,
  memberIds: string[]
): 'credential' | 'resource' | 'other' {
  for (const id of memberIds) {
    const cfg = blockConfig.subBlocks?.find((sb: any) => sb.id === id)
    const type = cfg?.type
    if (type === 'oauth-input') return 'credential'
    if (typeof type === 'string' && type.endsWith('-selector')) return 'resource'
  }
  return 'other'
}

/**
 * Non-throwing analysis of a block's required fields and canonical-mode value
 * placement. `serializeBlock` wraps this and throws on missing required fields
 * (execution ground truth); the copilot workflow lint consumes the structured
 * result. Single source of truth shared by both, so they can never drift.
 */
export function collectBlockFieldIssues(
  block: BlockState,
  blockConfig: any,
  params: Record<string, any>
): BlockFieldIssues {
  // Disabled blocks and trigger-mode blocks are not validated (mirrors runtime).
  if (block.enabled === false) {
    return { missingRequiredFields: [], inactiveModeValues: [] }
  }
  if (
    block.triggerMode === true ||
    blockConfig.category === 'triggers' ||
    params.triggerMode === true
  ) {
    return { missingRequiredFields: [], inactiveModeValues: [] }
  }

  const missingFields: string[] = []
  const displayAdvancedOptions = block.advancedMode ?? false
  const isTriggerContext = block.triggerMode ?? false
  const isTriggerCategory = blockConfig.category === 'triggers'
  // canonical-index-unscoped: same filter-then-resolve ordering as `extractBlockParams`, and a
  // trigger-mode block returns above before reaching here at all.
  const canonicalIndex = buildCanonicalIndex(blockConfig.subBlocks || [])
  const canonicalModeOverrides = block.data?.canonicalModes
  const allValues = buildSubBlockValues(block.subBlocks)

  // Get the tool configuration to check parameter visibility
  const toolAccess = blockConfig.tools?.access
  const currentToolId = toolAccess?.length > 0 ? selectToolId(blockConfig, params) : null
  const currentToolParams = currentToolId ? getToolParams(currentToolId) : undefined

  // Validate tool parameters (for blocks with tools).
  // Lookup contract: a tool param's value lives under its own paramId in `params`.
  // Block subBlocks align via either `id === paramId` or `canonicalParamId === paramId`.
  if (currentToolParams) {
    Object.entries(currentToolParams).forEach(([paramId, paramConfig]: [string, any]) => {
      if (paramConfig.required && paramConfig.visibility === 'user-only') {
        const matchingConfigs =
          blockConfig.subBlocks?.filter(
            (sb: any) => sb.id === paramId || sb.canonicalParamId === paramId
          ) || []

        let shouldValidateParam = true

        if (matchingConfigs.length > 0) {
          shouldValidateParam = matchingConfigs.some((subBlockConfig: any) => {
            const includedByMode = shouldSerializeSubBlock(
              subBlockConfig,
              allValues,
              displayAdvancedOptions,
              isTriggerContext,
              isTriggerCategory,
              canonicalIndex,
              canonicalModeOverrides
            )

            const isRequired = (() => {
              if (!subBlockConfig.required) return false
              if (typeof subBlockConfig.required === 'boolean') return subBlockConfig.required
              return evaluateSubBlockCondition(subBlockConfig.required, params)
            })()

            return includedByMode && isRequired
          })
        }

        if (!shouldValidateParam) {
          return
        }

        const fieldValue = params[paramId]
        if (fieldValue === undefined || fieldValue === null || fieldValue === '') {
          const activeConfig = matchingConfigs.find((config: any) =>
            shouldSerializeSubBlock(
              config,
              allValues,
              displayAdvancedOptions,
              isTriggerContext,
              isTriggerCategory,
              canonicalIndex,
              canonicalModeOverrides
            )
          )
          const displayName = activeConfig?.title || paramId
          missingFields.push(displayName)
        }
      }
    })
  }

  // Validate required subBlocks not covered by tool params (e.g., blocks with empty tools.access)
  const validatedByTool = new Set(currentToolParams ? Object.keys(currentToolParams) : [])

  blockConfig.subBlocks?.forEach((subBlockConfig: SubBlockConfig) => {
    if (validatedByTool.has(subBlockConfig.id)) {
      return
    }
    if (subBlockConfig.canonicalParamId && validatedByTool.has(subBlockConfig.canonicalParamId)) {
      return
    }

    const isVisible = shouldSerializeSubBlock(
      subBlockConfig,
      allValues,
      displayAdvancedOptions,
      isTriggerContext,
      isTriggerCategory,
      canonicalIndex,
      canonicalModeOverrides
    )

    if (!isVisible) {
      return
    }

    const isRequired = (() => {
      if (!subBlockConfig.required) return false
      if (typeof subBlockConfig.required === 'boolean') return subBlockConfig.required
      return evaluateSubBlockCondition(subBlockConfig.required, params)
    })()

    if (!isRequired) {
      return
    }

    // For canonical subBlocks, look up the canonical param value (original IDs were deleted)
    const canonicalId = canonicalIndex.canonicalIdBySubBlockId[subBlockConfig.id]
    const fieldValue = canonicalId ? params[canonicalId] : params[subBlockConfig.id]
    if (fieldValue === undefined || fieldValue === null || fieldValue === '') {
      missingFields.push(subBlockConfig.title || subBlockConfig.id)
    }
  })

  // Detect canonical pairs whose active member is empty while an inactive member
  // holds a value (the value is silently dropped at serialize time).
  const inactiveModeValues: InactiveModeValue[] = []
  for (const group of Object.values(canonicalIndex.groupsById)) {
    if (!isCanonicalPair(group)) continue
    const mode = resolveCanonicalMode(group, allValues, canonicalModeOverrides)
    const { basicValue, advancedValue } = getCanonicalValues(group, allValues)
    const activeValue = mode === 'advanced' ? advancedValue : basicValue
    if (isNonEmptyValue(activeValue)) continue

    const memberIds = [group.basicId, ...group.advancedIds].filter(Boolean) as string[]
    const activeMemberId = mode === 'advanced' ? group.advancedIds[0] : group.basicId
    const inactiveMemberId = memberIds.find(
      (id) => id !== activeMemberId && isNonEmptyValue(allValues[id])
    )
    if (inactiveMemberId) {
      inactiveModeValues.push({
        canonicalId: group.canonicalId,
        activeMemberId,
        inactiveMemberId,
        kind: classifyCanonicalKind(blockConfig, memberIds),
      })
    }
  }

  return { missingRequiredFields: missingFields, inactiveModeValues }
}
