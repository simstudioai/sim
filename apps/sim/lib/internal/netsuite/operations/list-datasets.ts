import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { NetSuiteListDatasetsParams } from '@/tools/netsuite/types'
import { executeNetSuiteRequest, normalizePagination } from '@/tools/netsuite/utils'

export const executeNetsuiteListDatasetsOperation: InternalToolOperationImplementation<
  NetSuiteListDatasetsParams
> = (params, signal) =>
  executeNetSuiteRequest(
    params,
    () => ({
      method: 'GET',
      path: '/services/rest/query/v1/dataset/',
      success: { status: 200, body: 'object', validator: 'collection-page' },
      query: normalizePagination(params.limit, params.offset),
    }),
    signal
  )
