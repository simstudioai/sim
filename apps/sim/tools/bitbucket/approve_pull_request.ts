import {
  BITBUCKET_PARTICIPANT_OUTPUT_PROPERTIES,
  type BitbucketParticipant,
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
  normalizeBitbucketParticipant,
} from '@/tools/bitbucket/utils'
import type { ToolConfig } from '@/tools/types'

export const bitbucketApprovePullRequestTool: ToolConfig<
  BitbucketPullRequestParams,
  BitbucketToolResponse<{ participant: BitbucketParticipant }>
> = {
  id: 'bitbucket_approve_pull_request',
  name: 'Bitbucket Approve Pull Request',
  description: 'Approve a pull request as the authenticated account',
  version: '1.0.0',
  oauth: { required: true, provider: 'bitbucket', requiredScopes: ['pullrequest:write'] },
  params: { ...BITBUCKET_PULL_REQUEST_PARAMS },
  request: {
    url: (params) =>
      `${BITBUCKET_API_BASE}${bitbucketPullRequestPath(params.workspaceSlug, params.repoSlug, params.prId)}/approve`,
    method: 'POST',
    headers: (params) => bitbucketHeaders(params.accessToken),
  },
  transformResponse: async (response) => ({
    success: true,
    output: { participant: normalizeBitbucketParticipant(await bitbucketJson(response)) },
  }),
  outputs: {
    participant: {
      type: 'object',
      description: 'Approval participant record',
      properties: BITBUCKET_PARTICIPANT_OUTPUT_PROPERTIES,
    },
  },
  errorExtractor: BITBUCKET_ERROR_EXTRACTOR,
}
