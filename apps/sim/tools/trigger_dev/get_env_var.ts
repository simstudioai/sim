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
    'Retrieve an environment variable from a Trigger.dev project environment. A secret variable is returned redacted; a non-secret value is returned in plaintext and will appear in workflow outputs and run history.',
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

  /**
   * The retrieve endpoint is typed `EnvironmentVariableWithSecret` in
   * `@trigger.dev/core`, which returns `isSecret` at the top level alongside
   * `name` and `value`. The field is required there, so the fallback never
   * fires; it defaults to `true` because assuming a value is secret is the
   * safe direction — a caller must never treat a possibly-redacted value as
   * the real one.
   */
  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        name: data.name,
        value: data.value,
        isSecret: data.isSecret ?? true,
      },
    }
  },

  outputs: {
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
}
