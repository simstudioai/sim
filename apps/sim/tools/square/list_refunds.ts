import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ListRefundsParams, RefundListResponse } from '@/tools/square/types'
import {
  LIST_METADATA_OUTPUT_PROPERTIES,
  REFUND_OUTPUT,
  SQUARE_BASE_URL,
  squareHeaders,
} from '@/tools/square/types'
import type { ToolConfig } from '@/tools/types'

export const squareListRefundsTool: ToolConfig<ListRefundsParams, RefundListResponse> = {
  id: 'square_list_refunds',
  name: 'Square List Refunds',
  description: 'List payment refunds, optionally filtered by location, status, and time range',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SQUARE_ERRORS,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Square access token (personal access token)',
    },
    locationId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter refunds by location ID',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by refund status (PENDING, COMPLETED, REJECTED, or FAILED)',
    },
    beginTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'RFC 3339 timestamp for the beginning of the reporting period',
    },
    endTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'RFC 3339 timestamp for the end of the reporting period',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results to return per page',
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
      const url = new URL(`${SQUARE_BASE_URL}/v2/refunds`)
      if (params.locationId) url.searchParams.append('location_id', params.locationId)
      if (params.status) url.searchParams.append('status', params.status)
      if (params.beginTime) url.searchParams.append('begin_time', params.beginTime)
      if (params.endTime) url.searchParams.append('end_time', params.endTime)
      if (params.limit !== undefined) url.searchParams.append('limit', params.limit.toString())
      if (params.cursor) url.searchParams.append('cursor', params.cursor)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => squareHeaders(params.apiKey),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    const refunds = data.refunds ?? []
    return {
      success: true,
      output: {
        refunds,
        metadata: {
          count: refunds.length,
          cursor: data.cursor ?? null,
        },
      },
    }
  },

  outputs: {
    refunds: {
      type: 'array',
      description: 'Array of refund objects',
      items: REFUND_OUTPUT,
    },
    metadata: {
      type: 'json',
      description: 'List pagination metadata',
      properties: LIST_METADATA_OUTPUT_PROPERTIES,
    },
  },
}
