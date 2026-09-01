import {
  BITBUCKET_BRANCH_OUTPUT_PROPERTIES,
  BITBUCKET_PAGE_OUTPUT,
  type BitbucketBranch,
  type BitbucketListBranchesParams,
  type BitbucketListOutput,
  type BitbucketToolResponse,
} from '@/tools/bitbucket/types'
import {
  BITBUCKET_ERROR_EXTRACTOR,
  BITBUCKET_PAGINATION_PARAMS,
  BITBUCKET_READ_RETRY,
  BITBUCKET_REPOSITORY_PARAMS,
  bitbucketApiUrl,
  bitbucketHeaders,
  bitbucketJson,
  bitbucketRepositoryPath,
  normalizeBitbucketBranch,
  normalizeBitbucketPage,
} from '@/tools/bitbucket/utils'
import { optionalBitbucketString } from '@/tools/bitbucket/validation'
import type { ToolConfig } from '@/tools/types'

export const bitbucketListBranchesTool: ToolConfig<
  BitbucketListBranchesParams,
  BitbucketToolResponse<BitbucketListOutput<BitbucketBranch>>
> = {
  id: 'bitbucket_list_branches',
  name: 'Bitbucket List Branches',
  description: 'List branches in a Bitbucket Cloud repository',
  version: '1.0.0',
  oauth: { required: true, provider: 'bitbucket', requiredScopes: ['repository'] },
  params: {
    ...BITBUCKET_REPOSITORY_PARAMS,
    q: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Bitbucket branch filtering expression',
    },
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Bitbucket branch sort expression',
    },
    ...BITBUCKET_PAGINATION_PARAMS,
  },
  request: {
    url: (params) => {
      const q = optionalBitbucketString(params.q, 'q')
      const sort = optionalBitbucketString(params.sort, 'sort')
      return bitbucketApiUrl(
        `${bitbucketRepositoryPath(params.workspaceSlug, params.repoSlug)}/refs/branches`,
        {
          nextUrl: params.nextUrl,
          pageLen: params.pageLen,
          query: { q, sort },
        }
      )
    },
    method: 'GET',
    headers: (params) => bitbucketHeaders(params.accessToken),
    retry: BITBUCKET_READ_RETRY,
  },
  transformResponse: async (response) => ({
    success: true,
    output: normalizeBitbucketPage(await bitbucketJson(response), normalizeBitbucketBranch),
  }),
  outputs: {
    items: {
      type: 'array',
      description: 'Branches',
      items: { type: 'object', properties: BITBUCKET_BRANCH_OUTPUT_PROPERTIES },
    },
    page: BITBUCKET_PAGE_OUTPUT,
  },
  errorExtractor: BITBUCKET_ERROR_EXTRACTOR,
}
