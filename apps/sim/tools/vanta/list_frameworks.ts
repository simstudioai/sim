import type { ToolConfig } from '@/tools/types'
import {
  VANTA_FRAMEWORK_OUTPUT_PROPERTIES,
  VANTA_PAGE_INFO_OUTPUT_PROPERTIES,
} from '@/tools/vanta/outputs'
import type { VantaListFrameworksParams, VantaListFrameworksResponse } from '@/tools/vanta/types'
import { createVantaTransformResponse, VANTA_QUERY_ROUTE } from '@/tools/vanta/utils'

export const vantaListFrameworksTool: ToolConfig<
  VantaListFrameworksParams,
  VantaListFrameworksResponse
> = {
  id: 'vanta_list_frameworks',
  name: 'Vanta List Frameworks',
  description:
    'List the compliance frameworks (e.g., SOC 2, ISO 27001) available in a Vanta account with completion counts',
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
      operation: 'vanta_list_frameworks',
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      region: params.region,
      pageSize: params.pageSize,
      pageCursor: params.pageCursor,
    }),
  },

  transformResponse: createVantaTransformResponse<VantaListFrameworksResponse>(
    'Failed to list Vanta frameworks'
  ),

  outputs: {
    frameworks: {
      type: 'array',
      description: 'Frameworks in the Vanta account',
      items: { type: 'object', properties: VANTA_FRAMEWORK_OUTPUT_PROPERTIES },
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
