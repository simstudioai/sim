import {
  BITBUCKET_COMMIT_OUTPUT_PROPERTIES,
  BITBUCKET_PAGE_OUTPUT,
  type BitbucketCommit,
  type BitbucketListCommitsParams,
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
  normalizeBitbucketCommit,
  normalizeBitbucketPage,
} from '@/tools/bitbucket/utils'
import type { ToolConfig } from '@/tools/types'

export const bitbucketListCommitsTool: ToolConfig<
  BitbucketListCommitsParams,
  BitbucketToolResponse<BitbucketListOutput<BitbucketCommit>>
> = {
  id: 'bitbucket_list_commits',
  name: 'Bitbucket List Commits',
  description: 'List repository commits in reverse chronological order',
  version: '1.0.0',
  oauth: { required: true, provider: 'bitbucket', requiredScopes: ['repository'] },
  params: { ...BITBUCKET_REPOSITORY_PARAMS, ...BITBUCKET_PAGINATION_PARAMS },
  request: {
    url: (params) =>
      bitbucketApiUrl(`${bitbucketRepositoryPath(params.workspaceSlug, params.repoSlug)}/commits`, {
        nextUrl: params.nextUrl,
        pageLen: params.pageLen,
      }),
    method: 'GET',
    headers: (params) => bitbucketHeaders(params.accessToken),
    retry: BITBUCKET_READ_RETRY,
  },
  transformResponse: async (response) => ({
    success: true,
    output: normalizeBitbucketPage(await bitbucketJson(response), normalizeBitbucketCommit),
  }),
  outputs: {
    items: {
      type: 'array',
      description: 'Commits',
      items: { type: 'object', properties: BITBUCKET_COMMIT_OUTPUT_PROPERTIES },
    },
    page: BITBUCKET_PAGE_OUTPUT,
  },
  errorExtractor: BITBUCKET_ERROR_EXTRACTOR,
}
