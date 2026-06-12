import type {
  TriggerDevEnvVarsScopeParams,
  TriggerDevListEnvVarsResponse,
} from '@/tools/trigger_dev/types'
import { buildTriggerDevEnvVarsUrl, buildTriggerDevHeaders } from '@/tools/trigger_dev/utils'
import type { ToolConfig } from '@/tools/types'

export const triggerDevListEnvVarsTool: ToolConfig<
  TriggerDevEnvVarsScopeParams,
  TriggerDevListEnvVarsResponse
> = {
  id: 'trigger_dev_list_env_vars',
  name: 'Trigger.dev List Env Vars',
  description:
    'List the environment variables of a Trigger.dev project environment. Values are returned in plaintext and will appear in workflow outputs and run history — scope this operation carefully.',
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
      description: 'Environment to list variables for: dev, staging, or prod',
    },
  },

  request: {
    url: (params) => buildTriggerDevEnvVarsUrl(params.projectRef, params.environment),
    method: 'GET',
    headers: (params) => buildTriggerDevHeaders(params.apiKey),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    const variables = Array.isArray(data) ? data : []
    return {
      success: true,
      output: {
        variables: variables.map((variable) => ({
          name: variable.name,
          value: variable.value,
        })),
      },
    }
  },

  outputs: {
    variables: {
      type: 'array',
      description: 'Environment variables in the project environment',
      items: {
        type: 'object',
        description: 'Environment variable',
        properties: {
          name: { type: 'string', description: 'Name of the environment variable' },
          value: {
            type: 'string',
            description:
              'Plaintext value of the environment variable; appears in workflow outputs and run history',
          },
        },
      },
    },
  },
}
