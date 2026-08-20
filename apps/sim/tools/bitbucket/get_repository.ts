import {
  BITBUCKET_REPOSITORY_OUTPUT_PROPERTIES,
  type BitbucketRepository,
  type BitbucketRepositoryParams,
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
  normalizeBitbucketRepository,
} from '@/tools/bitbucket/utils'
import type { ToolConfig } from '@/tools/types'

export const bitbucketGetRepositoryTool: ToolConfig<
  BitbucketRepositoryParams,
  BitbucketToolResponse<{ repository: BitbucketRepository }>
> = {
  id: 'bitbucket_get_repository',
  name: 'Bitbucket Get Repository',
  description: 'Get a Bitbucket Cloud repository',
  version: '1.0.0',
  oauth: { required: true, provider: 'bitbucket', requiredScopes: ['repository'] },
  params: { ...BITBUCKET_REPOSITORY_PARAMS },
  request: {
    url: (params) =>
      `${BITBUCKET_API_BASE}${bitbucketRepositoryPath(params.workspaceSlug, params.repoSlug)}`,
    method: 'GET',
    headers: (params) => bitbucketHeaders(params.accessToken),
    retry: BITBUCKET_READ_RETRY,
  },
  transformResponse: async (response) => ({
    success: true,
    output: { repository: normalizeBitbucketRepository(await bitbucketJson(response)) },
  }),
  outputs: {
    repository: {
      type: 'object',
      description: 'Repository details',
      properties: BITBUCKET_REPOSITORY_OUTPUT_PROPERTIES,
    },
  },
  errorExtractor: BITBUCKET_ERROR_EXTRACTOR,
}
