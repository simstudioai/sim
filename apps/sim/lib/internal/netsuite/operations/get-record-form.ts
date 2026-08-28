import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { NetSuiteGetRecordFormParams } from '@/tools/netsuite/types'
import {
  buildRecordPath,
  executeNetSuiteRequest,
  normalizeOptionalBoolean,
  optionalTrim,
} from '@/tools/netsuite/utils'

export const executeNetsuiteGetRecordFormOperation: InternalToolOperationImplementation<
  NetSuiteGetRecordFormParams
> = (params, signal) =>
  executeNetSuiteRequest(
    params,
    () => {
      const recordId = optionalTrim(params.recordId)
      return {
        method: recordId ? 'PATCH' : 'POST',
        path: buildRecordPath(
          { value: params.recordType, label: 'Record type' },
          ...(recordId ? [{ value: recordId, label: 'Record ID' }] : [])
        ),
        success: { status: 200, body: 'object' },
        query: {
          fields: optionalTrim(params.fields),
          expand: optionalTrim(params.expand),
          expandSubResources: normalizeOptionalBoolean(
            params.expandSubResources,
            'Expand subresources'
          ),
        },
        headers: {
          Accept: `application/vnd.oracle.resource+json; type=${recordId ? 'edit-form' : 'create-form'}`,
        },
        body: params.body ?? {},
      }
    },
    signal
  )
