import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { NetSuiteBatchGetParams } from '@/tools/netsuite/types'
import {
  buildRecordPath,
  executeNetSuiteRequest,
  normalizeBatchIds,
  normalizeOptionalBoolean,
  optionalTrim,
} from '@/tools/netsuite/utils'

export const executeNetsuiteBatchGetRecordsOperation: InternalToolOperationImplementation<
  NetSuiteBatchGetParams
> = (params, signal) =>
  executeNetSuiteRequest(
    params,
    () => {
      const idempotencyKey = optionalTrim(params.idempotencyKey, 'Idempotency key')
      return {
        method: 'GET',
        path: buildRecordPath({ value: params.recordType, label: 'Record type' }),
        success: { status: 202, body: 'none' },
        responseLocation: 'async-job',
        query: {
          expandRecords: true,
          ids: normalizeBatchIds(params.ids),
          fields: optionalTrim(params.fields, 'Fields'),
          expand: optionalTrim(params.expand, 'Expand'),
          expandSubResources: normalizeOptionalBoolean(
            params.expandSubResources,
            'Expand subresources'
          ),
        },
        headers: {
          Prefer: 'respond-async',
          ...(idempotencyKey ? { 'X-NetSuite-idempotency-key': idempotencyKey } : {}),
        },
      }
    },
    signal
  )
