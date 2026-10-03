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

export const bitbucketRequestPullRequestChangesTool: ToolConfig<
  BitbucketPullRequestParams,
  BitbucketToolResponse<{ participant: BitbucketParticipant }>
> = {
  id: 'bitbucket_request_pull_request_changes',
  name: 'Bitbucket Request Pull Request Changes',
  description: 'Request changes on a pull request as the authenticated account',
  version: '1.0.0',
  oauth: { required: true, provider: 'bitbucket', requiredScopes: ['pullrequest:write'] },
  params: { ...BITBUCKET_PULL_REQUEST_PARAMS },
  request: {
    url: (params) =>
      `${BITBUCKET_API_BASE}${bitbucketPullRequestPath(params.workspaceSlug, params.repoSlug, params.prId)}/request-changes`,
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
      description: 'Change-request participant record',
      properties: BITBUCKET_PARTICIPANT_OUTPUT_PROPERTIES,
    },
  },
  errorExtractor: BITBUCKET_ERROR_EXTRACTOR,
}
