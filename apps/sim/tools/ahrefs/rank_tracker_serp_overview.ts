import type {
  AhrefsRankTrackerSerpOverviewParams,
  AhrefsRankTrackerSerpOverviewResponse,
} from '@/tools/ahrefs/types'
import type { ToolConfig } from '@/tools/types'

export const rankTrackerSerpOverviewTool: ToolConfig<
  AhrefsRankTrackerSerpOverviewParams,
  AhrefsRankTrackerSerpOverviewResponse
> = {
  id: 'ahrefs_rank_tracker_serp_overview',
  name: 'Ahrefs Rank Tracker SERP Overview',
  description:
    'Get the full SERP (search engine results page) for a keyword tracked in an Ahrefs Rank Tracker project, including every ranking URL with its position, title, and authority metrics. This endpoint is free and does not consume API units.',
  version: '1.0.0',

  params: {
    projectId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Rank Tracker project ID (found in the project URL in Ahrefs)',
    },
    keyword: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The tracked keyword to retrieve SERP data for',
    },
    country: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Country code for the tracked keyword. Example: "us", "gb", "de"',
    },
    device: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Rankings device type: "desktop" or "mobile"',
    },
    topPositions: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of top organic positions to return (defaults to all available)',
    },
    date: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Timestamp to return the last available SERP Overview at, in YYYY-MM-DDThh:mm:ss format',
    },
    locationId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Location ID of the tracked keyword, if tracked at a specific location',
    },
    languageCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Language code of the tracked keyword',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Ahrefs API Key',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.ahrefs.com/v3/rank-tracker/serp-overview')
      url.searchParams.set('project_id', String(params.projectId))
      url.searchParams.set('keyword', params.keyword)
      url.searchParams.set('country', params.country)
      url.searchParams.set('device', params.device)
      if (params.topPositions) url.searchParams.set('top_positions', String(params.topPositions))
      if (params.date) url.searchParams.set('date', params.date)
      if (params.locationId) url.searchParams.set('location_id', String(params.locationId))
      if (params.languageCode) url.searchParams.set('language_code', params.languageCode)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Accept: 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message || data.error || 'Failed to get SERP overview')
    }

    const positions = (data.positions || []).map((item: any) => ({
      position: item.position ?? 0,
      url: item.url || '',
      title: item.title || '',
      type: item.type ?? [],
      domainRating: item.domain_rating ?? 0,
      urlRating: item.url_rating ?? 0,
      backlinks: item.backlinks ?? 0,
      refdomains: item.refdomains ?? 0,
      traffic: item.traffic ?? 0,
      value: item.value ?? null,
      topKeyword: item.top_keyword ?? null,
      topKeywordVolume: item.top_keyword_volume ?? null,
      updateDate: item.update_date || '',
    }))

    return {
      success: true,
      output: {
        positions,
      },
    }
  },

  outputs: {
    positions: {
      type: 'array',
      description: 'Every ranking result on the SERP for the tracked keyword',
      items: {
        type: 'object',
        properties: {
          position: { type: 'number', description: 'Position of the result in the SERP' },
          url: { type: 'string', description: 'URL of the ranking page' },
          title: { type: 'string', description: 'Page title' },
          type: {
            type: 'array',
            description: 'The kind of the position: organic, paid, or a SERP feature',
            items: { type: 'string' },
          },
          domainRating: { type: 'number', description: 'Domain Rating of the ranking domain' },
          urlRating: { type: 'number', description: 'URL Rating of the ranking page' },
          backlinks: { type: 'number', description: 'Total backlinks to the ranking domain' },
          refdomains: { type: 'number', description: 'Unique referring domains' },
          traffic: { type: 'number', description: 'Estimated monthly organic search traffic' },
          value: {
            type: 'number',
            description: 'Estimated monthly traffic value in USD cents',
            optional: true,
          },
          topKeyword: {
            type: 'string',
            description: 'Highest-traffic keyword ranking for this page',
            optional: true,
          },
          topKeywordVolume: {
            type: 'number',
            description: 'Monthly search volume for the top keyword',
            optional: true,
          },
          updateDate: { type: 'string', description: 'Date the SERP was last checked' },
        },
      },
    },
  },
}
