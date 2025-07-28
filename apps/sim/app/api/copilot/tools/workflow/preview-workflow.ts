import { createLogger } from '@/lib/logs/console-logger'
import { BaseCopilotTool } from '../base'

interface PreviewWorkflowParams {
  yamlContent: string
  description?: string
}

interface PreviewWorkflowResult {
  yamlContent: string
  description?: string
  [key: string]: any // For the preview data fields
}

class PreviewWorkflowTool extends BaseCopilotTool<PreviewWorkflowParams, PreviewWorkflowResult> {
  readonly id = 'build_workflow'
  readonly displayName = 'Preview workflow changes'

  protected async executeImpl(params: PreviewWorkflowParams): Promise<PreviewWorkflowResult> {
    return previewWorkflow(params)
  }
}

// Export the tool instance
export const previewWorkflowTool = new PreviewWorkflowTool()

// Implementation function
async function previewWorkflow(params: PreviewWorkflowParams): Promise<PreviewWorkflowResult> {
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