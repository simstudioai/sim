import type {
  TriggerDevEnvVarNameParams,
  TriggerDevEnvVarResponse,
} from '@/tools/trigger_dev/types'
import { buildTriggerDevEnvVarsUrl, buildTriggerDevHeaders } from '@/tools/trigger_dev/utils'
import type { ToolConfig } from '@/tools/types'

export const triggerDevGetEnvVarTool: ToolConfig<
  TriggerDevEnvVarNameParams,
  TriggerDevEnvVarResponse
> = {
  id: 'trigger_dev_get_env_var',
  name: 'Trigger.dev Get Env Var',
  description:
    'Retrieve an environment variable from a Trigger.dev project environment. The value is returned in plaintext and will appear in workflow outputs and run history.',
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
      description: 'Environment to read the variable from: dev, staging, or prod',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the environment variable (e.g., "SLACK_API_KEY")',
    },
  },

  request: {
    url: (params) => buildTriggerDevEnvVarsUrl(params.projectRef, params.environment, params.name),
    method: 'GET',
    headers: (params) => buildTriggerDevHeaders(params.apiKey),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        name: data.name,
        value: data.value,
      },
    }
  },

  outputs: {
    name: { type: 'string', description: 'Name of the environment variable' },
    value: {
      type: 'string',
      description:
        'Plaintext value of the environment variable; appears in workflow outputs and run history',
    },
  },
}
