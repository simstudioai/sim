import { createLogger } from '@/lib/logs/console/logger'
import { getAllBlocks } from '@/blocks/registry'
import type { BlockConfig } from '@/blocks/types'
import { resolveOutputType } from '@/blocks/utils'
import { generateLoopBlocks, generateParallelBlocks } from '@/stores/workflows/workflow/utils'

const logger = createLogger('EditWorkflowAPI')

// Sim Agent API configuration
const SIM_AGENT_API_URL = process.env.SIM_AGENT_API_URL || 'http://localhost:8000'
const SIM_AGENT_API_KEY = process.env.SIM_AGENT_API_KEY

// Types for operations
interface EditWorkflowOperation {
  operation_type: 'add' | 'edit' | 'delete'
  block_id: string
  params?: Record<string, any>
}

/**
 * Apply operations to YAML workflow
 */
async function applyOperationsToYaml(
  currentYaml: string,
  operations: EditWorkflowOperation[]
): Promise<string> {
  // Parse current YAML by calling sim-agent directly
  // Gather block registry and utilities
  const blocks = getAllBlocks()
  const blockRegistry = blocks.reduce(
    (acc, block) => {
      const blockType = block.type
      acc[blockType] = {
        ...block,
        id: blockType,
        subBlocks: block.subBlocks || [],
        outputs: block.outputs || {},
      } as any
      return acc
    },
    {} as Record<string, BlockConfig>
  )

  const response = await fetch(`${SIM_AGENT_API_URL}/api/yaml/parse`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(SIM_AGENT_API_KEY && { 'x-api-key': SIM_AGENT_API_KEY }),
    },
    body: JSON.stringify({
      yamlContent: currentYaml,
      blockRegistry,
      utilities: {
        generateLoopBlocks: generateLoopBlocks.toString(),
        generateParallelBlocks: generateParallelBlocks.toString(),
        resolveOutputType: resolveOutputType.toString(),
      },
    }),
  })

  if (!response.ok) {
    throw new Error(`Sim agent API error: ${response.statusText}`)
  }

  const parseResult = await response.json()

  if (!parseResult.success || !parseResult.data || parseResult.errors?.length > 0) {
    throw new Error(`Invalid YAML format: ${parseResult.errors?.join(', ') || 'Unknown error'}`)
  }

  const workflowData = parseResult.data

  // Apply operations to the parsed YAML data (preserving all existing fields)
  logger.info('Starting YAML operations', {
    initialBlockCount: Object.keys(workflowData.blocks).length,
    version: workflowData.version,
    operationCount: operations.length,
  })

  for (const operation of operations) {
    const { operation_type, block_id, params } = operation

    logger.info(`Processing operation: ${operation_type} for block ${block_id}`, { params })

    switch (operation_type) {
      case 'delete':
        if (workflowData.blocks[block_id]) {
          // First, find child blocks that reference this block as parent (before deleting the parent)
          const childBlocksToRemove: string[] = []
          Object.entries(workflowData.blocks).forEach(
            ([childBlockId, childBlock]: [string, any]) => {
              if (childBlock.parentId === block_id) {
                logger.info(
                  `Found child block ${childBlockId} with parentId ${block_id}, marking for deletion`
                )
                childBlocksToRemove.push(childBlockId)
              }
            }
          )

          // Delete the main block
          delete workflowData.blocks[block_id]
          logger.info(`Deleted block ${block_id}`)

          // Remove child blocks
          childBlocksToRemove.forEach((childBlockId) => {
            if (workflowData.blocks[childBlockId]) {
              delete workflowData.blocks[childBlockId]
              logger.info(`Deleted child block ${childBlockId}`)
            }
          })

          // Remove connections mentioning this block or any of its children
          const allDeletedBlocks = [block_id, ...childBlocksToRemove]
          Object.values(workflowData.blocks).forEach((block: any) => {
            if (block.connections) {
              Object.keys(block.connections).forEach((key) => {
                const connectionValue = block.connections[key]

                if (typeof connectionValue === 'string') {
                  // Simple format: connections: { default: "block2" }
                  if (allDeletedBlocks.includes(connectionValue)) {
                    delete block.connections[key]
                    logger.info(`Removed connection ${key} to deleted block ${connectionValue}`)
                  }
                } else if (Array.isArray(connectionValue)) {
                  // Array format: connections: { default: ["block2", "block3"] }
                  block.connections[key] = connectionValue.filter((item: any) => {
                    if (typeof item === 'string') {
                      return !allDeletedBlocks.includes(item)
                    }
                    if (typeof item === 'object' && item.block) {
                      return !allDeletedBlocks.includes(item.block)
                    }
                    return true
                  })

                  // If array is empty after filtering, remove the connection
                  if (block.connections[key].length === 0) {
                    delete block.connections[key]
                  }
                } else if (typeof connectionValue === 'object' && connectionValue.block) {
                  // Object format: connections: { success: { block: "block2", input: "data" } }
                  if (allDeletedBlocks.includes(connectionValue.block)) {
                    delete block.connections[key]
                    logger.info(
                      `Removed object connection ${key} to deleted block ${connectionValue.block}`
                    )
                  }
                }
              })
            }
          })
        } else {
          logger.warn(`Block ${block_id} not found for deletion`)
        }
        break

      case 'edit':
        if (workflowData.blocks[block_id]) {
          const block = workflowData.blocks[block_id]

          // Update inputs (preserve existing inputs, only overwrite specified ones)
          if (params?.inputs) {
            if (!block.inputs) block.inputs = {}
            Object.assign(block.inputs, params.inputs)
            logger.info(`Updated inputs for block ${block_id}`, { inputs: block.inputs })
          }

          // Update connections (preserve existing connections, only overwrite specified ones)
          if (params?.connections) {
            if (!block.connections) block.connections = {}

            // Handle edge removals - if a connection is explicitly set to null, remove it
            Object.entries(params.connections).forEach(([key, value]) => {
              if (value === null) {
                delete (block.connections as any)[key]
                logger.info(`Removed connection ${key} from block ${block_id}`)
              } else {
                ;(block.connections as any)[key] = value
              }
            })

            logger.info(`Updated connections for block ${block_id}`, {
              connections: block.connections,
            })
          }

          // Handle edge removals when specified in params
          if (params?.removeEdges && Array.isArray(params.removeEdges)) {
            params.removeEdges.forEach(
              (edgeToRemove: {
                targetBlockId: string
                sourceHandle?: string
                targetHandle?: string
              }) => {
                if (!block.connections) return

                const { targetBlockId, sourceHandle = 'default' } = edgeToRemove

                // Handle different connection formats
                const connectionValue = (block.connections as any)[sourceHandle]

                if (typeof connectionValue === 'string') {
                  // Simple format: connections: { default: "block2" }
                  if (connectionValue === targetBlockId) {
                    delete (block.connections as any)[sourceHandle]
                    logger.info(`Removed edge from ${block_id}:${sourceHandle} to ${targetBlockId}`)
                  }
                } else if (Array.isArray(connectionValue)) {
                  // Array format: connections: { default: ["block2", "block3"] }
                  ;(block.connections as any)[sourceHandle] = connectionValue.filter(
                    (item: any) => {
                      if (typeof item === 'string') {
                        return item !== targetBlockId
                      }
                      if (typeof item === 'object' && item.block) {
                        return item.block !== targetBlockId
                      }
                      return true
                    }
                  )

                  // If array is empty after filtering, remove the connection
                  if ((block.connections as any)[sourceHandle].length === 0) {
                    delete (block.connections as any)[sourceHandle]
                  }

                  logger.info(`Updated array connection for ${block_id}:${sourceHandle}`)
                } else if (typeof connectionValue === 'object' && connectionValue.block) {
                  // Object format: connections: { success: { block: "block2", input: "data" } }
                  if (connectionValue.block === targetBlockId) {
                    delete (block.connections as any)[sourceHandle]
                    logger.info(
                      `Removed object connection from ${block_id}:${sourceHandle} to ${targetBlockId}`
                    )
                  }
                }
              }
            )
          }
        } else {
          logger.warn(`Block ${block_id} not found for editing`)
        }
        break

      case 'add':
        if (params?.type && params?.name) {
          workflowData.blocks[block_id] = {
            type: params.type,
            name: params.name,
            inputs: params.inputs || {},
            connections: params.connections || {},
          }
          logger.info(`Added block ${block_id}`, { type: params.type, name: params.name })
        } else {
          logger.warn(`Invalid add operation for block ${block_id} - missing type or name`)
        }
        break

      default:
        logger.warn(`Unknown operation type: ${operation_type}`)
    }
  }

  logger.info('Completed YAML operations', {
    finalBlockCount: Object.keys(workflowData.blocks).length,
  })

  // Convert the complete workflow data back to YAML (preserving version and all other fields)
  const { dump: yamlDump } = await import('js-yaml')
  return yamlDump(workflowData)
}

import { BaseCopilotTool } from '../base'

interface EditWorkflowParams {
  operations: EditWorkflowOperation[]
  workflowId: string
}

interface EditWorkflowResult {
  yamlContent: string
  operations: Array<{ type: string; blockId: string }>
}

class EditWorkflowTool extends BaseCopilotTool<EditWorkflowParams, EditWorkflowResult> {
  readonly id = 'edit_workflow'
  readonly displayName = 'Updating workflow'

  protected async executeImpl(params: EditWorkflowParams): Promise<EditWorkflowResult> {
    return editWorkflow(params)
  }
}

// Export the tool instance
export const editWorkflowTool = new EditWorkflowTool()

// Implementation function
async function editWorkflow(params: EditWorkflowParams): Promise<EditWorkflowResult> {
  const { operations, workflowId } = params

  logger.info('Processing targeted update request', {
    workflowId,
    operationCount: operations.length,
  })

  // Get current workflow state as JSON
  const { getUserWorkflowTool } = await import('./get-user-workflow')

  const getUserWorkflowResult = await getUserWorkflowTool.execute({
    workflowId: workflowId,
    includeMetadata: false,
  })

  if (!getUserWorkflowResult.success || !getUserWorkflowResult.data) {
    throw new Error('Failed to get current workflow state')
  }

  const workflowStateJson = getUserWorkflowResult.data

  logger.info('Retrieved current workflow state', {
    jsonLength: workflowStateJson.length,
    jsonPreview: workflowStateJson.substring(0, 200),
  })

  // Parse the JSON to get the workflow state object
  const workflowState = JSON.parse(workflowStateJson)

  // Extract subblock values from the workflow state (same logic as get-user-workflow.ts)
  const subBlockValues: Record<string, Record<string, any>> = {}
  Object.entries(workflowState.blocks || {}).forEach(([blockId, block]) => {
    subBlockValues[blockId] = {}
    Object.entries((block as any).subBlocks || {}).forEach(([subBlockId, subBlock]) => {
      if ((subBlock as any).value !== undefined) {
        subBlockValues[blockId][subBlockId] = (subBlock as any).value
      }
    })
  })

  logger.info('Extracted subblock values', {
    blockCount: Object.keys(subBlockValues).length,
    totalSubblocks: Object.values(subBlockValues).reduce(
      (sum, blockValues) => sum + Object.keys(blockValues).length,
      0
    ),
  })

  // Convert workflow state to YAML format using the same endpoint as the UI
  const blocks = getAllBlocks()
  const blockRegistry = blocks.reduce(
    (acc, block) => {
      const blockType = block.type
      acc[blockType] = {
        ...block,
        id: blockType,
        subBlocks: block.subBlocks || [],
        outputs: block.outputs || {},
      } as any
      return acc
    },
    {} as Record<string, BlockConfig>
  )

  // Convert to YAML using sim-agent
  const yamlResponse = await fetch(`${SIM_AGENT_API_URL}/api/workflow/to-yaml`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(SIM_AGENT_API_KEY && { 'x-api-key': SIM_AGENT_API_KEY }),
    },
    body: JSON.stringify({
      workflowState,
      subBlockValues, // Now using the properly extracted subblock values
      blockRegistry,
      utilities: {
        generateLoopBlocks: generateLoopBlocks.toString(),
        generateParallelBlocks: generateParallelBlocks.toString(),
        resolveOutputType: resolveOutputType.toString(),
      },
    }),
  })

  if (!yamlResponse.ok) {
    const errorText = await yamlResponse.text()
    throw new Error(`Sim agent API error: ${yamlResponse.statusText}`)
  }

  const yamlResult = await yamlResponse.json()

  if (!yamlResult.success || !yamlResult.yaml) {
    throw new Error(yamlResult.error || 'Failed to generate YAML')
  }

  const currentYaml = yamlResult.yaml

  if (!currentYaml || currentYaml.trim() === '') {
    throw new Error('Generated YAML is empty')
  }

  logger.info('Successfully converted workflow to YAML', {
    workflowId,
    blockCount: Object.keys(workflowState.blocks).length,
    yamlLength: currentYaml.length,
  })

  // Apply operations to generate modified YAML
  const modifiedYaml = await applyOperationsToYaml(currentYaml, operations)

  logger.info('Applied operations to YAML', {
    operationCount: operations.length,
    currentYamlLength: currentYaml.length,
    modifiedYamlLength: modifiedYaml.length,
    operations: operations.map((op) => ({ type: op.operation_type, blockId: op.block_id })),
  })

  logger.info(
    `Successfully generated modified YAML for ${operations.length} targeted update operations`
  )

  // Return the modified YAML directly - the UI will handle preview generation via updateDiffStore()
  return {
    yamlContent: modifiedYaml,
    operations: operations.map((op) => ({ type: op.operation_type, blockId: op.block_id })),
  }
}
