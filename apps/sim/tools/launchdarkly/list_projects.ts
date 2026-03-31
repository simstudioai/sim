import type {
  LaunchDarklyListProjectsParams,
  LaunchDarklyListProjectsResponse,
} from '@/tools/launchdarkly/types'
import { PROJECT_OUTPUT_PROPERTIES } from '@/tools/launchdarkly/types'
import type { ToolConfig } from '@/tools/types'

export const launchDarklyListProjectsTool: ToolConfig<
  LaunchDarklyListProjectsParams,
  LaunchDarklyListProjectsResponse
> = {
  id: 'launchdarkly_list_projects',
  name: 'LaunchDarkly List Projects',
  description: 'List all projects in your LaunchDarkly account.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'LaunchDarkly API key',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of projects to return (default 20)',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      if (params.limit) queryParams.set('limit', String(params.limit))
      const qs = queryParams.toString()
      return `https://app.launchdarkly.com/api/v2/projects${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: params.apiKey.trim(),
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }))
      return { success: false, output: { projects: [], totalCount: 0 }, error: error.message }
    }

    const data = await response.json()
    const projects = (data.items ?? []).map((item: Record<string, unknown>) => ({
      id: (item._id as string) ?? null,
      key: item.key ?? null,
      name: item.name ?? null,
      tags: (item.tags as string[]) ?? [],
    }))

    return {
      success: true,
      output: {
        projects,
        totalCount: (data.totalCount as number) ?? projects.length,
      },
    }
  },

  outputs: {
    projects: {
      type: 'array',
      description: 'List of projects',
      items: {
        type: 'object',
        properties: PROJECT_OUTPUT_PROPERTIES,
      },
    },
    totalCount: { type: 'number', description: 'Total number of projects' },
  },
}
