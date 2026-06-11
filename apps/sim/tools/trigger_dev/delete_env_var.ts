import type {
  TriggerDevEnvVarActionResponse,
  TriggerDevEnvVarNameParams,
} from '@/tools/trigger_dev/types'
import {
  buildTriggerDevEnvVarsUrl,
  buildTriggerDevHeaders,
  resolveTriggerDevSuccess,
} from '@/tools/trigger_dev/utils'
import type { ToolConfig } from '@/tools/types'

export const triggerDevDeleteEnvVarTool: ToolConfig<
  TriggerDevEnvVarNameParams,
  TriggerDevEnvVarActionResponse
> = {
  id: 'trigger_dev_delete_env_var',
  name: 'Trigger.dev Delete Env Var',
  description: 'Delete an environment variable from a Trigger.dev project environment.',
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
      description: 'Name of the environment variable to delete (e.g., "SLACK_API_KEY")',
    },
  },

  request: {
    url: (params) => buildTriggerDevEnvVarsUrl(params.projectRef, params.environment, params.name),
    method: 'DELETE',
    headers: (params) => buildTriggerDevHeaders(params.apiKey),
  },

  transformResponse: async (response, params) => {
    const deleted = await resolveTriggerDevSuccess(response)
    return {
      success: deleted,
      output: {
        success: deleted,
        name: params?.name ?? '',
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the environment variable was deleted' },
    name: { type: 'string', description: 'Name of the environment variable that was deleted' },
  },
}
