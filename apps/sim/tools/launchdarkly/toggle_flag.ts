import type {
  LaunchDarklyToggleFlagParams,
  LaunchDarklyToggleFlagResponse,
} from '@/tools/launchdarkly/types'
import { FLAG_OUTPUT_PROPERTIES } from '@/tools/launchdarkly/types'
import type { ToolConfig } from '@/tools/types'

export const launchDarklyToggleFlagTool: ToolConfig<
  LaunchDarklyToggleFlagParams,
  LaunchDarklyToggleFlagResponse
> = {
  id: 'launchdarkly_toggle_flag',
  name: 'LaunchDarkly Toggle Flag',
  description: 'Toggle a feature flag on or off in a specific LaunchDarkly environment.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'LaunchDarkly API key',
    },
    projectKey: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The project key',
    },
    flagKey: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The feature flag key to toggle',
    },
    environmentKey: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The environment key to toggle the flag in',
    },
    enabled: {
      type: 'boolean',
      required: true,
      visibility: 'user-or-llm',
      description: 'Whether to turn the flag on (true) or off (false)',
    },
  },

  request: {
    url: (params) =>
      `https://app.launchdarkly.com/api/v2/flags/${encodeURIComponent(params.projectKey.trim())}/${encodeURIComponent(params.flagKey.trim())}`,
    method: 'PATCH',
    headers: (params) => ({
      Authorization: params.apiKey.trim(),
      'Content-Type': 'application/json; domain-model=launchdarkly.semanticpatch',
    }),
    body: (params) => ({
      environmentKey: params.environmentKey,
      instructions: [{ kind: params.enabled ? 'turnFlagOn' : 'turnFlagOff' }],
    }),
  },

  transformResponse: async (response: Response, params?: LaunchDarklyToggleFlagParams) => {
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }))
      return {
        success: false,
        output: {
          key: '',
          name: '',
          kind: '',
          description: null,
          temporary: false,
          archived: false,
          deprecated: false,
          creationDate: 0,
          tags: [],
          variations: [],
          maintainerId: null,
          on: null,
        },
        error: error.message,
      }
    }

    const data = await response.json()

    const environments = data.environments as Record<string, Record<string, unknown>> | undefined
    let on: boolean | null = null
    if (environments) {
      const envKey = params?.environmentKey?.trim()
      if (envKey && environments[envKey]) {
        on = (environments[envKey].on as boolean) ?? null
      }
    }

    return {
      success: true,
      output: {
        key: data.key ?? null,
        name: data.name ?? null,
        kind: data.kind ?? null,
        description: data.description ?? null,
        temporary: data.temporary ?? false,
        archived: data.archived ?? false,
        deprecated: data.deprecated ?? false,
        creationDate: data.creationDate ?? null,
        tags: data.tags ?? [],
        variations: data.variations ?? [],
        maintainerId: data.maintainerId ?? null,
        on,
      },
    }
  },

  outputs: {
    ...FLAG_OUTPUT_PROPERTIES,
    on: {
      type: 'boolean',
      description: 'Whether the flag is now on in the target environment',
      optional: true,
    },
  },
}
