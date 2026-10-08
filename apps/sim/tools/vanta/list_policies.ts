import type { InternalToolConfig } from '@/tools/types'
import {
  VANTA_PAGE_INFO_OUTPUT_PROPERTIES,
  VANTA_POLICY_OUTPUT_PROPERTIES,
} from '@/tools/vanta/outputs'
import type { VantaListPoliciesParams, VantaListPoliciesResponse } from '@/tools/vanta/types'
import { createVantaTransformResponse } from '@/tools/vanta/utils'

export const vantaListPoliciesTool: InternalToolConfig<
  VantaListPoliciesParams,
  VantaListPoliciesResponse
> = {
  id: 'vanta_list_policies',
  name: 'Vanta List Policies',
  description:
    'List the security policies in a Vanta account with approval status and version info',
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
      operation: 'vanta_list_policies',
      accessToken: params.accessToken,
      apiDomain: params.apiDomain,
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
      nullable: true,
      properties: VANTA_PAGE_INFO_OUTPUT_PROPERTIES,
    },
  },
}
