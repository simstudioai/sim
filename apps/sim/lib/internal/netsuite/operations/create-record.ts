import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { NetSuiteCreateRecordParams } from '@/tools/netsuite/types'
import { buildRecordPath, executeNetSuiteRequest, optionalTrim } from '@/tools/netsuite/utils'

export const executeNetsuiteCreateRecordOperation: InternalToolOperationImplementation<
  NetSuiteCreateRecordParams
> = (params, signal) =>
  executeNetSuiteRequest(
    params,
    () => {
      const replace = optionalTrim(params.replace, 'Replace sublists')
      return {
        method: 'POST',
        path: buildRecordPath({ value: params.recordType, label: 'Record type' }),
        success: replace ? { status: 201, body: 'object' } : { status: 204, body: 'none' },
        responseLocation: 'resource',
        query: { replace },
        body: params.body,
      }
    },
    signal
  )
