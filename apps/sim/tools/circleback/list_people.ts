import {
  type CirclebackListPeopleParams,
  type CirclebackPersonListResponse,
  PERSON_OUTPUT_PROPERTIES,
} from '@/tools/circleback/types'
import {
  appendListParams,
  CIRCLEBACK_API_BASE,
  circlebackHeaders,
  mapPerson,
  parseNextCursor,
  throwCirclebackError,
  toIdList,
  toStringList,
} from '@/tools/circleback/utils'
import type { ToolConfig } from '@/tools/types'

export const listPeopleTool: ToolConfig<CirclebackListPeopleParams, CirclebackPersonListResponse> =
  {
    id: 'circleback_list_people',
    name: 'Circleback List People',
    description:
      'Lists the people who attend the authenticated user meetings, ordered by most recent meeting, with optional company and tag filters.',
    version: '1.0.0',

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Circleback API key',
      },
      domains: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Comma-separated company domains to filter people by',
      },
      tagIds: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Comma-separated tag IDs. Filters people to attendees of meetings so tagged',
      },
      limit: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'The maximum number of people to return',
      },
      cursor: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Pagination cursor from a previous response',
      },
    },

    request: {
      url: (params) => {
        const url = new URL(`${CIRCLEBACK_API_BASE}/people`)
        appendListParams(url, 'domains', toStringList(params.domains))
        appendListParams(url, 'tagIds', toIdList(params.tagIds))
        if (params.limit) url.searchParams.append('limit', String(params.limit))
        if (params.cursor) url.searchParams.append('cursor', params.cursor)
        return url.toString()
      },
      method: 'GET',
      headers: (params) => circlebackHeaders(params.apiKey),
    },

    transformResponse: async (response: Response) => {
      if (!response.ok) await throwCirclebackError(response)

      const data = await response.json()
      const nextCursor = parseNextCursor(response)

      return {
        success: true,
        output: {
          people: (Array.isArray(data) ? data : []).map(mapPerson),
          nextCursor,
          hasMore: nextCursor !== null,
        },
      }
    },

    outputs: {
      people: {
        type: 'array',
        description: 'The people on this page',
        items: { type: 'object', properties: PERSON_OUTPUT_PROPERTIES },
      },
      nextCursor: {
        type: 'string',
        description: 'Pagination cursor for the next page',
        optional: true,
      },
      hasMore: {
        type: 'boolean',
        description: 'Whether another page of people is available',
      },
    },
  }
