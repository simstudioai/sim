import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { UpdateSloParams } from '@/tools/datadog/types'
import {
  datadogApiUrl,
  datadogErrorMessage,
  datadogHeaders,
  datadogPathSegment,
  mergeSloUpdatePayload,
} from '@/tools/datadog/utils'

export const executeUpdateSloOperation: InternalToolOperationImplementation<
  UpdateSloParams
> = async (params, signal) => {
  const url = datadogApiUrl(params.site, `/api/v1/slo/${datadogPathSegment(params.sloId)}`)
  const headers = datadogHeaders(params)

  const existingResponse = await fetch(url, { method: 'GET', headers, signal })
  if (!existingResponse.ok) {
    return {
      success: false,
      output: { slo: { id: '', name: '', type: '' } },
      error: `Could not load SLO ${params.sloId} before updating it: ${await datadogErrorMessage(existingResponse)}`,
    }
  }

  const existing = await existingResponse.json()
  const stored = existing.data
  if (!stored || typeof stored !== 'object') {
    return {
      success: false,
      output: { slo: { id: '', name: '', type: '' } },
      error: `Datadog returned no SLO for id ${params.sloId}`,
    }
  }

  const response = await fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify(mergeSloUpdatePayload(stored, params)),
    signal,
  })

  if (!response.ok) {
    return {
      success: false,
      output: { slo: { id: '', name: '', type: '' } },
      error: await datadogErrorMessage(response),
    }
  }

  const data = await response.json()

  return {
    success: true,
    output: { slo: data.data?.[0] ?? { id: '', name: '', type: '' } },
  }
}
