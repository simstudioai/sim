import {
  BITBUCKET_COMMENT_OUTPUT_PROPERTIES,
  BITBUCKET_PAGE_OUTPUT,
  type BitbucketComment,
  type BitbucketListOutput,
  type BitbucketListPullRequestCommentsParams,
  type BitbucketToolResponse,
} from '@/tools/bitbucket/types'
import {
  BITBUCKET_ERROR_EXTRACTOR,
  BITBUCKET_PAGINATION_PARAMS,
  BITBUCKET_PULL_REQUEST_PARAMS,
  BITBUCKET_READ_RETRY,
  bitbucketApiUrl,
  bitbucketHeaders,
  bitbucketJson,
  bitbucketPullRequestPath,
  normalizeBitbucketComment,
  normalizeBitbucketPage,
} from '@/tools/bitbucket/utils'
import { optionalBitbucketString } from '@/tools/bitbucket/validation'
import type { ToolConfig } from '@/tools/types'

export const bitbucketListPullRequestCommentsTool: ToolConfig<
  BitbucketListPullRequestCommentsParams,
  BitbucketToolResponse<BitbucketListOutput<BitbucketComment>>
> = {
  id: 'bitbucket_list_pull_request_comments',
  name: 'Bitbucket List Pull Request Comments',
  description: 'List global, inline, and reply comments on a pull request',
  version: '1.0.0',
  oauth: { required: true, provider: 'bitbucket', requiredScopes: ['pullrequest'] },
  params: {
    ...BITBUCKET_PULL_REQUEST_PARAMS,
    q: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Bitbucket comment filtering expression',
    },
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Bitbucket comment sort expression',
    },
    ...BITBUCKET_PAGINATION_PARAMS,
  },
  request: {
    url: (params) => {
      const q = optionalBitbucketString(params.q, 'q')
      const sort = optionalBitbucketString(params.sort, 'sort')
      return bitbucketApiUrl(
        `${bitbucketPullRequestPath(params.workspaceSlug, params.repoSlug, params.prId)}/comments`,
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
    output: normalizeBitbucketPage(await bitbucketJson(response), normalizeBitbucketComment),
  }),
  outputs: {
    items: {
      type: 'array',
      description: 'Pull request comments',
      items: { type: 'object', properties: BITBUCKET_COMMENT_OUTPUT_PROPERTIES },
    },
    page: BITBUCKET_PAGE_OUTPUT,
  },
  errorExtractor: BITBUCKET_ERROR_EXTRACTOR,
}
