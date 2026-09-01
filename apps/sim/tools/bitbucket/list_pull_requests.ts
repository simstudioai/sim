import {
  BITBUCKET_PAGE_OUTPUT,
  BITBUCKET_PULL_REQUEST_OUTPUT_PROPERTIES,
  type BitbucketListOutput,
  type BitbucketListPullRequestsParams,
  type BitbucketPullRequest,
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
  normalizeBitbucketPage,
  normalizeBitbucketPullRequest,
} from '@/tools/bitbucket/utils'
import { optionalBitbucketEnum, optionalBitbucketString } from '@/tools/bitbucket/validation'
import type { ToolConfig } from '@/tools/types'

const BITBUCKET_PULL_REQUEST_STATES = ['OPEN', 'MERGED', 'DECLINED', 'SUPERSEDED'] as const

export const bitbucketListPullRequestsTool: ToolConfig<
  BitbucketListPullRequestsParams,
  BitbucketToolResponse<BitbucketListOutput<BitbucketPullRequest>>
> = {
  id: 'bitbucket_list_pull_requests',
  name: 'Bitbucket List Pull Requests',
  description: 'List pull requests in a Bitbucket Cloud repository',
  version: '1.0.0',
  oauth: { required: true, provider: 'bitbucket', requiredScopes: ['pullrequest'] },
  params: {
    ...BITBUCKET_REPOSITORY_PARAMS,
    state: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'State filter: OPEN, MERGED, DECLINED, or SUPERSEDED',
    },
    q: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Bitbucket pull request filtering expression',
    },
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Bitbucket pull request sort expression',
    },
    ...BITBUCKET_PAGINATION_PARAMS,
  },
  request: {
    url: (params) => {
      const state = optionalBitbucketEnum(params.state, 'state', BITBUCKET_PULL_REQUEST_STATES)
      const q = optionalBitbucketString(params.q, 'q')
      const sort = optionalBitbucketString(params.sort, 'sort')
      return bitbucketApiUrl(
        `${bitbucketRepositoryPath(params.workspaceSlug, params.repoSlug)}/pullrequests`,
        {
          nextUrl: params.nextUrl,
          pageLen: params.pageLen,
          query: { state, q, sort },
        }
      )
    },
    method: 'GET',
    headers: (params) => bitbucketHeaders(params.accessToken),
    retry: BITBUCKET_READ_RETRY,
  },
  transformResponse: async (response) => ({
    success: true,
    output: normalizeBitbucketPage(await bitbucketJson(response), normalizeBitbucketPullRequest),
  }),
  outputs: {
    items: {
      type: 'array',
      description: 'Pull requests',
      items: { type: 'object', properties: BITBUCKET_PULL_REQUEST_OUTPUT_PROPERTIES },
    },
    page: BITBUCKET_PAGE_OUTPUT,
  },
  errorExtractor: BITBUCKET_ERROR_EXTRACTOR,
}
