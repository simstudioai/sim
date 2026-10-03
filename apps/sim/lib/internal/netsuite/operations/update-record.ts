import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { NetSuiteUpdateRecordParams } from '@/tools/netsuite/types'
import { buildRecordPath, executeNetSuiteRequest, optionalTrim } from '@/tools/netsuite/utils'

export const executeNetsuiteUpdateRecordOperation: InternalToolOperationImplementation<
  NetSuiteUpdateRecordParams
> = (params, signal) =>
  executeNetSuiteRequest(
    params,
    () => ({
      method: 'PATCH',
      path: buildRecordPath(
        { value: params.recordType, label: 'Record type' },
        { value: params.recordId, label: 'Record ID' }
      ),
      success: { status: 204, body: 'none' },
      responseLocation: 'resource',
      query: { replace: optionalTrim(params.replace, 'Replace sublists') },
      body: params.body,
    }),
    signal
  )
