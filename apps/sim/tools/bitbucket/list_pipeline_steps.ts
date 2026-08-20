import {
  BITBUCKET_PAGE_OUTPUT,
  BITBUCKET_PIPELINE_STEP_OUTPUT_PROPERTIES,
  type BitbucketListOutput,
  type BitbucketListPipelineStepsParams,
  type BitbucketPipelineStep,
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
  encodeBitbucketSegment,
  normalizeBitbucketPage,
  normalizeBitbucketPipelineStep,
} from '@/tools/bitbucket/utils'
import type { ToolConfig } from '@/tools/types'

export const bitbucketListPipelineStepsTool: ToolConfig<
  BitbucketListPipelineStepsParams,
  BitbucketToolResponse<BitbucketListOutput<BitbucketPipelineStep>>
> = {
  id: 'bitbucket_list_pipeline_steps',
  name: 'Bitbucket List Pipeline Steps',
  description: 'List the steps in a pipeline',
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
    ...BITBUCKET_PAGINATION_PARAMS,
  },
  request: {
    url: (params) =>
      bitbucketApiUrl(
        `${bitbucketRepositoryPath(params.workspaceSlug, params.repoSlug)}/pipelines/${encodeBitbucketSegment(params.pipelineUuid, 'pipelineUuid')}/steps`,
        { nextUrl: params.nextUrl, pageLen: params.pageLen }
      ),
    method: 'GET',
    headers: (params) => bitbucketHeaders(params.accessToken),
    retry: BITBUCKET_READ_RETRY,
  },
  transformResponse: async (response) => ({
    success: true,
    output: normalizeBitbucketPage(await bitbucketJson(response), normalizeBitbucketPipelineStep),
  }),
  outputs: {
    items: {
      type: 'array',
      description: 'Pipeline steps',
      items: { type: 'object', properties: BITBUCKET_PIPELINE_STEP_OUTPUT_PROPERTIES },
    },
    page: BITBUCKET_PAGE_OUTPUT,
  },
  errorExtractor: BITBUCKET_ERROR_EXTRACTOR,
}
