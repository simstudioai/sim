import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console-logger'
import { getAllBlocks } from '@/blocks/registry'
import { generateLoopBlocks, generateParallelBlocks, convertLoopBlockToLoop, convertParallelBlockToParallel, findChildNodes, findAllDescendantNodes } from '@/stores/workflows/workflow/utils'
import { resolveOutputType } from '@/blocks/utils'
import { BLOCK_CATEGORIES, BLOCK_DIMENSIONS } from '@/lib/autolayout/types'
import type { BlockConfig } from '@/blocks/types'

const logger = createLogger('YamlDiffCreateAPI')

// Sim Agent API configuration
const SIM_AGENT_API_URL = process.env.SIM_AGENT_API_URL || 'http://localhost:8000'
const SIM_AGENT_API_KEY = process.env.SIM_AGENT_API_KEY

const CreateDiffRequestSchema = z.object({
  yamlContent: z.string().min(1),
  diffAnalysis: z.object({
    new_blocks: z.array(z.string()),
    edited_blocks: z.array(z.string()),
    deleted_blocks: z.array(z.string()),
    field_diffs: z.record(z.object({
      changed_fields: z.array(z.string()),
      unchanged_fields: z.array(z.string())
    })).optional(),
    edge_diff: z.object({
      new_edges: z.array(z.string()),
      deleted_edges: z.array(z.string()),
      unchanged_edges: z.array(z.string())
    }).optional()
  }).optional(),
  options: z.object({
    applyAutoLayout: z.boolean().optional(),
    layoutOptions: z.any().optional()
  }).optional()
})

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const body = await request.json()
    const { yamlContent, diffAnalysis, options } = CreateDiffRequestSchema.parse(body)

    logger.info(`[${requestId}] Creating diff from YAML`, {
      contentLength: yamlContent.length,
      hasDiffAnalysis: !!diffAnalysis,
      hasOptions: !!options,
      options: options,
      hasApiKey: !!SIM_AGENT_API_KEY,
    })

    // Gather block registry
    const blocks = getAllBlocks()
    const blockRegistry = blocks.reduce((acc, block) => {
      const blockType = block.type
      acc[blockType] = {
        ...block,
        id: blockType,
        subBlocks: block.subBlocks || [],
        outputs: block.outputs || {},
      } as any
      return acc
    }, {} as Record<string, BlockConfig>)

    // Call sim-agent API
    const response = await fetch(`${SIM_AGENT_API_URL}/api/yaml/diff/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(SIM_AGENT_API_KEY && { 'x-api-key': SIM_AGENT_API_KEY }),
      },
      body: JSON.stringify({
        yamlContent,
        diffAnalysis,
        blockRegistry,
        blockMappings: {
          categories: BLOCK_CATEGORIES,
          dimensions: BLOCK_DIMENSIONS
        },
        utilities: {
          generateLoopBlocks: generateLoopBlocks.toString(),
          generateParallelBlocks: generateParallelBlocks.toString(),
          resolveOutputType: resolveOutputType.toString(),
          convertLoopBlockToLoop: convertLoopBlockToLoop.toString(),
          convertParallelBlockToParallel: convertParallelBlockToParallel.toString(),
          findChildNodes: findChildNodes.toString(),
          findAllDescendantNodes: findAllDescendantNodes.toString()
        },
        options
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
    
    // If the sim agent returned blocks directly (when auto-layout is applied),
    // transform it to the expected diff format
    if (result.success && result.blocks && !result.diff) {
      logger.info(`[${requestId}] Transforming sim agent blocks response to diff format`)
      
      const transformedResult = {
        success: result.success,
        diff: {
          proposedState: {
            blocks: result.blocks,
            edges: result.edges || [],
            loops: result.loops || {},
            parallels: result.parallels || {}
          },
          diffAnalysis: diffAnalysis,
          metadata: result.metadata || {
            source: 'sim-agent',
            timestamp: Date.now()
          }
        },
        errors: result.errors || []
      }
      
      return NextResponse.json(transformedResult)
    }
    
    return NextResponse.json(result)
  } catch (error) {
    logger.error(`[${requestId}] Diff creation failed:`, error)
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, errors: error.errors.map(e => e.message) },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { 
        success: false, 
        errors: [error instanceof Error ? error.message : 'Unknown error']
      },
      { status: 500 }
    )
  }
} 