import type {
  LaunchDarklyListSegmentsParams,
  LaunchDarklyListSegmentsResponse,
} from '@/tools/launchdarkly/types'
import { SEGMENT_OUTPUT_PROPERTIES } from '@/tools/launchdarkly/types'
import type { ToolConfig } from '@/tools/types'

export const launchDarklyListSegmentsTool: ToolConfig<
  LaunchDarklyListSegmentsParams,
  LaunchDarklyListSegmentsResponse
> = {
  id: 'launchdarkly_list_segments',
  name: 'LaunchDarkly List Segments',
  description: 'List user segments in a LaunchDarkly project and environment.',
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
    environmentKey: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The environment key',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of segments to return (default 20)',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      if (params.limit) queryParams.set('limit', String(params.limit))
      const qs = queryParams.toString()
      return `https://app.launchdarkly.com/api/v2/segments/${encodeURIComponent(params.projectKey.trim())}/${encodeURIComponent(params.environmentKey.trim())}${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: params.apiKey.trim(),
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }))
      return { success: false, output: { segments: [], totalCount: 0 }, error: error.message }
    }

    const data = await response.json()
    const segments = (data.items ?? []).map((item: Record<string, unknown>) => ({
      key: item.key ?? null,
      name: item.name ?? null,
      description: item.description ?? null,
      tags: (item.tags as string[]) ?? [],
      creationDate: item.creationDate ?? null,
      unbounded: item.unbounded ?? false,
      included: (item.included as string[]) ?? [],
      excluded: (item.excluded as string[]) ?? [],
    }))

    return {
      success: true,
      output: {
        segments,
        totalCount: (data.totalCount as number) ?? segments.length,
      },
    }
  },

  outputs: {
    segments: {
      type: 'array',
      description: 'List of user segments',
      items: {
        type: 'object',
        properties: SEGMENT_OUTPUT_PROPERTIES,
      },
    },
    totalCount: { type: 'number', description: 'Total number of segments' },
  },
}
