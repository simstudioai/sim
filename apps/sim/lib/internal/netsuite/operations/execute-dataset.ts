import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { NetSuiteExecuteDatasetParams } from '@/tools/netsuite/types'
import {
  encodePathSegment,
  executeNetSuiteRequest,
  normalizePagination,
} from '@/tools/netsuite/utils'

export const executeNetsuiteExecuteDatasetOperation: InternalToolOperationImplementation<
  NetSuiteExecuteDatasetParams
> = (params, signal) =>
  executeNetSuiteRequest(
    params,
    () => ({
      method: 'GET',
      path: `/services/rest/query/v1/dataset/${encodePathSegment(params.datasetId, 'Dataset ID')}/result`,
      success: { status: 200, body: 'object', validator: 'collection-page' },
      query: normalizePagination(params.limit, params.offset),
    }),
    signal
  )
