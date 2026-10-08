import type { InternalToolConfig } from '@/tools/types'
import {
  VANTA_CONTROL_OUTPUT_PROPERTIES,
  VANTA_PAGE_INFO_OUTPUT_PROPERTIES,
} from '@/tools/vanta/outputs'
import type { VantaListControlsParams, VantaListControlsResponse } from '@/tools/vanta/types'
import { createVantaTransformResponse } from '@/tools/vanta/utils'

export const vantaListControlsTool: InternalToolConfig<
  VantaListControlsParams,
  VantaListControlsResponse
> = {
  id: 'vanta_list_controls',
  name: 'Vanta List Controls',
  description: 'List the security controls in a Vanta account, optionally filtered by framework',
  version: '1.0.0',

  oauth: { required: true, provider: 'vanta', authoritativeParams: ['apiDomain'] },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Access token supplied by the saved Vanta credential',
    },
    apiDomain: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'API origin supplied by the saved Vanta credential',
    },
    frameworkMatchesAny: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated framework IDs to filter controls by (e.g., soc2,iso27001)',
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

  operation: {
    input: (params) => ({
      operation: 'vanta_list_controls',
      accessToken: params.accessToken,
      apiDomain: params.apiDomain,
      frameworkMatchesAny: params.frameworkMatchesAny,
      pageSize: params.pageSize,
      pageCursor: params.pageCursor,
    }),
  },

  transformResponse: createVantaTransformResponse<VantaListControlsResponse>(
    'Failed to list Vanta controls'
  ),

  outputs: {
    controls: {
      type: 'array',
      description: 'Controls matching the filters',
      items: { type: 'object', properties: VANTA_CONTROL_OUTPUT_PROPERTIES },
    },
    pageInfo: {
      type: 'json',
      description:
        'Cursor pagination info for the returned page; pass endCursor as pageCursor to fetch the next page',
      nullable: true,
      properties: VANTA_PAGE_INFO_OUTPUT_PROPERTIES,
    },
  },
}
