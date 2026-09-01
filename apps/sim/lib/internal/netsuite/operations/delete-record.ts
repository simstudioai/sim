import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { NetSuiteDeleteRecordParams } from '@/tools/netsuite/types'
import { buildRecordPath, executeNetSuiteRequest } from '@/tools/netsuite/utils'

export const executeNetsuiteDeleteRecordOperation: InternalToolOperationImplementation<
  NetSuiteDeleteRecordParams
> = (params, signal) =>
  executeNetSuiteRequest(
    params,
    () => ({
      method: 'DELETE',
      path: buildRecordPath(
        { value: params.recordType, label: 'Record type' },
        { value: params.recordId, label: 'Record ID' }
      ),
      success: { status: 204, body: 'none' },
    }),
    signal
  )
