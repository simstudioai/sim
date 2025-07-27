import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('SetEnvironmentVariablesAPI')

export async function setEnvironmentVariables(params: any) {
  const { variables } = params

  if (!variables || typeof variables !== 'object') {
    throw new Error('Variables object is required')
  }

  logger.info('Setting environment variables for copilot', { 
    variableCount: Object.keys(variables).length,
    variableNames: Object.keys(variables),
  })

  // Forward the request to the existing environment variables endpoint
  const envUrl = `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/environment/variables`
  
  const response = await fetch(envUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ variables }),
  })

  if (!response.ok) {
    logger.error('Set environment variables API failed', { 
      status: response.status, 
      statusText: response.statusText 
    })
    throw new Error('Failed to set environment variables')
  }

  const result = await response.json()

  return {
    success: true,
    data: {
      message: 'Environment variables updated successfully',
      updatedVariables: Object.keys(variables),
      count: Object.keys(variables).length,
    },
  }
} 