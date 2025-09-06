import type { Edge } from 'reactflow'
import { createLogger } from '@/lib/logs/console/logger'
import { getBlock } from '@/blocks'
import type { SubBlockConfig } from '@/blocks/types'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'
import type { BlockState, Loop, Parallel } from '@/stores/workflows/workflow/types'
import { getTool } from '@/tools/utils'

const logger = createLogger('Serializer')

/**
 * Helper function to check if a subblock should be included in serialization based on current mode
 */
function shouldIncludeField(subBlockConfig: SubBlockConfig, isAdvancedMode: boolean): boolean {
  const fieldMode = subBlockConfig.mode
  if (fieldMode === 'advanced' && !isAdvancedMode) return false
  return true
}

function doesConditionMatch(
  condition: NonNullable<SubBlockConfig['condition']>,
  params: Record<string, any>
): boolean {
  const cond = typeof condition === 'function' ? condition() : condition
  const primaryMatches = cond.not
    ? params[cond.field] !== cond.value
    : Array.isArray(cond.value)
      ? cond.value.includes(params[cond.field])
      : params[cond.field] === cond.value

  if (!cond.and) return !!primaryMatches

  const andCond = cond.and
  const andMatches = andCond.not
    ? params[andCond.field] !== andCond.value
    : Array.isArray(andCond.value)
      ? (andCond.value as any[]).includes(params[andCond.field])
      : params[andCond.field] === andCond.value

  return !!primaryMatches && !!andMatches
}

function consolidateCanonicalParams(
  params: Record<string, any>,
  blockConfig: { subBlocks: SubBlockConfig[] },
  isAdvancedMode: boolean
): Record<string, any> {
  const consolidated: Record<string, any> = { ...params }

  // In basic mode, drop standalone advanced-only fields that don't belong to a canonical group
  if (!isAdvancedMode) {
    blockConfig.subBlocks.forEach((subBlockConfig) => {
      const isAdvancedOnly = subBlockConfig.mode === 'advanced'
      const isPartOfCanonicalGroup = !!subBlockConfig.canonicalParamId
      if (isAdvancedOnly && !isPartOfCanonicalGroup) {
        delete consolidated[subBlockConfig.id]
      }
    })
  }
  const canonicalGroups: Record<string, { basic?: string; advanced?: string[] }> = {}
  blockConfig.subBlocks.forEach((subBlockConfig) => {
    const key = subBlockConfig.canonicalParamId
    if (!key) return
    if (!canonicalGroups[key]) canonicalGroups[key] = { basic: undefined, advanced: [] }
    if (subBlockConfig.mode === 'advanced') {
      canonicalGroups[key].advanced!.push(subBlockConfig.id)
    } else {
      canonicalGroups[key].basic = subBlockConfig.id
    }
  })

  Object.entries(canonicalGroups).forEach(([canonicalKey, group]) => {
    const basicId = group.basic
    const advancedIds = group.advanced || []
    const basicVal = basicId ? consolidated[basicId] : undefined
    const advancedVal = advancedIds
      .map((id) => consolidated[id])
      .find((v) => v !== undefined && v !== null && (typeof v !== 'string' || v.trim().length > 0))
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
      if (id !== canonicalKey) delete consolidated[id]
    })

    if (chosen !== undefined) {
      consolidated[canonicalKey] = chosen
    } else {
      delete consolidated[canonicalKey]
    }
  })

  return consolidated
}

export class Serializer {
  serializeWorkflow(
    blocks: Record<string, BlockState>,
    edges: Edge[],
    loops: Record<string, Loop>,
    parallels?: Record<string, Parallel>,
    validateRequired = false
  ): SerializedWorkflow {
    return {
      version: '1.0',
      blocks: Object.values(blocks).map((block) => this.serializeBlock(block, validateRequired)),
      connections: edges.map((edge) => ({
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle || undefined,
        targetHandle: edge.targetHandle || undefined,
      })),
      loops,
      parallels,
    }
  }

  private serializeBlock(block: BlockState, validateRequired = false): SerializedBlock {
    // Special handling for subflow blocks (loops, parallels, etc.)
    if (block.type === 'loop' || block.type === 'parallel') {
      return {
        id: block.id,
        position: block.position,
        config: {
          tool: '', // Loop blocks don't have tools
          params: block.data || {}, // Preserve the block data (parallelType, count, etc.)
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
    } catch (_) {
      // no-op: conservative, avoid blocking serialization if blockConfig is unexpected
    }

    // Run params mapper only for non-trigger blocks. Trigger-mode blocks skip mapper.
    let finalParams = params
    const isTriggerBlock = !!(block.triggerMode || blockConfig.category === 'triggers')
    if (!isTriggerBlock) {
      try {
        const mapper = blockConfig.tools?.config?.params
        if (typeof mapper === 'function') {
          finalParams = mapper(params)
        }
      } catch (error) {
        // If mapper throws during validation, surface the error
        // Otherwise keep original params for non-validation serialization
        if (validateRequired) {
          throw error
        }
        finalParams = params
      }
    }

    // Validate required fields AFTER params mapping (uses mapped params)
    if (validateRequired) {
      // Skip validation for trigger mode blocks and trigger category blocks
      if (!isTriggerBlock) {
        this.validateRequiredFieldsBeforeExecution(block, blockConfig, finalParams)
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
          try {
            toolId = blockConfig.tools.config?.tool
              ? blockConfig.tools.config.tool(finalParams)
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
          ? blockConfig.tools.config.tool(finalParams)
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
        params: finalParams,
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
      if (trimmedValue.startsWith('<') && trimmedValue.includes('>')) {
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

    Object.entries(block.subBlocks).forEach(([id, subBlock]) => {
      const subBlockConfig = blockConfig.subBlocks.find((config) => config.id === id)
      if (!subBlockConfig) return

      // Respect conditional visibility: if condition exists and doesn't match current params, skip
      if (subBlockConfig.condition && !doesConditionMatch(subBlockConfig.condition, params)) {
        return
      }

      const v = subBlock.value
      const hasValue = !(
        v === null ||
        v === undefined ||
        (typeof v === 'string' && v.trim().length === 0) ||
        (Array.isArray(v) && v.length === 0) ||
        (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0)
      )
      if (hasValue) {
        params[id] = v
      }
    })

    // Then check for any subBlocks with default values
    blockConfig.subBlocks.forEach((subBlockConfig) => {
      const id = subBlockConfig.id
      if (
        params[id] === null &&
        subBlockConfig.value &&
        shouldIncludeField(subBlockConfig, isAdvancedMode)
      ) {
        // If the value is null and there's a default value function, use it
        params[id] = subBlockConfig.value(params)
      }
    })

    return consolidateCanonicalParams(params, blockConfig, block.advancedMode ?? false)
  }

  private validateRequiredFieldsBeforeExecution(
    block: BlockState,
    blockConfig: any,
    params: Record<string, any>
  ) {
    // Validate user-only required fields before execution starts
    // This catches missing API keys, credentials, and other user-provided values early
    // Note: params passed here have already been through the mapper

    // Get the tool configuration to check parameter visibility
    const toolAccess = blockConfig.tools?.access
    if (!toolAccess || toolAccess.length === 0) {
      return // No tools to validate against
    }

    // Determine the current tool ID using mapped params
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
    // Note: params are already mapped, so we check them directly
    const missingFields: string[] = []

    Object.entries(currentTool.params || {}).forEach(([paramId, paramConfig]) => {
      if (paramConfig.required && paramConfig.visibility === 'user-only') {
        const fieldValue = params[paramId]
        if (fieldValue === undefined || fieldValue === null || fieldValue === '') {
          // Find the corresponding subBlock to get the display title
          // BUT also check if this subBlock has a condition that excludes it from the current operation
          const subBlockConfig = blockConfig.subBlocks?.find((sb: any) => sb.id === paramId)

          // If the subBlock has a condition that doesn't match current params, skip validation
          if (subBlockConfig?.condition) {
            if (!doesConditionMatch(subBlockConfig.condition, params)) {
              return // This field is not relevant for the current operation
            }
          }

          const displayName = subBlockConfig?.title || paramId
          missingFields.push(displayName)
        }
      }
    })

    if (missingFields.length > 0) {
      const blockName = block.name || blockConfig.name || 'Block'
      throw new Error(`${blockName} is missing required fields: ${missingFields.join(', ')}`)
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

    return {
      id: serializedBlock.id,
      type: blockType,
      name: serializedBlock.metadata?.name || blockConfig.name,
      position: serializedBlock.position,
      subBlocks,
      outputs: serializedBlock.outputs,
      enabled: true,
      // Restore trigger mode from serialized params; treat trigger category as triggers as well
      triggerMode:
        serializedBlock.config?.params?.triggerMode === true ||
        serializedBlock.metadata?.category === 'triggers',
    }
  }
}
