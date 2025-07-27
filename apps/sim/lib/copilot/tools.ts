import { createLogger } from '@/lib/logs/console-logger'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useWorkflowYamlStore } from '@/stores/workflows/yaml/store'
import { WORKFLOW_EXAMPLES } from './examples'
import { searchDocumentation } from './service'

const logger = createLogger('CopilotTools')

/**
 * Interface for copilot tool execution results
 */
export interface CopilotToolResult {
  success: boolean
  data?: any
  error?: string
}

/**
 * Interface for copilot tool parameters
 */
export interface CopilotToolParameters {
  type: 'object'
  properties: Record<string, any>
  required: string[]
}

/**
 * Interface for copilot tool definitions
 */
export interface CopilotTool {
  id: string
  name: string
  description: string
  parameters: CopilotToolParameters
  execute: (args: Record<string, any>) => Promise<CopilotToolResult>
}

/**
 * Operation types for targeted updates
 */
export type TargetedUpdateOperationType = 'add' | 'edit' | 'delete'

/**
 * Interface for targeted update operation
 */
export interface TargetedUpdateOperation {
  operation_type: TargetedUpdateOperationType
  block_id: string
  params?: any
}

/**
 * Interface for documentation search arguments
 */
interface DocsSearchArgs {
  query: string
  topK?: number
}

/**
 * Interface for workflow metadata
 */
interface WorkflowMetadata {
  workflowId: string
  name: string
  description: string | undefined
  workspaceId: string
}

/**
 * Interface for user workflow data
 */
interface UserWorkflowData {
  yaml: string
  metadata?: WorkflowMetadata
}

/**
 * Apply targeted update operations to YAML content
 */
async function applyOperationsToYaml(
  currentYaml: string,
  operations: TargetedUpdateOperation[]
): Promise<string> {
  const { parseWorkflowYaml } = await import('@/stores/workflows/yaml/importer')
  const yaml = await import('yaml')

  // Parse current YAML to get the complete structure
  const { data: workflowData, errors } = parseWorkflowYaml(currentYaml)
  if (!workflowData || errors.length > 0) {
    throw new Error(`Failed to parse current YAML: ${errors.join(', ')}`)
  }

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
  return yaml.stringify(workflowData)
}

/**
 * Update block references in values to use new mapped IDs
 * Uses the same logic as the YAML converter
 */
function updateBlockReferences(value: any, blockIdMapping: Map<string, string>): any {
  if (typeof value === 'string' && value.includes('<') && value.includes('>')) {
    let processedValue = value
    const blockMatches = value.match(/<([^>]+)>/g)

    if (blockMatches) {
      for (const match of blockMatches) {
        const path = match.slice(1, -1)
        const [blockRef] = path.split('.')

        // Skip system references
        if (['start', 'loop', 'parallel', 'variable'].includes(blockRef.toLowerCase())) {
          continue
        }

        // Check if this references an old block ID that needs mapping
        const newMappedId = blockIdMapping.get(blockRef)
        if (newMappedId) {
          processedValue = processedValue.replace(
            new RegExp(`<${blockRef}\\.`, 'g'),
            `<${newMappedId}.`
          )
          processedValue = processedValue.replace(
            new RegExp(`<${blockRef}>`, 'g'),
            `<${newMappedId}>`
          )
        }
      }
    }

    return processedValue
  }

  // Handle arrays
  if (Array.isArray(value)) {
    return value.map((item) => updateBlockReferences(item, blockIdMapping))
  }

  // Handle objects
  if (value !== null && typeof value === 'object') {
    const result = { ...value }
    for (const key in result) {
      result[key] = updateBlockReferences(result[key], blockIdMapping)
    }
    return result
  }

  return value
}

/**
 * Documentation search tool for copilot
 */
const docsSearchTool: CopilotTool = {
  id: 'docs_search_internal',
  name: 'Search Documentation',
  description:
    'Search Sim Studio documentation for information about features, tools, workflows, and functionality',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query to find relevant documentation',
      },
      topK: {
        type: 'number',
        description: 'Number of results to return (default: 10, max: 10)',
        default: 10,
      },
    },
    required: ['query'],
  },
  execute: async (args: Record<string, any>): Promise<CopilotToolResult> => {
    try {
      const { query, topK = 10 } = args

      // Call the API route directly
      const response = await fetch(
        `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/copilot/docs-search-internal`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query, topK }),
        }
      )

      if (!response.ok) {
        return {
          success: false,
          error: `Documentation search failed: ${response.status} ${response.statusText}`,
        }
      }

      const result = await response.json()
      return result
    } catch (error) {
      logger.error('Documentation search failed', error)
      return {
        success: false,
        error: `Documentation search failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }
    }
  },
}

/**
 * Get user workflow as YAML tool for copilot
 */
const getUserWorkflowTool: CopilotTool = {
  id: 'get_user_workflow',
  name: 'Get User Workflow',
  description:
    'Get the current user workflow as YAML format. This shows all blocks, their configurations, inputs, and connections in the workflow.',
  parameters: {
    type: 'object',
    properties: {
      includeMetadata: {
        type: 'boolean',
        description: 'Whether to include additional metadata about the workflow (default: false)',
        default: false,
      },
    },
    required: [],
  },
  execute: async (args: Record<string, any>): Promise<CopilotToolResult> => {
    try {
      const { includeMetadata = false, _context } = args
      const workflowId = _context?.workflowId

      // Call the API route directly
      const response = await fetch(
        `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/copilot/get-user-workflow`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ workflowId, includeMetadata }),
        }
      )

      if (!response.ok) {
        return {
          success: false,
          error: `Failed to get user workflow: ${response.status} ${response.statusText}`,
        }
      }

      const result = await response.json()
      return result
    } catch (error) {
      logger.error('Get user workflow failed', error)
      return {
        success: false,
        error: `Failed to get user workflow: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }
    }
  },
}

/**
 * Get workflow examples tool for copilot
 */
export const getWorkflowExamplesTool: CopilotTool = {
  id: 'get_workflow_examples',
  name: 'Get Workflow Examples',
  description: `Get YAML workflow examples by ID. Available example IDs: ${Object.keys(WORKFLOW_EXAMPLES).join(', ')}`,
  parameters: {
    type: 'object',
    properties: {
      exampleIds: {
        type: 'array',
        items: {
          type: 'string',
        },
        description: 'Array of example IDs to retrieve',
      },
    },
    required: ['exampleIds'],
  },
  execute: async (args: Record<string, any>): Promise<CopilotToolResult> => {
    try {
      const { exampleIds } = args

      if (!Array.isArray(exampleIds)) {
        return {
          success: false,
          error: 'exampleIds must be an array',
        }
      }

      const examples: Record<string, string> = {}
      const notFound: string[] = []

      for (const id of exampleIds) {
        if (WORKFLOW_EXAMPLES[id]) {
          examples[id] = WORKFLOW_EXAMPLES[id]
        } else {
          notFound.push(id)
        }
      }

      return {
        success: true,
        data: {
          examples,
          notFound,
          availableIds: Object.keys(WORKFLOW_EXAMPLES),
        },
      }
    } catch (error) {
      logger.error('Get workflow examples failed', error)
      return {
        success: false,
        error: `Failed to get workflow examples: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }
    }
  },
}

/**
 * Targeted updates tool for copilot - allows atomic add/edit/delete operations
 */
const targetedUpdatesTool: CopilotTool = {
  id: 'targeted_updates',
  name: 'Targeted Updates',
  description:
    'Make targeted updates to the workflow with atomic add, edit, or delete operations. Takes an array of operations to execute.',
  parameters: {
    type: 'object',
    properties: {
      operations: {
        type: 'array',
        description: 'Array of targeted update operations to perform',
        items: {
          type: 'object',
          properties: {
            operation_type: {
              type: 'string',
              enum: ['add', 'edit', 'delete'],
              description: 'Type of operation to perform',
            },
            block_id: {
              type: 'string',
              description:
                'Block ID for the operation. For add operations, this will be the desired ID for the new block.',
            },
            params: {
              type: 'object',
              description:
                'Parameters for the operation. For add: full block YAML, for edit: partial updates to inputs/connections, for delete: empty',
            },
          },
          required: ['operation_type', 'block_id'],
        },
      },
    },
    required: ['operations'],
  },
  execute: async (args: Record<string, any>): Promise<CopilotToolResult> => {
    try {
      const { operations, _context } = args

      if (!Array.isArray(operations)) {
        return {
          success: false,
          error: 'Operations must be an array',
        }
      }

      const workflowId = _context?.workflowId

      if (!workflowId) {
        return {
          success: false,
          error: 'No workflow ID provided in context',
        }
      }

      // Get current workflow YAML directly by calling the function
      const { getUserWorkflow } = await import('@/app/api/copilot/get-user-workflow/route')
      
      const getUserWorkflowResult = await getUserWorkflow({
        workflowId: workflowId,
        includeMetadata: false,
      })

      if (!getUserWorkflowResult.success || !getUserWorkflowResult.data) {
        return {
          success: false,
          error: 'Failed to get current workflow YAML',
        }
      }

      const currentYaml = getUserWorkflowResult.data

      logger.info('Retrieved current workflow YAML', {
        yamlLength: currentYaml.length,
        yamlPreview: currentYaml.substring(0, 200),
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
        success: true,
        data: {
          yamlContent: modifiedYaml,
          operations: operations.map((op) => ({ type: op.operation_type, blockId: op.block_id })),
        },
      }
    } catch (error) {
      logger.error('Targeted updates execution failed:', error)
      return {
        success: false,
        error: `Targeted updates failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }
    }
  },
}

/**
 * Preview workflow tool for copilot - allows internal calls to preview functionality
 */
const previewWorkflowTool: CopilotTool = {
  id: 'preview_workflow',
  name: 'Preview Workflow',
  description: 'Generate a sandbox preview of the workflow without saving it',
  parameters: {
    type: 'object',
    properties: {
      yamlContent: {
        type: 'string',
        description: 'The complete YAML workflow content to preview',
      },
      description: {
        type: 'string',
        description: 'Optional description of the proposed changes',
      },
    },
    required: ['yamlContent'],
  },
  execute: async (args: Record<string, any>): Promise<CopilotToolResult> => {
    try {
      const { yamlContent, description } = args

      // Call the API route directly
      const response = await fetch(
        `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/copilot/preview-workflow`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ yamlContent, description }),
        }
      )

      if (!response.ok) {
        return {
          success: false,
          error: `Preview generation failed: ${response.status} ${response.statusText}`,
        }
      }

      const result = await response.json()
      return result
    } catch (error) {
      logger.error('Preview workflow execution failed:', error)
      return {
        success: false,
        error: `Preview workflow failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }
    }
  },
}

/**
 * Additional copilot tools
 */
const getBlocksAndToolsTool: CopilotTool = {
  id: 'get_blocks_and_tools',
  name: 'Get All Blocks and Tools',
  description: 'Get a comprehensive list of all available blocks and tools in Sim Studio',
  parameters: {
    type: 'object',
    properties: {
      includeDetails: {
        type: 'boolean',
        description: 'Whether to include detailed information (default: false)',
        default: false,
      },
      filterCategory: {
        type: 'string',
        description: 'Optional category filter for blocks',
      },
    },
    required: [],
  },
  execute: async (args: Record<string, any>): Promise<CopilotToolResult> => {
    try {
      const { includeDetails = false, filterCategory } = args

      const response = await fetch(
        `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/copilot/get-blocks-and-tools`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ includeDetails, filterCategory }),
        }
      )

      if (!response.ok) {
        return {
          success: false,
          error: `Failed to get blocks and tools: ${response.status} ${response.statusText}`,
        }
      }

      const result = await response.json()
      return result
    } catch (error) {
      return {
        success: false,
        error: `Failed to get blocks and tools: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }
    }
  },
}

const getBlocksMetadataTool: CopilotTool = {
  id: 'get_blocks_metadata',
  name: 'Get Block Metadata',
  description: 'Get detailed metadata for specific blocks',
  parameters: {
    type: 'object',
    properties: {
      blockIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Array of block IDs to get metadata for',
      },
    },
    required: ['blockIds'],
  },
  execute: async (args: Record<string, any>): Promise<CopilotToolResult> => {
    try {
      const { blockIds } = args

      const response = await fetch(
        `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/copilot/get-blocks-metadata`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ blockIds }),
        }
      )

      if (!response.ok) {
        return {
          success: false,
          error: `Failed to get blocks metadata: ${response.status} ${response.statusText}`,
        }
      }

      const result = await response.json()
      return result
    } catch (error) {
      return {
        success: false,
        error: `Failed to get blocks metadata: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }
    }
  },
}

const getYamlStructureTool: CopilotTool = {
  id: 'get_yaml_structure',
  name: 'Get YAML Structure Guide',
  description: 'Get YAML workflow syntax guide and examples',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (args: Record<string, any>): Promise<CopilotToolResult> => {
    try {
      const response = await fetch(
        `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/copilot/get-yaml-structure`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        }
      )

      if (!response.ok) {
        return {
          success: false,
          error: `Failed to get YAML structure: ${response.status} ${response.statusText}`,
        }
      }

      const result = await response.json()
      return result
    } catch (error) {
      return {
        success: false,
        error: `Failed to get YAML structure: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }
    }
  },
}

const getEnvironmentVariablesTool: CopilotTool = {
  id: 'get_environment_variables',
  name: 'Get Environment Variables',
  description: 'Get a list of available environment variable names',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (args: Record<string, any>): Promise<CopilotToolResult> => {
    try {
      const response = await fetch(
        `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/copilot/get-environment-variables`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        }
      )

      if (!response.ok) {
        return {
          success: false,
          error: `Failed to get environment variables: ${response.status} ${response.statusText}`,
        }
      }

      const result = await response.json()
      return result
    } catch (error) {
      return {
        success: false,
        error: `Failed to get environment variables: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }
    }
  },
}

const setEnvironmentVariablesTool: CopilotTool = {
  id: 'set_environment_variables',
  name: 'Set Environment Variables',
  description: 'Set or update environment variables',
  parameters: {
    type: 'object',
    properties: {
      variables: {
        type: 'object',
        description: 'Key-value object of environment variables to set',
      },
    },
    required: ['variables'],
  },
  execute: async (args: Record<string, any>): Promise<CopilotToolResult> => {
    try {
      const { variables } = args

      const response = await fetch(
        `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/copilot/set-environment-variables`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ variables }),
        }
      )

      if (!response.ok) {
        return {
          success: false,
          error: `Failed to set environment variables: ${response.status} ${response.statusText}`,
        }
      }

      const result = await response.json()
      return result
    } catch (error) {
      return {
        success: false,
        error: `Failed to set environment variables: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }
    }
  },
}

const getWorkflowConsoleTool: CopilotTool = {
  id: 'get_workflow_console',
  name: 'Get Workflow Console',
  description: 'Get console logs and execution history from the workflow',
  parameters: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Maximum number of console entries to return (default: 50)',
        default: 50,
      },
      includeDetails: {
        type: 'boolean',
        description: 'Whether to include detailed input/output data (default: false)',
        default: false,
      },
    },
    required: [],
  },
  execute: async (args: Record<string, any>): Promise<CopilotToolResult> => {
    try {
      const { limit = 50, includeDetails = false } = args

      const response = await fetch(
        `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/copilot/get-workflow-console`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ limit, includeDetails }),
        }
      )

      if (!response.ok) {
        return {
          success: false,
          error: `Failed to get workflow console: ${response.status} ${response.statusText}`,
        }
      }

      const result = await response.json()
      return result
    } catch (error) {
      return {
        success: false,
        error: `Failed to get workflow console: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }
    }
  },
}

/**
 * Copilot tools registry
 */
const copilotTools: Record<string, CopilotTool> = {
  docs_search_internal: docsSearchTool,
  get_user_workflow: getUserWorkflowTool,
  get_workflow_examples: getWorkflowExamplesTool,
  get_blocks_and_tools: getBlocksAndToolsTool,
  get_blocks_metadata: getBlocksMetadataTool,
  get_yaml_structure: getYamlStructureTool,
  preview_workflow: previewWorkflowTool,
  targeted_updates: targetedUpdatesTool,
  get_environment_variables: getEnvironmentVariablesTool,
  set_environment_variables: setEnvironmentVariablesTool,
  get_workflow_console: getWorkflowConsoleTool,
}

/**
 * Get a copilot tool by ID
 */
export function getCopilotTool(toolId: string): CopilotTool | undefined {
  return copilotTools[toolId]
}

/**
 * Execute a copilot tool
 */
export async function executeCopilotTool(
  toolId: string,
  args: Record<string, any>
): Promise<CopilotToolResult> {
  const tool = getCopilotTool(toolId)

  if (!tool) {
    logger.error(`Copilot tool not found: ${toolId}`)
    return {
      success: false,
      error: `Tool not found: ${toolId}`,
    }
  }

  try {
    const result = await tool.execute(args)
    return result
  } catch (error) {
    logger.error(`Copilot tool execution failed: ${toolId}`, error)
    return {
      success: false,
      error: `Tool execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    }
  }
}

/**
 * Get all available copilot tools (for tool definitions in LLM requests)
 */
export function getAllCopilotTools(): CopilotTool[] {
  return Object.values(copilotTools)
}

