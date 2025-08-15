import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console/logger'
import { getAllBlocks } from '@/blocks/registry'
import type { BlockConfig } from '@/blocks/types'
import { resolveOutputType } from '@/blocks/utils'
import {
  convertLoopBlockToLoop,
  convertParallelBlockToParallel,
  findAllDescendantNodes,
  findChildNodes,
  generateLoopBlocks,
  generateParallelBlocks,
} from '@/stores/workflows/workflow/utils'

const logger = createLogger('YamlDiffMergeAPI')

// Sim Agent API configuration
const SIM_AGENT_API_URL = process.env.SIM_AGENT_API_URL || 'http://localhost:8000'
const SIM_AGENT_API_KEY = process.env.SIM_AGENT_API_KEY

const MergeDiffRequestSchema = z.object({
  existingDiff: z.object({
    proposedState: z.object({
      blocks: z.record(z.any()),
      edges: z.array(z.any()),
      loops: z.record(z.any()).optional(),
      parallels: z.record(z.any()).optional(),
    }),
    diffAnalysis: z.any().optional(),
    metadata: z.object({
      source: z.string(),
      timestamp: z.number(),
    }),
  }),
  yamlContent: z.string().min(1),
  diffAnalysis: z.any().optional(),
  options: z
    .object({
      applyAutoLayout: z.boolean().optional(),
      layoutOptions: z.any().optional(),
    })
    .optional(),
})

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const body = await request.json()
    const { existingDiff, yamlContent, diffAnalysis, options } = MergeDiffRequestSchema.parse(body)

    // Ensure existingDiff.proposedState has all required properties with proper defaults
    if (!existingDiff.proposedState.loops) {
      existingDiff.proposedState.loops = {}
    }
    if (!existingDiff.proposedState.parallels) {
      existingDiff.proposedState.parallels = {}
    }

    logger.info(`[${requestId}] Merging diff from YAML`, {
      contentLength: yamlContent.length,
      existingBlockCount: Object.keys(existingDiff.proposedState.blocks).length,
      hasDiffAnalysis: !!diffAnalysis,
      hasOptions: !!options,
      options: options,
      hasApiKey: !!SIM_AGENT_API_KEY,
    })

    // Gather block registry
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

    // Call sim-agent API
    const response = await fetch(`${SIM_AGENT_API_URL}/api/yaml/diff/merge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(SIM_AGENT_API_KEY && { 'x-api-key': SIM_AGENT_API_KEY }),
      },
      body: JSON.stringify({
        existingDiff,
        yamlContent,
        diffAnalysis,
        blockRegistry,

        utilities: {
          generateLoopBlocks: generateLoopBlocks.toString(),
          generateParallelBlocks: generateParallelBlocks.toString(),
          resolveOutputType: resolveOutputType.toString(),
          convertLoopBlockToLoop: convertLoopBlockToLoop.toString(),
          convertParallelBlockToParallel: convertParallelBlockToParallel.toString(),
          findChildNodes: findChildNodes.toString(),
          findAllDescendantNodes: findAllDescendantNodes.toString(),
        },
        options,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error(`[${requestId}] Sim agent API error:`, {
        status: response.status,
        error: errorText,
      })
      return NextResponse.json(
        { success: false, errors: [`Sim agent API error: ${response.statusText}`] },
        { status: response.status }
      )
    }

    const result = await response.json()

    // Log the full response to see if auto-layout is happening
    logger.info(`[${requestId}] Full sim agent response:`, JSON.stringify(result, null, 2))

    // Log detailed block information to debug parent-child relationships
    if (result.success) {
      const blocks = result.diff?.proposedState?.blocks || result.blocks || {}
      logger.info(`[${requestId}] Sim agent blocks with parent-child info:`)
      Object.entries(blocks).forEach(([blockId, block]: [string, any]) => {
        if (block.data?.parentId || block.parentId) {
          logger.info(`[${requestId}] Child block ${blockId} (${block.name}):`, {
            type: block.type,
            parentId: block.data?.parentId || block.parentId,
            extent: block.data?.extent || block.extent,
            hasDataField: !!block.data,
            dataKeys: block.data ? Object.keys(block.data) : [],
          })
        }
        if (block.type === 'loop' || block.type === 'parallel') {
          logger.info(`[${requestId}] Container block ${blockId} (${block.name}):`, {
            type: block.type,
            hasData: !!block.data,
            dataKeys: block.data ? Object.keys(block.data) : [],
          })
        }
      })

      // Log existing loops/parallels from sim-agent
      const loops = result.diff?.proposedState?.loops || result.loops || {}
      const parallels = result.diff?.proposedState?.parallels || result.parallels || {}
      logger.info(`[${requestId}] Sim agent loops:`, loops)
      logger.info(`[${requestId}] Sim agent parallels:`, parallels)
    }

    // Post-process the result to ensure loops and parallels are properly generated
    const finalResult = result

    if (result.success && result.diff?.proposedState) {
      // First, fix parent-child relationships based on edges
      const blocks = result.diff.proposedState.blocks
      const edges = result.diff.proposedState.edges || []

      // Find all loop and parallel blocks
      const containerBlocks = Object.values(blocks).filter(
        (block: any) => block.type === 'loop' || block.type === 'parallel'
      )

      // For each container, find its children based on loop-start edges
      containerBlocks.forEach((container: any) => {
        const childEdges = edges.filter(
          (edge: any) => edge.source === container.id && edge.sourceHandle === 'loop-start-source'
        )

        childEdges.forEach((edge: any) => {
          const childBlock = blocks[edge.target]
          if (childBlock) {
            // Ensure data field exists
            if (!childBlock.data) {
              childBlock.data = {}
            }
            // Set parentId and extent
            childBlock.data.parentId = container.id
            childBlock.data.extent = 'parent'

            logger.info(`[${requestId}] Fixed parent-child relationship:`, {
              parent: container.id,
              parentName: container.name,
              child: childBlock.id,
              childName: childBlock.name,
            })
          }
        })
      })

      // Now regenerate loops and parallels with the fixed relationships
      const loops = generateLoopBlocks(result.diff.proposedState.blocks)
      const parallels = generateParallelBlocks(result.diff.proposedState.blocks)

      result.diff.proposedState.loops = loops
      result.diff.proposedState.parallels = parallels

      logger.info(`[${requestId}] Regenerated loops and parallels after fixing parent-child:`, {
        loopsCount: Object.keys(loops).length,
        parallelsCount: Object.keys(parallels).length,
        loops: Object.keys(loops).map((id) => ({
          id,
          nodes: loops[id].nodes,
        })),
      })
    }

    // If the sim agent returned blocks directly (when auto-layout is applied),
    // transform it to the expected diff format
    if (result.success && result.blocks && !result.diff) {
      logger.info(`[${requestId}] Transforming sim agent blocks response to diff format`)

      // First, fix parent-child relationships based on edges
      const blocks = result.blocks
      const edges = result.edges || []

      // Find all loop and parallel blocks
      const containerBlocks = Object.values(blocks).filter(
        (block: any) => block.type === 'loop' || block.type === 'parallel'
      )

      // For each container, find its children based on loop-start edges
      containerBlocks.forEach((container: any) => {
        const childEdges = edges.filter(
          (edge: any) => edge.source === container.id && edge.sourceHandle === 'loop-start-source'
        )

        childEdges.forEach((edge: any) => {
          const childBlock = blocks[edge.target]
          if (childBlock) {
            // Ensure data field exists
            if (!childBlock.data) {
              childBlock.data = {}
            }
            // Set parentId and extent
            childBlock.data.parentId = container.id
            childBlock.data.extent = 'parent'

            logger.info(`[${requestId}] Fixed parent-child relationship (auto-layout):`, {
              parent: container.id,
              parentName: container.name,
              child: childBlock.id,
              childName: childBlock.name,
            })
          }
        })
      })

      // Generate loops and parallels for the blocks with fixed relationships
      const loops = generateLoopBlocks(result.blocks)
      const parallels = generateParallelBlocks(result.blocks)

      const transformedResult = {
        success: result.success,
        diff: {
          proposedState: {
            blocks: result.blocks,
            edges: result.edges || existingDiff.proposedState.edges || [],
            loops: loops,
            parallels: parallels,
          },
          diffAnalysis: diffAnalysis,
          metadata: result.metadata || {
            source: 'sim-agent',
            timestamp: Date.now(),
          },
        },
        errors: result.errors || [],
      }

      return NextResponse.json(transformedResult)
    }

    return NextResponse.json(finalResult)
  } catch (error) {
    logger.error(`[${requestId}] Diff merge failed:`, error)

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, errors: error.errors.map((e) => e.message) },
        { status: 400 }
      )
    }

    return NextResponse.json(
      {
        success: false,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      },
      { status: 500 }
    )
  }
}
