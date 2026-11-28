import { toBooleanOrNull, toNumberOrNull, toStringOrNull } from '@sim/utils/coerce'
import { toArray, toRecord } from '@sim/utils/object'
import {
  DEALPORT_ACCESS_TOKEN_PARAM,
  DEALPORT_COMPANY_FILTER_PARAMS,
  DEALPORT_OAUTH,
} from '@/tools/dealport/params'
import {
  DEALPORT_PREVIEW_SAMPLE_OUTPUT_PROPERTIES,
  type DealportPreviewCompaniesParams,
  type DealportPreviewCompaniesResponse,
} from '@/tools/dealport/types'
import {
  buildPreviewCompaniesBody,
  DEALPORT_API_BASE,
  dealportJsonHeaders,
  mapPreviewSampleCompany,
} from '@/tools/dealport/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const dealportPreviewCompaniesTool: ToolConfig<
  DealportPreviewCompaniesParams,
  DealportPreviewCompaniesResponse
> = {
  id: 'dealport_preview_companies',
  name: 'Dealport Preview Companies',
  description:
    'Run a free ($0.00) market sizing count across 28M+ US private companies and inspect up to 5 sample companies before opening paid Records.',
  version: '1.0.0',
  effect: 'read',
  oauth: DEALPORT_OAUTH,
  errorExtractor: ErrorExtractorId.STANDARD_MESSAGE,

  params: {
    ...DEALPORT_ACCESS_TOKEN_PARAM,
    ...DEALPORT_COMPANY_FILTER_PARAMS,
    markets: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Additional state and county markets as a JSON array of {"state": "MI", "counties": ["Wayne", "Oakland"]} objects',
    },
  },

  request: {
    url: `${DEALPORT_API_BASE}/companies/preview`,
    method: 'POST',
    headers: (params) => dealportJsonHeaders(params.accessToken),
    body: (params) => buildPreviewCompaniesBody(params),
  },

  transformResponse: async (response) => {
    const payload = toRecord(await response.json())
    return {
      success: true,
      output: {
        matching_count: toNumberOrNull(payload.matching_count) ?? 0,
        matching_count_more: toBooleanOrNull(payload.matching_count_more) ?? false,
        sample: toArray(payload.sample).map(mapPreviewSampleCompany),
        board_url: toStringOrNull(payload.board_url) ?? '',
        cost_usd: toNumberOrNull(payload.cost_usd) ?? 0,
        remaining_balance_usd: toNumberOrNull(payload.remaining_balance_usd) ?? 0,
      },
    }
  },

  outputs: {
    matching_count: {
      type: 'number',
      description: 'Number of US private companies matching the buy-box filters',
    },
    matching_count_more: {
      type: 'boolean',
      description: 'Whether additional companies match beyond matching_count',
    },
    sample: {
      type: 'array',
      description: 'Up to 5 sample companies matching the filters',
      items: {
        type: 'object',
        properties: DEALPORT_PREVIEW_SAMPLE_OUTPUT_PROPERTIES,
      },
    },
    board_url: {
      type: 'string',
      description: 'Dealport web URL for inspecting the filtered market',
    },
    cost_usd: {
      type: 'number',
      description: 'USD charge for this request ($0.00 for market previews)',
    },
    remaining_balance_usd: {
      type: 'number',
      description: 'Remaining workspace USD balance after the call',
    },
  },
}
