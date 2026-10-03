import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { NetSuiteListRecordsParams } from '@/tools/netsuite/types'
import {
  buildRecordPath,
  executeNetSuiteRequest,
  normalizePagination,
  optionalTrim,
} from '@/tools/netsuite/utils'

export const executeNetsuiteListRecordsOperation: InternalToolOperationImplementation<
  NetSuiteListRecordsParams
> = (params, signal) =>
  executeNetSuiteRequest(
    params,
    () => ({
      method: 'GET',
      path: buildRecordPath({ value: params.recordType, label: 'Record type' }),
      success: { status: 200, body: 'object', validator: 'collection-page' },
      query: {
        ...normalizePagination(params.limit, params.offset),
        q: optionalTrim(params.q, 'Filter'),
      },
    }),
    signal
  )
