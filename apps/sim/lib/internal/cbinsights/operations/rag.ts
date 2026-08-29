import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { CbInsightsRagParams } from '@/tools/cbinsights/rag'
import {
  asString,
  asStringArray,
  cbInsightsRequest,
  parseOptionalStringParam,
} from '@/tools/cbinsights/utils'

export const executeCbinsightsRagOperation: InternalToolOperationImplementation<
  CbInsightsRagParams
> = async (params, signal) => {
  const message = parseOptionalStringParam(params.message, 'message')
  if (!message) throw new Error('CB Insights "message" is required')
  if (message.length >= 10_000) {
    throw new Error('CB Insights "message" must be under 10,000 characters')
  }

  return cbInsightsRequest<{ data?: unknown; guidance?: unknown }>(
    params,
    { path: '/v2/cbirag', body: { message } },
    (data) => ({ data: asString(data.data), guidance: asStringArray(data.guidance) }),
    signal
  )
}
