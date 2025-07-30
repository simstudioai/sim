import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'
import { yamlService } from '@/lib/yaml-service-client'

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

    // Generate YAML using the yaml service
    const result = await yamlService.generateYaml(workflowState, subBlockValues)

    if (!result.success || !result.yaml) {
      return NextResponse.json(
        {
          success: false,
          error: result.error || 'Failed to generate YAML',
        },
        { status: 500 }
      )
    }

    logger.info(`[${requestId}] Successfully generated YAML`, {
      yamlLength: result.yaml.length,
    })

    return NextResponse.json({
      success: true,
      yaml: result.yaml,
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
