import {
  BITBUCKET_PIPELINE_OUTPUT_PROPERTIES,
  type BitbucketPipeline,
  type BitbucketPipelineParams,
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
  normalizeBitbucketPipeline,
} from '@/tools/bitbucket/utils'
import type { ToolConfig } from '@/tools/types'

export const bitbucketGetPipelineTool: ToolConfig<
  BitbucketPipelineParams,
  BitbucketToolResponse<{ pipeline: BitbucketPipeline }>
> = {
  id: 'bitbucket_get_pipeline',
  name: 'Bitbucket Get Pipeline',
  description: 'Get a pipeline by UUID',
  version: '1.0.0',
  oauth: { required: true, provider: 'bitbucket', requiredScopes: ['pipeline'] },
  params: {
    ...BITBUCKET_REPOSITORY_PARAMS,
    pipelineUuid: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Pipeline UUID',
    },
  },
  request: {
    url: (params) =>
      `${BITBUCKET_API_BASE}${bitbucketRepositoryPath(params.workspaceSlug, params.repoSlug)}/pipelines/${encodeBitbucketSegment(params.pipelineUuid, 'pipelineUuid')}`,
    method: 'GET',
    headers: (params) => bitbucketHeaders(params.accessToken),
    retry: BITBUCKET_READ_RETRY,
  },
  transformResponse: async (response) => ({
    success: true,
    output: { pipeline: normalizeBitbucketPipeline(await bitbucketJson(response)) },
  }),
  outputs: {
    pipeline: {
      type: 'object',
      description: 'Pipeline details',
      properties: BITBUCKET_PIPELINE_OUTPUT_PROPERTIES,
    },
  },
  errorExtractor: BITBUCKET_ERROR_EXTRACTOR,
}
