import type {
  BitbucketListOutput,
  BitbucketListWorkspacesParams,
  BitbucketToolResponse,
  BitbucketWorkspaceAccess,
} from '@/tools/bitbucket/types'
import {
  BITBUCKET_PAGE_OUTPUT,
  BITBUCKET_WORKSPACE_OUTPUT_PROPERTIES,
} from '@/tools/bitbucket/types'
import {
  BITBUCKET_ACCESS_TOKEN_PARAM,
  BITBUCKET_ERROR_EXTRACTOR,
  BITBUCKET_PAGINATION_PARAMS,
  BITBUCKET_READ_RETRY,
  bitbucketApiUrl,
  bitbucketHeaders,
  bitbucketJson,
  normalizeBitbucketPage,
  normalizeBitbucketWorkspaceAccess,
} from '@/tools/bitbucket/utils'
import { optionalBitbucketBoolean, optionalBitbucketString } from '@/tools/bitbucket/validation'
import type { ToolConfig } from '@/tools/types'

export const bitbucketListWorkspacesTool: ToolConfig<
  BitbucketListWorkspacesParams,
  BitbucketToolResponse<BitbucketListOutput<BitbucketWorkspaceAccess>>
> = {
  id: 'bitbucket_list_workspaces',
  name: 'Bitbucket List Workspaces',
  description: 'List Bitbucket Cloud workspaces available to the authenticated account',
  version: '1.0.0',
  oauth: { required: true, provider: 'bitbucket', requiredScopes: ['account'] },
  params: {
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Workspace sort field; Bitbucket currently supports slug',
    },
    administrator: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by whether the caller is a workspace administrator',
    },
    ...BITBUCKET_PAGINATION_PARAMS,
    accessToken: BITBUCKET_ACCESS_TOKEN_PARAM,
  },
  request: {
    url: (params) => {
      const administrator = optionalBitbucketBoolean(params.administrator, 'administrator')
      const sort = optionalBitbucketString(params.sort, 'sort')
      return bitbucketApiUrl('/user/workspaces', {
        nextUrl: params.nextUrl,
        pageLen: params.pageLen,
        query: { sort, administrator },
      })
    },
    method: 'GET',
    headers: (params) => bitbucketHeaders(params.accessToken),
    retry: BITBUCKET_READ_RETRY,
  },
  transformResponse: async (response) => ({
    success: true,
    output: normalizeBitbucketPage(
      await bitbucketJson(response),
      normalizeBitbucketWorkspaceAccess
    ),
  }),
  outputs: {
    items: {
      type: 'array',
      description: 'Workspace access records',
      items: { type: 'object', properties: BITBUCKET_WORKSPACE_OUTPUT_PROPERTIES },
    },
    page: BITBUCKET_PAGE_OUTPUT,
  },
  errorExtractor: BITBUCKET_ERROR_EXTRACTOR,
}
