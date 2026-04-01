import type {
  LaunchDarklyDeleteFlagParams,
  LaunchDarklyDeleteFlagResponse,
} from '@/tools/launchdarkly/types'
import type { ToolConfig } from '@/tools/types'

export const launchDarklyDeleteFlagTool: ToolConfig<
  LaunchDarklyDeleteFlagParams,
  LaunchDarklyDeleteFlagResponse
> = {
  id: 'launchdarkly_delete_flag',
  name: 'LaunchDarkly Delete Flag',
  description: 'Delete a feature flag from a LaunchDarkly project.',
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
      description: 'The feature flag key to delete',
    },
  },

  request: {
    url: (params) =>
      `https://app.launchdarkly.com/api/v2/flags/${encodeURIComponent(params.projectKey.trim())}/${encodeURIComponent(params.flagKey.trim())}`,
    method: 'DELETE',
    headers: (params) => ({
      Authorization: params.apiKey.trim(),
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }))
      return { success: false, output: { deleted: false }, error: error.message }
    }

    return {
      success: true,
      output: { deleted: true },
    }
  },

  outputs: {
    deleted: { type: 'boolean', description: 'Whether the flag was successfully deleted' },
  },
}
