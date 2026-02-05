import { createLogger } from '@sim/logger'
import type { Edge } from 'reactflow'
import { BlockPathCalculator } from '@/lib/workflows/blocks/block-path-calculator'
import type { CanonicalModeOverrides } from '@/lib/workflows/subblocks/visibility'
import {
  buildCanonicalIndex,
  buildSubBlockValues,
  evaluateSubBlockCondition,
  getCanonicalValues,
  isCanonicalPair,
  isNonEmptyValue,
  isSubBlockFeatureEnabled,
  resolveCanonicalMode,
} from '@/lib/workflows/subblocks/visibility'
import { getBlock } from '@/blocks'
import type { SubBlockConfig } from '@/blocks/types'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'
import type { BlockState, Loop, Parallel } from '@/stores/workflows/workflow/types'
import { generateLoopBlocks, generateParallelBlocks } from '@/stores/workflows/workflow/utils'
import { getTool } from '@/tools/utils'

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
  if (!isSubBlockFeatureEnabled(subBlockConfig)) return false

  if (subBlockConfig.mode === 'trigger') {
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
        canonicalModeOverrides?.[group.canonicalId] ??
        (displayAdvancedOptions ? 'advanced' : resolveCanonicalMode(group, values))
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
    const accessibleBlocksMap = this.computeAccessibleBlockIds(
      blocks,
      edges,
      safeLoops,
      safeParallels
    )

    if (validateRequired) {
      this.validateSubflowsBeforeExecution(blocks, safeLoops, safeParallels)
    }

    return {
      version: '1.0',
      blocks: Object.values(blocks).map((block) =>
        this.serializeBlock(block, {
          validateRequired,
          allBlocks: blocks,
          accessibleBlocksMap,
        })
      ),
      connections: edges.map((edge) => ({
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
      accessibleBlocksMap: Map<string, Set<string>>
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
    const params = this.extractParams(block)

    const isTriggerCategory = blockConfig.category === 'triggers'
    if (block.triggerMode === true || isTriggerCategory) {
      params.triggerMode = true
    }
    if (block.advancedMode === true) {
      params.advancedMode = true
    }

    // Validate required fields that only users can provide (before execution starts)
    if (options.validateRequired) {
      this.validateRequiredFieldsBeforeExecution(block, blockConfig, params)
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
          toolId = this.selectToolId(blockConfig, params)
        }
      } catch (error) {
        logger.error('Error processing tools in agent block:', { error })
        // Default to the first tool if we can't process tools
        toolId = blockConfig.tools.access[0]
      }
    } else {
      // For non-agent blocks, get tool ID from block config as usual
      toolId = this.selectToolId(blockConfig, params)
    }

    // Get inputs from block config
    const inputs: Record<string, any> = {}
    if (blockConfig.inputs) {
      Object.entries(blockConfig.inputs).forEach(([key, config]) => {
        inputs[key] = config.type
      })
    }

    return {
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
    }
  }

  private extractParams(block: BlockState): Record<string, any> {
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
    const isTriggerContext = block.triggerMode ?? false
    const isTriggerCategory = blockConfig.category === 'triggers'
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

      if (
        (matchingConfigs.length > 0 && shouldInclude) ||
        hasStarterInputFormatValues ||
        isLegacyAgentField
      ) {
        params[id] = subBlock.value
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
      const pairMode =
        canonicalModeOverrides?.[group.canonicalId] ?? (legacyAdvancedMode ? 'advanced' : 'basic')
      const chosen = pairMode === 'advanced' ? advancedValue : basicValue

      const sourceIds = [group.basicId, ...group.advancedIds].filter(Boolean) as string[]
      sourceIds.forEach((id) => delete params[id])

      if (chosen !== undefined) {
        params[group.canonicalId] = chosen
      }
    })

    return params
  }

  private validateRequiredFieldsBeforeExecution(
    block: BlockState,
    blockConfig: any,
    params: Record<string, any>
  ) {
    // Skip validation if the block is disabled
    if (block.enabled === false) {
      return
    }

    // Skip validation if the block is used as a trigger
    if (
      block.triggerMode === true ||
      blockConfig.category === 'triggers' ||
      params.triggerMode === true
    ) {
      logger.info('Skipping validation for block in trigger mode', {
        blockId: block.id,
        blockType: block.type,
      })
      return
    }

    const missingFields: string[] = []
    const displayAdvancedOptions = block.advancedMode ?? false
    const isTriggerContext = block.triggerMode ?? false
    const isTriggerCategory = blockConfig.category === 'triggers'
    const canonicalIndex = buildCanonicalIndex(blockConfig.subBlocks || [])
    const canonicalModeOverrides = block.data?.canonicalModes
    const allValues = buildSubBlockValues(block.subBlocks)

    // Get the tool configuration to check parameter visibility
    const toolAccess = blockConfig.tools?.access
    const currentToolId = toolAccess?.length > 0 ? this.selectToolId(blockConfig, params) : null
    const currentTool = currentToolId ? getTool(currentToolId) : null

    // Validate tool parameters (for blocks with tools)
    if (currentTool) {
      Object.entries(currentTool.params || {}).forEach(([paramId, paramConfig]) => {
        if (paramConfig.required && paramConfig.visibility === 'user-only') {
          const matchingConfigs =
            blockConfig.subBlocks?.filter((sb: any) => sb.id === paramId) || []

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
    const validatedByTool = new Set(currentTool ? Object.keys(currentTool.params || {}) : [])

    blockConfig.subBlocks?.forEach((subBlockConfig: SubBlockConfig) => {
      // Skip if already validated via tool params
      if (validatedByTool.has(subBlockConfig.id)) {
        return
      }

      // Check if subBlock is visible
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

      // Check if subBlock is required
      const isRequired = (() => {
        if (!subBlockConfig.required) return false
        if (typeof subBlockConfig.required === 'boolean') return subBlockConfig.required
        return evaluateSubBlockCondition(subBlockConfig.required, params)
      })()

      if (!isRequired) {
        return
      }

      // Check if value is missing
      // For canonical subBlocks, look up the canonical param value (original IDs were deleted)
      const canonicalId = canonicalIndex.canonicalIdBySubBlockId[subBlockConfig.id]
      const fieldValue = canonicalId ? params[canonicalId] : params[subBlockConfig.id]
      if (fieldValue === undefined || fieldValue === null || fieldValue === '') {
        missingFields.push(subBlockConfig.title || subBlockConfig.id)
      }
    })

    if (missingFields.length > 0) {
      const blockName = block.name || blockConfig.name || 'Block'
      throw new Error(`${blockName} is missing required fields: ${missingFields.join(', ')}`)
    }
  }

  private computeAccessibleBlockIds(
    blocks: Record<string, BlockState>,
    edges: Edge[],
    loops: Record<string, Loop>,
    parallels: Record<string, Parallel>
  ): Map<string, Set<string>> {
    const accessibleMap = new Map<string, Set<string>>()
    const simplifiedEdges = edges.map((edge) => ({ source: edge.source, target: edge.target }))

    const starterBlock = Object.values(blocks).find((block) => block.type === 'starter')

    Object.keys(blocks).forEach((blockId) => {
      const ancestorIds = BlockPathCalculator.findAllPathNodes(simplifiedEdges, blockId)
      const accessibleIds = new Set<string>(ancestorIds)
      accessibleIds.add(blockId)

      if (starterBlock && ancestorIds.includes(starterBlock.id)) {
        accessibleIds.add(starterBlock.id)
      }

      Object.values(loops).forEach((loop) => {
        if (!loop?.nodes) return
        if (loop.nodes.includes(blockId)) {
          loop.nodes.forEach((nodeId) => accessibleIds.add(nodeId))
        }
      })

      Object.values(parallels).forEach((parallel) => {
        if (!parallel?.nodes) return
        if (parallel.nodes.includes(blockId)) {
          parallel.nodes.forEach((nodeId) => accessibleIds.add(nodeId))
        }
      })

      accessibleMap.set(blockId, accessibleIds)
    })

    return accessibleMap
  }

  private selectToolId(blockConfig: any, params: Record<string, any>): string {
    try {
      return blockConfig.tools.config?.tool
        ? blockConfig.tools.config.tool(params)
        : blockConfig.tools.access[0]
    } catch (error) {
      logger.warn('Tool selection failed during serialization, using default:', {
        error: error instanceof Error ? error.message : String(error),
      })
      return blockConfig.tools.access[0]
    }
  }

  deserializeWorkflow(workflow: SerializedWorkflow): {
    blocks: Record<string, BlockState>
    edges: Edge[]
  } {
    const blocks: Record<string, BlockState> = {}
    const edges: Edge[] = []

    // Deserialize blocks
    workflow.blocks.forEach((serializedBlock) => {
      const block = this.deserializeBlock(serializedBlock)
      blocks[block.id] = block
    })

    // Deserialize connections
    workflow.connections.forEach((connection) => {
      edges.push({
        id: crypto.randomUUID(),
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
        value: serializedBlock.config.params[subBlock.id] ?? null,
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
    }
  }
}
