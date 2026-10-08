import type { InternalToolConfig } from '@/tools/types'
import {
  VANTA_CONTROL_OUTPUT_PROPERTIES,
  VANTA_PAGE_INFO_OUTPUT_PROPERTIES,
} from '@/tools/vanta/outputs'
import type {
  VantaListControlsResponse,
  VantaListFrameworkControlsParams,
} from '@/tools/vanta/types'
import { createVantaTransformResponse } from '@/tools/vanta/utils'

export const vantaListFrameworkControlsTool: InternalToolConfig<
  VantaListFrameworkControlsParams,
  VantaListControlsResponse
> = {
  id: 'vanta_list_framework_controls',
  name: 'Vanta List Framework Controls',
  description: 'List the controls that belong to a specific Vanta compliance framework',
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

  operation: {
    input: (params) => ({
      operation: 'vanta_list_framework_controls',
      accessToken: params.accessToken,
      apiDomain: params.apiDomain,
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
      nullable: true,
      properties: VANTA_PAGE_INFO_OUTPUT_PROPERTIES,
    },
  },
}
