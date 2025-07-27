import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('GetEnvironmentVariablesAPI')

export async function getEnvironmentVariables(params: any) {
  logger.info('Getting environment variables for copilot')

  // Forward the request to the existing environment variables endpoint
  const envUrl = `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/environment/variables`
  
  const response = await fetch(envUrl, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    logger.error('Environment variables API failed', { 
      status: response.status, 
      statusText: response.statusText 
    })
    throw new Error('Failed to get environment variables')
  }

  const envData = await response.json()

  // Extract just the variable names (not values) for security
  const variableNames = envData.data ? Object.keys(envData.data) : []

  return {
    success: true,
    data: {
      variableNames,
      count: variableNames.length,
    },
  }
} 