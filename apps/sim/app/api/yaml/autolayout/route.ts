import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { applyAutoLayout } from '@/lib/workflows/autolayout'

const logger = createLogger('YamlAutoLayoutAPI')

const AutoLayoutRequestSchema = z.object({
  workflowState: z.object({
    blocks: z.record(z.any()),
    edges: z.array(z.any()),
    loops: z.record(z.any()).optional().default({}),
    parallels: z.record(z.any()).optional().default({}),
  }),
  options: z
    .object({
      strategy: z.enum(['smart', 'hierarchical', 'layered', 'force-directed']).optional(),
      direction: z.enum(['horizontal', 'vertical', 'auto']).optional(),
      spacing: z
        .object({
          horizontal: z.number().optional(),
          vertical: z.number().optional(),
          layer: z.number().optional(),
        })
        .optional(),
      alignment: z.enum(['start', 'center', 'end']).optional(),
      padding: z
        .object({
          x: z.number().optional(),
          y: z.number().optional(),
        })
        .optional(),
    })
    .optional(),
})

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const body = await request.json()
    const { workflowState, options } = AutoLayoutRequestSchema.parse(body)

    logger.info(`[${requestId}] Applying auto layout`, {
      blockCount: Object.keys(workflowState.blocks).length,
      edgeCount: workflowState.edges.length,
      strategy: options?.strategy || 'smart',
    })

    const autoLayoutOptions = {
      horizontalSpacing: options?.spacing?.horizontal || 550,
      verticalSpacing: options?.spacing?.vertical || 200,
      padding: {
        x: options?.padding?.x || 150,
        y: options?.padding?.y || 150,
      },
      alignment: options?.alignment || 'center',
    }

    const layoutResult = applyAutoLayout(
      workflowState.blocks,
      workflowState.edges,
      workflowState.loops || {},
      workflowState.parallels || {},
      autoLayoutOptions
    )

    if (!layoutResult.success || !layoutResult.blocks) {
      logger.error(`[${requestId}] Auto layout failed:`, {
        error: layoutResult.error,
      })
      return NextResponse.json(
        {
          success: false,
          errors: [layoutResult.error || 'Unknown auto layout error'],
        },
        { status: 500 }
      )
    }

    logger.info(`[${requestId}] Auto layout completed successfully:`, {
      success: true,
      blockCount: Object.keys(layoutResult.blocks).length,
    })

    const transformedResponse = {
      success: true,
      workflowState: {
        blocks: layoutResult.blocks,
        edges: workflowState.edges,
        loops: workflowState.loops || {},
        parallels: workflowState.parallels || {},
      },
    }

    return NextResponse.json(transformedResponse)
  } catch (error) {
    logger.error(`[${requestId}] Auto layout failed:`, error)

    return NextResponse.json(
      {
        success: false,
        errors: [error instanceof Error ? error.message : 'Unknown auto layout error'],
      },
      { status: 500 }
    )
  }
}
