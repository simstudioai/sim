import { getEnvironmentVariableKeys } from '@/lib/environment/utils'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserId } from '@/app/api/auth/oauth/utils'
import { BaseCopilotTool } from '../base'

interface GetEnvironmentVariablesParams {
  userId?: string
  workflowId?: string
}

interface EnvironmentVariablesResult {
  variableNames: string[]
  count: number
}

class GetEnvironmentVariablesTool extends BaseCopilotTool<
  GetEnvironmentVariablesParams,
  EnvironmentVariablesResult
> {
  readonly id = 'get_environment_variables'
  readonly displayName = 'Getting environment variables'

  protected async executeImpl(
    params: GetEnvironmentVariablesParams
  ): Promise<EnvironmentVariablesResult> {
    return getEnvironmentVariables(params)
  }
}

// Export the tool instance
export const getEnvironmentVariablesTool = new GetEnvironmentVariablesTool()

// Implementation function
async function getEnvironmentVariables(
  params: GetEnvironmentVariablesParams
): Promise<EnvironmentVariablesResult> {
  const logger = createLogger('GetEnvironmentVariables')
  const { userId: directUserId, workflowId } = params

  logger.info('Getting environment variables for copilot', {
    hasUserId: !!directUserId,
    hasWorkflowId: !!workflowId,
  })

  // Resolve userId from workflowId if needed
  const userId =
    directUserId || (workflowId ? await getUserId('copilot-env-vars', workflowId) : undefined)

  logger.info('Resolved userId', {
    directUserId,
    workflowId,
    resolvedUserId: userId,
  })

  if (!userId) {
    logger.warn('No userId could be determined', { directUserId, workflowId })
    throw new Error('Either userId or workflowId is required')
  }

  // Get environment variable keys directly
  const result = await getEnvironmentVariableKeys(userId)

  logger.info('Environment variable keys retrieved', {
    userId,
    variableCount: result.count,
  })

  return {
    variableNames: result.variableNames,
    count: result.count,
  }
}
