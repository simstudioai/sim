import type {
  TriggerDevEnvVarActionResponse,
  TriggerDevEnvVarWriteParams,
} from '@/tools/trigger_dev/types'
import { buildTriggerDevEnvVarsUrl, buildTriggerDevHeaders } from '@/tools/trigger_dev/utils'
import type { ToolConfig } from '@/tools/types'

export const triggerDevUpdateEnvVarTool: ToolConfig<
  TriggerDevEnvVarWriteParams,
  TriggerDevEnvVarActionResponse
> = {
  id: 'trigger_dev_update_env_var',
  name: 'Trigger.dev Update Env Var',
  description: 'Update the value of an environment variable in a Trigger.dev project environment.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Trigger.dev secret API key (starts with tr_)',
    },
    projectRef: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'External ref of the project, from the project settings (starts with proj_)',
    },
    environment: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Environment the variable belongs to: dev, staging, or prod',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the environment variable to update (e.g., "SLACK_API_KEY")',
    },
    value: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'New value of the environment variable',
    },
  },

  request: {
    url: (params) => buildTriggerDevEnvVarsUrl(params.projectRef, params.environment, params.name),
    method: 'PUT',
    headers: (params) => buildTriggerDevHeaders(params.apiKey),
    body: (params) => ({
      value: params.value,
    }),
  },

  transformResponse: async (response, params) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        success: data.success ?? true,
        name: params?.name ?? '',
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the environment variable was updated' },
    name: { type: 'string', description: 'Name of the environment variable that was updated' },
  },
}
