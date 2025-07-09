import { NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'
import { useWorkflowYamlStore } from '@/stores/workflows/yaml/store'

const logger = createLogger('GetWorkflowYamlAPI')

export async function POST(request: NextRequest) {
  try {
    const { includeMetadata = false } = await request.json()

    logger.info('Executing get user workflow', { includeMetadata })

    // Get the workflow YAML using the same store as the UI
    const yamlStore = useWorkflowYamlStore.getState()
    const yamlContent = yamlStore.getYaml()

    if (!yamlContent) {
      return NextResponse.json(
        { success: false, error: 'No workflow content available' },
        { status: 404 }
      )
    }

    let metadata = undefined
    if (includeMetadata) {
      // Get additional workflow metadata if requested
      const workflowStore = yamlStore as any // Access internal state
      metadata = {
        name: workflowStore.workflow?.name || 'Unnamed Workflow',
        description: workflowStore.workflow?.description || '',
        createdAt: workflowStore.workflow?.createdAt,
        updatedAt: workflowStore.workflow?.updatedAt,
      }
    }

    logger.info('Successfully generated workflow YAML', { 
      includeMetadata, 
      yamlLength: yamlContent.length 
    })

    return NextResponse.json({
      success: true,
      yaml: yamlContent,
      metadata: metadata,
    })
  } catch (error) {
    logger.error('Get user workflow API failed', error)
    return NextResponse.json(
      {
        success: false,
        error: `Failed to get user workflow: ${error instanceof Error ? error.message : 'Unknown error'}`,
      },
      { status: 500 }
    )
  }
} 