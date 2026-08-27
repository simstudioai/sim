import { fullEnrichExactHosting } from '@/tools/fullenrich/hosting'
import {
  fullEnrichPeopleFiltersSchema,
  fullEnrichSearchPaginationSchema,
  fullEnrichSearchPeopleResponseSchema,
} from '@/tools/fullenrich/schemas'
import {
  FULLENRICH_PERSON_OUTPUT,
  type FullEnrichSearchParams,
  type FullEnrichSearchPeopleResponse,
} from '@/tools/fullenrich/types'
import {
  extractFullEnrichError,
  parseFullEnrichInput,
  requireFullEnrichCredits,
} from '@/tools/fullenrich/utils'
import type { ToolConfig } from '@/tools/types'

export const searchPeopleTool: ToolConfig<FullEnrichSearchParams, FullEnrichSearchPeopleResponse> =
  {
    id: 'fullenrich_search_people',
    name: 'FullEnrich Search People',
    description:
      'Search FullEnrich people by company, identity, location, skills, role, seniority, employment, and education filters.',
    version: '1.0.0',
    hosting: fullEnrichExactHosting((_params, output) =>
      requireFullEnrichCredits(output.credits, 'FullEnrich response credits')
    ),
    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'FullEnrich API key',
      },
      filters: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Official people-search filter object. Supported keys include current_company_names, current_company_domains, current_position_titles, person_locations, person_skills, and all other documented v2 filters.',
      },
      offset: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Number of people to skip, from 0 to 10,000',
      },
      limit: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Number of people to return, from 1 to 100; defaults to 10',
      },
      searchAfter: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Cursor returned by the previous response for cursor-based pagination',
      },
    },
    request: {
      url: 'https://app.fullenrich.com/api/v2/people/search',
      method: 'POST',
      headers: (params) => ({
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      }),
      body: (params) => {
        const filters = parseFullEnrichInput(
          params.filters ?? {},
          fullEnrichPeopleFiltersSchema,
          'People filters'
        )
        const pagination = fullEnrichSearchPaginationSchema.parse({
          offset: params.offset,
          limit: params.limit,
          search_after: params.searchAfter,
        })
        return { ...filters, ...pagination }
      },
    },
    transformResponse: async (response) => {
      if (!response.ok) throw new Error(await extractFullEnrichError(response))
      const data = fullEnrichSearchPeopleResponseSchema.parse(await response.json())
      return {
        success: true,
        output: {
          people: data.people,
          total: data.metadata.total,
          credits: data.metadata.credits,
          offset: data.metadata.offset,
          searchAfter: data.metadata.search_after ?? null,
        },
      }
    },
    outputs: {
      people: FULLENRICH_PERSON_OUTPUT,
      total: { type: 'number', description: 'Total number of matching people' },
      credits: { type: 'number', description: 'Credits reported by FullEnrich for this request' },
      offset: { type: 'number', description: 'Number of results skipped' },
      searchAfter: {
        type: 'string',
        description: 'Cursor for the next page',
        optional: true,
        nullable: true,
      },
    },
  }
