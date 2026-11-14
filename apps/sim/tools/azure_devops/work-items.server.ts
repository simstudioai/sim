import { outboundFetch } from '@/lib/core/network/outbound-fetch.server'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseJsonWithLimit,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import type { AzureDevOpsWorkItem } from '@/tools/azure_devops/types'
import {
  type AzureDevOpsRawWorkItem,
  azureDevOpsProjectUrl,
  mapWorkItem,
} from '@/tools/azure_devops/utils'

/** Work Items - List accepts at most 200 ids per request. */
export const WORK_ITEMS_BATCH_SIZE = 200

/**
 * Fetches one Work Items - List chunk with `$expand=all`, bounded to the buffered
 * transfer cap (100 MB) and cancelled with the tool call.
 */
export async function fetchWorkItemsChunk(
  params: { organization: string; project: string; accessToken: string },
  ids: Array<string | number>,
  errorPrefix: string,
  signal?: AbortSignal
): Promise<AzureDevOpsWorkItem[]> {
  const url = new URL(`${azureDevOpsProjectUrl(params)}/_apis/wit/workitems`)
  url.searchParams.set('ids', ids.join(','))
  url.searchParams.set('$expand', 'all')
  url.searchParams.set('api-version', '7.2-preview.3')

  const response = await outboundFetch(url.toString(), {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`:${params.accessToken}`)}`,
    },
    signal,
  })

  if (!response.ok) {
    const errorBody = await readResponseTextWithLimit(response, {
      maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
      label: 'Azure DevOps work items error body',
      signal,
    }).catch(() => '')
    throw new Error(`${errorPrefix} (${response.status}): ${errorBody || response.statusText}`)
  }

  const data = await readResponseJsonWithLimit<{ value?: AzureDevOpsRawWorkItem[] }>(response, {
    maxBytes: MAX_BUFFERED_TRANSFER_BYTES,
    label: 'Azure DevOps work items response',
    signal,
  })
  return (data.value ?? []).map((raw: AzureDevOpsRawWorkItem) =>
    mapWorkItem(raw, { includeRawDetails: false })
  )
}
