import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { NetSuiteGetRecordParams } from '@/tools/netsuite/types'
import {
  buildRecordPath,
  executeNetSuiteRequest,
  normalizeOptionalBoolean,
  optionalTrim,
} from '@/tools/netsuite/utils'

export const executeNetsuiteGetRecordOperation: InternalToolOperationImplementation<
  NetSuiteGetRecordParams
> = (params, signal) =>
  executeNetSuiteRequest(
    params,
    () => ({
      method: 'GET',
      path: buildRecordPath(
        { value: params.recordType, label: 'Record type' },
        { value: params.recordId, label: 'Record ID' }
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
    }),
    signal
  )
