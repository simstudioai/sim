import type {
  LaunchDarklyGetFlagStatusParams,
  LaunchDarklyGetFlagStatusResponse,
} from '@/tools/launchdarkly/types'
import { FLAG_STATUS_OUTPUT_PROPERTIES } from '@/tools/launchdarkly/types'
import type { ToolConfig } from '@/tools/types'

export const launchDarklyGetFlagStatusTool: ToolConfig<
  LaunchDarklyGetFlagStatusParams,
  LaunchDarklyGetFlagStatusResponse
> = {
  id: 'launchdarkly_get_flag_status',
  name: 'LaunchDarkly Get Flag Status',
  description:
    'Get the status of a feature flag across environments (active, inactive, launched, etc.).',
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
      required: true,
      visibility: 'user-or-llm',
      description: 'The environment key',
    },
  },

  request: {
    url: (params) =>
      `https://app.launchdarkly.com/api/v2/flag-statuses/${encodeURIComponent(params.projectKey.trim())}/${encodeURIComponent(params.environmentKey.trim())}/${encodeURIComponent(params.flagKey.trim())}`,
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
          name: '',
          lastRequested: null,
          defaultVal: null,
        },
        error: error.message,
      }
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        name: data.name ?? null,
        lastRequested: data.lastRequested ?? null,
        defaultVal: data.default ?? null,
      },
    }
  },

  outputs: FLAG_STATUS_OUTPUT_PROPERTIES,
}
