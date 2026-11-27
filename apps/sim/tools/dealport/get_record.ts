import { toNumberOrNull, toStringOrNull } from '@sim/utils/coerce'
import { toRecord } from '@sim/utils/object'
import { DEALPORT_ACCESS_TOKEN_PARAM, DEALPORT_OAUTH } from '@/tools/dealport/params'
import {
  DEALPORT_RECORD_OUTPUT_PROPERTIES,
  type DealportGetRecordParams,
  type DealportGetRecordResponse,
} from '@/tools/dealport/types'
import { DEALPORT_API_BASE, dealportHeaders, mapDealportRecord } from '@/tools/dealport/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const dealportGetRecordTool: ToolConfig<DealportGetRecordParams, DealportGetRecordResponse> =
  {
    id: 'dealport_get_record',
    name: 'Dealport Get Record',
    description:
      'Open a cited company Record (by Dealport UUID) or NYC building Record (by 10-digit BBL) with primary filing facts, principals, identifiers, and sources.',
    version: '1.0.0',
    effect: 'read',
    oauth: DEALPORT_OAUTH,
    errorExtractor: ErrorExtractorId.STANDARD_MESSAGE,

    params: {
      ...DEALPORT_ACCESS_TOKEN_PARAM,
      recordId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Dealport company UUID or 10-digit NYC BBL (e.g. "1008350041")',
      },
    },

    request: {
      url: (params) =>
        `${DEALPORT_API_BASE}/records/${safeUrlPathSegment(params.recordId, 'recordId')}`,
      method: 'GET',
      headers: (params) => dealportHeaders(params.accessToken),
    },

    transformResponse: async (response) => {
      const payload = toRecord(await response.json())
      return {
        success: true,
        output: {
          record: mapDealportRecord(payload.data),
          record_url: toStringOrNull(payload.record_url) ?? '',
          cost_usd: toNumberOrNull(payload.cost_usd) ?? 0,
          remaining_balance_usd: toNumberOrNull(payload.remaining_balance_usd) ?? 0,
        },
      }
    },

    outputs: {
      record: {
        type: 'object',
        description: 'Cited Dealport company or building Record',
        properties: DEALPORT_RECORD_OUTPUT_PROPERTIES,
      },
      record_url: {
        type: 'string',
        description: 'Canonical URL for the Record in Dealport',
      },
      cost_usd: {
        type: 'number',
        description: 'USD charge for opening this Record ($0.01 fresh, $0.00 on 30-day repeat)',
      },
      remaining_balance_usd: {
        type: 'number',
        description: 'Remaining workspace USD balance after the call',
      },
    },
  }
