import {
  BITBUCKET_COMMIT_OUTPUT_PROPERTIES,
  type BitbucketCommit,
  type BitbucketGetCommitParams,
  type BitbucketToolResponse,
} from '@/tools/bitbucket/types'
import {
  BITBUCKET_API_BASE,
  BITBUCKET_ERROR_EXTRACTOR,
  BITBUCKET_READ_RETRY,
  BITBUCKET_REPOSITORY_PARAMS,
  bitbucketHeaders,
  bitbucketJson,
  bitbucketRepositoryPath,
  encodeBitbucketSegment,
  normalizeBitbucketCommit,
} from '@/tools/bitbucket/utils'
import { requireBitbucketSha1 } from '@/tools/bitbucket/validation'
import type { ToolConfig } from '@/tools/types'

export const bitbucketGetCommitTool: ToolConfig<
  BitbucketGetCommitParams,
  BitbucketToolResponse<{ commit: BitbucketCommit }>
> = {
  id: 'bitbucket_get_commit',
  name: 'Bitbucket Get Commit',
  description: 'Get a repository commit by its full SHA-1',
  version: '1.0.0',
  oauth: { required: true, provider: 'bitbucket', requiredScopes: ['repository'] },
  params: {
    ...BITBUCKET_REPOSITORY_PARAMS,
    commit: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Full 40-character commit SHA-1',
    },
  },
  request: {
    url: (params) =>
      `${BITBUCKET_API_BASE}${bitbucketRepositoryPath(params.workspaceSlug, params.repoSlug)}/commit/${encodeBitbucketSegment(requireBitbucketSha1(params.commit, 'commit'), 'commit')}`,
    method: 'GET',
    headers: (params) => bitbucketHeaders(params.accessToken),
    retry: BITBUCKET_READ_RETRY,
  },
  transformResponse: async (response) => ({
    success: true,
    output: { commit: normalizeBitbucketCommit(await bitbucketJson(response)) },
  }),
  outputs: {
    commit: {
      type: 'object',
      description: 'Commit details',
      properties: BITBUCKET_COMMIT_OUTPUT_PROPERTIES,
    },
  },
  errorExtractor: BITBUCKET_ERROR_EXTRACTOR,
}
