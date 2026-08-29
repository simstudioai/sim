import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { NetSuiteGetSelectOptionsParams } from '@/tools/netsuite/types'
import {
  buildRecordPath,
  executeNetSuiteRequest,
  normalizePagination,
  optionalTrim,
  requiredTrim,
} from '@/tools/netsuite/utils'

export const executeNetsuiteGetSelectOptionsOperation: InternalToolOperationImplementation<
  NetSuiteGetSelectOptionsParams
> = (params, signal) =>
  executeNetSuiteRequest(
    params,
    () => {
      const recordId = optionalTrim(params.recordId)
      const pagination = normalizePagination(params.limit, params.offset)
      return {
        method: recordId ? 'PATCH' : 'POST',
        path: buildRecordPath(
          { value: params.recordType, label: 'Record type' },
          ...(recordId ? [{ value: recordId, label: 'Record ID' }] : [])
        ),
        success: { status: 200, body: 'object' },
        query: {
          ...pagination,
          fields: requiredTrim(params.fields, 'Fields'),
          q: optionalTrim(params.q),
        },
        headers: { Accept: 'application/vnd.oracle.resource+json; type=select-options' },
        body: params.body ?? {},
      }
    },
    signal
  )
