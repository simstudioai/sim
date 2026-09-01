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
  bitbucketHeaders,
  bitbucketJson,
  bitbucketPullRequestPath,
  normalizeBitbucketPullRequest,
} from '@/tools/bitbucket/utils'
import type { ToolConfig } from '@/tools/types'

export const bitbucketDeclinePullRequestTool: ToolConfig<
  BitbucketPullRequestParams,
  BitbucketToolResponse<{ pullRequest: BitbucketPullRequest }>
> = {
  id: 'bitbucket_decline_pull_request',
  name: 'Bitbucket Decline Pull Request',
  description: 'Decline an open pull request',
  version: '1.0.0',
  oauth: { required: true, provider: 'bitbucket', requiredScopes: ['pullrequest:write'] },
  params: { ...BITBUCKET_PULL_REQUEST_PARAMS },
  request: {
    url: (params) =>
      `${BITBUCKET_API_BASE}${bitbucketPullRequestPath(params.workspaceSlug, params.repoSlug, params.prId)}/decline`,
    method: 'POST',
    headers: (params) => bitbucketHeaders(params.accessToken),
  },
  transformResponse: async (response) => ({
    success: true,
    output: { pullRequest: normalizeBitbucketPullRequest(await bitbucketJson(response)) },
  }),
  outputs: {
    pullRequest: {
      type: 'object',
      description: 'Declined pull request',
      properties: BITBUCKET_PULL_REQUEST_OUTPUT_PROPERTIES,
    },
  },
  errorExtractor: BITBUCKET_ERROR_EXTRACTOR,
}
