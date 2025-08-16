import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { simAgentClient } from '@/lib/sim-agent'
import { getAllBlocks } from '@/blocks/registry'
import type { BlockConfig } from '@/blocks/types'
import { resolveOutputType } from '@/blocks/utils'
import { generateLoopBlocks, generateParallelBlocks } from '@/stores/workflows/workflow/utils'

const logger = createLogger('WorkflowYamlAPI')

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    logger.info(`[${requestId}] Converting workflow JSON to YAML`)

    const body = await request.json()
    const { workflowState, subBlockValues, includeMetadata = false } = body

    if (!workflowState) {
      return NextResponse.json(
        { success: false, error: 'workflowState is required' },
        { status: 400 }
      )
    }

    // Gather block registry and utilities for sim-agent
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

    // Call sim-agent directly
    const result = await simAgentClient.makeRequest('/api/workflow/to-yaml', {
      body: {
        workflowState,
        subBlockValues,
        blockRegistry,
        utilities: {
          generateLoopBlocks: generateLoopBlocks.toString(),
          generateParallelBlocks: generateParallelBlocks.toString(),
          resolveOutputType: resolveOutputType.toString(),
        },
      },
    })

    if (!result.success || !result.data?.yaml) {
      return NextResponse.json(
        {
          success: false,
          error: result.error || 'Failed to generate YAML',
        },
        { status: result.status || 500 }
      )
    }

    logger.info(`[${requestId}] Successfully generated YAML`, {
      yamlLength: result.data.yaml.length,
    })

    return NextResponse.json({
      success: true,
      yaml: result.data.yaml,
    })
  } catch (error) {
    logger.error(`[${requestId}] YAML generation failed`, error)
    return NextResponse.json(
      {
        success: false,
        error: `Failed to generate YAML: ${error instanceof Error ? error.message : 'Unknown error'}`,
      },
      { status: 500 }
    )
  }
}
