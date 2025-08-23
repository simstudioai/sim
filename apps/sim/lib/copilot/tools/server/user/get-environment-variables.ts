import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { getEnvironmentVariableKeys } from '@/lib/environment/utils'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserId } from '@/app/api/auth/oauth/utils'

interface GetEnvironmentVariablesParams {
  userId?: string
  workflowId?: string
}

export const getEnvironmentVariablesServerTool: BaseServerTool<GetEnvironmentVariablesParams, any> =
  {
    name: 'get_environment_variables',
    async execute(params: GetEnvironmentVariablesParams): Promise<any> {
      const logger = createLogger('GetEnvironmentVariablesServerTool')
      const { userId: directUserId, workflowId } = params || {}

      logger.info('Getting environment variables (new runtime)', {
        hasUserId: !!directUserId,
        hasWorkflowId: !!workflowId,
      })

      const userId =
        directUserId || (workflowId ? await getUserId('copilot-env-vars', workflowId) : undefined)
      if (!userId) {
        logger.warn('No userId could be determined', { directUserId, workflowId })
        throw new Error('Either userId or workflowId is required')
      }

      const result = await getEnvironmentVariableKeys(userId)
      logger.info('Environment variable keys retrieved', { userId, variableCount: result.count })
      return {
        variableNames: result.variableNames,
        count: result.count,
      }
    },
  }
