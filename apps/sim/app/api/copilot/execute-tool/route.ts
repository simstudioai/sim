import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'
import { executeCopilotTool } from '@/lib/copilot/tools'

const logger = createLogger('ExecuteCopilotToolAPI')

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { toolId, params } = body

    if (!toolId) {
      return NextResponse.json(
        {
          success: false,
          error: 'toolId is required',
        },
        { status: 400 }
      )
    }

    logger.info('Executing copilot tool', { toolId })

    const result = await executeCopilotTool(toolId, params || {})

    return NextResponse.json(result)
  } catch (error) {
    logger.error('Failed to execute copilot tool', error)
    return NextResponse.json(
      {
        success: false,
        error: `Failed to execute copilot tool: ${error instanceof Error ? error.message : 'Unknown error'}`,
      },
      { status: 500 }
    )
  }
} 