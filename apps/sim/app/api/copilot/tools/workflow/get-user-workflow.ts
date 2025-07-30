import { eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/db-helpers'
import { getBlock } from '@/blocks'
import { getAllBlocks } from '@/blocks/registry'
import type { BlockConfig } from '@/blocks/types'
import { resolveOutputType } from '@/blocks/utils'
import { db } from '@/db'
import { workflow as workflowTable } from '@/db/schema'
import { generateLoopBlocks, generateParallelBlocks } from '@/stores/workflows/workflow/utils'
import { BaseCopilotTool } from '../base'

// Sim Agent API configuration
const SIM_AGENT_API_URL = process.env.SIM_AGENT_API_URL || 'http://localhost:8000'
const SIM_AGENT_API_KEY = process.env.SIM_AGENT_API_KEY

interface GetUserWorkflowParams {
  workflowId: string
  includeMetadata?: boolean
}

class GetUserWorkflowTool extends BaseCopilotTool<GetUserWorkflowParams, string> {
  readonly id = 'get_user_workflow'
  readonly displayName = 'Analyzing your workflow'

  protected async executeImpl(params: GetUserWorkflowParams): Promise<string> {
    return getUserWorkflow(params)
  }
}

// Export the tool instance
export const getUserWorkflowTool = new GetUserWorkflowTool()

// Implementation function
async function getUserWorkflow(params: GetUserWorkflowParams): Promise<string> {
  const logger = createLogger('GetUserWorkflow')
  const { workflowId, includeMetadata = false } = params

  logger.info('Fetching user workflow', { workflowId })

  // Fetch workflow from database
  const [workflowRecord] = await db
    .select()
    .from(workflowTable)
    .where(eq(workflowTable.id, workflowId))
    .limit(1)

  if (!workflowRecord) {
    throw new Error(`Workflow ${workflowId} not found`)
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
    throw new Error('Workflow state is empty or invalid')
  }

  // Generate YAML by calling sim-agent directly
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

  const response = await fetch(`${SIM_AGENT_API_URL}/api/workflow/to-yaml`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(SIM_AGENT_API_KEY && { 'x-api-key': SIM_AGENT_API_KEY }),
    },
    body: JSON.stringify({
      workflowState,
      subBlockValues,
      blockRegistry,
      utilities: {
        generateLoopBlocks: generateLoopBlocks.toString(),
        generateParallelBlocks: generateParallelBlocks.toString(),
        resolveOutputType: resolveOutputType.toString(),
      },
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Sim agent API error: ${response.statusText}`)
  }

  const generateResult = await response.json()

  if (!generateResult.success || !generateResult.yaml) {
    throw new Error(generateResult.error || 'Failed to generate YAML')
  }

  const yaml = generateResult.yaml

  if (!yaml || yaml.trim() === '') {
    throw new Error('Generated YAML is empty')
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
  const blockTypes = Object.values(workflowState.blocks).reduce(
    (acc: Record<string, number>, block: any) => {
      acc[block.type] = (acc[block.type] || 0) + 1
      return acc
    },
    {}
  )

  const categories = Object.values(blockSchemas).reduce(
    (acc: Record<string, number>, schema: any) => {
      if (schema.category) {
        acc[schema.category] = (acc[schema.category] || 0) + 1
      }
      return acc
    },
    {}
  )

  logger.info('Successfully fetched user workflow as YAML', {
    workflowId,
    blockCount: Object.keys(workflowState.blocks).length,
    yamlLength: yaml.length,
  })

  logger.info('YAML', { yaml })

  // Return the condensed YAML format directly, just like the YAML editor does
  return yaml
}
