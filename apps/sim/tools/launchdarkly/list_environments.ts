import type {
  LaunchDarklyListEnvironmentsParams,
  LaunchDarklyListEnvironmentsResponse,
} from '@/tools/launchdarkly/types'
import { ENVIRONMENT_OUTPUT_PROPERTIES } from '@/tools/launchdarkly/types'
import type { ToolConfig } from '@/tools/types'

export const launchDarklyListEnvironmentsTool: ToolConfig<
  LaunchDarklyListEnvironmentsParams,
  LaunchDarklyListEnvironmentsResponse
> = {
  id: 'launchdarkly_list_environments',
  name: 'LaunchDarkly List Environments',
  description: 'List environments in a LaunchDarkly project.',
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
      description: 'The project key to list environments for',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of environments to return (default 20)',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      if (params.limit) queryParams.set('limit', String(params.limit))
      const qs = queryParams.toString()
      return `https://app.launchdarkly.com/api/v2/projects/${encodeURIComponent(params.projectKey.trim())}/environments${qs ? `?${qs}` : ''}`
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
        output: { environments: [], totalCount: 0 },
        error: error.message,
      }
    }

    const data = await response.json()
    const environments = (data.items ?? []).map((item: Record<string, unknown>) => ({
      id: (item._id as string) ?? null,
      key: item.key ?? null,
      name: item.name ?? null,
      color: item.color ?? null,
      apiKey: item.apiKey ?? null,
      mobileKey: item.mobileKey ?? null,
      tags: (item.tags as string[]) ?? [],
    }))

    return {
      success: true,
      output: {
        environments,
        totalCount: (data.totalCount as number) ?? environments.length,
      },
    }
  },

  outputs: {
    environments: {
      type: 'array',
      description: 'List of environments',
      items: {
        type: 'object',
        properties: ENVIRONMENT_OUTPUT_PROPERTIES,
      },
    },
    totalCount: { type: 'number', description: 'Total number of environments' },
  },
}
