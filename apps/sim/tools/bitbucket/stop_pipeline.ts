import type { BitbucketPipelineParams, BitbucketToolResponse } from '@/tools/bitbucket/types'
import {
  BITBUCKET_API_BASE,
  BITBUCKET_ERROR_EXTRACTOR,
  BITBUCKET_REPOSITORY_PARAMS,
  bitbucketHeaders,
  bitbucketRepositoryPath,
  encodeBitbucketSegment,
} from '@/tools/bitbucket/utils'
import type { ToolConfig } from '@/tools/types'

export const bitbucketStopPipelineTool: ToolConfig<
  BitbucketPipelineParams,
  BitbucketToolResponse<{ stopped: boolean }>
> = {
  id: 'bitbucket_stop_pipeline',
  name: 'Bitbucket Stop Pipeline',
  description: 'Stop a running pipeline',
  version: '1.0.0',
  oauth: { required: true, provider: 'bitbucket', requiredScopes: ['pipeline:write'] },
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
      `${BITBUCKET_API_BASE}${bitbucketRepositoryPath(params.workspaceSlug, params.repoSlug)}/pipelines/${encodeBitbucketSegment(params.pipelineUuid, 'pipelineUuid')}/stopPipeline`,
    method: 'POST',
    headers: (params) => bitbucketHeaders(params.accessToken),
  },
  transformResponse: async (response) => {
    if (response.status !== 204) {
      throw new Error(`Bitbucket pipeline stop returned unexpected HTTP ${response.status}`)
    }
    return { success: true, output: { stopped: true } }
  },
  outputs: { stopped: { type: 'boolean', description: 'Whether the stop request succeeded' } },
  errorExtractor: BITBUCKET_ERROR_EXTRACTOR,
}
