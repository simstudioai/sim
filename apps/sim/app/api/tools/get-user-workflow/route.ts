import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/db-helpers'
import { generateWorkflowYaml } from '@/lib/workflows/yaml-generator'
import { db } from '@/db'
import { workflow as workflowTable } from '@/db/schema'
import { getBlock } from '@/blocks'

const logger = createLogger('GetUserWorkflowAPI')

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { workflowId, includeMetadata = false } = body

    if (!workflowId) {
      return NextResponse.json(
        { success: false, error: 'Workflow ID is required' },
        { status: 400 }
      )
    }

    logger.info('Fetching workflow for YAML generation', { workflowId })

    // Fetch workflow from database
    const [workflowRecord] = await db
      .select()
      .from(workflowTable)
      .where(eq(workflowTable.id, workflowId))
      .limit(1)

    if (!workflowRecord) {
      return NextResponse.json(
        { success: false, error: `Workflow ${workflowId} not found` },
        { status: 404 }
      )
    }

    // Try to load from normalized tables first, fallback to JSON blob
    let workflowState: any = null
    const subBlockValues: Record<string, Record<string, any>> = {}

    const normalizedData = await loadWorkflowFromNormalizedTables(workflowId)
    if (normalizedData) {
      workflowState = {
        blocks: normalizedData.blocks,
        edges: normalizedData.edges,
        loops: normalizedData.loops,
        parallels: normalizedData.parallels,
      }

      // Extract subblock values from normalized data
      Object.entries(normalizedData.blocks).forEach(([blockId, block]) => {
        subBlockValues[blockId] = {}
        Object.entries((block as any).subBlocks || {}).forEach(([subBlockId, subBlock]) => {
          if ((subBlock as any).value !== undefined) {
            subBlockValues[blockId][subBlockId] = (subBlock as any).value
          }
        })
      })
    } else if (workflowRecord.state) {
      // Fallback to JSON blob
      workflowState = workflowRecord.state as any
      // For JSON blob, subblock values are embedded in the block state
      Object.entries((workflowState.blocks as any) || {}).forEach(([blockId, block]) => {
        subBlockValues[blockId] = {}
        Object.entries((block as any).subBlocks || {}).forEach(([subBlockId, subBlock]) => {
          if ((subBlock as any).value !== undefined) {
            subBlockValues[blockId][subBlockId] = (subBlock as any).value
          }
        })
      })
    }

    if (!workflowState || !workflowState.blocks) {
      return NextResponse.json(
        { success: false, error: 'Workflow state is empty or invalid' },
        { status: 400 }
      )
    }

    // Generate YAML using server-side function
    const yaml = generateWorkflowYaml(workflowState, subBlockValues)

    if (!yaml || yaml.trim() === '') {
      return NextResponse.json(
        { success: false, error: 'Generated YAML is empty' },
        { status: 400 }
      )
    }

    // Generate detailed block information with schemas
    const blockSchemas: Record<string, any> = {}
    Object.entries(workflowState.blocks).forEach(([blockId, blockState]) => {
      const block = blockState as any
      const blockConfig = getBlock(block.type)
      
      if (blockConfig) {
        blockSchemas[blockId] = {
          type: block.type,
          name: block.name,
          description: blockConfig.description,
          longDescription: blockConfig.longDescription,
          category: blockConfig.category,
          docsLink: blockConfig.docsLink,
          inputs: {},
          inputRequirements: blockConfig.inputs || {},
          outputs: blockConfig.outputs || {},
          tools: blockConfig.tools,
        }

        // Add input schema from subBlocks configuration
        if (blockConfig.subBlocks) {
          blockConfig.subBlocks.forEach((subBlock) => {
            blockSchemas[blockId].inputs[subBlock.id] = {
              type: subBlock.type,
              title: subBlock.title,
              description: subBlock.description || '',
              layout: subBlock.layout,
              ...(subBlock.options && { options: subBlock.options }),
              ...(subBlock.placeholder && { placeholder: subBlock.placeholder }),
              ...(subBlock.min !== undefined && { min: subBlock.min }),
              ...(subBlock.max !== undefined && { max: subBlock.max }),
              ...(subBlock.columns && { columns: subBlock.columns }),
              ...(subBlock.hidden !== undefined && { hidden: subBlock.hidden }),
              ...(subBlock.condition && { condition: subBlock.condition }),
            }
          })
        }
      } else {
        // Handle special block types like loops and parallels
        blockSchemas[blockId] = {
          type: block.type,
          name: block.name,
          description: `${block.type.charAt(0).toUpperCase() + block.type.slice(1)} container block`,
          category: 'Control Flow',
          inputs: {},
          outputs: {},
        }
      }
    })

    // Generate workflow summary
    const blockTypes = Object.values(workflowState.blocks).reduce((acc: Record<string, number>, block: any) => {
      acc[block.type] = (acc[block.type] || 0) + 1
      return acc
    }, {})

    const categories = Object.values(blockSchemas).reduce((acc: Record<string, number>, schema: any) => {
      if (schema.category) {
        acc[schema.category] = (acc[schema.category] || 0) + 1
      }
      return acc
    }, {})

    // Prepare response with clear context markers
    const response: any = {
      workflowContext: 'USER_SPECIFIC_WORKFLOW', // Clear marker for the LLM
      note: 'This data represents only the blocks and configurations that the user has actually built in their current workflow, not all available Sim Studio capabilities.',
      yaml,
      format: 'yaml',
      summary: {
        workflowName: workflowRecord.name,
        blockCount: Object.keys(workflowState.blocks).length,
        edgeCount: (workflowState.edges || []).length,
        blockTypes,
        categories,
        hasLoops: Object.keys(workflowState.loops || {}).length > 0,
        hasParallels: Object.keys(workflowState.parallels || {}).length > 0,
      },
      userBuiltBlocks: blockSchemas, // Renamed to be clearer
    }

    // Add metadata if requested
    if (includeMetadata) {
      response.metadata = {
        workflowId: workflowRecord.id,
        name: workflowRecord.name,
        description: workflowRecord.description,
        workspaceId: workflowRecord.workspaceId,
        createdAt: workflowRecord.createdAt,
        updatedAt: workflowRecord.updatedAt,
      }
    }

    logger.info('Successfully generated workflow YAML', {
      workflowId,
      blockCount: response.blockCount,
      yamlLength: yaml.length,
    })

    return NextResponse.json({
      success: true,
      output: response,
    })
  } catch (error) {
    logger.error('Failed to get workflow YAML:', error)
    return NextResponse.json(
      {
        success: false,
        error: `Failed to get workflow YAML: ${error instanceof Error ? error.message : 'Unknown error'}`,
      },
      { status: 500 }
    )
  }
}
