import {
  BITBUCKET_PIPELINE_OUTPUT_PROPERTIES,
  type BitbucketPipeline,
  type BitbucketToolResponse,
  type BitbucketTriggerPipelineParams,
} from '@/tools/bitbucket/types'
import {
  BITBUCKET_API_BASE,
  BITBUCKET_ERROR_EXTRACTOR,
  BITBUCKET_REPOSITORY_PARAMS,
  bitbucketHeaders,
  bitbucketJson,
  bitbucketRepositoryPath,
  normalizeBitbucketPipeline,
  requireBitbucketString,
} from '@/tools/bitbucket/utils'
import { optionalBitbucketSha1, requireBitbucketEnum } from '@/tools/bitbucket/validation'
import type { ToolConfig } from '@/tools/types'

const BITBUCKET_PIPELINE_REF_TYPES = ['branch', 'tag', 'named_branch', 'bookmark'] as const

export const bitbucketTriggerPipelineTool: ToolConfig<
  BitbucketTriggerPipelineParams,
  BitbucketToolResponse<{ pipeline: BitbucketPipeline }>
> = {
  id: 'bitbucket_trigger_pipeline',
  name: 'Bitbucket Trigger Pipeline',
  description: 'Run the repository pipeline selected by a branch or ref target',
  version: '1.0.0',
  oauth: { required: true, provider: 'bitbucket', requiredScopes: ['pipeline'] },
  params: {
    ...BITBUCKET_REPOSITORY_PARAMS,
    refType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Reference type: branch, tag, named_branch, or bookmark',
    },
    refName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Reference name',
    },
    commitHash: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Full 40-character commit SHA-1 to run in the reference context',
    },
  },
  request: {
    url: (params) =>
      `${BITBUCKET_API_BASE}${bitbucketRepositoryPath(params.workspaceSlug, params.repoSlug)}/pipelines`,
    method: 'POST',
    headers: (params) => bitbucketHeaders(params.accessToken, { json: true }),
    body: (params) => {
      const commitHash = optionalBitbucketSha1(params.commitHash, 'commitHash')
      return {
        target: {
          type: 'pipeline_ref_target',
          ref_type: requireBitbucketEnum(params.refType, 'refType', BITBUCKET_PIPELINE_REF_TYPES),
          ref_name: requireBitbucketString(params.refName, 'refName'),
          ...(commitHash !== undefined ? { commit: { type: 'commit', hash: commitHash } } : {}),
        },
      }
    },
  },
  transformResponse: async (response) => ({
    success: true,
    output: { pipeline: normalizeBitbucketPipeline(await bitbucketJson(response)) },
  }),
  outputs: {
    pipeline: {
      type: 'object',
      description: 'Triggered pipeline',
      properties: BITBUCKET_PIPELINE_OUTPUT_PROPERTIES,
    },
  },
  errorExtractor: BITBUCKET_ERROR_EXTRACTOR,
}
