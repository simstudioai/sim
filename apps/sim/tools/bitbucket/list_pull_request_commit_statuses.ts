import {
  BITBUCKET_COMMIT_STATUS_OUTPUT_PROPERTIES,
  BITBUCKET_PAGE_OUTPUT,
  type BitbucketCommitStatus,
  type BitbucketListOutput,
  type BitbucketListPullRequestCommitStatusesParams,
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
  normalizeBitbucketCommitStatus,
  normalizeBitbucketPage,
} from '@/tools/bitbucket/utils'
import type { ToolConfig } from '@/tools/types'

export const bitbucketListPullRequestCommitStatusesTool: ToolConfig<
  BitbucketListPullRequestCommitStatusesParams,
  BitbucketToolResponse<BitbucketListOutput<BitbucketCommitStatus>>
> = {
  id: 'bitbucket_list_pull_request_commit_statuses',
  name: 'Bitbucket List Pull Request Commit Statuses',
  description: 'List commit statuses associated with a pull request',
  version: '1.0.0',
  oauth: { required: true, provider: 'bitbucket', requiredScopes: ['pullrequest'] },
  params: {
    ...BITBUCKET_PULL_REQUEST_PARAMS,
    q: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Bitbucket commit status filtering expression',
    },
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Bitbucket commit status sort expression',
    },
    ...BITBUCKET_PAGINATION_PARAMS,
  },
  request: {
    url: (params) =>
      bitbucketApiUrl(
        `${bitbucketPullRequestPath(params.workspaceSlug, params.repoSlug, params.prId)}/statuses`,
        {
          nextUrl: params.nextUrl,
          pageLen: params.pageLen,
          query: { q: params.q, sort: params.sort },
        }
      ),
    method: 'GET',
    headers: (params) => bitbucketHeaders(params.accessToken),
    retry: BITBUCKET_READ_RETRY,
  },
  transformResponse: async (response) => ({
    success: true,
    output: normalizeBitbucketPage(await bitbucketJson(response), normalizeBitbucketCommitStatus),
  }),
  outputs: {
    items: {
      type: 'array',
      description: 'Pull request commit statuses',
      items: { type: 'object', properties: BITBUCKET_COMMIT_STATUS_OUTPUT_PROPERTIES },
    },
    page: BITBUCKET_PAGE_OUTPUT,
  },
  errorExtractor: BITBUCKET_ERROR_EXTRACTOR,
}
