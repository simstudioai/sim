import type {
  BitbucketGetPipelineStepLogParams,
  BitbucketToolResponse,
} from '@/tools/bitbucket/types'
import {
  assertBitbucketResponseOk,
  BITBUCKET_API_BASE,
  BITBUCKET_DEFAULT_LOG_CHARACTERS,
  BITBUCKET_ERROR_EXTRACTOR,
  BITBUCKET_LOG_TRANSFER_MAX_BYTES,
  BITBUCKET_READ_RETRY,
  BITBUCKET_REPOSITORY_PARAMS,
  bitbucketHeaders,
  bitbucketMaxCharacters,
  bitbucketRawTail,
  bitbucketRepositoryPath,
  bitbucketTailRange,
  encodeBitbucketSegment,
} from '@/tools/bitbucket/utils'
import type { ToolConfig } from '@/tools/types'

interface BitbucketPipelineLogOutput {
  log: string
  truncated: boolean
  totalBytes: number | null
}

/** A suffix range against an empty log is unsatisfiable; Bitbucket answers 416 rather than 200. */
const BITBUCKET_RANGE_NOT_SATISFIABLE = 416
/** RFC 7233 unsatisfied-range header for a zero-length log; any other 416 is a genuine failure. */
const EMPTY_CONTENT_RANGE_PATTERN = /^bytes \*\/0$/

function stepLogUrl(params: BitbucketGetPipelineStepLogParams): string {
  return `${BITBUCKET_API_BASE}${bitbucketRepositoryPath(params.workspaceSlug, params.repoSlug)}/pipelines/${encodeBitbucketSegment(params.pipelineUuid, 'pipelineUuid')}/steps/${encodeBitbucketSegment(params.stepUuid, 'stepUuid')}/log`
}

export const bitbucketGetPipelineStepLogTool: ToolConfig<
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
  directExecution: async (params, signal) => {
    bitbucketMaxCharacters(params.maxCharacters, true)
    const { secureBitbucketRead } = await import('@/tools/bitbucket/utils.server')
    const response = await secureBitbucketRead(
      stepLogUrl(params),
      bitbucketHeaders(params.accessToken, {
        json: false,
        range: bitbucketTailRange(params.maxCharacters),
      }),
      BITBUCKET_LOG_TRANSFER_MAX_BYTES,
      { stripAuthOnRedirect: true, signal }
    )
    if (
      response.status === BITBUCKET_RANGE_NOT_SATISFIABLE &&
      EMPTY_CONTENT_RANGE_PATTERN.test(response.headers.get('content-range') ?? '')
    ) {
      await response.body?.cancel()
      return { success: true, output: { log: '', truncated: false, totalBytes: 0 } }
    }
    await assertBitbucketResponseOk(response)
    return { success: true, output: await bitbucketRawTail(response, params.maxCharacters) }
  },
  request: {
    url: stepLogUrl,
    method: 'GET',
    headers: (params) =>
      bitbucketHeaders(params.accessToken, {
        json: false,
        range: bitbucketTailRange(params.maxCharacters),
      }),
    retry: BITBUCKET_READ_RETRY,
    stripAuthOnRedirect: true,
  },
  transformResponse: async () => {
    throw new Error('Bitbucket step-log reads require the byte-capped direct execution path')
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
