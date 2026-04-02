import type {
  LaunchDarklyListFlagsParams,
  LaunchDarklyListFlagsResponse,
} from '@/tools/launchdarkly/types'
import { FLAG_OUTPUT_PROPERTIES } from '@/tools/launchdarkly/types'
import type { ToolConfig } from '@/tools/types'

export const launchDarklyListFlagsTool: ToolConfig<
  LaunchDarklyListFlagsParams,
  LaunchDarklyListFlagsResponse
> = {
  id: 'launchdarkly_list_flags',
  name: 'LaunchDarkly List Flags',
  description: 'List feature flags in a LaunchDarkly project.',
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
      description: 'The project key to list flags for',
    },
    environmentKey: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter flag configurations to a specific environment',
    },
    tag: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter flags by tag name',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of flags to return (default 20)',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      if (params.environmentKey) queryParams.set('env', params.environmentKey)
      if (params.tag) queryParams.set('tag', params.tag)
      if (params.limit) queryParams.set('limit', String(params.limit))
      const qs = queryParams.toString()
      return `https://app.launchdarkly.com/api/v2/flags/${encodeURIComponent(params.projectKey.trim())}${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: params.apiKey.trim(),
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }))
      return { success: false, output: { flags: [], totalCount: 0 }, error: error.message }
    }

    const data = await response.json()
    const flags = (data.items ?? []).map((item: Record<string, unknown>) => ({
      key: item.key ?? null,
      name: item.name ?? null,
      kind: item.kind ?? null,
      description: item.description ?? null,
      temporary: item.temporary ?? false,
      archived: item.archived ?? false,
      deprecated: item.deprecated ?? false,
      creationDate: item.creationDate ?? null,
      tags: (item.tags as string[]) ?? [],
      variations: (item.variations as Array<Record<string, unknown>>) ?? [],
      maintainerId: item.maintainerId ?? null,
    }))

    return {
      success: true,
      output: {
        flags,
        totalCount: (data.totalCount as number) ?? flags.length,
      },
    }
  },

  outputs: {
    flags: {
      type: 'array',
      description: 'List of feature flags',
      items: {
        type: 'object',
        properties: FLAG_OUTPUT_PROPERTIES,
      },
    },
    totalCount: { type: 'number', description: 'Total number of flags' },
  },
}
