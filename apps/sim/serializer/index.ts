import { createLogger } from '@sim/logger'
import type { Edge } from 'reactflow'
import { BlockPathCalculator } from '@/lib/workflows/blocks/block-path-calculator'
import { getBlock } from '@/blocks'
import type { SubBlockConfig } from '@/blocks/types'
import { REFERENCE } from '@/executor/constants'
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
 * Helper function to check if a subblock should be included in serialization based on current mode
 */
function shouldIncludeField(subBlockConfig: SubBlockConfig, isAdvancedMode: boolean): boolean {
  const fieldMode = subBlockConfig.mode

  if (fieldMode === 'advanced' && !isAdvancedMode) {
    return false // Skip advanced-only fields when in basic mode
  }

  return true
}

/**
 * Evaluates a condition object against current field values.
 * Used to determine if a conditionally-visible field should be included in params.
 */
function evaluateCondition(
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
  values: Record<string, any>
): boolean {
  if (!condition) return true

  const actual = typeof condition === 'function' ? condition() : condition
  const fieldValue = values[actual.field]

  const valueMatch = Array.isArray(actual.value)
    ? fieldValue != null &&
      (actual.not ? !actual.value.includes(fieldValue) : actual.value.includes(fieldValue))
    : actual.not
      ? fieldValue !== actual.value
      : fieldValue === actual.value

  const andMatch = !actual.and
    ? true
    : (() => {
        const andFieldValue = values[actual.and!.field]
        const andValueMatch = Array.isArray(actual.and!.value)
          ? andFieldValue != null &&
            (actual.and!.not
              ? !actual.and!.value.includes(andFieldValue)
              : actual.and!.value.includes(andFieldValue))
          : actual.and!.not
            ? andFieldValue !== actual.and!.value
            : andFieldValue === actual.and!.value
        return andValueMatch
      })()

  return valueMatch && andMatch
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

    try {
      const isTriggerCategory = blockConfig.category === 'triggers'
      if (block.triggerMode === true || isTriggerCategory) {
        params.triggerMode = true
      }
      if (block.advancedMode === true) {
        params.advancedMode = true
      }
    } catch (_) {
      // no-op: conservative, avoid blocking serialization if blockConfig is unexpected
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
          try {
            toolId = blockConfig.tools.config?.tool
              ? blockConfig.tools.config.tool(params)
              : blockConfig.tools.access[0]
          } catch (error) {
            logger.warn('Tool selection failed during serialization, using default:', {
              error: error instanceof Error ? error.message : String(error),
            })
            toolId = blockConfig.tools.access[0]
          }
        }
      } catch (error) {
        logger.error('Error processing tools in agent block:', { error })
        // Default to the first tool if we can't process tools
        toolId = blockConfig.tools.access[0]
      }
    } else {
      // For non-agent blocks, get tool ID from block config as usual
      try {
        toolId = blockConfig.tools.config?.tool
          ? blockConfig.tools.config.tool(params)
          : blockConfig.tools.access[0]
      } catch (error) {
        logger.warn('Tool selection failed during serialization, using default:', {
          error: error instanceof Error ? error.message : String(error),
        })
        toolId = blockConfig.tools.access[0]
      }
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
        // Include response format fields if available
        ...(params.responseFormat
          ? {
              responseFormat: this.parseResponseFormatSafely(params.responseFormat),
            }
          : {}),
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

  private parseResponseFormatSafely(responseFormat: any): any {
    if (!responseFormat) {
      return undefined
    }

    // If already an object, return as-is
    if (typeof responseFormat === 'object' && responseFormat !== null) {
      return responseFormat
    }

    // Handle string values
    if (typeof responseFormat === 'string') {
      const trimmedValue = responseFormat.trim()

      // Check for variable references like <start.input>
      if (trimmedValue.startsWith(REFERENCE.START) && trimmedValue.includes(REFERENCE.END)) {
        // Keep variable references as-is
        return trimmedValue
      }

      if (trimmedValue === '') {
        return undefined
      }

      // Try to parse as JSON
      try {
        return JSON.parse(trimmedValue)
      } catch (error) {
        // If parsing fails, return undefined to avoid crashes
        // This allows the workflow to continue without structured response format
        logger.warn('Failed to parse response format as JSON in serializer, using undefined:', {
          value: trimmedValue,
          error: error instanceof Error ? error.message : String(error),
        })
        return undefined
      }
    }

    // For any other type, return undefined
    return undefined
  }

  private extractParams(block: BlockState): Record<string, any> {
    // Special handling for subflow blocks (loops, parallels, etc.)
    if (block.type === 'loop' || block.type === 'parallel') {
      return {} // Loop and parallel blocks don't have traditional params
    }

    const blockConfig = getBlock(block.type)
    if (!blockConfig) {
      throw new Error(`Invalid block type: ${block.type}`)
    }

    const params: Record<string, any> = {}
    const isAdvancedMode = block.advancedMode ?? false
    const isStarterBlock = block.type === 'starter'
    const isAgentBlock = block.type === 'agent'

    // First pass: collect ALL raw values for condition evaluation
    const allValues: Record<string, any> = {}
    Object.entries(block.subBlocks).forEach(([id, subBlock]) => {
      allValues[id] = subBlock.value
    })

    // Second pass: filter by mode and conditions
    Object.entries(block.subBlocks).forEach(([id, subBlock]) => {
      const matchingConfigs = blockConfig.subBlocks.filter((config) => config.id === id)

      // Include field if it matches current mode OR if it's the starter inputFormat with values
      const hasStarterInputFormatValues =
        isStarterBlock &&
        id === 'inputFormat' &&
        Array.isArray(subBlock.value) &&
        subBlock.value.length > 0

      // Include legacy agent block fields (systemPrompt, userPrompt, memories) even if not in current config
      // This ensures backward compatibility with old workflows that were exported before the messages array migration
      const isLegacyAgentField =
        isAgentBlock && ['systemPrompt', 'userPrompt', 'memories'].includes(id)

      const anyConditionMet =
        matchingConfigs.length === 0
          ? true
          : matchingConfigs.some(
              (config) =>
                shouldIncludeField(config, isAdvancedMode) &&
                evaluateCondition(config.condition, allValues)
            )

      if (
        (matchingConfigs.length > 0 && anyConditionMet) ||
        hasStarterInputFormatValues ||
        isLegacyAgentField
      ) {
        params[id] = subBlock.value
      }
    })

    // Then check for any subBlocks with default values
    blockConfig.subBlocks.forEach((subBlockConfig) => {
      const id = subBlockConfig.id
      if (
        (params[id] === null || params[id] === undefined) &&
        subBlockConfig.value &&
        shouldIncludeField(subBlockConfig, isAdvancedMode)
      ) {
        // If the value is absent and there's a default value function, use it
        params[id] = subBlockConfig.value(params)
      }
    })

    // Finally, consolidate canonical parameters (e.g., selector and manual ID into a single param)
    const canonicalGroups: Record<string, { basic?: string; advanced: string[] }> = {}
    blockConfig.subBlocks.forEach((sb) => {
      if (!sb.canonicalParamId) return
      const key = sb.canonicalParamId
      if (!canonicalGroups[key]) canonicalGroups[key] = { basic: undefined, advanced: [] }
      if (sb.mode === 'advanced') canonicalGroups[key].advanced.push(sb.id)
      else canonicalGroups[key].basic = sb.id
    })

    Object.entries(canonicalGroups).forEach(([canonicalKey, group]) => {
      const basicId = group.basic
      const advancedIds = group.advanced
      const basicVal = basicId ? params[basicId] : undefined
      const advancedVal = advancedIds
        .map((id) => params[id])
        .find(
          (v) => v !== undefined && v !== null && (typeof v !== 'string' || v.trim().length > 0)
        )

      let chosen: any
      if (advancedVal !== undefined && basicVal !== undefined) {
        chosen = isAdvancedMode ? advancedVal : basicVal
      } else if (advancedVal !== undefined) {
        chosen = advancedVal
      } else if (basicVal !== undefined) {
        chosen = isAdvancedMode ? undefined : basicVal
      } else {
        chosen = undefined
      }

      const sourceIds = [basicId, ...advancedIds].filter(Boolean) as string[]
      sourceIds.forEach((id) => {
        if (id !== canonicalKey) delete params[id]
      })
      if (chosen !== undefined) params[canonicalKey] = chosen
      else delete params[canonicalKey]
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

    // Get the tool configuration to check parameter visibility
    const toolAccess = blockConfig.tools?.access
    if (!toolAccess || toolAccess.length === 0) {
      return // No tools to validate against
    }

    // Determine the current tool ID using the same logic as the serializer
    let currentToolId = ''
    try {
      currentToolId = blockConfig.tools.config?.tool
        ? blockConfig.tools.config.tool(params)
        : blockConfig.tools.access[0]
    } catch (error) {
      logger.warn('Tool selection failed during validation, using default:', {
        error: error instanceof Error ? error.message : String(error),
      })
      currentToolId = blockConfig.tools.access[0]
    }

    // Get the specific tool to validate against
    const currentTool = getTool(currentToolId)
    if (!currentTool) {
      return // Tool not found, skip validation
    }

    // Check required user-only parameters for the current tool
    const missingFields: string[] = []

    // Iterate through the tool's parameters, not the block's subBlocks
    Object.entries(currentTool.params || {}).forEach(([paramId, paramConfig]) => {
      if (paramConfig.required && paramConfig.visibility === 'user-only') {
        const matchingConfigs = blockConfig.subBlocks?.filter((sb: any) => sb.id === paramId) || []

        let shouldValidateParam = true

        if (matchingConfigs.length > 0) {
          const isAdvancedMode = block.advancedMode ?? false

          shouldValidateParam = matchingConfigs.some((subBlockConfig: any) => {
            const includedByMode = shouldIncludeField(subBlockConfig, isAdvancedMode)

            const includedByCondition = evaluateCondition(subBlockConfig.condition, params)

            const isRequired = (() => {
              if (!subBlockConfig.required) return false
              if (typeof subBlockConfig.required === 'boolean') return subBlockConfig.required
              return evaluateCondition(subBlockConfig.required, params)
            })()

            return includedByMode && includedByCondition && isRequired
          })
        }

        if (!shouldValidateParam) {
          return
        }

        const fieldValue = params[paramId]
        if (fieldValue === undefined || fieldValue === null || fieldValue === '') {
          const activeConfig = matchingConfigs.find(
            (config: any) =>
              shouldIncludeField(config, block.advancedMode ?? false) &&
              evaluateCondition(config.condition, params)
          )
          const displayName = activeConfig?.title || paramId
          missingFields.push(displayName)
        }
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
