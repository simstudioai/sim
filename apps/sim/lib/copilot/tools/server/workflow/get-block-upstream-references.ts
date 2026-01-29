import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { normalizeName } from '@/executor/constants'
import { BlockPathCalculator } from '@/lib/workflows/blocks/block-path-calculator'
import { getBlockOutputPaths } from '@/lib/workflows/blocks/block-outputs'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'
import { isInputDefinitionTrigger } from '@/lib/workflows/triggers/input-definition-triggers'
import type { Loop, Parallel } from '@/stores/workflows/workflow/types'
import type { BaseServerTool } from '../base-tool'

const logger = createLogger('GetBlockUpstreamReferencesServerTool')

export const GetBlockUpstreamReferencesInput = z.object({
  workflowId: z.string().min(1),
  blockIds: z.array(z.string()).min(1),
})

interface Variable {
  id: string
  name: string
  type?: string
}

interface BlockOutput {
  blockId: string
  blockName: string
  blockType: string
  outputs: string[]
  triggerMode?: boolean
  accessContext?: 'inside' | 'outside'
}

interface UpstreamResult {
  blockId: string
  blockName: string
  accessibleBlocks: BlockOutput[]
  variables: Array<{ id: string; name: string; type: string; tag: string }>
  insideSubflows?: Array<{ blockId: string; blockName: string; blockType: string }>
}

const GetBlockUpstreamReferencesResult = z.object({
  results: z.array(
    z.object({
      blockId: z.string(),
      blockName: z.string(),
      accessibleBlocks: z.array(
        z.object({
          blockId: z.string(),
          blockName: z.string(),
          blockType: z.string(),
          outputs: z.array(z.string()),
          triggerMode: z.boolean().optional(),
          accessContext: z.enum(['inside', 'outside']).optional(),
        })
      ),
      variables: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          type: z.string(),
          tag: z.string(),
        })
      ),
      insideSubflows: z
        .array(
          z.object({
            blockId: z.string(),
            blockName: z.string(),
            blockType: z.string(),
          })
        )
        .optional(),
    })
  ),
})

type GetBlockUpstreamReferencesResultType = z.infer<typeof GetBlockUpstreamReferencesResult>

/**
 * Format output paths with block name prefix
 */
function formatOutputsWithPrefix(outputPaths: string[], blockName: string): string[] {
  const normalized = normalizeName(blockName)
  return outputPaths.map((path) => `${normalized}.${path}`)
}

/**
 * Get outputs for subflow from inside (loop item, parallel item, etc.)
 */
function getSubflowInsidePaths(
  blockType: string,
  blockId: string,
  loops: Record<string, Loop>,
  parallels: Record<string, Parallel>
): string[] {
  if (blockType === 'loop') {
    const loop = loops[blockId]
    if (loop?.loopType === 'forEach') {
      return ['item', 'index']
    }
    return ['index']
  }
  if (blockType === 'parallel') {
    return ['item', 'index']
  }
  return []
}

export const getBlockUpstreamReferencesServerTool: BaseServerTool<
  typeof GetBlockUpstreamReferencesInput,
  GetBlockUpstreamReferencesResultType
> = {
  name: 'get_block_upstream_references',

  async execute(args: unknown, context?: { userId: string }) {
    const parsed = GetBlockUpstreamReferencesInput.parse(args)
    const { workflowId, blockIds } = parsed

    logger.info('Getting block upstream references', {
      workflowId,
      blockIds,
    })

    // Load workflow from normalized tables
    const normalizedData = await loadWorkflowFromNormalizedTables(workflowId)

    if (!normalizedData?.blocks) {
      throw new Error('Workflow state is empty or invalid')
    }

    const blocks = normalizedData.blocks
    const edges = normalizedData.edges || []
    const loops = (normalizedData.loops || {}) as Record<string, Loop>
    const parallels = (normalizedData.parallels || {}) as Record<string, Parallel>

    // Get workflow variables
    const [wf] = await db
      .select({ variables: workflow.variables })
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)

    const workflowVariables = wf?.variables as Record<string, Variable> | null
    let variables: Array<{ id: string; name: string; type: string; tag: string }> = []

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

    // Build graph edges for path calculation
    const graphEdges = edges.map((edge: { source: string; target: string }) => ({
      source: edge.source,
      target: edge.target,
    }))

    const results: UpstreamResult[] = []

    for (const blockId of blockIds) {
      const targetBlock = blocks[blockId]
      if (!targetBlock) {
        logger.warn(`Block ${blockId} not found`)
        continue
      }

      const insideSubflows: Array<{ blockId: string; blockName: string; blockType: string }> = []
      const containingLoopIds = new Set<string>()
      const containingParallelIds = new Set<string>()

      // Find containing loops
      Object.values(loops).forEach((loop) => {
        if (loop?.nodes?.includes(blockId)) {
          containingLoopIds.add(loop.id)
          const loopBlock = blocks[loop.id]
          if (loopBlock) {
            insideSubflows.push({
              blockId: loop.id,
              blockName: loopBlock.name || loopBlock.type,
              blockType: 'loop',
            })
          }
        }
      })

      // Find containing parallels
      Object.values(parallels).forEach((parallel) => {
        if (parallel?.nodes?.includes(blockId)) {
          containingParallelIds.add(parallel.id)
          const parallelBlock = blocks[parallel.id]
          if (parallelBlock) {
            insideSubflows.push({
              blockId: parallel.id,
              blockName: parallelBlock.name || parallelBlock.type,
              blockType: 'parallel',
            })
          }
        }
      })

      // Find all ancestor blocks using path calculator
      const ancestorIds = BlockPathCalculator.findAllPathNodes(graphEdges, blockId)
      const accessibleIds = new Set<string>(ancestorIds)
      accessibleIds.add(blockId)

      // Include starter block if it's an ancestor
      const starterBlock = Object.values(blocks).find((b: any) =>
        isInputDefinitionTrigger(b.type)
      )
      if (starterBlock && ancestorIds.includes((starterBlock as any).id)) {
        accessibleIds.add((starterBlock as any).id)
      }

      // Add all nodes in containing loops/parallels
      containingLoopIds.forEach((loopId) => {
        accessibleIds.add(loopId)
        loops[loopId]?.nodes?.forEach((nodeId) => accessibleIds.add(nodeId))
      })

      containingParallelIds.forEach((parallelId) => {
        accessibleIds.add(parallelId)
        parallels[parallelId]?.nodes?.forEach((nodeId) => accessibleIds.add(nodeId))
      })

      const accessibleBlocks: BlockOutput[] = []

      for (const accessibleBlockId of accessibleIds) {
        const block = blocks[accessibleBlockId] as any
        if (!block?.type) continue

        // Skip self-reference unless it's a special block type
        const canSelfReference = block.type === 'approval' || block.type === 'human_in_the_loop'
        if (accessibleBlockId === blockId && !canSelfReference) continue

        const blockName = block.name || block.type
        let accessContext: 'inside' | 'outside' | undefined
        let outputPaths: string[]

        if (block.type === 'loop' || block.type === 'parallel') {
          const isInside =
            (block.type === 'loop' && containingLoopIds.has(accessibleBlockId)) ||
            (block.type === 'parallel' && containingParallelIds.has(accessibleBlockId))

          accessContext = isInside ? 'inside' : 'outside'
          outputPaths = isInside
            ? getSubflowInsidePaths(block.type, accessibleBlockId, loops, parallels)
            : ['results']
        } else {
          outputPaths = getBlockOutputPaths(block.type, block.subBlocks, block.triggerMode)
        }

        const formattedOutputs = formatOutputsWithPrefix(outputPaths, blockName)

        const entry: BlockOutput = {
          blockId: accessibleBlockId,
          blockName,
          blockType: block.type,
          outputs: formattedOutputs,
        }

        if (block.triggerMode) {
          entry.triggerMode = true
        }

        if (accessContext) {
          entry.accessContext = accessContext
        }

        accessibleBlocks.push(entry)
      }

      const resultEntry: UpstreamResult = {
        blockId,
        blockName: targetBlock.name || targetBlock.type,
        accessibleBlocks,
        variables,
      }

      if (insideSubflows.length > 0) {
        resultEntry.insideSubflows = insideSubflows
      }

      results.push(resultEntry)
    }

    const result = GetBlockUpstreamReferencesResult.parse({ results })

    logger.info('Retrieved upstream references', {
      blockIds,
      resultCount: results.length,
    })

    return result
  },
}
