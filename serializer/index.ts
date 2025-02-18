import { Edge } from 'reactflow'
import { BlockState, Loop, SubBlockState } from '@/stores/workflow/types'
import { getBlock } from '@/blocks'
import { SerializedBlock, SerializedConnection, SerializedWorkflow } from './types'

export class Serializer {
  serializeWorkflow(
    blocks: Record<string, BlockState>,
    edges: Edge[],
    loops: Record<string, Loop>
  ): SerializedWorkflow {
    return {
      version: '1.0',
      blocks: Object.values(blocks).map((block) => this.serializeBlock(block)),
      connections: edges.map((edge) => ({
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle || undefined,
        targetHandle: edge.targetHandle || undefined,
      })),
      loops,
    }
  }

  private serializeBlock(block: BlockState): SerializedBlock {
    const blockConfig = getBlock(block.type)
    if (!blockConfig) {
      throw new Error(`Invalid block type: ${block.type}`)
    }

    // Get tool ID from block config
    const toolId = blockConfig.tools.config?.tool
      ? blockConfig.tools.config.tool(this.extractParams(block))
      : blockConfig.tools.access[0]

    // Extract params from subBlocks
    const params = this.extractParams(block)

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
              responseFormat: JSON.parse(params.responseFormat),
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

  private extractParams(block: BlockState): Record<string, any> {
    const blockConfig = getBlock(block.type)
    if (!blockConfig) {
      throw new Error(`Invalid block type: ${block.type}`)
    }

    const params: Record<string, any> = {}

    // First collect all current values from subBlocks
    Object.entries(block.subBlocks).forEach(([id, subBlock]) => {
      params[id] = subBlock.value
    })

    // Then check for any subBlocks with default values
    blockConfig.subBlocks.forEach((subBlockConfig) => {
      const id = subBlockConfig.id
      if (params[id] === null && subBlockConfig.value) {
        // If the value is null and there's a default value function, use it
        params[id] = subBlockConfig.value(params)
      }
    })

    return params
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
    }
  }
}
