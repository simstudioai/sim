import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { NetSuiteTransformRecordParams } from '@/tools/netsuite/types'
import { buildRecordPath, executeNetSuiteRequest } from '@/tools/netsuite/utils'

export const executeNetsuiteTransformRecordOperation: InternalToolOperationImplementation<
  NetSuiteTransformRecordParams
> = (params, signal) =>
  executeNetSuiteRequest(
    params,
    () => ({
      method: 'POST',
      path: buildRecordPath(
        { value: params.recordType, label: 'Source record type' },
        { value: params.recordId, label: 'Record ID' },
        { value: '!transform', label: 'Transform operation' },
        { value: params.targetRecordType, label: 'Target record type' }
      ),
      success: { status: 204, body: 'none' },
      responseLocation: 'resource-optional',
      body: params.body ?? {},
    }),
    signal
  )
