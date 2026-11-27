import { toStringOrNull } from '@sim/utils/coerce'
import { toArray, toRecord } from '@sim/utils/object'
import {
  DEALPORT_ACCESS_TOKEN_PARAM,
  DEALPORT_COMPANY_FILTER_PARAMS,
  DEALPORT_OAUTH,
} from '@/tools/dealport/params'
import {
  DEALPORT_COMPANY_SUMMARY_OUTPUT_PROPERTIES,
  type DealportSearchCompaniesParams,
  type DealportSearchCompaniesResponse,
} from '@/tools/dealport/types'
import { buildSearchCompaniesUrl, dealportHeaders, mapCompanySummary } from '@/tools/dealport/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const dealportSearchCompaniesTool: ToolConfig<
  DealportSearchCompaniesParams,
  DealportSearchCompaniesResponse
> = {
  id: 'dealport_search_companies',
  name: 'Dealport Search Companies',
  description:
    'Search 28M+ US private companies by geography, NAICS industry, revenue, headcount, and primary public-filing attributes.',
  version: '1.0.0',
  effect: 'read',
  oauth: DEALPORT_OAUTH,
  errorExtractor: ErrorExtractorId.STANDARD_MESSAGE,

  params: {
    ...DEALPORT_ACCESS_TOKEN_PARAM,
    ...DEALPORT_COMPANY_FILTER_PARAMS,
    markets: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Additional state and county markets (e.g. "IN|MI:Wayne,Oakland")',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Results per page from 1 to 50. Defaults to 25.',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor returned as next_cursor from the previous page',
    },
  },

  request: {
    url: (params) => buildSearchCompaniesUrl(params),
    method: 'GET',
    headers: (params) => dealportHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const payload = toRecord(await response.json())
    return {
      success: true,
      output: {
        companies: toArray(payload.data).map(mapCompanySummary),
        next_cursor: toStringOrNull(payload.next_cursor),
      },
    }
  },

  outputs: {
    companies: {
      type: 'array',
      description: 'Matching US private company Records on this page',
      items: {
        type: 'object',
        properties: DEALPORT_COMPANY_SUMMARY_OUTPUT_PROPERTIES,
      },
    },
    next_cursor: {
      type: 'string',
      nullable: true,
      description: 'Cursor for fetching the next page of companies, or null on the final page',
    },
  },
}
