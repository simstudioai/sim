import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('PreviewWorkflowAPI')

export async function previewWorkflow(params: any) {
  const { yamlContent, description } = params

  if (!yamlContent) {
    throw new Error('yamlContent is required')
  }

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
    success: true,
    data: {
      ...previewData,
      yamlContent, // Include the original YAML for diff functionality
      description,
    },
  }
} 