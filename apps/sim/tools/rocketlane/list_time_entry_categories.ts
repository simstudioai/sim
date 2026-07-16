import {
  mapPagination,
  mapTimeEntryCategory,
  PAGINATION_OUTPUT_PROPERTIES,
  ROCKETLANE_API_BASE,
  type RocketlaneListTimeEntryCategoriesParams,
  type RocketlaneTimeEntryCategory,
  type RocketlaneTimeEntryCategoryListResponse,
  rocketlaneError,
  rocketlaneHeaders,
  TIME_ENTRY_CATEGORY_OUTPUT_PROPERTIES,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneListTimeEntryCategoriesTool: ToolConfig<
  RocketlaneListTimeEntryCategoriesParams,
  RocketlaneTimeEntryCategoryListResponse
> = {
  id: 'rocketlane_list_time_entry_categories',
  name: 'Rocketlane List Time Entry Categories',
  description: 'List the time entry categories configured in Rocketlane',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rocketlane API key',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of categories per page (defaults to 100)',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page token from a previous response for fetching the next page',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`${ROCKETLANE_API_BASE}/time-entries/categories`)
      if (params.pageSize != null) url.searchParams.set('pageSize', String(params.pageSize))
      if (params.pageToken) url.searchParams.set('pageToken', params.pageToken)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => rocketlaneHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      throw new Error(await rocketlaneError(response))
    }
    const data = await response.json()
    const rawCategories = Array.isArray(data?.data) ? data.data : []
    return {
      success: true,
      output: {
        categories: rawCategories
          .map(mapTimeEntryCategory)
          .filter(
            (
              category: RocketlaneTimeEntryCategory | null
            ): category is RocketlaneTimeEntryCategory => category !== null
          ),
        pagination: mapPagination(data?.pagination),
      },
    }
  },

  outputs: {
    categories: {
      type: 'array',
      description: 'List of time entry categories',
      items: { type: 'object', properties: TIME_ENTRY_CATEGORY_OUTPUT_PROPERTIES },
    },
    pagination: {
      type: 'object',
      description: 'Pagination details for the result set',
      properties: PAGINATION_OUTPUT_PROPERTIES,
    },
  },
}
