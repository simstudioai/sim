import type { ToolConfig } from '@/tools/types'
import {
  VANTA_PAGE_INFO_OUTPUT_PROPERTIES,
  VANTA_VENDOR_OUTPUT_PROPERTIES,
} from '@/tools/vanta/outputs'
import type { VantaListVendorsParams, VantaListVendorsResponse } from '@/tools/vanta/types'
import { createVantaTransformResponse, VANTA_QUERY_ROUTE } from '@/tools/vanta/utils'

export const vantaListVendorsTool: ToolConfig<VantaListVendorsParams, VantaListVendorsResponse> = {
  id: 'vanta_list_vendors',
  name: 'Vanta List Vendors',
  description:
    'List the vendors tracked in a Vanta account with risk levels, contract dates, and security review schedules',
  version: '1.0.0',

  params: {
    clientId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Vanta OAuth application client ID',
    },
    clientSecret: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Vanta OAuth application client secret',
    },
    region: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Vanta API region: "us" (api.vanta.com, default) or "gov" (api.vanta-gov.com)',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter vendors by name',
    },
    statusMatchesAny: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated vendor statuses to filter by: MANAGED, ARCHIVED, IN_PROCUREMENT',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of items per page (1-100, default 10)',
    },
    pageCursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Pagination cursor: pass the endCursor from the previous response to fetch the next page',
    },
  },

  request: {
    url: VANTA_QUERY_ROUTE,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      operation: 'vanta_list_vendors',
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      region: params.region,
      name: params.name,
      statusMatchesAny: params.statusMatchesAny,
      pageSize: params.pageSize,
      pageCursor: params.pageCursor,
    }),
  },

  transformResponse: createVantaTransformResponse<VantaListVendorsResponse>(
    'Failed to list Vanta vendors'
  ),

  outputs: {
    vendors: {
      type: 'array',
      description: 'Vendors matching the filters',
      items: { type: 'object', properties: VANTA_VENDOR_OUTPUT_PROPERTIES },
    },
    pageInfo: {
      type: 'json',
      description:
        'Cursor pagination info for the returned page; pass endCursor as pageCursor to fetch the next page',
      optional: true,
      properties: VANTA_PAGE_INFO_OUTPUT_PROPERTIES,
    },
  },
}
