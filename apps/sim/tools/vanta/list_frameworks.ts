import type { InternalToolConfig } from '@/tools/types'
import {
  VANTA_FRAMEWORK_OUTPUT_PROPERTIES,
  VANTA_PAGE_INFO_OUTPUT_PROPERTIES,
} from '@/tools/vanta/outputs'
import type { VantaListFrameworksParams, VantaListFrameworksResponse } from '@/tools/vanta/types'
import { createVantaTransformResponse } from '@/tools/vanta/utils'

export const vantaListFrameworksTool: InternalToolConfig<
  VantaListFrameworksParams,
  VantaListFrameworksResponse
> = {
  id: 'vanta_list_frameworks',
  name: 'Vanta List Frameworks',
  description:
    'List the compliance frameworks (e.g., SOC 2, ISO 27001) available in a Vanta account with completion counts',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'vanta',
    credentialKind: 'service-account',
    authoritativeParams: ['apiDomain'],
    retryOnUnauthorized: true,
  },

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
      operation: 'vanta_list_frameworks',
      accessToken: params.accessToken,
      apiDomain: params.apiDomain,
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
      nullable: true,
      properties: VANTA_PAGE_INFO_OUTPUT_PROPERTIES,
    },
  },
}
