import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console/logger'
import { getAllBlocks } from '@/blocks/registry'
import type { BlockConfig } from '@/blocks/types'
import { resolveOutputType } from '@/blocks/utils'
import { generateLoopBlocks, generateParallelBlocks } from '@/stores/workflows/workflow/utils'

const logger = createLogger('YamlParseAPI')

// Sim Agent API configuration
const SIM_AGENT_API_URL = process.env.SIM_AGENT_API_URL || 'http://localhost:8000'
const SIM_AGENT_API_KEY = process.env.SIM_AGENT_API_KEY

const ParseRequestSchema = z.object({
  yamlContent: z.string().min(1),
})

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const body = await request.json()
    const { yamlContent } = ParseRequestSchema.parse(body)

    logger.info(`[${requestId}] Parsing YAML`, {
      contentLength: yamlContent.length,
      hasApiKey: !!SIM_AGENT_API_KEY,
    })

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

    // Call sim-agent API
    const response = await fetch(`${SIM_AGENT_API_URL}/api/yaml/parse`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(SIM_AGENT_API_KEY && { 'x-api-key': SIM_AGENT_API_KEY }),
      },
      body: JSON.stringify({
        yamlContent,
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
    return NextResponse.json(result)
  } catch (error) {
    logger.error(`[${requestId}] YAML parse failed:`, error)

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
