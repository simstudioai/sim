import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { NetSuiteBatchDeleteParams } from '@/tools/netsuite/types'
import {
  buildRecordPath,
  executeNetSuiteRequest,
  normalizeBatchIds,
  optionalTrim,
} from '@/tools/netsuite/utils'

export const executeNetsuiteBatchDeleteRecordsOperation: InternalToolOperationImplementation<
  NetSuiteBatchDeleteParams
> = (params, signal) =>
  executeNetSuiteRequest(
    params,
    () => {
      const idempotencyKey = optionalTrim(params.idempotencyKey, 'Idempotency key')
      return {
        method: 'DELETE',
        path: buildRecordPath({ value: params.recordType, label: 'Record type' }),
        success: { status: 202, body: 'none' },
        responseLocation: 'async-job',
        query: { ids: normalizeBatchIds(params.ids) },
        headers: {
          Prefer: 'respond-async',
          ...(idempotencyKey ? { 'X-NetSuite-idempotency-key': idempotencyKey } : {}),
        },
      }
    },
    signal
  )
