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
    'List the environment variables of a Trigger.dev project environment. Secret variables are returned redacted; non-secret values are returned in plaintext and will appear in workflow outputs and run history — scope this operation carefully.',
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

  /**
   * The list endpoint is typed `z.array(EnvironmentVariableWithSecret)` in
   * `@trigger.dev/core`, so `isSecret` arrives per item rather than at the top
   * level. The field is required there, so the fallback never fires; it
   * defaults to `true` because assuming a value is secret is the safe
   * direction — a caller must never treat a possibly-redacted value as the
   * real one.
   */
  transformResponse: async (response) => {
    const data = await response.json()
    const variables = Array.isArray(data) ? data : []
    return {
      success: true,
      output: {
        variables: variables.map((variable) => ({
          name: variable.name,
          value: variable.value,
          isSecret: variable.isSecret ?? true,
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
              'Value of the environment variable. Secret variables come back redacted, not as the real value; non-secret values are plaintext and appear in workflow outputs and run history',
          },
          isSecret: {
            type: 'boolean',
            description:
              "Whether the variable is a secret. A secret variable's value comes back redacted, so branch on this before treating the value as real",
          },
        },
      },
    },
  },
}
