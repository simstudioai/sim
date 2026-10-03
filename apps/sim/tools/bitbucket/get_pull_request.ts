import {
  BITBUCKET_PULL_REQUEST_OUTPUT_PROPERTIES,
  type BitbucketPullRequest,
  type BitbucketPullRequestParams,
  type BitbucketToolResponse,
} from '@/tools/bitbucket/types'
import {
  BITBUCKET_API_BASE,
  BITBUCKET_ERROR_EXTRACTOR,
  BITBUCKET_PULL_REQUEST_PARAMS,
  BITBUCKET_READ_RETRY,
  bitbucketHeaders,
  bitbucketJson,
  bitbucketPullRequestPath,
  normalizeBitbucketPullRequest,
} from '@/tools/bitbucket/utils'
import type { ToolConfig } from '@/tools/types'

export const bitbucketGetPullRequestTool: ToolConfig<
  BitbucketPullRequestParams,
  BitbucketToolResponse<{ pullRequest: BitbucketPullRequest }>
> = {
  id: 'bitbucket_get_pull_request',
  name: 'Bitbucket Get Pull Request',
  description: 'Get a pull request by repository-scoped ID',
  version: '1.0.0',
  oauth: { required: true, provider: 'bitbucket', requiredScopes: ['pullrequest'] },
  params: { ...BITBUCKET_PULL_REQUEST_PARAMS },
  request: {
    url: (params) =>
      `${BITBUCKET_API_BASE}${bitbucketPullRequestPath(params.workspaceSlug, params.repoSlug, params.prId)}`,
    method: 'GET',
    headers: (params) => bitbucketHeaders(params.accessToken),
    retry: BITBUCKET_READ_RETRY,
  },
  transformResponse: async (response) => ({
    success: true,
    output: { pullRequest: normalizeBitbucketPullRequest(await bitbucketJson(response)) },
  }),
  outputs: {
    pullRequest: {
      type: 'object',
      description: 'Pull request details',
      properties: BITBUCKET_PULL_REQUEST_OUTPUT_PROPERTIES,
    },
  },
  errorExtractor: BITBUCKET_ERROR_EXTRACTOR,
}
