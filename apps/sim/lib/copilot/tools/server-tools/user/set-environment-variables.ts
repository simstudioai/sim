import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { BaseCopilotTool } from '../base'

interface SetEnvironmentVariablesParams {
  variables: Record<string, any>
  workflowId?: string
}

interface SetEnvironmentVariablesResult {
  message: string
  updatedVariables: string[]
  count: number
}

class SetEnvironmentVariablesTool extends BaseCopilotTool<
  SetEnvironmentVariablesParams,
  SetEnvironmentVariablesResult
> {
  readonly id = 'set_environment_variables'
  readonly displayName = 'Setting environment variables'
  readonly requiresInterrupt = true

  protected async executeImpl(
    params: SetEnvironmentVariablesParams
  ): Promise<SetEnvironmentVariablesResult> {
    return setEnvironmentVariables(params)
  }
}

// Export the tool instance
export const setEnvironmentVariablesTool = new SetEnvironmentVariablesTool()

// Implementation function
async function setEnvironmentVariables(
  params: SetEnvironmentVariablesParams
): Promise<SetEnvironmentVariablesResult> {
  const logger = createLogger('SetEnvironmentVariables')
  const { variables, workflowId } = params

  logger.info('Setting environment variables for copilot', {
    variableCount: Object.keys(variables).length,
    variableNames: Object.keys(variables),
    hasWorkflowId: !!workflowId,
  })

  // Forward the request to the existing environment variables endpoint
  const envUrl = `${env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/environment/variables`

  const response = await fetch(envUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ variables, workflowId }),
  })

  if (!response.ok) {
    logger.error('Set environment variables API failed', {
      status: response.status,
      statusText: response.statusText,
    })
    throw new Error('Failed to set environment variables')
  }

  await response.json()

  return {
    message: 'Environment variables updated successfully',
    updatedVariables: Object.keys(variables),
    count: Object.keys(variables).length,
  }
}
