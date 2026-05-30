import { prospeoHosting } from '@/tools/prospeo/hosting'
import {
  extractProspeoError,
  PROSPEO_PAGINATION_OUTPUT,
  type ProspeoSearchPersonParams,
  type ProspeoSearchPersonResponse,
} from '@/tools/prospeo/types'
import { parseFiltersObject } from '@/tools/prospeo/utils'
import type { ToolConfig } from '@/tools/types'

export const searchPersonTool: ToolConfig<ProspeoSearchPersonParams, ProspeoSearchPersonResponse> =
  {
    id: 'prospeo_search_person',
    name: 'Prospeo Search Person',
    description: 'Search for leads using 20+ filters to build targeted contact lists.',
    version: '1.0.0',

    hosting: prospeoHosting<ProspeoSearchPersonParams>((_params, output) => {
      // 1 credit per page that returns at least one result; free on 30-day dedup.
      if (output.free === true) return 0
      const results = output.results
      return Array.isArray(results) && results.length > 0 ? 1 : 0
    }),

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Prospeo API key',
      },
      filters: {
        type: 'json',
        required: true,
        visibility: 'user-or-llm',
        description:
          'Filter configuration object. See https://prospeo.io/api-docs/filters-documentation for all supported filters (e.g., person_seniority, company_industry, person_location).',
      },
      page: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Page number (defaults to 1). Up to 1000 pages of 25 results.',
      },
    },

    request: {
      url: 'https://api.prospeo.io/search-person',
      method: 'POST',
      headers: (params) => ({
        'X-KEY': params.apiKey,
        'Content-Type': 'application/json',
      }),
      body: (params) => {
        const body: Record<string, unknown> = { filters: parseFiltersObject(params.filters) }
        if (params.page !== undefined) body.page = params.page
        return body
      },
    },

    transformResponse: async (response: Response) => {
      if (!response.ok) {
        throw new Error(await extractProspeoError(response))
      }
      const data = await response.json()
      return {
        success: true,
        output: {
          free: data.free ?? false,
          results: data.results ?? [],
          pagination: data.pagination ?? null,
        },
      }
    },

    outputs: {
      free: {
        type: 'boolean',
        description: 'True if the request was free due to 30-day result-set deduplication',
      },
      results: {
        type: 'array',
        description: 'Up to 25 search results (person + company, no email/mobile)',
        items: {
          type: 'object',
          properties: {
            person: {
              type: 'json',
              description: 'Matched person (no email/mobile in search response)',
            },
            company: { type: 'json', description: 'Current company of the person', optional: true },
          },
        },
      },
      pagination: PROSPEO_PAGINATION_OUTPUT,
    },
  }
