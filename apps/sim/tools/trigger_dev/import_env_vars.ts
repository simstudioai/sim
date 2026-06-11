import type {
  TriggerDevImportEnvVarsParams,
  TriggerDevImportEnvVarsResponse,
} from '@/tools/trigger_dev/types'
import {
  buildTriggerDevEnvVarsUrl,
  buildTriggerDevHeaders,
  parseJsonInput,
} from '@/tools/trigger_dev/utils'
import type { ToolConfig } from '@/tools/types'

export const triggerDevImportEnvVarsTool: ToolConfig<
  TriggerDevImportEnvVarsParams,
  TriggerDevImportEnvVarsResponse
> = {
  id: 'trigger_dev_import_env_vars',
  name: 'Trigger.dev Import Env Vars',
  description:
    'Upload multiple environment variables to a Trigger.dev project environment in one request.',
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
      description: 'Environment to upload the variables to: dev, staging, or prod',
    },
    variables: {
      type: 'json',
      required: true,
      visibility: 'user-only',
      description:
        'JSON array of environment variables to upload. Example: [{"name": "SLACK_API_KEY", "value": "slack_123"}]',
    },
    override: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to override existing variables: "true" or "false" (default false)',
    },
  },

  request: {
    url: (params) => `${buildTriggerDevEnvVarsUrl(params.projectRef, params.environment)}/import`,
    method: 'POST',
    headers: (params) => buildTriggerDevHeaders(params.apiKey),
    body: (params) => {
      const variables = parseJsonInput(params.variables, 'variables')
      if (!Array.isArray(variables)) {
        throw new Error('The variables parameter must be a JSON array of {"name", "value"} objects')
      }
      const body: Record<string, unknown> = { variables }
      if (params.override === 'true' || params.override === 'false') {
        body.override = params.override === 'true'
      }
      return body
    },
  },

  transformResponse: async (response, params) => {
    const data = await response.json()
    const variables = parseJsonInput(params?.variables, 'variables')
    return {
      success: true,
      output: {
        success: data.success ?? true,
        count: Array.isArray(variables) ? variables.length : 0,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the environment variables were uploaded' },
    count: { type: 'number', description: 'Number of environment variables submitted' },
  },
}
