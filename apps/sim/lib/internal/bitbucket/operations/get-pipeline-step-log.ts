import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import {
  BITBUCKET_RANGE_NOT_SATISFIABLE,
  EMPTY_CONTENT_RANGE_PATTERN,
  stepLogUrl,
} from '@/tools/bitbucket/get_pipeline_step_log'
import type { BitbucketGetPipelineStepLogParams } from '@/tools/bitbucket/types'
import {
  assertBitbucketResponseOk,
  BITBUCKET_LOG_TRANSFER_MAX_BYTES,
  bitbucketHeaders,
  bitbucketMaxCharacters,
  bitbucketRawTail,
  bitbucketTailRange,
} from '@/tools/bitbucket/utils'

export const executeBitbucketGetPipelineStepLogOperation: InternalToolOperationImplementation<
  BitbucketGetPipelineStepLogParams
> = async (params, signal) => {
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
}
