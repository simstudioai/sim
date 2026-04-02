import type {
  LaunchDarklyGetFlagParams,
  LaunchDarklyGetFlagResponse,
} from '@/tools/launchdarkly/types'
import { FLAG_OUTPUT_PROPERTIES } from '@/tools/launchdarkly/types'
import type { ToolConfig } from '@/tools/types'

export const launchDarklyGetFlagTool: ToolConfig<
  LaunchDarklyGetFlagParams,
  LaunchDarklyGetFlagResponse
> = {
  id: 'launchdarkly_get_flag',
  name: 'LaunchDarkly Get Flag',
  description: 'Get a single feature flag by key from a LaunchDarkly project.',
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
      description: 'The feature flag key',
    },
    environmentKey: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter flag configuration to a specific environment',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      if (params.environmentKey) queryParams.set('env', params.environmentKey)
      const qs = queryParams.toString()
      return `https://app.launchdarkly.com/api/v2/flags/${encodeURIComponent(params.projectKey.trim())}/${encodeURIComponent(params.flagKey.trim())}${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: params.apiKey.trim(),
    }),
  },

  transformResponse: async (response: Response) => {
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
      const envKeys = Object.keys(environments)
      if (envKeys.length === 1) {
        on = (environments[envKeys[0]].on as boolean) ?? null
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
      description:
        'Whether the flag is on in the requested environment (null if no single environment was specified)',
      optional: true,
    },
  },
}
