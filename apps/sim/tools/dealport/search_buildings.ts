import { toStringOrNull } from '@sim/utils/coerce'
import { toArray, toRecord } from '@sim/utils/object'
import { DEALPORT_ACCESS_TOKEN_PARAM, DEALPORT_OAUTH } from '@/tools/dealport/params'
import {
  DEALPORT_BUILDING_SUMMARY_OUTPUT_PROPERTIES,
  type DealportSearchBuildingsParams,
  type DealportSearchBuildingsResponse,
} from '@/tools/dealport/types'
import {
  buildSearchBuildingsUrl,
  dealportHeaders,
  mapBuildingSummary,
} from '@/tools/dealport/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const dealportSearchBuildingsTool: ToolConfig<
  DealportSearchBuildingsParams,
  DealportSearchBuildingsResponse
> = {
  id: 'dealport_search_buildings',
  name: 'Dealport Search Buildings',
  description:
    'Search NYC multifamily and commercial buildings by borough, unit count, ACRIS loan maturity, mortgage holder category, and regulatory signals.',
  version: '1.0.0',
  effect: 'read',
  oauth: DEALPORT_OAUTH,
  errorExtractor: ErrorExtractorId.STANDARD_MESSAGE,

  params: {
    ...DEALPORT_ACCESS_TOKEN_PARAM,
    borough: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'NYC borough code: MN, BK, QN, BX, or SI',
    },
    min_units: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Minimum residential unit count. Defaults to 10.',
    },
    q: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Street address or recorded owner substring match',
    },
    loan_due_by: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Estimated mortgage maturity year ceiling (e.g. 2027)',
    },
    loan_holder: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Current mortgage holder category: agency, cmbs, or bank',
    },
    signal: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Regulatory or distress signal: rent_stabilized, dob_penalties, housing_court, tax_lien, ll97, section8_expiring, tax_credit_ending, or failing_inspection',
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
    url: (params) => buildSearchBuildingsUrl(params),
    method: 'GET',
    headers: (params) => dealportHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const payload = toRecord(await response.json())
    return {
      success: true,
      output: {
        buildings: toArray(payload.data).map(mapBuildingSummary),
        next_cursor: toStringOrNull(payload.next_cursor),
      },
    }
  },

  outputs: {
    buildings: {
      type: 'array',
      description: 'Matching NYC building Records on this page',
      items: {
        type: 'object',
        properties: DEALPORT_BUILDING_SUMMARY_OUTPUT_PROPERTIES,
      },
    },
    next_cursor: {
      type: 'string',
      nullable: true,
      description: 'Cursor for fetching the next page of buildings, or null on the final page',
    },
  },
}
