import type { ToolConfig } from '@/tools/types'
import {
  VANTA_CONTROL_OUTPUT_PROPERTIES,
  VANTA_PAGE_INFO_OUTPUT_PROPERTIES,
} from '@/tools/vanta/outputs'
import type {
  VantaListControlsResponse,
  VantaListFrameworkControlsParams,
} from '@/tools/vanta/types'
import { createVantaTransformResponse, VANTA_QUERY_ROUTE } from '@/tools/vanta/utils'

export const vantaListFrameworkControlsTool: ToolConfig<
  VantaListFrameworkControlsParams,
  VantaListControlsResponse
> = {
  id: 'vanta_list_framework_controls',
  name: 'Vanta List Framework Controls',
  description: 'List the controls that belong to a specific Vanta compliance framework',
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
    frameworkId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique ID of the framework (e.g., soc2)',
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
      operation: 'vanta_list_framework_controls',
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      region: params.region,
      frameworkId: params.frameworkId,
      pageSize: params.pageSize,
      pageCursor: params.pageCursor,
    }),
  },

  transformResponse: createVantaTransformResponse<VantaListControlsResponse>(
    'Failed to list Vanta framework controls'
  ),

  outputs: {
    controls: {
      type: 'array',
      description: 'Controls belonging to the framework',
      items: { type: 'object', properties: VANTA_CONTROL_OUTPUT_PROPERTIES },
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
