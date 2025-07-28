import { createLogger } from '@/lib/logs/console-logger'
import { BaseCopilotTool } from '../base'

interface BuildWorkflowParams {
  yamlContent: string
  description?: string
}

interface BuildWorkflowResult {
  yamlContent: string
  description?: string
  [key: string]: any // For the preview data fields
}

class BuildWorkflowTool extends BaseCopilotTool<BuildWorkflowParams, BuildWorkflowResult> {
  readonly id = 'build_workflow'
  readonly displayName = 'Building workflow'

  protected async executeImpl(params: BuildWorkflowParams): Promise<BuildWorkflowResult> {
    return buildWorkflow(params)
  }
}

// Export the tool instance
export const buildWorkflowTool = new BuildWorkflowTool()

// Implementation function
async function buildWorkflow(params: BuildWorkflowParams): Promise<BuildWorkflowResult> {
  const logger = createLogger('PreviewWorkflow')
  const { yamlContent, description } = params

  logger.info('Generating workflow preview for copilot', { 
    yamlLength: yamlContent.length,
    description,
  })

  // Forward the request to the existing workflow preview endpoint
  const previewUrl = `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/workflows/preview`
  
  const response = await fetch(previewUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      yamlContent,
      applyAutoLayout: true,
    }),
  })

  if (!response.ok) {
    logger.error('Workflow preview API failed', { 
      status: response.status, 
      statusText: response.statusText 
    })
    throw new Error('Workflow preview generation failed')
  }

  const previewData = await response.json()

  if (!previewData.success) {
    throw new Error(`Preview generation failed: ${previewData.message || 'Unknown error'}`)
  }

  // Return in the format expected by the copilot for diff functionality
  return {
    ...previewData,
    yamlContent, // Include the original YAML for diff functionality
    description,
  }
} 