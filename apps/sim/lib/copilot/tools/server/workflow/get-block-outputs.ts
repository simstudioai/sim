import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getBlockOutputPaths } from '@/lib/workflows/blocks/block-outputs'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'
import { normalizeName } from '@/executor/constants'
import type { Loop, Parallel } from '@/stores/workflows/workflow/types'
import type { BaseServerTool } from '../base-tool'

const logger = createLogger('GetBlockOutputsServerTool')

export const GetBlockOutputsInput = z.object({
  workflowId: z.string().min(1),
  blockIds: z.array(z.string()).optional(),
})

const BlockOutputSchema = z.object({
  blockId: z.string(),
  blockName: z.string(),
  blockType: z.string(),
  triggerMode: z.boolean().optional(),
  outputs: z.array(z.string()),
  insideSubflowOutputs: z.array(z.string()).optional(),
  outsideSubflowOutputs: z.array(z.string()).optional(),
})

const VariableOutputSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  tag: z.string(),
})

export const GetBlockOutputsResult = z.object({
  blocks: z.array(BlockOutputSchema),
  variables: z.array(VariableOutputSchema).optional(),
})

export type GetBlockOutputsInputType = z.infer<typeof GetBlockOutputsInput>
export type GetBlockOutputsResultType = z.infer<typeof GetBlockOutputsResult>

interface Variable {
  id: string
  name: string
  type: string
}

function formatOutputsWithPrefix(paths: string[], blockName: string): string[] {
  const normalizedName = normalizeName(blockName)
  return paths.map((path) => `${normalizedName}.${path}`)
}

function getSubflowInsidePaths(
  blockType: 'loop' | 'parallel',
  blockId: string,
  loops: Record<string, Loop>,
  parallels: Record<string, Parallel>
): string[] {
  const paths = ['index']
  if (blockType === 'loop') {
    const loopType = loops[blockId]?.loopType || 'for'
    if (loopType === 'forEach') {
      paths.push('currentItem', 'items')
    }
  } else {
    const parallelType = parallels[blockId]?.parallelType || 'count'
    if (parallelType === 'collection') {
      paths.push('currentItem', 'items')
    }
  }
  return paths
}

export const getBlockOutputsServerTool: BaseServerTool<
  GetBlockOutputsInputType,
  GetBlockOutputsResultType
> = {
  name: 'get_block_outputs',
  async execute(args: unknown, context?: { userId: string }) {
    const parsed = GetBlockOutputsInput.parse(args)
    const { workflowId, blockIds } = parsed

    if (!context?.userId) {
      throw new Error('User authentication required')
    }

    logger.debug('Getting block outputs', { workflowId, blockIds })

    // Load workflow from normalized tables
    const normalizedData = await loadWorkflowFromNormalizedTables(workflowId)

    if (!normalizedData?.blocks) {
      throw new Error('Workflow state is empty or invalid')
    }

    const blocks = normalizedData.blocks
    const loops = normalizedData.loops || {}
    const parallels = normalizedData.parallels || {}

    const targetBlockIds = blockIds && blockIds.length > 0 ? blockIds : Object.keys(blocks)

    const blockOutputs: GetBlockOutputsResultType['blocks'] = []

    for (const blockId of targetBlockIds) {
      const block = blocks[blockId]
      if (!block?.type) continue

      const blockName = block.name || block.type

      const blockOutput: GetBlockOutputsResultType['blocks'][0] = {
        blockId,
        blockName,
        blockType: block.type,
        outputs: [],
      }

      // Include triggerMode if the block is in trigger mode
      if (block.triggerMode) {
        blockOutput.triggerMode = true
      }

      if (block.type === 'loop' || block.type === 'parallel') {
        const insidePaths = getSubflowInsidePaths(block.type, blockId, loops, parallels)
        blockOutput.insideSubflowOutputs = formatOutputsWithPrefix(insidePaths, blockName)
        blockOutput.outsideSubflowOutputs = formatOutputsWithPrefix(['results'], blockName)
      } else {
        // Compute output paths using the block's subBlocks
        const outputPaths = getBlockOutputPaths(block.type, block.subBlocks, block.triggerMode)
        blockOutput.outputs = formatOutputsWithPrefix(outputPaths, blockName)
      }

      blockOutputs.push(blockOutput)
    }

    // Get workflow variables if no specific blockIds requested
    let variables: GetBlockOutputsResultType['variables'] | undefined
    const includeVariables = !blockIds || blockIds.length === 0

    if (includeVariables) {
      // Get variables from workflow record
      const [wf] = await db
        .select({ variables: workflow.variables })
        .from(workflow)
        .where(eq(workflow.id, workflowId))
        .limit(1)

      const workflowVariables = wf?.variables as Record<string, Variable> | null

      if (workflowVariables && typeof workflowVariables === 'object') {
        variables = Object.values(workflowVariables)
          .filter(
            (v): v is Variable =>
              typeof v === 'object' &&
              v !== null &&
              'name' in v &&
              typeof v.name === 'string' &&
              v.name.trim() !== ''
          )
          .map((variable) => ({
            id: variable.id,
            name: variable.name,
            type: variable.type || 'string',
            tag: `variable.${normalizeName(variable.name)}`,
          }))
      }
    }

    logger.info('Retrieved block outputs', {
      workflowId,
      blockCount: blockOutputs.length,
      variableCount: variables?.length ?? 0,
    })

    return GetBlockOutputsResult.parse({
      blocks: blockOutputs,
      ...(variables && { variables }),
    })
  },
}
