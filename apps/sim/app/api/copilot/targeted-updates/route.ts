import { type NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { apiKey as apiKeyTable } from '@/db/schema'

const logger = createLogger('TargetedUpdatesAPI')

// Types for operations
interface TargetedUpdateOperation {
  operation_type: 'add' | 'edit' | 'delete'
  block_id: string
  params?: Record<string, any>
}

/**
 * Apply operations to YAML workflow
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

export async function targetedUpdates(params: any) {
  try {
    const { operations, workflowId } = params

    if (!operations || !Array.isArray(operations)) {
      return {
        success: false,
        error: 'operations must be an array',
      }
    }

    if (!workflowId) {
      return {
        success: false,
        error: 'workflowId is required',
      }
    }

    logger.info('Processing targeted update request', { 
      workflowId,
      operationCount: operations.length 
    })

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
    logger.error('Targeted update failed:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    // Try session auth first (for web UI)
    const session = await getSession()
    let authenticatedUserId: string | null = session?.user?.id || null

    // If no session, check for API key auth
    if (!authenticatedUserId) {
      const apiKeyHeader = request.headers.get('x-api-key')
      if (apiKeyHeader) {
        // Verify API key
        const [apiKeyRecord] = await db
          .select({ userId: apiKeyTable.userId })
          .from(apiKeyTable)
          .where(eq(apiKeyTable.key, apiKeyHeader))
          .limit(1)

        if (apiKeyRecord) {
          authenticatedUserId = apiKeyRecord.userId
        }
      }
    }

    // Parse body early to check for workflowId
    const body = await request.json()
    const { operations, workflowId } = body

    // If no authentication but workflowId is provided, allow internal calls
    // This maintains backward compatibility for internal copilot tool calls
    if (!authenticatedUserId) {
      if (!workflowId) {
        return NextResponse.json({ error: 'Unauthorized - authentication or workflowId required' }, { status: 401 })
      }
      
      // For internal calls without auth, we'll validate the workflow exists
      // but won't enforce user ownership (as this was the original behavior)
      logger.info('Allowing internal call to targeted-updates without authentication', { workflowId })
    }

    if (!operations || !Array.isArray(operations)) {
      return NextResponse.json(
        { success: false, error: 'Operations array is required' },
        { status: 400 }
      )
    }

    if (!workflowId) {
      return NextResponse.json(
        { success: false, error: 'Workflow ID is required' },
        { status: 400 }
      )
    }

    logger.info('Executing targeted updates', {
      workflowId,
      userId: authenticatedUserId || 'internal_call',
      operationCount: operations.length,
      operations: operations.map((op) => ({ type: op.operation_type, blockId: op.block_id })),
    })

    const result = await executeCopilotTool('targeted_updates', {
      operations,
      _context: { workflowId },
    })

    return NextResponse.json(result)
  } catch (error) {
    logger.error('Targeted updates API failed:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
