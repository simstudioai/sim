import type { ToolConfig } from '@/tools/types'
import {
  VANTA_PAGE_INFO_OUTPUT_PROPERTIES,
  VANTA_POLICY_OUTPUT_PROPERTIES,
} from '@/tools/vanta/outputs'
import type { VantaListPoliciesParams, VantaListPoliciesResponse } from '@/tools/vanta/types'
import { createVantaTransformResponse, VANTA_QUERY_ROUTE } from '@/tools/vanta/utils'

export const vantaListPoliciesTool: ToolConfig<VantaListPoliciesParams, VantaListPoliciesResponse> =
  {
    id: 'vanta_list_policies',
    name: 'Vanta List Policies',
    description:
      'List the security policies in a Vanta account with approval status and version info',
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
        operation: 'vanta_list_policies',
        clientId: params.clientId,
        clientSecret: params.clientSecret,
        region: params.region,
        pageSize: params.pageSize,
        pageCursor: params.pageCursor,
      }),
    },

    transformResponse: createVantaTransformResponse<VantaListPoliciesResponse>(
      'Failed to list Vanta policies'
    ),

    outputs: {
      policies: {
        type: 'array',
        description: 'Policies in the Vanta account',
        items: { type: 'object', properties: VANTA_POLICY_OUTPUT_PROPERTIES },
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
