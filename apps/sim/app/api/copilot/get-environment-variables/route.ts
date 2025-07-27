import { createLogger } from '@/lib/logs/console-logger'
import { getEnvironmentVariableKeys } from '@/lib/environment/utils'
import { getUserId } from '@/app/api/auth/oauth/utils'

const logger = createLogger('GetEnvironmentVariablesAPI')

export async function getEnvironmentVariables(params: any) {
  logger.info('Getting environment variables for copilot', { params })

  const { userId: directUserId, workflowId } = params

  try {
    // Resolve userId from workflowId if needed
    const userId = directUserId || (workflowId ? await getUserId('copilot-env-vars', workflowId) : undefined)

    logger.info('Resolved userId', { 
      directUserId, 
      workflowId, 
      resolvedUserId: userId 
    })

    if (!userId) {
      logger.warn('No userId could be determined', { directUserId, workflowId })
      return {
        success: false,
        error: 'Either userId or workflowId is required',
      }
    }

    // Get environment variable keys directly
    const result = await getEnvironmentVariableKeys(userId)

    logger.info('Environment variable keys retrieved', { 
      userId,
      result,
      variableCount: result.count 
    })

    return {
      success: true,
      data: {
        variableNames: result.variableNames,
        count: result.count,
      },
    }
  } catch (error) {
    logger.error('Failed to get environment variables', error)
    return {
      success: false,
      error: 'Failed to get environment variables',
    }
  }
} 