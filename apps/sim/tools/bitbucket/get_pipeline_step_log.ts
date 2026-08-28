import type {
  BitbucketGetPipelineStepLogParams,
  BitbucketToolResponse,
} from '@/tools/bitbucket/types'
import {
  BITBUCKET_API_BASE,
  BITBUCKET_DEFAULT_LOG_CHARACTERS,
  BITBUCKET_ERROR_EXTRACTOR,
  BITBUCKET_REPOSITORY_PARAMS,
  bitbucketRepositoryPath,
  encodeBitbucketSegment,
} from '@/tools/bitbucket/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

interface BitbucketPipelineLogOutput {
  log: string
  truncated: boolean
  totalBytes: number | null
}

/** A suffix range against an empty log is unsatisfiable; Bitbucket answers 416 rather than 200. */
export const BITBUCKET_RANGE_NOT_SATISFIABLE = 416
/** RFC 7233 unsatisfied-range header for a zero-length log; any other 416 is a genuine failure. */
export const EMPTY_CONTENT_RANGE_PATTERN = /^bytes \*\/0$/

export function stepLogUrl(params: BitbucketGetPipelineStepLogParams): string {
  return `${BITBUCKET_API_BASE}${bitbucketRepositoryPath(params.workspaceSlug, params.repoSlug)}/pipelines/${encodeBitbucketSegment(params.pipelineUuid, 'pipelineUuid')}/steps/${encodeBitbucketSegment(params.stepUuid, 'stepUuid')}/log`
}

export const bitbucketGetPipelineStepLogTool: InternalToolConfig<
  BitbucketGetPipelineStepLogParams,
  BitbucketToolResponse<BitbucketPipelineLogOutput>
> = {
  id: 'bitbucket_get_pipeline_step_log',
  name: 'Bitbucket Get Pipeline Step Log',
  description: 'Read a bounded UTF-8 tail of a pipeline step log',
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
    stepUuid: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Pipeline step UUID',
    },
    maxCharacters: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum trailing log characters to return (1-200000)',
      default: BITBUCKET_DEFAULT_LOG_CHARACTERS,
    },
  },
  operation: {
    input: createInternalToolOperationInput,
  },
  outputs: {
    log: { type: 'string', description: 'Bounded trailing UTF-8 log text' },
    truncated: { type: 'boolean', description: 'Whether earlier log output was omitted' },
    totalBytes: {
      type: 'number',
      description: 'Full log byte size when reported',
      nullable: true,
    },
  },
  errorExtractor: BITBUCKET_ERROR_EXTRACTOR,
}
